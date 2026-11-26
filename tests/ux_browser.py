"""Local F browser coverage: actual UI, immutable read/filter flows, synthetic data."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import time
import traceback

from browser_support import (FIXED_TIME, assert_production_url, backup_action, browser_name,
                             install_playwright_path, launch_browser, new_page, stored_document)
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
        # Turning the page scrolls the list into view on the next animation frame. Let that settle first,
        # otherwise it can land after the scroll below and move the page away from the recorded offset.
        page.evaluate('() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))')
        offset = page.evaluate('() => { window.scrollTo(0, 450); return window.scrollY; }')
        assert offset > 200
        nav.get_by_role('button', name='Dompet', exact=True).click()
        assert page.evaluate('window.scrollY') == 0
        nav.get_by_role('button', name='Transaksi', exact=True).click()
        expect(page.locator('.transactions-table tbody tr')).to_have_count(17)
        assert abs(page.evaluate('window.scrollY') - offset) <= 2
        unchanged()
        page.get_by_label('Cari transaksi', exact=True).fill('Synthetic older history')
        expect(page.get_by_label('Periode transaksi', exact=True)).to_have_value('all')
        expect(page.locator('.transactions-table tbody tr')).to_have_count(1)
        expect(page.get_by_text('Synthetic older history', exact=True)).to_be_visible()
        page.get_by_label('Dompet riwayat', exact=True).select_option('bank')
        page.get_by_label('Filter jenis transaksi', exact=True).select_option('income')
        nav.get_by_role('button', name='Transaksi', exact=True).click()
        expect(page.get_by_label('Cari transaksi', exact=True)).to_have_value('Synthetic older history')
        nav.get_by_role('button', name='Ringkasan', exact=True).click()
        expect(page.locator('.transactions-table tbody tr')).to_have_count(5)
        nav.get_by_role('button', name='Transaksi', exact=True).click()
        expect(page.get_by_label('Periode transaksi', exact=True)).to_have_value('all')
        expect(page.get_by_label('Dompet riwayat', exact=True)).to_have_value('bank')
        expect(page.get_by_label('Filter jenis transaksi', exact=True)).to_have_value('income')
        expect(page.get_by_label('Cari transaksi', exact=True)).to_have_value('Synthetic older history')
        expect(page.get_by_text('Synthetic older history', exact=True)).to_be_visible()
        page.get_by_role('button', name='Reset filter', exact=True).click()
        expect(page.get_by_label('Cari transaksi', exact=True)).to_have_value('')
        expect(page.get_by_label('Dompet riwayat', exact=True)).to_have_value('all')
        expect(page.get_by_label('Filter jenis transaksi', exact=True)).to_have_value('all')
        expect(page.get_by_label('Periode transaksi', exact=True)).to_have_value('month')
        expect(page.locator('.transactions-table tbody tr')).to_have_count(50)
        unchanged()
        page.get_by_label('Cari transaksi', exact=True).fill('')
        page.get_by_label('Periode transaksi', exact=True).select_option('month')
        page.get_by_label('Bulan laporan', exact=True).select_option('2025-01')
        expect(page.locator('.transactions-table tbody tr')).to_have_count(1)
        unchanged()
        nav.get_by_role('button', name='Ringkasan', exact=True).click()
        expect(page.get_by_text('Uang masuk rekening', exact=True)).to_be_visible()
        expect(page.get_by_text('Uang keluar rekening', exact=True)).to_be_visible()
        expect(page.get_by_label('Bulan laporan', exact=True)).to_have_value('2025-01')
        expect(page.get_by_test_id('cashflow-period')).to_have_text('1 Jan 2025 – 31 Jan 2025')
        page.get_by_role('button', name='TL Lira Turki', exact=True).click()
        page.get_by_label('Bulan laporan', exact=True).select_option('2026-10')
        unchanged()
        nav.get_by_role('button', name='Transaksi', exact=True).click()
        expect(page.get_by_role('button', name='IDR Rupiah', exact=True)).to_have_attribute('aria-pressed', 'true')
        expect(page.get_by_label('Bulan laporan', exact=True)).to_have_value('2025-01')
        expect(page.get_by_text('Synthetic older history', exact=True)).to_be_visible()
        page.get_by_label('Cari transaksi', exact=True).fill('Synthetic exact large amount')
        page.get_by_role('button', name='Rincian transaksi Synthetic exact large amount', exact=True).click()
        detail = page.get_by_role('dialog', name='Rincian transaksi', exact=True)
        expect(detail).to_be_visible()
        expect(detail).to_contain_text('90.071.992.540.000,01')
        expect(detail.locator('input,select,textarea')).to_have_count(0)
        unchanged()
        contrast('large-amount-detail')
        detail.get_by_role('button', name='Tutup rincian', exact=True).click()
        page.get_by_label('Cari transaksi', exact=True).fill('Synthetic transfer detail')
        page.get_by_role('button', name='Rincian transaksi Synthetic transfer detail', exact=True).click()
        detail = page.get_by_role('dialog', name='Rincian transaksi', exact=True)
        expect(detail).to_contain_text('Biaya tambahan')
        expect(detail).to_contain_text('Total debit dompet asal')
        expect(detail).to_contain_text('Nominal diterima')
        unchanged()
        detail.get_by_role('button', name='Tutup rincian', exact=True).click()
        page.get_by_label('Cari transaksi', exact=True).fill('')
        # Emptying the search box returns to the period that was in use before the search widened it.
        expect(page.get_by_label('Periode transaksi', exact=True)).to_have_value('month')
        page.get_by_label('Periode transaksi', exact=True).select_option('all')
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
        rate = dlg.get_by_label('Kurs transaksi', exact=True)
        for source, target, units in [('bank', 'try-bank', 'Jumlah TRY untuk 1 IDR'),
                                      ('try-bank', 'bank', 'Jumlah IDR untuk 1 TRY')]:
            dlg.get_by_label('Dompet asal', exact=True).select_option(source)
            dlg.get_by_label('Dompet tujuan', exact=True).select_option(target)
            expect(rate).to_have_attribute('placeholder', units)
            expect(dlg.locator('#fx-input-help')).to_contain_text('tanpa pemisah ribuan')
            expect(dlg.locator('.fx-section')).not_to_contain_text('16000')
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


STORAGE_SUM_JS = """() => { let used = 0;
 for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); used += key.length + localStorage.getItem(key).length; }
 return used; }"""
# Another page's key on the same origin: the quota is per origin, so it counts although it is not Uangku's.
STORAGE_FILL_JS = """(target) => { const key = 'synthetic-other-page';
 let used = key.length;
 for (let i = 0; i < localStorage.length; i++) { const name = localStorage.key(i); used += name.length + localStorage.getItem(name).length; }
 try { localStorage.setItem(key, 'x'.repeat(target - used)); return 'stored'; } catch (error) { return String(error && error.name); } }"""


STORAGE_WARNING_CHARS = 3_145_728  # 60% of 5,242,880
REJECT_LEDGER_WRITES_JS = """() => { window.__setItem = Storage.prototype.setItem;
 Storage.prototype.setItem = function (key, value) {
  if (key === 'uangku:v1') throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
  return window.__setItem.call(this, key, value); }; }"""


def storage_page(browser, mobile, stored):
    context = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 1000},
                                  is_mobile=mobile, has_touch=mobile, timezone_id='Europe/Istanbul')
    if stored is not None:
        context.add_init_script('if(localStorage.getItem(' + json.dumps(KEY) + ')===null)localStorage.setItem('
                                + json.dumps(KEY) + ',' + json.dumps(stored) + ');')
    page = new_page(context)
    page.set_default_timeout(15_000)
    errors = []
    page.on('pageerror', lambda err: errors.append(str(err)))
    return context, page, errors


def open_privacy(page):
    privacy = page.get_by_role('button', name='Lokal & pribadi', exact=True)
    (privacy if privacy.is_visible() else backup_action(page, 'Privasi')).click()
    dialog = page.get_by_role('dialog', name='Privasi dan cadangan', exact=True)
    expect(dialog).to_be_visible()
    return dialog


def close_privacy(page, dialog):
    dialog.get_by_role('button', name='Tutup penjelasan privasi', exact=True).click()
    expect(page.get_by_role('dialog')).to_have_count(0)


def fill_storage(page, target, label):
    """Fills the origin to exactly `target` characters. Returns False when this engine's own quota refuses it."""
    filled = page.evaluate(STORAGE_FILL_JS, target)
    if filled != 'stored':
        # An engine whose own quota is below the Chromium threshold cannot reach the warning this way. That is a
        # finding about that engine, not a pass of the warning: it is reported, and Chromium must not get here.
        assert browser_name() != 'chromium', f'{label}: Chromium rejected the {target}-character filler: {filled}'
        return False
    assert page.evaluate(STORAGE_SUM_JS) == target
    return True


