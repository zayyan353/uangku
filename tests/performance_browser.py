"""Production-only, synthetic browser performance gate.

The measured workload is ten individually committed UI edits on a 10k ledger.
The median/p95 budgets and active animation-frame budget are declared before
sampling. This is not comparable with historical measurements on other hosts.

That ledger is a version-1 document: manual rows only. A second sample builds
a version-2 document by importing a synthetic CSV through the app's own
"CSV / Excel umum" screen and then times one manual save on it. Its
milliseconds are reported in the summary and have no budget.
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import statistics
import time
import traceback

from browser_support import (install_playwright_path, launch_browser,
                             stored_document, wait_not_saving)
install_playwright_path()
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
KEY = 'uangku:v1'


def source_hashes():
    files = [*sorted((ROOT / 'src').rglob('*')), ROOT / 'package-lock.json', ROOT / 'vite.config.ts']
    return {str(p.relative_to(ROOT)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in files if p.is_file()}


def make_fixture(count):
    return {'app': 'uangku', 'version': 1, 'demo': False, 'state': {
        'version': 1,
        'wallets': [
            {'id': 'perf-bank', 'name': 'Synthetic performance bank', 'currency': 'IDR', 'kind': 'bank', 'openingBalance': 10_000_000},
            {'id': 'perf-cash', 'name': 'Synthetic performance second bank', 'currency': 'IDR', 'kind': 'bank', 'openingBalance': 0},
        ],
        'entries': [{'id': f'perf-{index}', 'date': '2026-10-01', 'type': 'expense', 'walletId': 'perf-bank',
                     'amount': 100, 'category': 'Belanja', 'note': f'Synthetic performance row {index:05d}'}
                    for index in range(count)],
    }}


IMPORT_WALLET = {'id': 'perf-import', 'name': 'Synthetic imported bank', 'currency': 'IDR', 'kind': 'bank', 'openingBalance': 0}
MANUAL_NOTE = 'Synthetic manual save after import'


def make_import_csv(count):
    """One account, oldest first, with a running balance: the shape "CSV / Excel umum" requires."""
    money = lambda minor: f'{"-" if minor < 0 else ""}{abs(minor) // 100}.{abs(minor) % 100:02d}'
    lines, balance = ['date,reference,description,amount,balance'], 100_000_000
    for index in range(count):
        amount = 150_000 if index % 10 == 9 else -(10_000 + index % 97)
        balance += amount
        day = date(2026, 1, 1) + timedelta(days=index * 240 // count)
        lines.append(f'{day.isoformat()},SYN-{index:05d},Synthetic imported row {index:05d},{money(amount)},{money(balance)}')
    return ('\n'.join(lines) + '\n').encode('utf-8')


# Clocks run in the page so that the numbers exclude Playwright's own polling.
SAVE_TIMER_JS = '''(button, key) => {
  const timing = window.__perfSave = {clicked: null, stored: null, closed: null};
  button.addEventListener('click', () => { if (timing.clicked === null) timing.clicked = performance.now(); }, true);
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (name, value) {
    setItem.call(this, name, value);
    if (name === key && timing.clicked !== null && timing.stored === null) timing.stored = performance.now();
  };
  new MutationObserver((records, observer) => {
    if (timing.clicked === null || document.querySelector('[role="dialog"]')) return;
    timing.closed = performance.now();
    observer.disconnect();
  }).observe(document.body, {childList: true, subtree: true});
}'''


def percentile(values, fraction):
    return sorted(values)[max(0, math.ceil(fraction * len(values)) - 1)]


def run_sample(browser, args, output, index, fixture, html_sha):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, timezone_id='Europe/Istanbul')
    raw = json.dumps(fixture, separators=(',', ':'))
    context.add_init_script('if(localStorage.getItem(' + json.dumps(KEY) + ')===null) localStorage.setItem('
                            + json.dumps(KEY) + ',' + json.dumps(raw) + ');')
    page = context.new_page()
    page.set_default_timeout(30_000)
    errors = []
    page.on('pageerror', lambda err: errors.append(str(err)))
    result = {'sample': index, 'status': 'failed'}
    try:
        start = time.monotonic()
        response = page.goto(args.url, wait_until='networkidle')
        assert response and response.ok
        assert hashlib.sha256(response.body()).hexdigest() == html_sha, 'Server is not serving canonical dist/index.html'
        expect(page.locator('.balance-card')).to_be_visible()
        result['load_seconds'] = round(time.monotonic() - start, 4)
        page.locator('.sidebar').get_by_role('button', name='Transaksi', exact=True).click()
        period = page.get_by_label('Periode transaksi', exact=True)
        if period.count():
            period.select_option('all')
        expect(page.locator('.transactions-table tbody tr')).to_have_count(min(50, args.rows))
        page.evaluate('''() => {
          window.__perfMeasurement = {active:true, maxFrameGap:0, last:performance.now(), longTasks:[]};
          const measure = () => { const m=window.__perfMeasurement; if(!m.active)return;
            const now=performance.now(); m.maxFrameGap=Math.max(m.maxFrameGap,now-m.last); m.last=now; requestAnimationFrame(measure); };
          requestAnimationFrame(measure);
          if(PerformanceObserver.supportedEntryTypes.includes('longtask')) {
            window.__perfObserver=new PerformanceObserver(list => {
              if(window.__perfMeasurement.active) window.__perfMeasurement.longTasks.push(...list.getEntries().map(e=>e.duration));
            }); window.__perfObserver.observe({entryTypes:['longtask']});
          }
        }''')
        began = time.monotonic()
        changes = []
        for item in range(args.edits):
            one = time.monotonic()
            note = fixture['state']['entries'][item]['note']
            page.get_by_label('Cari transaksi', exact=True).fill(note)
            expect(page.locator('.transactions-table tbody tr')).to_have_count(1)
            page.get_by_role('button', name='Ubah ' + note, exact=True).click()
            dlg = page.get_by_role('dialog')
            dlg.get_by_label('Nominal', exact=True).fill('1,10')
            dlg.get_by_role('button', name='Simpan transaksi', exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0)
            expect(page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
            changes.append(round((time.monotonic() - one) * 1000, 3))
        result['batch_ms'] = round((time.monotonic() - began) * 1000, 3)
        result['edit_ms'] = changes
        # Allow the frame after the last save and its performance observer batch.
        page.wait_for_timeout(100)
        result['ui'] = page.evaluate('''() => { const m=window.__perfMeasurement; m.active=false;
          if(window.__perfObserver)window.__perfObserver.disconnect();
          return {max_frame_gap_ms:m.maxFrameGap,long_tasks_ms:m.longTasks}; }''')
        durable = stored_document(page)
        expected = [{**entry, 'amount': 110} if i < args.edits else entry
                    for i, entry in enumerate(fixture['state']['entries'])]
        assert durable['state']['entries'] == expected, 'Unexpected financial mutation or duplicate'
        assert durable['state']['wallets'] == fixture['state']['wallets']
        before_raw = page.evaluate('(key)=>localStorage.getItem(key)', KEY)
        page.reload(wait_until='networkidle')
        # MW-113a: a reload stays on the page it was made from, here Transaksi.
        expect(page.locator('.breadcrumb strong')).to_have_text('Transaksi')
        expect(page.get_by_label('Cari transaksi', exact=True)).to_be_visible()
        assert stored_document(page)['state']['entries'] == expected
        assert page.evaluate('(key)=>localStorage.getItem(key)', KEY) == before_raw, 'Reload rewrote saved bytes'
        assert not errors, errors
        result['browser_runtime'] = page.evaluate('''() => ({hardware_concurrency:navigator.hardwareConcurrency,
            device_memory_gb:navigator.deviceMemory ?? null,user_agent:navigator.userAgent})''')
        result['status'] = 'passed'
    except Exception as err:
        result['error'] = str(err)
        result['traceback'] = traceback.format_exc()
        try:
            page.screenshot(path=str(output / f'sample-{index}-failure.png'), full_page=True, timeout=5000)
        except Exception:
            pass
    finally:
        context.close()
    return result


def run_import_sample(browser, args, output, index, csv_bytes, html_sha):
    """Import the synthetic CSV into an empty ledger, then time one manual save on the version-2 document."""
    rows = args.import_rows
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, timezone_id='Europe/Istanbul')
    raw = json.dumps({'app': 'uangku', 'version': 1, 'demo': False,
                      'state': {'version': 1, 'wallets': [IMPORT_WALLET], 'entries': []}}, separators=(',', ':'))
    context.add_init_script('if(localStorage.getItem(' + json.dumps(KEY) + ')===null) localStorage.setItem('
                            + json.dumps(KEY) + ',' + json.dumps(raw) + ');')
    page = context.new_page()
    page.set_default_timeout(30_000)
    errors = []
    page.on('pageerror', lambda err: errors.append(str(err)))
    result = {'workload': 'version2-import', 'sample': index, 'status': 'failed', 'rows': rows}
    stored_raw = lambda: page.evaluate('(key)=>localStorage.getItem(key)', KEY)
    try:
        start = time.monotonic()
        response = page.goto(args.url, wait_until='networkidle')
        assert response and response.ok
        assert hashlib.sha256(response.body()).hexdigest() == html_sha, 'Server is not serving canonical dist/index.html'
        expect(page.locator('.balance-card')).to_be_visible()
        sidebar = page.locator('.sidebar')
        sidebar.get_by_role('button', name='Impor mutasi', exact=True).click()
        page.get_by_role('button', name='CSV / Excel umum', exact=True).click()
        page.get_by_label('Dompet impor', exact=True).select_option(IMPORT_WALLET['id'])
        importing = time.monotonic()
        page.get_by_label('File mutasi umum', exact=True).set_input_files(
            {'name': 'synthetic-import.csv', 'mimeType': 'text/csv', 'buffer': csv_bytes})
        separator = page.get_by_label('Pemisah CSV', exact=True)
        expect(separator).to_be_visible()
        if separator.input_value() != ',':
            separator.select_option(',')
        expect(page.get_by_label('Baris judul kolom', exact=True)).to_be_visible()
        page.get_by_label('Format tanggal', exact=True).select_option('iso')
        page.get_by_label('Pemisah desimal', exact=True).select_option('.')
        page.get_by_label('Urutan mutasi', exact=True).select_option('oldest')
        page.get_by_label('Konfirmasi mata uang file', exact=True).check()
        page.get_by_role('button', name='Buat pratinjau impor', exact=True).click()
        preview = page.get_by_role('heading', name='Periksa sebelum disimpan', exact=True)
        expect(preview).to_be_visible()
        page.get_by_role('button', name=f'Simpan {rows} transaksi', exact=True).click()
        expect(preview).to_have_count(0)
        expect(page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
        result['import_seconds'] = round(time.monotonic() - importing, 4)
        imported = stored_document(page)
        assert json.loads(stored_raw())['version'] == 2, 'Import did not produce a version-2 document'
        assert len(imported['state']['entries']) == len(imported['metadata']['facts']) == rows, \
            'Import did not store one entry and one bank fact per CSV row'
        assert all(entry.get('sourceKey') for entry in imported['state']['entries'])
        # The same page and row window as the version-1 workload: Transaksi, all periods.
        sidebar.get_by_role('button', name=re.compile(r'^Transaksi(?:\s+\d+)?$')).click()
        period = page.get_by_label('Periode transaksi', exact=True)
        if period.count():
            period.select_option('all')
        expect(page.locator('.transactions-table tbody tr')).to_have_count(min(50, rows))
        page.get_by_role('button', name='Catat transaksi', exact=True).first.click()
        dlg = page.get_by_role('dialog')
        dlg.get_by_label('Dompet asal', exact=True).select_option(IMPORT_WALLET['id'])
        dlg.get_by_label('Nominal', exact=True).fill('15')
        dlg.get_by_label(re.compile('^Keterangan')).fill(MANUAL_NOTE)
        save = dlg.get_by_role('button', name='Simpan transaksi', exact=True)
        save.evaluate(SAVE_TIMER_JS, KEY)
        save.click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        expect(page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
        timing = page.evaluate('() => window.__perfSave')
        assert None not in timing.values() and timing['clicked'] <= timing['stored'] <= timing['closed'], timing
        # save_ms: click on "Simpan transaksi" until the dialog has left the page. stored_ms: until localStorage holds the document.
        result['save_ms'] = round(timing['closed'] - timing['clicked'], 3)
        result['stored_ms'] = round(timing['stored'] - timing['clicked'], 3)
        durable = stored_document(page)
        before_raw = stored_raw()
        assert json.loads(before_raw)['version'] == 2, 'Measured save did not store a version-2 document'
        result['document_chars'] = len(before_raw)
        manual = [entry for entry in durable['state']['entries'] if not entry.get('sourceKey')]
        assert len(manual) == 1 and (manual[0]['type'], manual[0]['walletId'], manual[0]['amount'], manual[0]['note']) == (
            'expense', IMPORT_WALLET['id'], 1500, MANUAL_NOTE), 'Manual transaction was not saved as entered'
        assert [entry for entry in durable['state']['entries'] if entry.get('sourceKey')] == imported['state']['entries'], \
            'Unexpected financial mutation or duplicate'
        assert durable['metadata']['facts'] == imported['metadata']['facts'], 'Manual save changed bank facts'
        assert durable['state']['wallets'] == imported['state']['wallets'], 'Manual save changed a wallet'
        page.reload(wait_until='networkidle')
        # MW-113a: a reload stays on the page it was made from, here Transaksi.
        expect(page.locator('.breadcrumb strong')).to_have_text('Transaksi')
        expect(page.get_by_label('Cari transaksi', exact=True)).to_be_visible()
        assert stored_document(page) == durable, 'Reload changed the saved document'
        assert stored_raw() == before_raw, 'Reload rewrote saved bytes'
        assert not errors, errors
        result['sample_seconds'] = round(time.monotonic() - start, 4)
        result['status'] = 'passed'
    except Exception as err:
        result['error'] = str(err)
        result['traceback'] = traceback.format_exc()
        try:
            page.screenshot(path=str(output / f'import-sample-{index}-failure.png'), full_page=True, timeout=5000)
        except Exception:
            pass
    finally:
        context.close()
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--url', default=os.environ.get('UANGKU_TEST_URL', 'http://127.0.0.1:4180'))
    parser.add_argument('--samples', type=int, default=5)
    parser.add_argument('--rows', type=int, default=10_000)
    parser.add_argument('--edits', type=int, default=10)
    parser.add_argument('--median-budget-ms', type=float, default=5000)
    parser.add_argument('--p95-budget-ms', type=float, default=8000)
    parser.add_argument('--frame-budget-ms', type=float, default=250)
    parser.add_argument('--import-rows', type=int, default=2_000, help='rows in the synthetic CSV of the version-2 sample')
    parser.add_argument('--import-samples', type=int, default=1, help='version-2 samples to report; 0 skips them')
    args = parser.parse_args()
    assert args.samples >= 3 and 0 < args.edits <= args.rows <= 100_000
    # Chromium's localStorage quota (about 5.2 million characters) is reached between 16,500 and 17,000 rows of
    # this CSV; above that the import is correctly rejected and the sample could only time out.
    assert args.import_samples >= 0 and 0 < args.import_rows <= 15_000
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    before = source_hashes()
    html_sha = hashlib.sha256((ROOT / 'dist' / 'index.html').read_bytes()).hexdigest()
    fixture = make_fixture(args.rows)
    csv_bytes = make_import_csv(args.import_rows)
    results, import_results = [], []
    with sync_playwright() as pw:
        browser = launch_browser(pw)
        version = browser.version
        try:
            for index in range(1, args.samples + 1):
                result = run_sample(browser, args, output, index, fixture, html_sha)
                results.append(result)
                print(json.dumps(result, ensure_ascii=False), flush=True)
            # After the budgeted samples, so that the version-1 gate runs exactly as before.
            for index in range(1, args.import_samples + 1):
                result = run_import_sample(browser, args, output, index, csv_bytes, html_sha)
                import_results.append(result)
                print(json.dumps(result, ensure_ascii=False), flush=True)
        finally:
            browser.close()
    after = source_hashes()
    times = [r['batch_ms'] for r in results if r['status'] == 'passed']
    frames = [r['ui']['max_frame_gap_ms'] for r in results if r['status'] == 'passed']
    metrics = {'median_batch_ms': statistics.median(times) if times else None,
               'p95_batch_ms': percentile(times, .95) if times else None,
               'maximum_active_frame_gap_ms': max(frames) if frames else None}
    checks = {'all_samples_passed': len(times) == args.samples, 'source_stable': before == after,
              'median_budget': bool(times) and metrics['median_batch_ms'] <= args.median_budget_ms,
              'p95_budget': bool(times) and metrics['p95_batch_ms'] <= args.p95_budget_ms,
              'frame_budget': bool(frames) and max(frames) <= args.frame_budget_ms}
    # Reported for comparison between runs on one host. The only check is that the measurement was obtained.
    # One sample moves by tens of percent under shared load, so compare the median or minimum of several
    # samples (--import-samples N), not two single numbers.
    imported = [r for r in import_results if r['status'] == 'passed']
    saves = [r['save_ms'] for r in imported]
    version2 = {'scope': ('One manual save on a version-2 document holding CSV-imported rows; page clock from the click on '
                          '"Simpan transaksi": save_ms until the dialog is removed, stored_ms until localStorage holds '
                          'the document; reported, no budget'),
                'imported_rows': args.import_rows, 'samples': args.import_samples, 'save_ms': saves,
                'stored_ms': [r['stored_ms'] for r in imported],
                'median_save_ms': statistics.median(saves) if saves else None}
    checks['version2_samples_passed'] = len(imported) == args.import_samples
    report = {'scope': 'Fresh production browser workload; not a cross-host speedup comparison',
              'url': args.url, 'synthetic_only': True, 'rows': args.rows, 'edits': args.edits,
              'samples': args.samples, 'browser_version': version, 'host': platform.platform(),
              'logical_cpus': os.cpu_count(), 'dist_sha256': html_sha,
              'budgets': {'median_batch_ms': args.median_budget_ms, 'p95_batch_ms': args.p95_budget_ms,
                          'maximum_active_frame_gap_ms': args.frame_budget_ms},
              'metrics': metrics, 'checks': checks, 'results': results,
              'version2': {**version2, 'results': import_results},
              'source_before': before, 'source_after': after, 'passed': all(checks.values())}
    (output / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'summary': str(output / 'summary.json'), 'metrics': metrics, 'version2': version2,
                      'checks': checks, 'passed': report['passed']}))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
