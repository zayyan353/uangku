"""Local F browser coverage: actual UI, immutable read/filter flows, synthetic data."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import time
import traceback

from browser_support import (FIXED_TIME, assert_production_url, install_playwright_path,
                             launch_browser, new_page)
install_playwright_path()
from playwright.sync_api import sync_playwright, expect

KEY = 'uangku:v1'


def fixture():
    entries = [{'id': f'row-{i}', 'date': '2026-10-30', 'type': 'expense', 'walletId': 'bank',
                'amount': 100 + i, 'category': 'Belanja', 'note': f'Synthetic current row {i:03d}'}
               for i in range(65)]
    entries += [
        {'id': 'old', 'date': '2025-01-05', 'type': 'income', 'walletId': 'bank', 'amount': 12_345,
         'category': 'Pemasukan', 'note': 'Synthetic older history'},
        {'id': 'large', 'date': '2026-10-31', 'type': 'expense', 'walletId': 'bank', 'amount': 9_007_199_254_000_001,
         'category': 'Belanja', 'note': 'Synthetic exact large amount'},
        {'id': 'transfer', 'date': '2026-10-31', 'type': 'transfer', 'walletId': 'bank', 'amount': 1000,
         'toWalletId': 'cash', 'toAmount': 1000, 'fee': 200, 'rate': 1, 'category': '', 'note': 'Synthetic transfer detail'},
    ]
    return {'app': 'uangku', 'version': 1, 'demo': False, 'state': {'version': 1,
        'wallets': [{'id': 'bank', 'name': 'Synthetic bank', 'currency': 'IDR', 'kind': 'bank', 'openingBalance': 100_000},
                    {'id': 'cash', 'name': 'Synthetic second bank', 'currency': 'IDR', 'kind': 'bank', 'openingBalance': 0},
                    {'id': 'try-bank', 'name': 'Synthetic TRY', 'currency': 'TRY', 'kind': 'bank', 'openingBalance': 0}],
        'entries': entries}}


CONTRAST_JS = r'''() => {
 const parse = text => {const numbers=text.match(/[\d.]+/g)?.map(Number) ?? []; return [...numbers.slice(0,3),numbers[3]??1];};
 const over = (fg,bg) => [0,1,2].map(i=>fg[i]*fg[3]+bg[i]*(1-fg[3]));
 const luminance = rgb => rgb.map(v=>{const c=v/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;})
   .reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 const results=[], excluded={gradient:0,disabled:0,invisible:0};
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 while(walker.nextNode()) { const node=walker.currentNode,el=node.parentElement;
   const text=node.textContent.trim(); if(!text||!el||el.closest('script,style,svg,.screen-reader-only,.greeting-leaf,.brand-mark,.currency-flag'))continue;
   const cs=getComputedStyle(el),r=el.getBoundingClientRect();
   if(!r.width||!r.height||r.bottom<0||r.top>innerHeight||cs.visibility==='hidden'||cs.display==='none'){excluded.invisible++;continue;}
   if(el.closest(':disabled,[aria-disabled=true]')){excluded.disabled++;continue;}
   const ancestors=[];for(let a=el;a;a=a.parentElement)ancestors.unshift(a);
   if(ancestors.some(a=>getComputedStyle(a).backgroundImage!=='none')){excluded.gradient++;continue;}
   let bg=[255,255,255];for(const a of ancestors)bg=over(parse(getComputedStyle(a).backgroundColor),bg);
   const fg=over(parse(cs.color),bg),l1=luminance(fg),l2=luminance(bg),ratio=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
   const large=parseFloat(cs.fontSize)>=24||(parseFloat(cs.fontSize)>=18.6667&&Number(cs.fontWeight)>=700);
   results.push({text:text.slice(0,90),tag:el.tagName,class:el.className,foreground:cs.color,background:bg,ratio,required:large?3:4.5});
 }
 return {samples:results.length,excluded,minimum:Math.min(...results.map(x=>x.ratio)),failures:results.filter(x=>x.ratio+.01<x.required),results};
}'''


def run_case(browser, args, output, mobile):
    label = 'mobile' if mobile else 'desktop'
    context = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 1000},
                                  is_mobile=mobile, has_touch=mobile, timezone_id='Europe/Istanbul')
    raw = json.dumps(fixture(), ensure_ascii=False, separators=(',', ':'))
    context.add_init_script('if(localStorage.getItem(' + json.dumps(KEY) + ')===null)localStorage.setItem('
                            + json.dumps(KEY) + ',' + json.dumps(raw) + ');')
    page = new_page(context)
    page.set_default_timeout(15_000)
    errors = []
    page.on('pageerror', lambda err: errors.append(str(err)))
    comparisons = 0
    contrasts = []
    def unchanged():
        nonlocal comparisons
        assert page.evaluate('(key)=>localStorage.getItem(key)', KEY) == raw, 'Read/filter operation mutated financial storage'
        comparisons += 1
    def contrast(state):
        report = page.evaluate(CONTRAST_JS)
        report['state'] = state
        contrasts.append(report)
        assert not report['failures'], 'Contrast failures: ' + repr(report['failures'])
    try:
        page.goto(args.url, wait_until='networkidle')
        expect(page.locator('.balance-card')).to_be_visible()
        contrast('overview')
        unchanged()
        nav = page.locator('.mobile-nav' if mobile else '.sidebar')
        nav.get_by_role('button', name='Transaksi', exact=True).click()
        expect(page.locator('.transactions-table tbody tr')).to_have_count(50)
        unchanged()
        page.get_by_role('button', name='Halaman berikutnya', exact=True).click()
        expect(page.locator('.transactions-table tbody tr')).to_have_count(17)
        unchanged()
        page.get_by_label('Cari transaksi', exact=True).fill('Synthetic older history')
        expect(page.get_by_label('Periode transaksi', exact=True)).to_have_value('all')
        expect(page.locator('.transactions-table tbody tr')).to_have_count(1)
        expect(page.get_by_text('Synthetic older history', exact=True)).to_be_visible()
        unchanged()
        page.get_by_label('Cari transaksi', exact=True).fill('')
        page.get_by_label('Periode transaksi', exact=True).select_option('month')
        page.get_by_label('Bulan laporan', exact=True).fill('2025-01')
        expect(page.locator('.transactions-table tbody tr')).to_have_count(1)
        unchanged()
        nav.get_by_role('button', name='Ringkasan', exact=True).click()
        expect(page.get_by_text('Uang masuk rekening', exact=True)).to_be_visible()
        expect(page.get_by_text('Uang keluar rekening', exact=True)).to_be_visible()
        expect(page.get_by_label('Bulan laporan', exact=True)).to_have_value('2025-01')
        expect(page.get_by_test_id('cashflow-period')).to_have_text('1 Jan 2025 – 31 Jan 2025')
        unchanged()
        nav.get_by_role('button', name='Transaksi', exact=True).click()
        page.get_by_label('Cari transaksi', exact=True).fill('Synthetic exact large amount')
        page.get_by_role('button', name='Rincian nominal Synthetic exact large amount', exact=True).click()
        detail = page.get_by_role('dialog', name='Rincian nominal', exact=True)
        expect(detail).to_be_visible()
        expect(detail).to_contain_text('90.071.992.540.000,01')
        expect(detail.locator('input,select,textarea')).to_have_count(0)
        unchanged()
        contrast('large-amount-detail')
        detail.get_by_role('button', name='Tutup rincian', exact=True).click()
        page.get_by_label('Cari transaksi', exact=True).fill('Synthetic transfer detail')
        page.get_by_role('button', name='Rincian nominal Synthetic transfer detail', exact=True).click()
        detail = page.get_by_role('dialog', name='Rincian nominal', exact=True)
        expect(detail).to_contain_text('Biaya tambahan')
        expect(detail).to_contain_text('Total debit dompet asal')
        expect(detail).to_contain_text('Nominal diterima')
        unchanged()
        detail.get_by_role('button', name='Tutup rincian', exact=True).click()
        page.get_by_label('Cari transaksi', exact=True).fill('')
        page.get_by_label('Filter jenis transaksi', exact=True).select_option('transfer')
        expect(page.locator('.transactions-table tbody tr')).to_have_count(1)
        for aria in ['Cari transaksi', 'Periode transaksi', 'Filter jenis transaksi']:
            control = page.get_by_label(aria, exact=True)
            expect(control).to_be_visible()
            box = control.bounding_box()
            assert box and box['x'] >= 0 and box['x'] + box['width'] <= page.viewport_size['width'] + 1
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
        unchanged()
        contrast('filtered-history')
        page.screenshot(path=str(output / f'{label}.png'), full_page=True)
        page.get_by_role('button', name='Pindah uang', exact=True).first.click()
        dlg = page.get_by_role('dialog')
        dlg.get_by_label('Dompet asal', exact=True).select_option('bank')
        dlg.get_by_label('Dompet tujuan', exact=True).select_option('try-bank')
        dlg.get_by_label('Nominal', exact=True).fill('10')
        dlg.get_by_label('Kurs transaksi', exact=True).fill('0')
        expect(dlg.locator('#fx-input-feedback')).to_be_visible()
        expect(dlg.get_by_label('Kurs transaksi', exact=True)).to_have_attribute('aria-invalid', 'true')
        unchanged()
        contrast('invalid-fx')
        assert not errors, errors
        return {'name': label, 'status': 'passed', 'read_only_comparisons': comparisons, 'contrasts': contrasts}
    except Exception:
        page.screenshot(path=str(output / f'{label}-failure.png'), full_page=True)
        raise
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--url', default=os.environ.get('UANGKU_TEST_URL', 'http://127.0.0.1:4180'))
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    dist_sha = assert_production_url(args.url)
    results = []
    with sync_playwright() as pw:
        browser = launch_browser(pw)
        version = browser.version
        try:
            for mobile in [False, True]:
                began = time.monotonic()
                try:
                    result = run_case(browser, args, output, mobile)
                except Exception as err:
                    result = {'name': 'mobile' if mobile else 'desktop', 'status': 'failed',
                              'error': str(err), 'traceback': traceback.format_exc()}
                result['seconds'] = round(time.monotonic() - began, 3)
                results.append(result)
                print(json.dumps({k: v for k, v in result.items() if k != 'contrasts'}, ensure_ascii=False), flush=True)
        finally:
            browser.close()
    report = {'scope': 'UX001–006 automated desktop/mobile-emulation states; no physical device or manual screen-reader claim',
              'synthetic_only': True, 'browser_version': version, 'dist_sha256': dist_sha,
              'contrast_scope': 'Visible text on solid computed backgrounds; gradients and disabled controls explicitly excluded',
              'results': results, 'passed': all(r['status'] == 'passed' for r in results)}
    (output / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