def record_expense(page, note):
    page.get_by_role('button', name='Catat transaksi', exact=True).first.click()
    dialog = page.get_by_role('dialog')
    dialog.get_by_label('Dompet asal', exact=True).select_option('bank')
    dialog.get_by_label('Nominal', exact=True).fill('7')
    dialog.get_by_label(re.compile('Keterangan')).fill(note)
    dialog.get_by_role('button', name='Simpan transaksi', exact=True).click()
    return dialog


def storage_case(browser, args, output, mobile):
    """MW-96: the storage meter in "Privasi dan cadangan" and the early warning from 60% of the Chromium quota."""
    label = 'storage-mobile' if mobile else 'storage-desktop'
    raw = json.dumps(fixture(), ensure_ascii=False, separators=(',', ':'))
    context, page, errors = storage_page(browser, mobile, raw)
    warning = page.get_by_test_id('storage-warning')
    reminder = page.get_by_test_id('backup-reminder')
    try:
        page.goto(args.url, wait_until='networkidle')
        expect(page.locator('.balance-card')).to_be_visible()
        # A small ledger that was never backed up: the backup reminder shows and the storage warning does not.
        expect(reminder).to_be_visible()
        expect(warning).to_have_count(0)
        dialog = open_privacy(page)
        used = page.evaluate(STORAGE_SUM_JS)
        assert len(raw) < used < 100_000, used
        usage = dialog.get_by_test_id('storage-usage')
        expect(usage).to_have_attribute('data-level', 'ok')
        expect(usage).to_contain_text('Ruang penyimpanan: 0% terpakai.')
        expect(usage).to_contain_text(f'{used:,}'.replace(',', '.') + ' dari 5.242.880 karakter')
        expect(usage.locator('meter')).to_have_attribute('value', str(used))
        close_privacy(page, dialog)
        # The meter only reads: the ledger text is still what the fixture stored.
        assert page.evaluate('(key)=>localStorage.getItem(key)', KEY) == raw, 'Storage meter changed the ledger'

        # One save through the app first, so the stored text has the app's own shape before sizes are compared.
        expect(record_expense(page, 'Synthetic storage first')).to_have_count(0)
        expect(page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
        if not fill_storage(page, STORAGE_WARNING_CHARS - 20, label):
            assert not errors, errors
            return {'name': label, 'status': 'passed', 'used_chars': used, 'warning_checked': False,
                    'filler_rejected': True}
        # Twenty characters short of the threshold: the meter, measured again when the window opens, says 59%.
        dialog = open_privacy(page)
        expect(dialog.get_by_test_id('storage-usage')).to_have_attribute('data-level', 'ok')
        expect(dialog.get_by_test_id('storage-usage')).to_contain_text('Ruang penyimpanan: 59% terpakai.')
        close_privacy(page, dialog)
        expect(warning).to_have_count(0)
        expect(reminder).to_be_visible()
        # The next save crosses the threshold. The warning appears without a reload, and the reminder waits behind it.
        expect(record_expense(page, 'Synthetic storage second')).to_have_count(0)
        expect(warning).to_be_visible()
        expect(warning).to_contain_text('Ruang penyimpanan browser terpakai 60%.')
        expect(reminder).to_have_count(0)
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
        warning.scroll_into_view_if_needed()
        page.screenshot(path=str(output / f'{label}.png'))
        dialog = open_privacy(page)
        expect(dialog.get_by_test_id('storage-usage')).to_have_attribute('data-level', 'warning')
        expect(dialog.get_by_test_id('storage-usage')).to_contain_text('Ruang penyimpanan: 60% terpakai.')
        close_privacy(page, dialog)

        # A refused save has its own box with the download that works then; the warning waits behind it.
        page.evaluate(REJECT_LEDGER_WRITES_JS)
        dialog = record_expense(page, 'Synthetic storage refused')
        problem = page.locator('.notice.save-problem')
        expect(problem).to_contain_text('Belum tersimpan')
        expect(warning).to_have_count(0)
        dialog.get_by_role('button', name='Batal', exact=True).click()
        page.get_by_role('button', name='Buang isian', exact=True).click()
        expect(warning).to_have_count(0)
        page.evaluate('() => { Storage.prototype.setItem = window.__setItem; }')
        problem.get_by_role('button', name='Coba simpan lagi', exact=True).click()
        expect(page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
        expect(warning).to_be_visible()

        # "Nanti saja" closes the box for the day, also after a reload, and does not bring the reminder up instead.
        warning.get_by_role('button', name='Nanti saja', exact=True).click()
        expect(warning).to_have_count(0)
        expect(reminder).to_have_count(0)
        page.reload(wait_until='networkidle')
        expect(page.locator('.balance-card')).to_be_visible()
        expect(warning).to_have_count(0)
        expect(reminder).to_have_count(0)
        # It was the dismissal that hid it: without that record the warning is back.
        page.evaluate("() => localStorage.removeItem('uangku:backup-reminder-dismissed:v1')")
        page.reload(wait_until='networkidle')
        expect(warning).to_be_visible()
        # Its own button satisfies it: after a full backup of what is stored now, neither box asks again.
        with page.expect_download() as pending:
            warning.get_by_role('button', name='Cadangkan sekarang', exact=True).click()
        assert pending.value.suggested_filename.startswith('uangku-lengkap-')
        expect(warning).to_have_count(0)
        expect(reminder).to_have_count(0)
        page.reload(wait_until='networkidle')
        expect(page.locator('.balance-card')).to_be_visible()
        expect(warning).to_have_count(0)
        expect(reminder).to_have_count(0)
        assert not errors, errors
        return {'name': label, 'status': 'passed', 'used_chars': used, 'warning_checked': True}
    except Exception:
        page.screenshot(path=str(output / f'{label}-failure.png'), full_page=True)
        raise
    finally:
        context.close()


def storage_gating_case(browser, args, output, mobile):
    """MW-96: over the threshold, sample data and unreadable stored data show the meter but not the warning."""
    label = 'storage-gating'
    checked = []
    for name, stored, banner in [('sample', None, '.demo-banner'),
                                 ('unreadable', json.dumps({'app': 'uangku', 'version': 999}), '.notice.save-problem')]:
        context, page, errors = storage_page(browser, mobile, stored)
        try:
            page.goto(args.url, wait_until='networkidle')
            expect(page.locator(banner)).to_be_visible()
            if not fill_storage(page, STORAGE_WARNING_CHARS + 100_000, f'{label}-{name}'):
                continue
            page.reload(wait_until='networkidle')
            expect(page.locator(banner)).to_be_visible()
            expect(page.get_by_test_id('storage-warning')).to_have_count(0)
            dialog = open_privacy(page)
            expect(dialog.get_by_test_id('storage-usage')).to_have_attribute('data-level', 'warning')
            close_privacy(page, dialog)
            expect(page.get_by_test_id('storage-warning')).to_have_count(0)
            assert not errors, errors
            checked.append(name)
        except Exception:
            page.screenshot(path=str(output / f'{label}-{name}-failure.png'), full_page=True)
            raise
        finally:
            context.close()
    return {'name': label, 'status': 'passed', 'profiles_checked': checked}


def another_page(context):
    """A further tab of a context whose first tab came from new_page().

    The clock installed there belongs to the context and covers every tab. Installing it again fails in WebKit when the
    context seeds its ledger through an init script (CI on PR #69: "undefined is not an object (evaluating
    'globalThis.__pwClock.controller')"); recovery_browser.py installs it once for the same reason."""
    return context.new_page()


def route_case(browser, args, output, mobile):
    """MW-113a: the page is in the address. A reload stays on it; Back and Forward move between pages."""
    label = 'routes-mobile' if mobile else 'routes-desktop'
    raw = json.dumps(fixture(), ensure_ascii=False, separators=(',', ':'))
    context, page, errors = storage_page(browser, mobile, raw)
    nav = page.locator('.mobile-nav' if mobile else '.sidebar')

    def at(target, name, address, landmark):
        expect(target.locator('.breadcrumb strong')).to_have_text(name)
        expect(target.locator(landmark).first).to_be_visible()
        assert target.evaluate('location.hash') == address, target.evaluate('location.href')

    try:
        page.goto(args.url, wait_until='networkidle')
        at(page, 'Ringkasan', '', '.balance-card')
        entries = page.evaluate('history.length')
        nav.get_by_role('button', name='Dompet', exact=True).click()
        at(page, 'Dompet', '#/dompet', '.wallet-card')
        nav.get_by_role('button', name='Transaksi', exact=True).click()
        at(page, 'Transaksi', '#/transaksi', '.transactions-table tbody tr')
        # Choosing the page that is already open adds no history entry.
        nav.get_by_role('button', name='Transaksi', exact=True).click()
        assert page.evaluate('history.length') == entries + 2
        # A reload stays on the page instead of returning to Ringkasan.
        page.reload(wait_until='networkidle')
        at(page, 'Transaksi', '#/transaksi', '.transactions-table tbody tr')
        # Back and Forward walk the pages; the first Back does not leave the app.
        page.go_back()
        at(page, 'Dompet', '#/dompet', '.wallet-card')
        page.go_back()
        at(page, 'Ringkasan', '', '.balance-card')
        page.go_forward()
        at(page, 'Dompet', '#/dompet', '.wallet-card')
        # An address typed into the same tab is followed too.
        page.evaluate("location.hash = '#/impor'")
        at(page, 'Impor mutasi', '#/impor', '.import-format-tabs, .tab-list, [aria-label="Dompet impor"]')
        # A page opened directly on an address starts there.
        direct = another_page(context)
        try:
            direct.goto(args.url + '#/dompet', wait_until='networkidle')
            at(direct, 'Dompet', '#/dompet', '.wallet-card')
            # An older entry can still have native scroll restoration enabled. Revisit that entry via Back.
            direct.evaluate("history.scrollRestoration = 'auto'")
            direct.locator('.mobile-nav' if mobile else '.sidebar').get_by_role('button', name='Transaksi', exact=True).click()
            at(direct, 'Transaksi', '#/transaksi', '.transactions-table tbody tr')
            direct.go_back()
            at(direct, 'Dompet', '#/dompet', '.wallet-card')
            assert direct.evaluate('history.scrollRestoration') == 'manual', 'Back left the older entry in auto mode'
        finally:
            direct.close()
        # An unknown address opens Ringkasan. A new page, so this is a first load and not a hash change.
        unknown = another_page(context)
        try:
            unknown.goto(args.url + '#/tidak-ada', wait_until='networkidle')
            expect(unknown.locator('.breadcrumb strong')).to_have_text('Ringkasan')
            expect(unknown.locator('.balance-card')).to_be_visible()
        finally:
            unknown.close()
        # A path that starts with two slashes is still this site: changing page works there too.
        doubled = another_page(context)
        doubled_errors = []
        doubled.on('pageerror', lambda err: doubled_errors.append(str(err)))
        try:
            doubled.goto(args.url.rstrip('/') + '//', wait_until='networkidle')
            (doubled.locator('.mobile-nav' if mobile else '.sidebar')).get_by_role('button', name='Dompet', exact=True).click()
            at(doubled, 'Dompet', '#/dompet', '.wallet-card')
            assert not doubled_errors, doubled_errors
        finally:
            doubled.close()
        # A browser may refuse a write to the history (Safari allows 100 in 30 seconds). The page still changes; only
        # the address lags.
        refused = another_page(context)
        refused_errors = []
        refused.on('pageerror', lambda err: refused_errors.append(str(err)))
        try:
            refused.goto(args.url, wait_until='networkidle')
            refused.evaluate("() => { History.prototype.pushState = () => { throw new DOMException('Synthetic refusal', 'SecurityError'); }; }")
            refused.locator('.mobile-nav' if mobile else '.sidebar').get_by_role('button', name='Dompet', exact=True).click()
            at(refused, 'Dompet', '', '.wallet-card')
            assert not refused_errors, refused_errors
        finally:
            refused.close()

        # Transaksi keeps its own month and scroll position while another page is shown. Back and Forward bring them
        # back the way the navigation buttons do.
        month = page.get_by_label('Bulan laporan', exact=True)

        def transaksi_as_left():
            at(page, 'Transaksi', '#/transaksi', '.transactions-table tbody tr')
            expect(month).to_have_value('2026-10')
            try:
                page.wait_for_function('() => Math.abs(scrollY - 600) <= 2')
            except Exception as error:
                state = page.evaluate('''() => ({scrollY, mode: history.scrollRestoration,
                    documentHeight: document.scrollingElement.scrollHeight, viewportHeight: innerHeight})''')
                raise AssertionError(f'Expected Transaksi at 600px (±2px), observed {state}') from error

        nav.get_by_role('button', name='Ringkasan', exact=True).click()
        at(page, 'Ringkasan', '', '.balance-card')
        nav.get_by_role('button', name='Transaksi', exact=True).click()
        at(page, 'Transaksi', '#/transaksi', '.transactions-table tbody tr')
        expect(month).to_have_value('2026-10')
        page.evaluate('window.scrollTo(0, 600)')
        page.wait_for_function('() => scrollY === 600')
        # Left by the navigation button, returned to by Back.
        nav.get_by_role('button', name='Ringkasan', exact=True).click()
        at(page, 'Ringkasan', '', '.balance-card')
        month.select_option('2026-09')
        page.go_back()
        transaksi_as_left()
        # Left by Back, returned to by Forward.
        page.go_back()
        at(page, 'Ringkasan', '', '.balance-card')
        month.select_option('2026-08')
        page.go_forward()
        transaksi_as_left()

        # Moving between pages reads only.
        assert page.evaluate('(key)=>localStorage.getItem(key)', KEY) == raw, 'Navigation changed the ledger'

        # While a save is running the page stays: Back and a typed address are put back, and the save finishes once.
        nav.get_by_role('button', name='Transaksi', exact=True).click()
        at(page, 'Transaksi', '#/transaksi', '.transactions-table tbody tr')
        holder = another_page(context)
        try:
            holder.goto(args.url, wait_until='networkidle')
            # A second tab of the same profile holds the ledger's lock, so the save below has to wait.
            holder.evaluate('''(name) => new Promise(held => { navigator.locks.request(name, () => new Promise(release => {
                window.__release = release; held(true); })); })''', 'uangku:v1:coordinated-write')
            page.get_by_role('button', name='Catat transaksi', exact=True).first.click()
            dialog = page.get_by_role('dialog')
            dialog.get_by_label('Dompet asal', exact=True).select_option('bank')
            dialog.get_by_label('Nominal', exact=True).fill('7')
            dialog.get_by_label(re.compile('Keterangan')).fill('Synthetic saved while Back was pressed')
            dialog.get_by_role('button', name='Simpan transaksi', exact=True).click()
            page.evaluate('''() => { window.__moves = 0; for (const type of ['popstate', 'hashchange']) addEventListener(type, () => { window.__moves += 1; }); }''')
            for leave in ('history.back()', "location.hash = '#/dompet'"):
                seen = page.evaluate('window.__moves')
                page.evaluate(leave)
                page.wait_for_function('(seen) => window.__moves > seen', arg=seen)
                page.wait_for_function("() => location.hash === '#/transaksi'")
                at(page, 'Transaksi', '#/transaksi', '.transactions-table tbody tr')
                expect(dialog).to_be_visible()
                assert page.evaluate('(key)=>localStorage.getItem(key)', KEY) == raw, 'The waiting save was written early'
            holder.evaluate('window.__release()')
            expect(page.get_by_role('dialog')).to_have_count(0)
            at(page, 'Transaksi', '#/transaksi', '.transactions-table tbody tr')
            saved = json.loads(page.evaluate('(key)=>localStorage.getItem(key)', KEY))['state']['entries']
            assert [entry['note'] for entry in saved if entry['note'].startswith('Synthetic saved while')] == ['Synthetic saved while Back was pressed']
            assert len(saved) == len(fixture()['state']['entries']) + 1
        finally:
            holder.close()
        assert not errors, errors
        return {'name': label, 'status': 'passed'}
    except Exception:
        page.screenshot(path=str(output / f'{label}-failure.png'), full_page=True)
        raise
    finally:
        context.close()


def dialog_back_case(browser, args, output, mobile):
    """MW-113b: an open dialog has a history entry of its own; Back closes it through the discard question."""
    label = 'dialog-back-mobile' if mobile else 'dialog-back-desktop'
    raw = json.dumps(fixture(), ensure_ascii=False, separators=(',', ':'))
    context, page, errors = storage_page(browser, mobile, raw)
    nav = page.locator('.mobile-nav' if mobile else '.sidebar')
    dialogs = page.get_by_role('dialog')
    on_entry = '() => !!(history.state && history.state.uangkuDialog)'

    def at(name, address):
        expect(page.locator('.breadcrumb strong')).to_have_text(name)
        assert page.evaluate('location.hash') == address, page.evaluate('location.href')

    def record():
        page.get_by_role('button', name='Catat transaksi', exact=True).first.click()
        expect(dialogs).to_have_count(1)
        page.wait_for_function(on_entry)
        return page.get_by_role('dialog')

    def back():
        # The dialog's entry has the page's own address, so this is the History API's Back, as in MW-113a's note.
        page.evaluate('history.back()')

    try:
        page.goto(args.url, wait_until='networkidle')
        nav.get_by_role('button', name='Transaksi', exact=True).click()
        at('Transaksi', '#/transaksi')
        entries = page.evaluate('history.length')

        # An untouched dialog: Back closes it and the page stays.
        opener = page.get_by_role('button', name='Catat transaksi', exact=True).first
        opener.focus()
        opener.press('Enter')
        expect(dialogs).to_have_count(1)
        page.wait_for_function(on_entry)
        assert page.evaluate('history.length') == entries + 1
        at('Transaksi', '#/transaksi')
        back()
        expect(dialogs).to_have_count(0)
        at('Transaksi', '#/transaksi')
        expect(opener).to_be_focused()

        # A filled form: Back asks first, and what was typed is still there afterwards.
        dialog = record()
        dialog.get_by_label('Nominal', exact=True).fill('7')
        dialog.get_by_label(re.compile('Keterangan')).fill('Synthetic back draft')
        # A push after Back would truncate the forward entry and leave history.length unchanged.
        page.evaluate('''() => {
            window.__dialogPushes = 0;
            const push = history.pushState.bind(history);
            history.pushState = (...args) => { window.__dialogPushes++; return push(...args); };
        }''')
        back()
        expect(page.get_by_role('dialog', name='Buang isian transaksi?', exact=True)).to_be_visible()
        page.get_by_role('button', name='Lanjut mengisi', exact=True).click()
        expect(dialog.get_by_label('Nominal', exact=True)).to_have_value('7')
        expect(dialog.get_by_label(re.compile('Keterangan'))).to_have_value('Synthetic back draft')
        # The dialog is back on the entry it had; nothing was added to the history.
        page.wait_for_function(on_entry)
        assert page.evaluate('history.length') == entries + 1
        assert page.evaluate('window.__dialogPushes') == 0, 'The discarded forward entry was replaced with a new one'
        back()
        expect(page.get_by_role('dialog', name='Buang isian transaksi?', exact=True)).to_be_visible()
        page.get_by_role('button', name='Buang isian', exact=True).click()
        expect(dialogs).to_have_count(0)
        at('Transaksi', '#/transaksi')

        # Dialogs closed by their own button: three rounds add one entry in all, and one Back still leaves the page.
        for _ in range(3):
            dialog = record()
            dialog.get_by_role('button', name='Batal', exact=True).click()
            expect(dialogs).to_have_count(0)
        assert page.evaluate('history.length') == entries + 1
        back()
        at('Ringkasan', '')
        page.go_forward()
        at('Transaksi', '#/transaksi')
        # Forward once more reaches the entry the dialogs used: no dialog comes back, and the page is the same.
        page.evaluate('history.forward()')
        page.wait_for_function(on_entry)
        expect(dialogs).to_have_count(0)
        at('Transaksi', '#/transaksi')

        # One dialog replaced by another keeps the entry: Back from Kelola mata uang returns to the wallet form.
        nav.get_by_role('button', name='Dompet', exact=True).click()
        at('Dompet', '#/dompet')
        entries = page.evaluate('history.length')
        page.get_by_role('button', name='Tambah dompet', exact=True).first.click()
        wallet = page.get_by_role('dialog', name='Tambah dompet', exact=True)
        expect(wallet).to_be_visible()
        page.wait_for_function(on_entry)
        wallet.get_by_role('button', name='Mata uang lain…', exact=True).click()
        expect(page.get_by_role('dialog', name='Kelola mata uang', exact=True)).to_be_visible()
        page.wait_for_function(on_entry)
        assert page.evaluate('history.length') == entries + 1
        back()
        expect(wallet).to_be_visible()
        expect(dialogs).to_have_count(1)
        page.wait_for_function(on_entry)
        back()
        expect(dialogs).to_have_count(0)
        at('Dompet', '#/dompet')

        # Wallets use the shared discard guard. Back while it asks means keep editing, with the draft and focus intact.
        wallet_opener = page.get_by_role('button', name='Tambah dompet', exact=True).first
        wallet_opener.focus()
        wallet_opener.press('Enter')
        expect(wallet).to_be_visible()
        page.wait_for_function(on_entry)
        name = wallet.get_by_label('Nama dompet', exact=True)
        name.fill('Synthetic wallet draft')
        back()
        question = wallet.get_by_role('alertdialog', name='Buang perubahan?', exact=True)
        expect(question.get_by_role('button', name='Lanjut mengisi', exact=True)).to_be_focused()
        page.wait_for_function(on_entry)
        back()
        expect(question).to_have_count(0)
        expect(name).to_have_value('Synthetic wallet draft')
        expect(name).to_be_focused()
        page.wait_for_function(on_entry)
        back()
        question.get_by_role('button', name='Buang perubahan', exact=True).click()
        expect(dialogs).to_have_count(0)
        expect(wallet_opener).to_be_focused()
        at('Dompet', '#/dompet')

        # A reload with a dialog open: the page stays, the dialog is gone, and one Back leaves the page.
        page.get_by_role('button', name='Tambah dompet', exact=True).first.click()
        expect(wallet).to_be_visible()
        page.wait_for_function(on_entry)
        page.reload(wait_until='networkidle')
        expect(dialogs).to_have_count(0)
        at('Dompet', '#/dompet')
        back()
        at('Transaksi', '#/transaksi')
        # A reload right after a dialog closes is not cut short by anything the dialog left behind.
        record().get_by_role('button', name='Batal', exact=True).click()
        page.reload(wait_until='networkidle')
        at('Transaksi', '#/transaksi')

        # A direct visit has no earlier page. After Back runs out of history, the next navigation still writes its URL.
        direct = another_page(context)
        try:
            # Replace the tab's initial about:blank too, so Back really has nowhere else to go.
            direct.evaluate('(url) => location.replace(url)', args.url)
            direct.get_by_role('button', name='Catat transaksi', exact=True).first.wait_for()
            assert direct.evaluate('history.length') == 1
            direct.get_by_role('button', name='Catat transaksi', exact=True).first.click()
            direct.wait_for_function(on_entry)
            direct.get_by_role('dialog').get_by_role('button', name='Batal', exact=True).click()
            expect(direct.get_by_role('dialog')).to_have_count(0)
            # Let the close's queued timer finish before Back, as when the user pauses after closing.
            direct.evaluate('() => new Promise(resolve => setTimeout(resolve, 50))')
            direct.evaluate('history.back()')
            direct.wait_for_function('() => !!history.state?.uangkuUnder')
            direct.locator('.mobile-nav' if mobile else '.sidebar').get_by_role('button', name='Transaksi', exact=True).click()
            expect(direct.locator('.breadcrumb strong')).to_have_text('Transaksi')
            assert direct.evaluate('location.hash') == '#/transaksi', direct.url
        finally:
            direct.close()

        # Two Back calls can cancel the keeper's forward move, or reach the preceding document.
        # Both documents show Transaksi. Moving on must still write the URL and leave a working Back.
        page.goto(args.url + '?dialog-back#/transaksi', wait_until='networkidle')
        record().get_by_label('Nominal', exact=True).fill('7')
        page.evaluate("""() => {
            addEventListener('popstate', () => { window.__dialogBackSeen = true; }, {once: true});
            history.back();
            history.back();
        }""")
        page.wait_for_function("() => location.search !== '?dialog-back' || window.__dialogBackSeen")
        if page.evaluate("location.search === '?dialog-back'"):
            discard = page.get_by_role('button', name='Buang isian', exact=True)
            if not discard.is_visible():
                dialogs.get_by_role('button', name='Batal', exact=True).click()
            discard.click()
        expect(dialogs).to_have_count(0)
        at('Transaksi', '#/transaksi')
        previous = page.url
        nav.get_by_role('button', name='Dompet', exact=True).click()
        at('Dompet', '#/dompet')
        page.go_back()
        expect(page).to_have_url(previous)
        at('Transaksi', '#/transaksi')

        # Opening and closing dialogs reads only.
        assert page.evaluate('(key)=>localStorage.getItem(key)', KEY) == raw, 'A dialog closed by Back changed the ledger'
        assert not errors, errors
        return {'name': label, 'status': 'passed'}
    except Exception:
        page.screenshot(path=str(output / f'{label}-failure.png'), full_page=True)
        raise
    finally:
        context.close()


def unload_warning_case(browser, args, output, mobile):
    """MW-113c: closing or reloading the tab asks first while a form holds something typed."""
    label = 'unload-warning-mobile' if mobile else 'unload-warning-desktop'
    raw = json.dumps(fixture(), ensure_ascii=False, separators=(',', ':'))
    context, page, errors = storage_page(browser, mobile, raw)
    nav = page.locator('.mobile-nav' if mobile else '.sidebar')
    dialogs = page.get_by_role('dialog')
    # What the browser reads to decide whether to ask: did a listener cancel `beforeunload`?
    warns = "() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }"
    try:
        page.goto(args.url, wait_until='networkidle')
        assert page.evaluate(warns) is False, 'A page without a form warned'
        # The transaction form: silent while untouched, warns once something is typed.
        page.get_by_role('button', name='Catat transaksi', exact=True).first.click()
        dialog = page.get_by_role('dialog')
        expect(dialog.get_by_label('Nominal', exact=True)).to_be_visible()
        assert page.evaluate(warns) is False, 'An untouched transaction form warned'
        # Template names can be the only value changed. The suggested/existing name itself is clean.
        dialog.get_by_role('button', name='Simpan sebagai template', exact=True).click()
        name = dialog.get_by_label('Nama template', exact=True)
        suggested = name.input_value()
        assert page.evaluate(warns) is False, 'The suggested template name warned'
        name.fill('Synthetic template')
        assert page.evaluate(warns) is True, 'A new template name did not warn'
        name.fill(suggested)
        assert page.evaluate(warns) is False, 'Restoring the suggested name still warned'
        name.fill('Synthetic template')
        dialog.get_by_role('button', name='Simpan template', exact=True).click()
        expect(name).to_have_count(0)
        assert page.evaluate(warns) is False, 'A saved template name still warned'
        dialog.get_by_role('button', name='Kelola template', exact=True).click()
        dialog.get_by_role('button', name='Ganti nama template Synthetic template', exact=True).click()
        renamed = dialog.get_by_label('Nama baru untuk template Synthetic template', exact=True)
        assert page.evaluate(warns) is False, 'The existing template name warned'
        renamed.fill('Synthetic rename')
        assert page.evaluate(warns) is True, 'An edited template name did not warn'
        renamed.press('Escape')
        expect(renamed).to_have_count(0)
        assert page.evaluate(warns) is False, 'A cancelled template rename still warned'
        dialog.get_by_label('Nominal', exact=True).fill('7')
        assert page.evaluate(warns) is True, 'A filled transaction form did not warn'
        if browser_name() == 'chromium':
            # The real thing: the browser's own question appears, and staying keeps the form as it was.
            seen = []
            def stay(prompt):
                seen.append(prompt.type)
                prompt.dismiss()
            page.on('dialog', stay)
            page.close(run_before_unload=True)
            page.wait_for_timeout(500)
            page.remove_listener('dialog', stay)
            assert seen == ['beforeunload'], seen
            assert not page.is_closed()
            expect(dialog.get_by_label('Nominal', exact=True)).to_have_value('7')
        dialog.get_by_role('button', name='Batal', exact=True).click()
        page.get_by_role('button', name='Buang isian', exact=True).click()
        expect(dialogs).to_have_count(0)
        assert page.evaluate(warns) is False, 'A discarded transaction form still warned'

        # The forms that share the discard question (wallet, currencies, categories) warn the same way.
        nav.get_by_role('button', name='Dompet', exact=True).click()
        page.get_by_role('button', name='Tambah dompet', exact=True).first.click()
        wallet = page.get_by_role('dialog', name='Tambah dompet', exact=True)
        expect(wallet.get_by_label('Nama dompet', exact=True)).to_be_visible()
        assert page.evaluate(warns) is False, 'An untouched wallet form warned'
        wallet.get_by_label('Nama dompet', exact=True).fill('Synthetic unload')
        assert page.evaluate(warns) is True, 'A filled wallet form did not warn'
        wallet.get_by_role('button', name='Batal', exact=True).click()
        wallet.get_by_role('button', name='Buang perubahan', exact=True).click()
        expect(dialogs).to_have_count(0)
        assert page.evaluate(warns) is False, 'A discarded wallet form still warned'

        assert page.evaluate('(key)=>localStorage.getItem(key)', KEY) == raw, 'The warning changed the ledger'
        assert not errors, errors
        return {'name': label, 'status': 'passed', 'browser_prompt_checked': browser_name() == 'chromium'}
    except Exception:
        page.screenshot(path=str(output / f'{label}-failure.png'), full_page=True)
        raise
    finally:
        context.close()


def saved_elsewhere_case(browser, args, output, mobile):
    """MW-115: a transaction saved outside the month on screen says where it went and offers to show it."""
    label = 'saved-elsewhere-mobile' if mobile else 'saved-elsewhere-desktop'
    raw = json.dumps(fixture(), ensure_ascii=False, separators=(',', ':'))
    context, page, errors = storage_page(browser, mobile, raw)
    nav = page.locator('.mobile-nav' if mobile else '.sidebar')
    dialogs = page.get_by_role('dialog')
    toast = page.locator('.toast')
    scope = page.get_by_test_id('history-scope')
    rows = page.locator('.transactions-table tbody tr')

    def record(note, date):
        page.get_by_role('button', name='Catat transaksi', exact=True).first.click()
        dialog = page.get_by_role('dialog')
        dialog.get_by_label('Dompet asal', exact=True).select_option('bank')
        dialog.get_by_label('Nominal', exact=True).fill('7')
        dialog.get_by_label(re.compile('Keterangan')).fill(note)
        if date:
            dialog.get_by_label('Tanggal', exact=True).fill(date)
        dialog.get_by_role('button', name='Simpan transaksi', exact=True).click()
        expect(dialogs).to_have_count(0)

    def stored_dates():
        return page.evaluate('(key) => Object.fromEntries(JSON.parse(localStorage.getItem(key)).state.entries'
                             '.filter(entry => entry.note.startsWith("Synthetic elsewhere")).map(entry => [entry.note, entry.date]))', KEY)

    try:
        page.goto(args.url, wait_until='networkidle')
        nav.get_by_role('button', name='Transaksi', exact=True).click()
        expect(scope).to_contain_text('Oktober 2026')

        # Dated in the month on screen: the usual words, no button, and the row is there.
        record('Synthetic elsewhere same month', '')
        expect(toast).to_have_text('Transaksi tersimpan.')
        expect(toast.get_by_role('button', name='Lihat', exact=True)).to_have_count(0)
        expect(rows.filter(has_text='Synthetic elsewhere same month')).to_have_count(1)

        # A receipt from the previous save clears when a new dialog opens.
        transfer = page.get_by_role('button', name='Pindah uang', exact=True).first
        transfer.click()
        expect(dialogs).to_be_visible()
        expect(toast).to_have_count(0, timeout=1_000)
        dialogs.get_by_role('button', name='Tutup', exact=True).click()

        # Lihat clears a filter that would hide this expense even in its destination month.
        type_filter = page.get_by_label('Filter jenis transaksi', exact=True)
        type_filter.select_option('income')
        record('Synthetic elsewhere march', '2025-03-15')
        expect(toast).to_contain_text('Tersimpan di Maret 2025.')
        expect(rows.filter(has_text='Synthetic elsewhere march')).to_have_count(0)
        expect(scope).to_contain_text('Oktober 2026')
        toast.get_by_role('button', name='Lihat', exact=True).click()
        expect(toast).to_have_count(0)
        expect(scope).to_contain_text('Maret 2025')
        expect(type_filter).to_have_value('all')
        expect(rows.filter(has_text='Synthetic elsewhere march')).to_have_count(1)
        expect(scope).to_contain_text('1 transaksi')

        # An edit that moves the row to another month: the toast names it, and focus goes to the list's status line
        # instead of being left on the page body.
        page.get_by_role('button', name=re.compile('^Ubah .*Synthetic elsewhere march')).first.click()
        dialog = page.get_by_role('dialog')
        dialog.get_by_label('Tanggal', exact=True).fill('2025-01-20')
        dialog.get_by_role('button', name='Simpan transaksi', exact=True).click()
        expect(dialogs).to_have_count(0)
        expect(toast).to_contain_text('Tersimpan di Januari 2025.')
        expect(toast.get_by_role('button', name='Lihat', exact=True)).to_be_visible()
        expect(rows.filter(has_text='Synthetic elsewhere march')).to_have_count(0)
        expect(scope).to_be_focused()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'The toast with a button widened the page'
        toast.screenshot(path=str(output / f'{label}-toast.png'))

        # From Ringkasan the same toast leads to the row on Transaksi.
        nav.get_by_role('button', name='Ringkasan', exact=True).click()
        expect(page.locator('.breadcrumb strong')).to_have_text('Ringkasan')
        record('Synthetic elsewhere from overview', '2025-02-10')
        expect(toast).to_contain_text('Tersimpan di Februari 2025.')
        toast.get_by_role('button', name='Lihat', exact=True).click()
        expect(page.locator('.breadcrumb strong')).to_have_text('Transaksi')
        expect(scope).to_contain_text('Februari 2025')
        expect(rows.filter(has_text='Synthetic elsewhere from overview')).to_have_count(1)

        # Exactly what was typed is what was stored.
        assert stored_dates() == {'Synthetic elsewhere same month': '2026-10-31', 'Synthetic elsewhere march': '2025-01-20',
                                  'Synthetic elsewhere from overview': '2025-02-10'}, stored_dates()
        # A same-currency transfer can leave the selected wallet's month even though its other leg stays in it.
        page.get_by_label('Bulan laporan', exact=True).select_option('2026-10')
        page.get_by_label('Dompet riwayat', exact=True).select_option('cash')
        page.get_by_role('button', name='Pindah uang', exact=True).first.click()
        dialog = page.get_by_role('dialog')
        dialog.get_by_label('Dompet asal', exact=True).select_option('bank')
        dialog.get_by_label('Dompet tujuan', exact=True).select_option('cash')
        dialog.get_by_role('button', name='Tanggal masuk berbeda?', exact=True).click()
        dialog.get_by_label('Tanggal debit', exact=True).fill('2026-10-31')
        dialog.get_by_label('Tanggal kredit', exact=True).fill('2026-11-01')
        dialog.get_by_label('Nominal', exact=True).fill('7')
        dialog.get_by_label(re.compile('Keterangan')).fill('Synthetic split transfer')
        dialog.get_by_role('button', name='Simpan transaksi', exact=True).click()
        expect(dialogs).to_have_count(0)
        expect(rows.filter(has_text='Synthetic split transfer')).to_have_count(0)
        expect(toast).to_contain_text('Transfer tersimpan di November 2026.')
        toast.get_by_role('button', name='Lihat', exact=True).click()
        expect(scope).to_contain_text('November 2026')
        expect(page.get_by_label('Dompet riwayat', exact=True)).to_have_value('all')
        expect(rows.filter(has_text='Synthetic split transfer')).to_have_count(1)

        # A persistent error from an unreadable backup stays available in the next dialog.
        with page.expect_file_chooser() as pending:
            backup_action(page, 'Pulihkan cadangan').click()
        pending.value.set_files({'name': 'synthetic-invalid.json', 'mimeType': 'application/json', 'buffer': b'{'})
        error = page.get_by_role('alert').filter(has_text='File ini bukan cadangan Uangku')
        expect(error).to_be_visible()
        transfer.click()
        expect(dialogs).to_be_visible()
        expect(error).to_be_visible()
        error.get_by_text('Detail teknis', exact=True).click()
        expect(error.locator('details')).to_have_attribute('open', '')
        error.get_by_role('button', name='Tutup pemberitahuan').click()
        dialogs.get_by_role('button', name='Tutup', exact=True).click()
        assert not errors, errors
        return {'name': label, 'status': 'passed'}
    except Exception:
        page.screenshot(path=str(output / f'{label}-failure.png'), full_page=True)
        raise
    finally:
        context.close()


ROW_ON_SCREEN_JS = """(row) => { const box = row.getBoundingClientRect();
 const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
 return box.height > 0 && box.top >= 0 && box.bottom <= innerHeight && row.contains(hit); }"""


def saved_page_case(browser, args, output, mobile):
    """MW-165: Lihat opens the page of the list that holds the saved transaction, and brings its row on screen.

    The fixture has 67 IDR rows in October 2026: two pages of 50, so a row dated early in the month is on page 2."""
    label = 'saved-page-mobile' if mobile else 'saved-page-desktop'
    data = fixture()
    # Older backups accept identifiers containing NUL. CSS selectors cannot represent this character.
    next(entry for entry in data['state']['entries'] if entry['id'] == 'old')['id'] = 'old\x00row'
    raw = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    context, page, errors = storage_page(browser, mobile, raw)
    nav = page.locator('.mobile-nav' if mobile else '.sidebar')
    dialogs = page.get_by_role('dialog')
    toast = page.locator('.toast')
    scope = page.get_by_test_id('history-scope')
    rows = page.locator('.transactions-table tbody tr')
    paging = page.get_by_role('navigation', name='Halaman riwayat', exact=True).get_by_role('status')
    month = page.get_by_label('Bulan laporan', exact=True)

    def record(note, date, again=False):
        page.get_by_role('button', name='Catat transaksi', exact=True).first.click()
        dialog = page.get_by_role('dialog')
        dialog.get_by_label('Dompet asal', exact=True).select_option('bank')
        dialog.get_by_label('Nominal', exact=True).fill('7')
        dialog.get_by_label(re.compile('Keterangan')).fill(note)
        dialog.get_by_label('Tanggal', exact=True).fill(date)
        dialog.get_by_role('button', name='Simpan & catat lagi' if again else 'Simpan transaksi', exact=True).click()
        if not again:
            expect(dialogs).to_have_count(0)

    def see(note, pages):
        """Lihat, then: October 2026 without filters, on the page given, with this row in the list and on screen."""
        toast.get_by_role('button', name='Lihat', exact=True).click()
        expect(toast).to_have_count(0)
        expect(page.locator('.breadcrumb strong')).to_have_text('Transaksi')
        expect(scope).to_contain_text('Oktober 2026')
        expect(page.get_by_label('Dompet riwayat', exact=True)).to_have_value('all')
        expect(paging).to_have_text(pages)
        row = rows.filter(has_text=note)
        expect(row).to_have_count(1)
        # In the viewport and not under the fixed navigation: the point in its middle hits the row itself.
        page.wait_for_function(ROW_ON_SCREEN_JS, arg=row.element_handle())
        return row

    try:
        page.goto(args.url, wait_until='networkidle')
        # A row that another tab removes before Lihat is pressed is not in the list Lihat opens: page 1 stays and no
        # place is guessed for it. The balance on Ringkasan tells when this tab has taken the other tab's change over.
        other = another_page(context)
        other.goto(args.url + '#/transaksi', wait_until='networkidle')
        other.get_by_label('Cari transaksi', exact=True).fill('Synthetic page removed')
        month.select_option('2025-01')
        balance = '() => document.querySelector(".balance-card").innerText'
        before = page.evaluate(balance)
        record('Synthetic page removed', '2026-10-01')
        expect(toast).to_contain_text('Tersimpan di Oktober 2026.')
        assert page.evaluate(balance) != before, 'The balance on Ringkasan does not show the saved row'
        other.get_by_role('button', name='Ubah Synthetic page removed', exact=True).click()
        other.get_by_role('dialog').get_by_role('button', name='Hapus', exact=True).click()
        other.get_by_role('dialog').get_by_role('button', name='Hapus transaksi', exact=True).click()
        expect(other.locator('.toast')).to_contain_text('Transaksi dihapus')
        after_deletion = other.evaluate('(key) => localStorage.getItem(key)', KEY)
        page.wait_for_function('(text) => document.querySelector(".balance-card").innerText === text', arg=before)
        other.close()
        toast.get_by_role('button', name='Lihat', exact=True).click()
        expect(page.locator('.breadcrumb strong')).to_have_text('Transaksi')
        expect(scope).to_contain_text('Oktober 2026')
        expect(paging).to_have_text('1–50 dari 67 · Halaman 1 dari 2')
        expect(rows.filter(has_text='Synthetic page removed')).to_have_count(0)
        assert page.evaluate('scrollY') == 0, 'The list moved for a row that is not in it'
        assert page.evaluate('(key) => localStorage.getItem(key)', KEY) == after_deletion, 'Lihat wrote to the ledger'

        # The oldest row of the month, saved from another month: it is on page 2, far down the list.
        month.select_option('2025-01')
        expect(scope).to_contain_text('Januari 2025')
        record('Synthetic page oldest', '2026-10-01')
        expect(toast).to_contain_text('Tersimpan di Oktober 2026.')
        row = see('Synthetic page oldest', '51–68 dari 68 · Halaman 2 dari 2')
        row.screenshot(path=str(output / f'{label}-row.png'))
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Showing the row widened the page'
        # The pager still works from the page Lihat opened.
        page.get_by_role('button', name='Halaman sebelumnya', exact=True).click()
        expect(paging).to_have_text('1–50 dari 68 · Halaman 1 dari 2')
        expect(rows.filter(has_text='Synthetic page oldest')).to_have_count(0)

        # A row that belongs on page 1 opens page 1: the page is the row's own, not the last one. The page is counted
        # in the order Lihat leaves the list in (newest first), not the order chosen before it.
        month.select_option('2025-01')
        order = page.get_by_label('Urutan transaksi', exact=True)
        order.select_option('oldest')
        record('Synthetic page newest', '2026-10-31')
        expect(toast).to_contain_text('Tersimpan di Oktober 2026.')
        see('Synthetic page newest', '1–50 dari 69 · Halaman 1 dari 2')
        expect(order).to_have_value('newest')

        # From Ringkasan: the page changes too, and the list still opens on the row's page.
        nav.get_by_role('button', name='Ringkasan', exact=True).click()
        expect(page.locator('.breadcrumb strong')).to_have_text('Ringkasan')
        month.select_option('2025-01')
        record('Synthetic page from overview', '2026-10-02')
        expect(toast).to_contain_text('Tersimpan di Oktober 2026.')
        see('Synthetic page from overview', '51–70 dari 70 · Halaman 2 dari 2')

        # A transfer debited in September and credited in October, saved while the receiving wallet is selected:
        # Lihat opens October for every wallet, where the transfer sorts by its 1 October credit on page 2.
        month.select_option('2025-01')
        page.get_by_label('Dompet riwayat', exact=True).select_option('cash')
        page.get_by_role('button', name='Pindah uang', exact=True).first.click()
        dialog = page.get_by_role('dialog')
        dialog.get_by_label('Dompet asal', exact=True).select_option('bank')
        dialog.get_by_label('Dompet tujuan', exact=True).select_option('cash')
        dialog.get_by_role('button', name='Tanggal masuk berbeda?', exact=True).click()
        dialog.get_by_label('Tanggal debit', exact=True).fill('2026-09-30')
        dialog.get_by_label('Tanggal kredit', exact=True).fill('2026-10-01')
        dialog.get_by_label('Nominal', exact=True).fill('7')
        dialog.get_by_label(re.compile('Keterangan')).fill('Synthetic page transfer')
        dialog.get_by_role('button', name='Simpan transaksi', exact=True).click()
        expect(dialogs).to_have_count(0)
        expect(toast).to_contain_text('Transfer tersimpan di Oktober 2026.')
        see('Synthetic page transfer', '51–71 dari 71 · Halaman 2 dari 2')

        # Simpan & catat lagi names the month but offers no Lihat; the form stays open.
        month.select_option('2025-01')
        record('Synthetic page again', '2026-10-03', again=True)
        receipt = dialogs.get_by_role('status').filter(has_text='Tersimpan di Oktober 2026. Lanjut catat berikutnya.')
        expect(receipt).to_be_visible()
        expect(page.get_by_role('button', name='Lihat', exact=True)).to_have_count(0)
        expect(dialogs).to_have_count(1)
        # The repeat form restores focus on the next animation frame. Escape reaches
        # the dialog only after focus has returned from the disabled submit button.
        amount = dialogs.get_by_label('Nominal', exact=True)
        expect(amount).to_have_value('')
        expect(amount).to_be_focused()
        page.keyboard.press('Escape')
        expect(dialogs).to_have_count(0)
        expect(scope).to_contain_text('Januari 2025')

        # Edit an existing row with a legacy id, then follow it to page 2 of its new month.
        page.get_by_role('button', name='Ubah Synthetic older history', exact=True).click()
        dialog = page.get_by_role('dialog')
        dialog.get_by_label('Tanggal', exact=True).fill('2026-10-01')
        dialog.get_by_role('button', name='Simpan transaksi', exact=True).click()
        expect(dialogs).to_have_count(0)
        see('Synthetic older history', '51–73 dari 73 · Halaman 2 dari 2')

        # Exactly what was typed is what was stored, both dates of the transfer included.
        document = stored_document(page, KEY)
        saved = {entry['note']: entry for entry in document['state']['entries'] if entry['note'].startswith('Synthetic page')}
        assert {note: entry['date'] for note, entry in saved.items()} == {
            'Synthetic page oldest': '2026-10-01', 'Synthetic page newest': '2026-10-31', 'Synthetic page again': '2026-10-03',
            'Synthetic page from overview': '2026-10-02', 'Synthetic page transfer': '2026-09-30'}, saved
        posting = [row for row in document['metadata']['transfers'] if row['entryId'] == saved['Synthetic page transfer']['id']]
        assert [(row['sourceDate'], row['destinationDate']) for row in posting] == [('2026-09-30', '2026-10-01')], posting
        assert not errors, errors
        return {'name': label, 'status': 'passed'}
    except Exception:
        page.screenshot(path=str(output / f'{label}-failure.png'), full_page=True)
        raise
    finally:
        context.close()


def repeat_entry_close_case(browser, args, output, width):
    label = f'repeat-entry-close-{width}'
    raw = json.dumps(fixture(), ensure_ascii=False, separators=(',', ':'))
    context, page, errors = storage_page(browser, True, raw)
    try:
        page.set_viewport_size({'width': width, 'height': 844})
        page.goto(args.url, wait_until='networkidle')
        page.get_by_label('Bulan laporan', exact=True).select_option('2025-01')
        page.get_by_role('button', name='Catat transaksi', exact=True).first.click()
        dialog = page.get_by_role('dialog')
        dialog.get_by_label('Dompet asal', exact=True).select_option('bank')
        amount = dialog.get_by_label('Nominal', exact=True)
        amount.fill('7')
        note = 'Synthetic repeat entry'
        dialog.get_by_label(re.compile('Keterangan')).fill(note)
        again = dialog.get_by_role('button', name='Simpan & catat lagi', exact=True)
        again.click()
        receipt = page.get_by_role('status').filter(has_text='Tersimpan di Oktober 2026. Lanjut catat berikutnya.')
        expect(receipt).to_be_visible()
        expect(amount).to_have_value('')
        expect(amount).to_be_focused()
        if width == 390:
            # Dismissing just the receipt leaves the form ready to record a second transaction.
            receipt.get_by_role('button', name='Tutup pemberitahuan', exact=True).click()
            expect(receipt).to_have_count(0)
            amount.fill('8')
            dialog.get_by_label(re.compile('Keterangan')).fill(note)
            again.click()
            expect(receipt).to_be_visible()
        # An ordinary click must reach the header while the save receipt is still on screen.
        dialog.get_by_role('button', name='Tutup', exact=True).click(timeout=1_000)
        expect(dialog).to_have_count(0)
        stored = stored_document(page)
        amounts = sorted(entry['amount'] for entry in stored['state']['entries'] if entry['note'] == note)
        assert amounts == ([700, 800] if width == 390 else [700]), amounts
        assert not errors, errors
        return {'name': label, 'status': 'passed'}
    except Exception:
        page.screenshot(path=str(output / f'{label}-failure.png'), full_page=True)
        raise
    finally:
        context.close()


def receipt_keyboard_case(browser, args, output, mobile):
    data = fixture()
    data['state']['entries'] = []
    data['state']['wallets'] = data['state']['wallets'][:1]
    context, page, errors = storage_page(browser, mobile, json.dumps(data))
    try:
        page.goto(args.url, wait_until='networkidle')
        page.get_by_role('button', name='Catat transaksi', exact=True).first.click()
        dialog = page.get_by_role('dialog')
        amount = dialog.get_by_label('Nominal', exact=True)
        for expires in (True, False):
            amount.fill('7')
            dialog.get_by_role('button', name='Simpan & catat lagi', exact=True).click()
            dismiss = dialog.get_by_role('button', name='Tutup pemberitahuan', exact=True)
            expect(amount).to_be_focused()
            # Reach the receipt with the keyboard just as a user can while it is being announced.
            for _ in range(30):
                if dismiss.evaluate('(el) => document.activeElement === el'):
                    break
                page.keyboard.press('Shift+Tab')
            expect(dismiss).to_be_focused()
            if expires:
                page.clock.fast_forward(5_500)
            else:
                page.keyboard.press('Enter')
            expect(dismiss).to_have_count(0)
            expect(amount).to_be_focused(timeout=1_000)
        page.keyboard.press('Escape')
        expect(dialog).to_have_count(0)

        # With only one wallet, opening the wallet form produces a fresh explanation.
        page.get_by_role('button', name='Pindah uang', exact=True).first.click()
        expect(page.get_by_role('dialog', name='Tambah dompet', exact=True)).to_be_visible()
        expect(page.get_by_text('Transfer membutuhkan dua dompet.', exact=True)).to_be_visible(timeout=1_000)
        assert not errors, errors
        return {'name': 'receipt-keyboard', 'status': 'passed'}
    except Exception:
        page.screenshot(path=str(output / 'receipt-keyboard-failure.png'), full_page=True)
        raise
    finally:
        context.close()


def statement_fixture(period_end):
    """A bank wallet kept from one stored statement that ends on `period_end`, and a wallet without statements."""
    return {'app': 'uangku', 'version': 1, 'demo': False, 'state': {'version': 1,
        'wallets': [{'id': 'bank', 'name': 'Synthetic statement bank', 'currency': 'TRY', 'kind': 'bank', 'openingBalance': 12_000},
                    {'id': 'manual', 'name': 'Synthetic manual wallet', 'currency': 'TRY', 'kind': 'bank', 'openingBalance': 0}],
        'entries': [{'id': 'source-out', 'date': period_end, 'type': 'expense', 'walletId': 'bank', 'amount': 1000,
                     'category': 'Belanja', 'note': 'Synthetic statement row', 'sourceKey': 'ziraat:0000000000000001'},
                    {'id': 'manual-old', 'date': '2026-01-05', 'type': 'expense', 'walletId': 'manual', 'amount': 500,
                     'category': 'Belanja', 'note': 'Synthetic old manual row'}]},
        'metadata': {'policy': 'unverified-unless-linked',
            'facts': [{'id': 'synthetic-fact', 'walletId': 'bank', 'currency': 'TRY', 'postedOn': period_end, 'signedAmount': -1000,
                       'balanceAfter': 11_000, 'description': 'SYNTHETIC STATEMENT ROW', 'reference': 'SYN-STATEMENT-1',
                       'fingerprintVersion': 'ziraat-v1', 'fingerprint': 'ziraat:0000000000000001'}],
            'links': [{'entryId': 'source-out', 'source': 'synthetic-fact'}],
            'statements': [{'id': 'synthetic-statement', 'walletId': 'bank', 'currency': 'TRY', 'periodStart': period_end,
                            'periodEnd': period_end, 'openingBalance': 12_000, 'closingBalance': 11_000, 'rowIds': ['synthetic-fact']}]}}


def statement_reminder_case(browser, args, output, mobile):
    """MW-129c: on Ringkasan, a wallet whose stored statements stop before last month began gets a reminder.

    The clock is fixed on 31 Oct 2026, so last month began on 1 Sep."""
    label = 'statement-reminder-mobile' if mobile else 'statement-reminder-desktop'

    def opened(data):
        raw = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
        context, page, errors = storage_page(browser, mobile, raw)
        page.goto(args.url, wait_until='networkidle')
        expect(page.locator('.balance-card')).to_be_visible()
        return raw, context, page, errors

    def back_up(page):
        # One box at a time: the backup reminder goes first. A backup of what is stored satisfies it.
        backup = page.get_by_test_id('backup-reminder')
        expect(backup).to_be_visible()
        expect(page.get_by_test_id('statement-reminder')).to_have_count(0)
        with page.expect_download():
            backup.get_by_role('button', name='Cadangkan sekarang', exact=True).click()
        expect(backup).to_have_count(0)

    raw, context, page, errors = opened(statement_fixture('2026-08-31'))
    reminder = page.get_by_test_id('statement-reminder')
    nav = page.locator('.mobile-nav' if mobile else '.sidebar')
    try:
        back_up(page)
        expect(reminder).to_be_visible()
        expect(reminder).to_have_attribute('data-wallets', '1')
        expect(reminder.locator('strong')).to_have_text('Mutasi Synthetic statement bank baru tersimpan sampai 31 Agu 2026.')
        # The wallet that was never kept from statements is not named, however old its last record is.
        expect(reminder).not_to_contain_text('Synthetic manual wallet')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'The reminder overflows the page'
        page.screenshot(path=str(output / f'{label}.png'))
        # It belongs to Ringkasan only.
        nav.get_by_role('button', name='Dompet', exact=True).click()
        expect(page.locator('.breadcrumb strong')).to_have_text('Dompet')
        expect(reminder).to_have_count(0)
        nav.get_by_role('button', name='Ringkasan', exact=True).click()
        # Its action opens the import page.
        reminder.get_by_role('button', name='Impor mutasi', exact=True).click()
        expect(page.locator('.breadcrumb strong')).to_have_text('Impor mutasi')
        nav.get_by_role('button', name='Ringkasan', exact=True).click()
        expect(reminder).to_be_visible()
        # "Nanti saja" closes it until tomorrow, also after a reload, and nothing in the ledger is touched.
        reminder.get_by_role('button', name='Nanti saja', exact=True).click()
        expect(reminder).to_have_count(0)
        page.reload(wait_until='networkidle')
        expect(page.locator('.balance-card')).to_be_visible()
        expect(reminder).to_have_count(0)
        expect(page.get_by_test_id('backup-reminder')).to_have_count(0)
        assert page.evaluate('(key)=>localStorage.getItem(key)', KEY) == raw, 'The reminder changed the ledger'
        # The next day it is back.
        page.clock.set_fixed_time('2026-11-01T12:00:00Z')
        page.reload(wait_until='networkidle')
        expect(reminder).to_be_visible()
        assert not errors, errors
    except Exception:
        page.screenshot(path=str(output / f'{label}-failure.png'), full_page=True)
        raise
    finally:
        context.close()

    # A statement that reaches last month, even by one day, asks for nothing.
    raw, context, page, errors = opened(statement_fixture('2026-09-01'))
    try:
        back_up(page)
        expect(page.locator('.balance-card')).to_be_visible()
        expect(page.get_by_test_id('statement-reminder')).to_have_count(0)
        assert not errors, errors
    except Exception:
        page.screenshot(path=str(output / f'{label}-control-failure.png'), full_page=True)
        raise
    finally:
        context.close()

    # Only the active non-cash wallets are listed, oldest statement end first.
    from currency_import_browser import encode_fixture

    data = statement_fixture('2026-08-31')
    long_name = 'W' * 60
    for wallet_id, name, kind, end in [
        ('second', long_name, 'ewallet', '2026-07-31'),
        ('archived', 'Synthetic archived', 'bank', '2026-06-30'),
        ('cash', 'Synthetic cash', 'cash', '2026-05-31'),
    ]:
        data['state']['wallets'].append({'id': wallet_id, 'name': name, 'kind': kind, 'currency': 'TRY', 'openingBalance': 0})
        data['metadata']['statements'].append({'id': f'statement-{wallet_id}', 'walletId': wallet_id, 'currency': 'TRY',
            'periodStart': end, 'periodEnd': end, 'openingBalance': 0, 'closingBalance': 0, 'rowIds': []})
    data['metadata']['walletArchives'] = [{'walletId': 'archived', 'at': '2026-09-15T12:00:00Z'}]
    raw, context, page, errors = opened(encode_fixture(data))
    try:
        back_up(page)
        reminder = page.get_by_test_id('statement-reminder')
        expect(reminder).to_have_attribute('data-wallets', '2')
        expect(reminder.locator('strong')).to_have_text('Mutasi 2 dompet belum menjangkau bulan lalu.')
        expect(reminder).to_contain_text(re.compile(f'{long_name} sampai 31 Jul 2026.*Synthetic statement bank sampai 31 Agu 2026', re.S))
        expect(reminder).not_to_contain_text('Synthetic archived')
        expect(reminder).not_to_contain_text('Synthetic cash')
        assert reminder.evaluate('el => el.scrollWidth <= el.clientWidth + 1'), 'Wallet names overflow the reminder'
        assert page.evaluate('(key) => localStorage.getItem(key)', KEY) == raw
        assert not errors, errors
    except Exception:
        page.screenshot(path=str(output / f'{label}-multiple-failure.png'), full_page=True)
        raise
    finally:
        context.close()
    return {'name': label, 'status': 'passed'}


def statement_storage_case(browser, args, output, mobile):
    label = 'statement-reminder-storage-recovery'
    raw = json.dumps(statement_fixture('2026-08-31'), ensure_ascii=False, separators=(',', ':'))
    context, page, errors = storage_page(browser, mobile, raw)
    try:
        page.goto(args.url, wait_until='networkidle')
        reminder = page.get_by_test_id('statement-reminder')
        backup = page.get_by_test_id('backup-reminder')
        with page.expect_download():
            backup.get_by_role('button', name='Cadangkan sekarang', exact=True).click()
        expect(reminder).to_be_visible()

        page.evaluate(REJECT_LEDGER_WRITES_JS)
        dialog = record_expense(page, 'Synthetic reminder recovery')
        expect(page.get_by_test_id('save-status')).to_contain_text('penyimpanan gagal')
        dialog.get_by_role('button', name='Batal', exact=True).click()
        page.get_by_role('button', name='Buang isian', exact=True).click()
        expect(reminder).to_have_count(0)
        assert page.evaluate('(key) => localStorage.getItem(key)', KEY) == raw

        page.evaluate('() => { Storage.prototype.setItem = window.__setItem; }')
        page.get_by_role('button', name='Coba simpan lagi', exact=True).click()
        expect(page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
        expect(reminder).to_be_visible()
        durable = page.evaluate('(key) => localStorage.getItem(key)', KEY)
        assert durable != raw

        other = context.new_page()
        other.goto(args.url, wait_until='networkidle')
        other.evaluate('(key) => localStorage.setItem(key, "{broken")', KEY)
        expect(page.get_by_test_id('save-status')).to_contain_text('pemulihan diperlukan')
        expect(reminder).to_have_count(0)
        assert page.evaluate('(key) => localStorage.getItem(key)', KEY) == '{broken'
        other.evaluate('([key, value]) => localStorage.setItem(key, value)', [KEY, durable])
        expect(page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
        expect(reminder).to_be_visible()
        assert page.evaluate('(key) => localStorage.getItem(key)', KEY) == durable
        assert not errors, errors
    except Exception:
        page.screenshot(path=str(output / f'{label}-failure.png'), full_page=True)
        raise
    finally:
        context.close()
    return {'name': label, 'status': 'passed'}


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
            for name, case, mobile in [('desktop', run_case, False), ('mobile', run_case, True),
                                       ('storage-desktop', storage_case, False), ('storage-mobile', storage_case, True),
                                       ('storage-gating', storage_gating_case, False),
                                       ('routes-desktop', route_case, False), ('routes-mobile', route_case, True),
                                       ('dialog-back-desktop', dialog_back_case, False),
                                       ('dialog-back-mobile', dialog_back_case, True),
                                       ('unload-warning-desktop', unload_warning_case, False),
                                       ('unload-warning-mobile', unload_warning_case, True),
                                       ('saved-elsewhere-desktop', saved_elsewhere_case, False),
                                       ('saved-elsewhere-mobile', saved_elsewhere_case, True),
                                       ('saved-page-desktop', saved_page_case, False),
                                       ('saved-page-mobile', saved_page_case, True),
                                       ('repeat-entry-close-320', repeat_entry_close_case, 320),
                                       ('repeat-entry-close-390', repeat_entry_close_case, 390),
                                       ('receipt-keyboard', receipt_keyboard_case, True),
                                       ('statement-reminder-storage-recovery', statement_storage_case, False),
                                       ('statement-reminder-desktop', statement_reminder_case, False),
                                       ('statement-reminder-mobile', statement_reminder_case, True)]:
                began = time.monotonic()
                try:
                    result = case(browser, args, output, mobile)
                except Exception as err:
                    result = {'name': name, 'status': 'failed', 'error': str(err), 'traceback': traceback.format_exc()}
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
