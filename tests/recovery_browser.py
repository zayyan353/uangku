"""Minimum local reconstruction regressions; synthetic fresh browser contexts only.

Run a production preview first. Example:
  UANGKU_TEST_URL=http://127.0.0.1:4173 python tests/recovery_browser.py --output PATH

Uses an installed Chrome/Edge executable and a scoped Playwright dependency.
No existing browser profile, cloud runtime, bank account or real backup is read.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
from browser_support import (install_playwright_path, launch_browser,
                             read_document, stored_document, assert_production_url)
install_playwright_path()
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('UANGKU_TEST_URL', 'http://127.0.0.1:4180')
KEY = 'uangku:v1'
FIXED_TIME = datetime(2026, 10, 30, 12, tzinfo=timezone.utc)
LIMIT = 8 * 1024 * 1024


def fixture(entries=None, *, try_opening=12_000):
    return {'app': 'uangku', 'version': 1, 'demo': False, 'state': {
        'version': 1,
        'wallets': [
            {'id': 'bca-idr', 'name': 'Synthetic A', 'currency': 'IDR', 'kind': 'bank', 'openingBalance': 100_000},
            {'id': 'cash-idr', 'name': 'Synthetic B', 'currency': 'IDR', 'kind': 'bank', 'openingBalance': 0},
            {'id': 'ziraat-try', 'name': 'Synthetic Ziraat', 'currency': 'TRY', 'kind': 'bank', 'openingBalance': try_opening},
        ],
        'entries': entries or [],
    }}


def expense(id_, amount=100, *, wallet='bca-idr', date='2026-10-30', note='Synthetic'):
    return {'id': id_, 'date': date, 'type': 'expense', 'walletId': wallet, 'amount': amount,
            'category': 'Belanja', 'note': note}


def stored(page):
    return stored_document(page, KEY)


def persisted_notes(page):
    return sorted(e['note'] for e in stored(page)['state']['entries'])


def saldo(data, wallet):
    result = next(w['openingBalance'] for w in data['state']['wallets'] if w['id'] == wallet)
    for e in data['state']['entries']:
        if e['walletId'] == wallet:
            result += e['amount'] if e['type'] in ['income', 'adjustment', 'unreviewed', 'movement'] else -e['amount'] - e.get('fee', 0)
        if e['type'] == 'transfer' and e.get('toWalletId') == wallet:
            result += e.get('toAmount', 0)
    return result


def nav(page, label):
    page.locator('.sidebar').get_by_role('button', name=re.compile('^' + re.escape(label) + r'(?:\s+\d+)?$')).click()


def open_expense(page, *, note, amount='1', wallet='bca-idr', date='2026-10-30'):
    page.get_by_role('button', name='Catat transaksi', exact=True).first.click()
    dlg = page.get_by_role('dialog')
    dlg.get_by_label('Dompet asal', exact=True).select_option(wallet)
    dlg.get_by_label('Nominal', exact=True).fill(amount)
    dlg.locator('input[type=date]').fill(date)
    dlg.get_by_label(re.compile('Keterangan')).fill(note)
    return dlg


def save_expense(page, **kwargs):
    dlg = open_expense(page, **kwargs)
    dlg.get_by_role('button', name='Simpan transaksi', exact=True).click()
    expect(page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
    expect(page.get_by_role('dialog')).to_have_count(0)


@contextmanager
def isolated(browser, initial, output, name, *, viewport=None, init_extra=None):
    context = browser.new_context(viewport=viewport or {'width': 1440, 'height': 1000}, accept_downloads=True,
                                  timezone_id='Europe/Istanbul')
    raw = json.dumps(initial, ensure_ascii=False, separators=(',', ':'))
    context.add_init_script('if (localStorage.getItem(' + json.dumps(KEY) + ') === null) localStorage.setItem('
                            + json.dumps(KEY) + ', ' + json.dumps(raw) + ');')
    if init_extra:
        context.add_init_script(init_extra)
    errors = []

    def add_page():
        page = context.new_page()
        page.set_default_timeout(25_000)
        page.on('pageerror', lambda err: errors.append(str(err)))
        page.clock.install(time=FIXED_TIME)
        page.goto(URL, wait_until='networkidle')
        expect(page.locator('.balance-card')).to_be_visible()
        return page

    try:
        yield context, add_page, errors
        assert errors == [], 'Unexpected page error: ' + repr(errors)
    except Exception:
        for index, page in enumerate(context.pages):
            if not page.is_closed():
                try:
                    page.screenshot(path=str(output / f'{name}-{index}-failure.png'), full_page=True, timeout=5_000)
                except Exception:
                    pass
        raise
    finally:
        context.close()


def test_stale_form(browser, output):
    with isolated(browser, fixture(), output, 'stale-form') as (_, new_page, _):
        a, b = new_page(), new_page()
        draft_a = open_expense(a, note='Tab A durable')
        draft_b = open_expense(b, note='Tab B recoverable', amount='2')
        draft_a.get_by_role('button', name='Simpan transaksi', exact=True).click()
        a.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).state.entries.length === 1', arg=KEY)
        draft_b.get_by_role('button', name='Simpan transaksi', exact=True).click()
        expect(b.get_by_test_id('save-status')).to_contain_text('konflik')
        assert persisted_notes(a) == ['Tab A durable']
        b.get_by_role('dialog').get_by_role('button', name='Batal', exact=True).click()
        with b.expect_download() as info:
            b.get_by_role('button', name='Unduh pekerjaan yang belum tersimpan', exact=True).click()
        path = output / 'stale-form-recovery-synthetic.json'
        info.value.save_as(path)
        recovered = json.loads(path.read_text(encoding='utf-8'))
        assert 'Tab B recoverable' in [e['note'] for e in recovered['state']['entries']]
        a.reload(wait_until='networkidle')
        assert persisted_notes(a) == ['Tab A durable']


def test_clean_sync_and_concurrent_forms(browser, output):
    with isolated(browser, fixture(), output, 'two-tabs') as (_, new_page, _):
        a, b = new_page(), new_page()
        save_expense(a, note='Sequential A')
        b.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).state.entries.length === 1', arg=KEY)
        b.bring_to_front()
        save_expense(b, note='Sequential B')
        assert persisted_notes(a) == ['Sequential A', 'Sequential B']
        a.bring_to_front()
        a.wait_for_timeout(100)
        open_expense(a, note='Concurrent A')
        open_expense(b, note='Concurrent B')
        a.get_by_role('dialog').locator('form').evaluate('(form) => form.requestSubmit()')
        b.get_by_role('dialog').locator('form').evaluate('(form) => form.requestSubmit()')
        a.wait_for_timeout(400)
        notes = persisted_notes(a)
        assert 'Sequential A' in notes and 'Sequential B' in notes
        assert ('Concurrent A' in notes) or ('Concurrent B' in notes)
        assert len(notes) in [3, 4]
        if len(notes) == 3:
            loser = a if 'Concurrent A' not in notes else b
            expect(loser.get_by_test_id('save-status')).to_contain_text('konflik')


def test_quota_retry(browser, output):
    with isolated(browser, fixture(), output, 'quota') as (_, new_page, _):
        page = new_page()
        page.evaluate('''() => {
          window.__restoreSetItem = Storage.prototype.setItem;
          window.__ledgerWriteAttempts = 0;
          Storage.prototype.setItem = function(key,value) {
            if (key === 'uangku:v1') { window.__ledgerWriteAttempts++; throw new DOMException('Synthetic quota failure','QuotaExceededError'); }
            return window.__restoreSetItem.call(this,key,value);
          };
        }''')
        open_expense(page, note='Quota retained draft', amount='7').get_by_role('button', name='Simpan transaksi', exact=True).click()
        expect(page.get_by_test_id('save-status')).to_contain_text('penyimpanan gagal')
        assert stored(page)['state']['entries'] == []
        assert 'Tersimpan di browser' not in page.locator('.sidebar-user').inner_text()
        assert 'Transaksi tersimpan.' not in page.locator('body').inner_text()
        page.get_by_role('dialog').get_by_role('button', name='Batal', exact=True).click()
        with page.expect_download() as info:
            page.get_by_role('button', name='Unduh pekerjaan yang belum tersimpan', exact=True).click()
        path = output / 'quota-recovery-synthetic.json'
        info.value.save_as(path)
        assert len(json.loads(path.read_text(encoding='utf-8'))['state']['entries']) == 1
        page.evaluate('''() => {
          Storage.prototype.setItem = function(key,value) {
            if (key === 'uangku:v1') window.__ledgerWriteAttempts++;
            return window.__restoreSetItem.call(this,key,value);
          };
        }''')
        page.get_by_role('button', name='Coba simpan lagi', exact=True).click()
        expect(page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
        assert persisted_notes(page) == ['Quota retained draft']
        assert page.evaluate('window.__ledgerWriteAttempts') == 2
        page.reload(wait_until='networkidle')
        assert persisted_notes(page) == ['Quota retained draft']


def test_no_web_locks(browser, output):
    extra = "Object.defineProperty(navigator,'locks',{configurable:true,get:()=>undefined});"
    with isolated(browser, fixture(), output, 'no-locks', init_extra=extra) as (_, new_page, _):
        page = new_page()
        expect(page.get_by_test_id('save-status')).to_contain_text('tidak didukung')
        open_expense(page, note='Unsupported draft').get_by_role('button', name='Simpan transaksi', exact=True).click()
        expect(page.get_by_test_id('save-status')).to_contain_text('tidak didukung')
        assert stored(page)['state']['entries'] == []


def test_pending_writer_modal_guard(browser, output):
    with isolated(browser, fixture(), output, 'pending-writer') as (_, new_page, _):
        page = new_page()
        page.evaluate('''() => {
          const request = navigator.locks.request.bind(navigator.locks);
          navigator.locks.request = (name,options,callback) => request(name,options,async lock => {
            await new Promise(resolve => { window.__releaseSyntheticWriter = resolve; });
            return callback(lock);
          });
        }''')
        dlg = open_expense(page, note='Pending original draft')
        dlg.get_by_role('button', name='Simpan transaksi', exact=True).click()
        expect(page.get_by_test_id('save-status')).to_contain_text('Sedang menyimpan')
        # Inspect durable bytes while intentionally withholding the lock. The
        # usual helper waits for a completed save and would deadlock this case.
        assert page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', KEY)['state']['entries'] == []
        dlg.press('Escape')
        expect(page.get_by_role('dialog')).to_have_count(1)
        page.get_by_role('dialog').get_by_role('button', name='Batal', exact=True).evaluate('(button) => button.click()')
        expect(page.get_by_role('dialog')).to_have_count(1)
        page.locator('.modal-backdrop').click(position={'x': 2, 'y': 2}, force=True)
        expect(page.get_by_role('dialog')).to_have_count(1)
        page.get_by_role('button', name='Pindah uang', exact=True).evaluate('(button) => button.click()')
        expect(page.get_by_role('dialog')).to_have_attribute('aria-label', 'Catat transaksi')
        expect(page.get_by_role('dialog').get_by_label(re.compile('Keterangan'))).to_have_value('Pending original draft')
        page.evaluate('window.__releaseSyntheticWriter()')
        expect(page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
        expect(page.get_by_role('dialog')).to_have_count(0)
        assert persisted_notes(page) == ['Pending original draft']


def test_stale_modal_delete(browser, output):
    initial = fixture([expense('original', 100, note='Original record')])
    with isolated(browser, initial, output, 'stale-delete') as (_, new_page, _):
        a, b = new_page(), new_page()
        a.get_by_role('button', name='Ubah Original record', exact=True).click()
        b.get_by_role('button', name='Ubah Original record', exact=True).click()
        b.get_by_role('dialog').get_by_label(re.compile('Keterangan')).fill('Remote edited record')
        b.get_by_role('dialog').get_by_role('button', name='Simpan transaksi', exact=True).click()
        expect(b.get_by_role('dialog')).to_have_count(0)
        a.get_by_role('dialog').get_by_role('button', name='Hapus', exact=True).click()
        a.get_by_role('dialog').get_by_role('button', name='Hapus transaksi', exact=True).click()
        expect(a.get_by_test_id('save-status')).to_contain_text('konflik')
        assert persisted_notes(a) == ['Remote edited record']
        assert stored(a)['state']['entries'][0]['id'] == 'original'


def test_blocked_metadata_confirmation(browser, output):
    initial = fixture([expense('source', 100, note='Unsupported source document')])
    initial['metadata'] = {'policy': 'synthetic-source', 'facts': [], 'links': [], 'statements': []}
    with isolated(browser, initial, output, 'blocked-metadata') as (_, new_page, _):
        page = new_page()
        before = page.evaluate('(key) => localStorage.getItem(key)', KEY)
        expect(page.get_by_test_id('save-status')).to_contain_text('Data lama dilindungi')
        page.locator('.demo-banner button').click()
        dlg = page.get_by_role('dialog')
        expect(dlg).to_contain_text(re.compile(r'data (lama|tersimpan)|catatan (lama|tersimpan)|data.*tidak.*(terbaca|didukung)', re.I))
        assert 'Data contoh akan diganti' not in dlg.inner_text()
        dlg.get_by_role('button', name='Batal', exact=True).click()
        assert page.evaluate('(key) => localStorage.getItem(key)', KEY) == before
        with page.expect_download() as info:
            page.get_by_role('button', name='Unduh pekerjaan yang belum tersimpan', exact=True).click()
        path = output / 'blocked-original-synthetic.json'
        info.value.save_as(path)
        assert path.read_text(encoding='utf-8') == before
        assert json.loads(path.read_text(encoding='utf-8')) == initial


def download_backup(page, path):
    with page.expect_download(timeout=60_000) as info:
        page.locator('.sidebar').get_by_role('button', name='Cadangkan data', exact=True).click()
    info.value.save_as(path)
    return read_document(path)


def restore_backup(page, path):
    page.get_by_label('File cadangan Uangku', exact=True).set_input_files(path)
    page.get_by_role('dialog').get_by_role('button', name='Pulihkan data', exact=True).click()
    expect(page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser', timeout=60_000)
    expect(page.get_by_role('dialog')).to_have_count(0)


def test_backup_small(browser, output):
    initial = fixture([expense('small-1', 2_550, note='İstanbul 界 synthetic')])
    with isolated(browser, initial, output, 'backup-small') as (_, new_page, _):
        page = new_page()
        path = output / 'download-small-synthetic.json'
        assert download_backup(page, path) == initial
        save_expense(page, note='Mutation after backup')
        assert len(stored(page)['state']['entries']) == 2
        restore_backup(page, path)
        page.reload(wait_until='networkidle')
        assert stored(page) == initial
        invalid = output / 'invalid-synthetic.json'
        invalid.write_text('{"app":"foreign"}', encoding='utf-8')
        page.get_by_label('File cadangan Uangku', exact=True).set_input_files(invalid)
        assert stored(page) == initial


def test_backup_large(browser, output):
    initial = {'app': 'uangku', 'version': 1, 'demo': False, 'state': {'version': 1,
        'wallets': [{'id': 'a', 'name': 'Synthetic large', 'currency': 'TRY', 'kind': 'bank', 'openingBalance': 1_000_000}],
        'entries': [{'id': f'e{i}', 'date': '2020-01-01', 'type': 'expense', 'walletId': 'a', 'amount': 1, 'category': '', 'note': ''} for i in range(46_000)]}}
    pretty = output / 'legacy-pretty-large-synthetic.json'
    pretty.write_text(json.dumps(initial, ensure_ascii=False, indent=2), encoding='utf-8')
    assert pretty.stat().st_size > LIMIT
    with isolated(browser, initial, output, 'backup-large') as (_, new_page, _):
        page = new_page()
        path = output / 'download-large-synthetic.json'
        assert download_backup(page, path) == initial
        assert path.stat().st_size < LIMIT
        restore_backup(page, path)
        restore_backup(page, pretty)
        page.reload(wait_until='networkidle')
        result = stored(page)
        assert result == initial
        assert saldo(result, 'a') == 954_000


def test_future_balance(browser, output):
    past = {**expense('past', 20_000, note='Past income'), 'type': 'income'}
    future = {**expense('future', 50_000, date='2099-01-01', note='Future income'), 'type': 'income'}
    initial = fixture([past, future])
    with isolated(browser, initial, output, 'future') as (_, new_page, _):
        page = new_page()
        expect(page.locator('.balance-number')).to_contain_text('1.200')
        expect(page.locator('.balance-bottom')).to_contain_text('1.700')
        assert stored(page) == initial
        open_expense(page, note='Future expense UI', date='2099-01-02')
        expect(page.get_by_role('dialog')).to_contain_text(re.compile('masa depan', re.I))
        page.get_by_role('dialog').get_by_role('button', name='Simpan transaksi', exact=True).click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        expect(page.locator('.balance-number')).to_contain_text('1.200')
        page.reload(wait_until='networkidle')
        expect(page.locator('.balance-number')).to_contain_text('1.200')
        assert len(stored(page)['state']['entries']) == 3


def write_statement(path):
    transactions = [
        ['30.10.2026', 'R-3', 'POS toko contoh', -25.5, 174.5],
        ['29.10.2026', 'R-2', 'HAVALE contoh', 100, 200],
        ['28.10.2026', 'R-1', 'POS belanja contoh', -20, 100],
    ]
    rows = [['Synthetic statement only'], ['Mata uang', 'TL'], *[[] for _ in range(9)],
            ['Tarih', 'Fiş No', 'Açıklama', 'İşlem Tutarı', 'Bakiye'], *transactions]
    xml = []
    for row in rows:
        cells = [f'<c t="{"n" if isinstance(v,(int,float)) else "str"}"><v>{escape(str(v))}</v></c>' for v in row]
        xml.append('<row>' + ''.join(cells) + '</row>')
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    with ZipFile(path, 'w', ZIP_DEFLATED) as z:
        z.writestr('xl/workbook.xml', f'<workbook {ns}><workbookPr date1904="0"/></workbook>')
        z.writestr('xl/worksheets/sheet1.xml', f'<worksheet {ns}><sheetData>{"".join(xml)}</sheetData></worksheet>')


def test_import_overlap(browser, output, *, after_preview):
    name = 'manual-after-preview' if after_preview else 'manual-before-preview'
    with isolated(browser, fixture(), output, name) as (_, new_page, _):
        page = new_page()
        path = output / f'{name}.xlsx'
        write_statement(path)
        if not after_preview:
            save_expense(page, note='POS belanja contoh', amount='20', wallet='ziraat-try', date='2026-10-28')
        nav(page, 'Impor mutasi')
        page.get_by_label('File mutasi Ziraat', exact=True).set_input_files(path)
        expect(page.locator('.import-preview')).to_be_visible()
        if after_preview:
            save_expense(page, note='POS belanja contoh', amount='20', wallet='ziraat-try', date='2026-10-28')
        expect(page.get_by_role('button', name='Lewati', exact=True)).to_have_count(1)
        page.get_by_role('button', name='Lewati', exact=True).click()
        page.get_by_role('button', name='Simpan 2 transaksi', exact=True).click()
        expect(page.locator('.import-preview')).to_have_count(0)
        page.reload(wait_until='networkidle')
        data = stored(page)
        assert len(data['state']['entries']) == 3
        assert saldo(data, 'ziraat-try') == 17_450
        assert len({e['id'] for e in data['state']['entries']}) == 3


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--case', action='append', default=[])
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    dist_sha = assert_production_url(URL)
    candidates = [os.environ.get('UANGKU_BROWSER_EXECUTABLE'),
                  r'C:\Program Files\Google\Chrome\Application\chrome.exe',
                  r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe']
    executable = next((p for p in candidates if p and Path(p).is_file()), None)
    cases = [
        ('stale-form-conflict', test_stale_form),
        ('two-tabs-sync-and-concurrent', test_clean_sync_and_concurrent_forms),
        ('quota-recovery-retry', test_quota_retry),
        ('missing-web-locks', test_no_web_locks),
        ('pending-writer-modal-guard', test_pending_writer_modal_guard),
        ('stale-modal-delete', test_stale_modal_delete),
        ('blocked-metadata-confirmation', test_blocked_metadata_confirmation),
        ('backup-small-roundtrip', test_backup_small),
        ('backup-large-and-legacy-pretty', test_backup_large),
        ('future-actual-vs-all-records', test_future_balance),
        ('manual-before-preview', lambda b, o: test_import_overlap(b, o, after_preview=False)),
        ('manual-after-preview', lambda b, o: test_import_overlap(b, o, after_preview=True)),
    ]
    results = []
    source = {str(p.relative_to(ROOT)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in sorted((ROOT / 'src').rglob('*')) if p.is_file()}
    with sync_playwright() as pw:
        if executable:
            os.environ['CHROMIUM_PATH'] = executable
        browser = launch_browser(pw)
        version = browser.version
        for name, function in cases:
            if args.case and name not in args.case:
                continue
            began = time.monotonic()
            try:
                function(browser, output)
                result = {'name': name, 'status': 'passed'}
            except Exception as err:
                result = {'name': name, 'status': 'failed', 'error': str(err)}
            result['seconds'] = round(time.monotonic() - began, 3)
            results.append(result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
        browser.close()
    final_source = {str(p.relative_to(ROOT)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in sorted((ROOT / 'src').rglob('*')) if p.is_file()}
    report = {'scope': 'Fresh local minimum reconstruction; not the cloud H release gates',
              'url': URL, 'browser_executable': executable, 'browser_version': version,
              'dist_sha256': dist_sha,
              'synthetic_only': True, 'real_profile_used': False,
              'source_before': source, 'source_after': final_source,
              'source_stable': source == final_source, 'results': results,
              'passed': sum(r['status'] == 'passed' for r in results),
              'failed': sum(r['status'] != 'passed' for r in results)}
    (output / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'summary': str(output / 'summary.json'), 'passed': report['passed'], 'failed': report['failed'], 'source_stable': report['source_stable']}))
    return 0 if not report['failed'] and report['source_stable'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
