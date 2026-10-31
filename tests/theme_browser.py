"""Production-only theme gate, using fresh profiles and synthetic financial data.

Run after building and starting the matching production preview:
  python tests/theme_browser.py --output ../work/theme-browser
The report explicitly scopes contrast checks; it is not a general accessibility audit.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import time
import traceback
from urllib.parse import urlsplit

from browser_support import (assert_production_url, install_playwright_path,
                             launch_browser, new_page, read_document, stored_document)
install_playwright_path()
from playwright.sync_api import sync_playwright, expect
from ux_browser import CONTRAST_JS, fixture as ordinary_fixture
from source_browser import fixture as source_fixture, make_statement

FINANCIAL_KEY = 'uangku:v1'
PREFERENCES_KEY = 'uangku:preferences:v1'
THEME_KEY = 'uangku:theme:v1'
PREFERENCES = {'currency': 'IDR', 'lastWallets': {
    'IDR': 'cash', 'TRY': 'try-bank', 'USD': 'synthetic-retained-usd'}}
MISSING = object()


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


# Observe before page scripts run. oldValue retains intermediate values even if
# two attribute changes occur in the same task. Null before bootstrap is allowed.
STARTUP_JS = r'''(() => {
  const trace = window.__themeStartup = {attributes: [], frames: []};
  const record = value => { if (value !== null) trace.attributes.push(value); };
  record(document.documentElement?.getAttribute('data-theme') ?? null);
  new MutationObserver(records => {
    for (const change of records) {
      if (change.type === 'attributes' && change.target === document.documentElement) {
        record(change.oldValue); record(change.target.getAttribute('data-theme'));
      }
    }
  }).observe(document, {subtree: true, attributes: true,
      attributeOldValue: true, attributeFilter: ['data-theme']});
  requestAnimationFrame(() => {
    trace.frames.push(document.documentElement?.getAttribute('data-theme') ?? null);
    requestAnimationFrame(() => trace.frames.push(document.documentElement?.getAttribute('data-theme') ?? null));
  });
})();'''

# Use the existing text audit, scoped to the modal when its backdrop obscures the
# page. Native input values, selected option text, and placeholders need separate
# samples because they are not ordinary DOM text nodes.
TEXT_CONTRAST_JS = CONTRAST_JS.replace(
    'document.body,NodeFilter',
    "(document.querySelector('[role=dialog]') ?? document.body),NodeFilter")
CONTROL_CONTRAST_JS = r'''() => {
 const parse = text => {const n=text.match(/[\d.]+/g)?.map(Number)??[];return [...n.slice(0,3),n[3]??1];};
 const over = (fg,bg) => [0,1,2].map(i=>fg[i]*fg[3]+bg[i]*(1-fg[3]));
 const lum = rgb => rgb.map(v=>{const c=v/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;})
   .reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 const results=[],excluded={gradient:0,disabled:0,invisible:0};
 const root=document.querySelector('[role=dialog]')??document.body;
 for(const el of root.querySelectorAll('input:not([type=hidden]):not([type=file]),textarea,select')) {
   if(['checkbox','radio'].includes(el.type))continue;
   const cs=getComputedStyle(el),r=el.getBoundingClientRect();
   if(!r.width||!r.height||r.bottom<0||r.top>innerHeight||cs.visibility==='hidden'||cs.display==='none'){excluded.invisible++;continue;}
   if(el.matches(':disabled,[aria-disabled=true]')){excluded.disabled++;continue;}
   const ancestors=[];for(let a=el;a;a=a.parentElement)ancestors.unshift(a);
   if(ancestors.some(a=>getComputedStyle(a).backgroundImage!=='none')){excluded.gradient++;continue;}
   let bg=[255,255,255];for(const a of ancestors)bg=over(parse(getComputedStyle(a).backgroundColor),bg);
   const placeholder=!el.value&&!!el.placeholder;
   const style=placeholder?getComputedStyle(el,'::placeholder'):cs;
   const color=parse(style.color);if(placeholder)color[3]*=Number(style.opacity);
   const fg=over(color,bg),a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
   const text=placeholder?el.placeholder:el.tagName==='SELECT'?el.selectedOptions[0]?.text:el.value;
   if(!text)continue;
   const large=parseFloat(cs.fontSize)>=24||(parseFloat(cs.fontSize)>=18.6667&&Number(cs.fontWeight)>=700);
   results.push({kind:placeholder?'placeholder':'control-value',text:text.slice(0,90),
     label:el.getAttribute('aria-label'),foreground:style.color,background:bg,ratio,required:large?3:4.5});
 }
 return {samples:results.length,excluded,minimum:results.length?Math.min(...results.map(x=>x.ratio)):null,
   failures:results.filter(x=>x.ratio+.01<x.required),results};
}'''


def nav(page, name):
    scope = page.locator('.sidebar' if page.locator('.sidebar').is_visible() else '.mobile-nav')
    scope.get_by_role('button', name=re.compile('^' + re.escape(name) + r'(?:\s+\d+)?$')).click()


class Case:
    def __init__(self, browser, args, name, *, width=390, scheme='light', theme=MISSING,
                 financial=None, preferences=PREFERENCES, fault=None):
        self.name, self.args, self.width = name, args, width
        self.reports, self.issues, self.errors, self.traces = [], [], [], []
        self.comparisons = 0
        self.raw = compact(ordinary_fixture()) if financial is None else financial
        self.prefs = compact(preferences)
        parts = urlsplit(args.url)
        origin = f'{parts.scheme}://{parts.netloc}'
        items = [{'name': FINANCIAL_KEY, 'value': self.raw},
                 {'name': PREFERENCES_KEY, 'value': self.prefs}]
        if theme is not MISSING:
            items.append({'name': THEME_KEY, 'value': theme})
        self.context = browser.new_context(
            viewport={'width': width, 'height': 1000 if width == 1440 else 844},
            is_mobile=width < 600, has_touch=width < 600, color_scheme=scheme,
            timezone_id='Europe/Istanbul', accept_downloads=True,
            storage_state={'cookies': [], 'origins': [{'origin': origin, 'localStorage': items}]})
        init_script = STARTUP_JS
        # Keep a test-only reader for proving underlying synthetic bytes even
        # when the public storage API deliberately throws.
        init_script += r'''(() => {
          const get=Storage.prototype.getItem;
          window.__themeTestRead = key => get.call(localStorage,key);
        })();'''
        if fault:
            all_keys = fault.startswith('all-')
            methods = ['getItem', 'setItem'] if fault.endswith('read-write') else ['setItem']
            init_script += '''(() => {
              for (const method of %s) {
                const original=Storage.prototype[method];
                Storage.prototype[method]=function(key,...rest) {
                  if (%s || key===%s) throw new DOMException('Synthetic denied storage','SecurityError');
                  return original.call(this,key,...rest);
                };
              }
            })();''' % (compact(methods), 'true' if all_keys else 'false', compact(THEME_KEY))
        self.context.add_init_script(init_script)
        self.page = new_page(self.context)
        self.page.set_default_timeout(12_000)
        self.page.on('pageerror', lambda err: self.errors.append(str(err)))

    def goto(self):
        self.page.goto(self.args.url, wait_until='networkidle')
        expect(self.picker).to_be_visible()

    @property
    def picker(self):
        return self.page.get_by_label('Tema tampilan', exact=True)

    def resolved(self, preference, actual):
        expect(self.picker).to_have_value(preference)
        expect(self.page.locator('html')).to_have_attribute('data-theme', actual)

    def startup(self, actual):
        self.page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        trace = self.page.evaluate('window.__themeStartup')
        self.traces.append(trace)
        assert trace['attributes'], 'Startup never assigned data-theme'
        assert all(value == actual for value in trace['attributes']), trace
        assert trace['frames'] and all(value == actual for value in trace['frames']), trace

    def unchanged(self):
        values = self.page.evaluate('keys=>keys.map(key=>window.__themeTestRead(key))',
                                    [FINANCIAL_KEY, PREFERENCES_KEY])
        assert values == [self.raw, self.prefs], 'Theme/UI action changed financial or currency/lastWallets bytes'
        self.comparisons += 1

    def choose(self, value, actual=None):
        self.picker.select_option(value)
        self.resolved(value, actual or value)
        self.unchanged()

    def capture(self, state, *, screenshot=True):
        page = self.page
        page.evaluate('''async () => {
          await Promise.all(document.getAnimations().filter(animation =>
            animation.effect?.getComputedTiming().iterations !== Infinity
          ).map(animation => animation.finished.catch(() => {})));
        }''')
        target = page.locator('[role=dialog] .modal-body')
        modal = target.count() > 0
        extent = (target.evaluate('(el)=>Math.max(0,el.scrollHeight-el.clientHeight)') if modal
                  else page.evaluate('Math.max(0,document.documentElement.scrollHeight-innerHeight)'))
        offsets = sorted(set([0, round(extent / 2), extent]))
        for offset in offsets:
            if modal:
                target.evaluate('(el,y)=>el.scrollTop=y', offset)
            else:
                page.evaluate('(y)=>scrollTo(0,y)', offset)
            # Allow computed layout to follow the scroll without animation waits.
            for kind, script in [('text', TEXT_CONTRAST_JS), ('controls', CONTROL_CONTRAST_JS)]:
                report = page.evaluate(script)
                report.update({'state': state, 'kind': kind, 'scroll_offset': offset})
                self.reports.append(report)
                for failure in report['failures']:
                    self.issues.append({'state': state, 'kind': kind, **failure})
        if modal:
            target.evaluate('(el)=>el.scrollTop=0')
        else:
            page.evaluate('scrollTo(0,0)')
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'), state + ': horizontal page overflow'
        if modal:
            assert not page.locator('[role=dialog]').evaluate('(el)=>el.scrollWidth>el.clientWidth+1'), state + ': horizontal dialog overflow'
        else:
            expect(self.picker).to_be_visible()
            box = self.picker.bounding_box()
            assert box and box['x'] >= 0 and box['x'] + box['width'] <= self.width + 1, box
        self.unchanged()
        if screenshot:
            page.screenshot(path=str(self.args.output / f'{self.name}-{state}.png'), full_page=not modal)

    def finish(self):
        assert not self.errors, self.errors
        assert not self.issues, 'Contrast failures: ' + repr(self.issues[:16])

    def details(self):
        return {'read_only_comparisons': self.comparisons, 'startup_traces': self.traces,
                'financial_string_sha256_utf8': hashlib.sha256(self.raw.encode('utf-8')).hexdigest(),
                'preferences_preserved': json.loads(self.prefs),
                'contrasts': self.reports, 'contrast_failures': self.issues,
                'page_errors': self.errors}


def startup_case(case, scheme):
    case.goto()
    case.resolved('system', scheme)
    case.startup(scheme)
    expect(case.picker.locator('option')).to_have_text(['Sistem', 'Terang', 'Gelap'])
    case.unchanged()
    assert case.page.evaluate('(key)=>localStorage.getItem(key)', THEME_KEY) in [None, 'system']


def persistence_case(case, theme):
    case.goto()
    case.resolved(theme, theme)
    case.startup(theme)
    opposite = 'light' if theme == 'dark' else 'dark'
    case.choose(opposite)
    case.page.reload(wait_until='networkidle')
    case.resolved(opposite, opposite)
    case.startup(opposite)
    case.unchanged()
    case.choose(theme)
    case.page.reload(wait_until='networkidle')
    case.resolved(theme, theme)
    case.startup(theme)
    case.unchanged()


def system_and_keyboard(case):
    case.goto()
    case.resolved('system', 'dark')
    case.page.emulate_media(color_scheme='light')
    case.resolved('system', 'light')
    case.page.emulate_media(color_scheme='dark')
    case.resolved('system', 'dark')
    # Reach the native select using actual Tab navigation, then change it with
    # keyboard keys. No select_option or programmatic focus for this assertion.
    for _ in range(40):
        case.page.keyboard.press('Tab')
        if case.picker.evaluate('(el)=>el===document.activeElement'):
            break
    assert case.picker.evaluate('(el)=>el===document.activeElement'), 'Theme picker not keyboard reachable'
    case.page.keyboard.press('Home')
    case.page.keyboard.press('ArrowDown')
    case.resolved('light', 'light')
    case.page.emulate_media(color_scheme='light')
    case.page.emulate_media(color_scheme='dark')
    case.resolved('light', 'light')
    case.page.keyboard.press('End')
    case.resolved('dark', 'dark')
    case.page.emulate_media(color_scheme='light')
    case.resolved('dark', 'dark')
    case.page.keyboard.press('Home')
    case.resolved('system', 'light')
    case.page.emulate_media(color_scheme='dark')
    case.resolved('system', 'dark')
    case.unchanged()


def invalid_case(case):
    case.goto()
    case.resolved('system', 'dark')
    case.startup('dark')
    case.choose('light')
    case.page.reload(wait_until='networkidle')
    case.resolved('light', 'light')
    case.startup('light')
    case.unchanged()


def cross_tab_case(case):
    case.goto()
    second = new_page(case.context)
    second.set_default_timeout(12_000)
    second.on('pageerror', lambda error: case.errors.append('second tab: ' + str(error)))
    second.emulate_media(color_scheme='dark')
    second.goto(case.args.url, wait_until='networkidle')
    second_picker = second.get_by_label('Tema tampilan', exact=True)
    case.choose('dark')
    expect(second_picker).to_have_value('dark')
    expect(second.locator('html')).to_have_attribute('data-theme', 'dark')
    second_picker.select_option('light')
    case.resolved('light', 'light')
    case.unchanged()
    case.choose('system', 'light')
    expect(second_picker).to_have_value('system')
    expect(second.locator('html')).to_have_attribute('data-theme', 'dark')
    second.reload(wait_until='networkidle')
    expect(second_picker).to_have_value('system')
    expect(second.locator('html')).to_have_attribute('data-theme', 'dark')
    assert second.evaluate('keys=>keys.map(key=>window.__themeTestRead(key))',
                          [FINANCIAL_KEY, PREFERENCES_KEY]) == [case.raw, case.prefs]
    case.comparisons += 1
    case.unchanged()


def storage_failure_case(case, denied_read):
    case.goto()
    case.resolved('system' if denied_read else 'dark', 'dark')
    case.startup('dark')
    case.choose('light')
    expect(case.page.locator('.toast')).to_contain_text('Tema berlaku untuk sesi ini')
    case.page.emulate_media(color_scheme='dark')
    case.resolved('light', 'light')
    case.page.reload(wait_until='networkidle')
    case.resolved('system' if denied_read else 'dark', 'dark')
    case.unchanged()


def visual_case(case, theme):
    case.goto()
    case.choose(theme)
    page = case.page
    for label, state in [('Ringkasan', 'overview'), ('Dompet', 'wallets'),
                         ('Transaksi', 'transactions'), ('Impor mutasi', 'import')]:
        nav(page, label)
        case.capture(state)
    nav(page, 'Ringkasan')
    page.get_by_role('button', name='Catat transaksi', exact=True).click()
    dialog = page.get_by_role('dialog')
    expect(dialog.get_by_label('Dompet asal', exact=True)).to_have_value('cash')
    case.capture('ordinary-entry')
    dialog.get_by_role('button', name='Batal', exact=True).click()
    page.get_by_role('button', name='Pindah uang', exact=True).click()
    dialog = page.get_by_role('dialog')
    dialog.get_by_label('Dompet asal', exact=True).select_option('bank')
    dialog.get_by_label('Dompet tujuan', exact=True).select_option('try-bank')
    case.capture('fx-entry')
    dialog.get_by_label('Nominal', exact=True).fill('10')
    dialog.get_by_label('Kurs transaksi', exact=True).fill('0')
    expect(dialog.locator('#fx-input-feedback')).to_be_visible()
    expect(dialog.get_by_label('Kurs transaksi', exact=True)).to_have_attribute('aria-invalid', 'true')
    case.capture('fx-error')
    dialog.get_by_role('button', name='Batal', exact=True).click()
    nav(page, 'Transaksi')
    page.get_by_label('Cari transaksi', exact=True).fill('Synthetic exact large amount')
    page.get_by_role('button', name='Rincian nominal Synthetic exact large amount', exact=True).click()
    dialog = page.get_by_role('dialog', name='Rincian nominal', exact=True)
    expect(dialog).to_contain_text('90.071.992.540.000,01')
    expect(dialog.locator('input,select,textarea')).to_have_count(0)
    case.capture('read-only-large-detail')
    dialog.get_by_role('button', name='Tutup rincian', exact=True).click()
    page.get_by_label('Cari transaksi', exact=True).fill('Synthetic transfer detail')
    page.get_by_role('button', name='Rincian nominal Synthetic transfer detail', exact=True).click()
    dialog = page.get_by_role('dialog', name='Rincian nominal', exact=True)
    expect(dialog).to_contain_text('Total debit dompet asal')
    case.capture('read-only-transfer-detail')
    dialog.get_by_role('button', name='Tutup rincian', exact=True).click()
    privacy = page.get_by_role('button', name='Privasi dan cadangan', exact=True)
    (privacy if privacy.is_visible() else page.get_by_role('button', name='Privasi', exact=True)).click()
    case.capture('privacy-modal')
    page.get_by_role('button', name='Tutup penjelasan privasi', exact=True).click()
    case.choose('light' if theme == 'dark' else 'dark')
    case.choose(theme)
    page.reload(wait_until='networkidle')
    case.resolved(theme, theme)
    case.startup(theme)
    case.unchanged()


def download_backup(case, name):
    button = 'Cadangkan data' if case.page.locator('.sidebar').is_visible() else 'Cadangkan'
    with case.page.expect_download() as download:
        case.page.get_by_role('button', name=button, exact=True).click()
    path = case.args.output / name
    download.value.save_as(path)
    return path


def metadata_case(case):
    case.goto()
    nav(case.page, 'Impor mutasi')
    path = case.args.output / 'synthetic-theme-statement.xlsx'
    make_statement(path, '31.10.2026', -20, 100, 'Synthetic theme source')
    case.page.get_by_label('Dompet impor', exact=True).select_option('bank')
    case.page.get_by_label('File mutasi Ziraat', exact=True).set_input_files(path)
    expect(case.page.get_by_role('heading', name='Periksa sebelum disimpan')).to_be_visible()
    case.page.get_by_role('button', name='Simpan 1 transaksi', exact=True).click()
    expect(case.page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
    case.page.wait_for_function("JSON.parse(localStorage.getItem('uangku:v1')).version===2")
    case.raw = case.page.evaluate('(key)=>localStorage.getItem(key)', FINANCIAL_KEY)
    baseline = stored_document(case.page)
    assert baseline['metadata']['facts'] and baseline['metadata']['links']
    before = download_backup(case, 'metadata-before-theme.json')
    assert json.loads(before.read_text(encoding='utf-8'))['version'] == 2
    assert read_document(before) == baseline
    for theme in ['dark', 'light', 'system', 'dark', 'light']:
        case.choose(theme, 'light' if theme == 'system' else theme)
        case.page.reload(wait_until='networkidle')
        case.resolved(theme, 'light' if theme == 'system' else theme)
        case.startup('light' if theme == 'system' else theme)
        case.unchanged()
        assert stored_document(case.page) == baseline
    after = download_backup(case, 'metadata-after-theme.json')
    assert read_document(after) == baseline
    assert json.loads(after.read_text(encoding='utf-8')) == json.loads(before.read_text(encoding='utf-8'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--url', default=os.environ.get('UANGKU_TEST_URL', 'http://127.0.0.1:4180'))
    parser.add_argument('--only', help='Optional case-name substring for focused reruns')
    args = parser.parse_args()
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    dist_sha = assert_production_url(args.url)
    results = []
    with sync_playwright() as pw:
        browser = launch_browser(pw)
        version = browser.version
        cases = []
        for scheme in ['light', 'dark']:
            cases.append((f'default-system-{scheme}', {'scheme': scheme},
                          lambda case, scheme=scheme: startup_case(case, scheme)))
        for theme in ['light', 'dark']:
            cases.append((f'explicit-{theme}-startup-reload',
                          {'scheme': 'dark' if theme == 'light' else 'light', 'theme': theme},
                          lambda case, theme=theme: persistence_case(case, theme)))
        cases.append(('live-system-and-keyboard', {'scheme': 'dark'}, system_and_keyboard))
        cases.append(('real-second-tab-preference-sync', {'scheme': 'light'}, cross_tab_case))
        for number, invalid in enumerate(['sepia', 'DARK', 'null', '{broken', 'x' * 8193]):
            cases.append((f'invalid-preference-{number}', {'scheme': 'dark', 'theme': invalid}, invalid_case))
        for fault in ['theme-read-write', 'theme-write', 'all-read-write']:
            cases.append((f'storage-unavailable-{fault}', {'scheme': 'dark', 'theme': 'dark', 'fault': fault},
                          lambda case, fault=fault: storage_failure_case(case, fault.endswith('read-write'))))
        for width in [320, 390, 1440]:
            for theme in ['light', 'dark']:
                cases.append((f'{width}-{theme}', {'width': width, 'theme': theme},
                              lambda case, theme=theme: visual_case(case, theme)))
        source_prefs = {'currency': 'TRY', 'lastWallets': {'IDR': 'synthetic-retained-idr', 'TRY': 'cash'}}
        cases.append(('metadata-v2-byte-and-backup-preservation',
                      {'width': 1440, 'financial': compact(source_fixture()), 'preferences': source_prefs}, metadata_case))
        try:
            for name, options, run in cases:
                if args.only and args.only not in name:
                    continue
                began = time.monotonic()
                case = None
                result = {'name': name, 'status': 'failed'}
                try:
                    assert assert_production_url(args.url) == dist_sha, 'Production build changed during suite'
                    case = Case(browser, args, name, **options)
                    run(case)
                    case.finish()
                    result['status'] = 'passed'
                except Exception as error:
                    result.update({'error': str(error), 'traceback': traceback.format_exc()})
                    if case:
                        try:
                            case.page.screenshot(path=str(args.output / f'{name}-failure.png'), full_page=True)
                        except Exception:
                            pass
                finally:
                    if case:
                        result.update(case.details())
                        case.context.close()
                result['seconds'] = round(time.monotonic() - began, 3)
                results.append(result)
                print(compact({key: value for key, value in result.items()
                               if key not in ['contrasts', 'startup_traces', 'traceback']}), flush=True)
        finally:
            browser.close()
    identity_verified = False
    try:
        assert assert_production_url(args.url) == dist_sha, 'Production build changed before completion'
        identity_verified = True
    except Exception as error:
        results.append({'name': 'final-build-identity', 'status': 'failed',
                        'error': str(error), 'traceback': traceback.format_exc()})
    report = {'synthetic_only': True, 'fresh_browser_contexts': True,
              'dist_sha256': dist_sha, 'final_build_identity_verified': identity_verified,
              'browser_version': version, 'url': args.url,
              'scope': 'Chromium desktop/mobile viewport emulation; no physical-device or manual screen-reader claim',
              'contrast_scope': 'Visible DOM text, native control values and placeholders on solid computed backgrounds after finite CSS transitions/animations settle, at top/middle/bottom scroll positions; gradients and disabled controls explicitly excluded; not a zero-bug or complete accessibility claim',
              'startup_scope': 'Pre-script data-theme MutationObserver, intermediate old values, and first two animation-frame attributes; no pixel-level filmstrip claim',
              'results': results, 'passed': bool(results) and all(r['status'] == 'passed' for r in results)}
    (args.output / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(compact({'passed': sum(r['status'] == 'passed' for r in results),
                   'failed': sum(r['status'] != 'passed' for r in results), 'dist_sha256': dist_sha}), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
