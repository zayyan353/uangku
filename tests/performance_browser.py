"""Production-only, synthetic browser performance gate.

The measured workload is ten individually committed UI edits on a 10k ledger.
The median/p95 budgets and active animation-frame budget are declared before
sampling. This is not comparable with historical measurements on other hosts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import platform
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
        expect(page.locator('.balance-card')).to_be_visible()
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
    args = parser.parse_args()
    assert args.samples >= 3 and 0 < args.edits <= args.rows <= 100_000
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    before = source_hashes()
    html_sha = hashlib.sha256((ROOT / 'dist' / 'index.html').read_bytes()).hexdigest()
    fixture = make_fixture(args.rows)
    results = []
    with sync_playwright() as pw:
        browser = launch_browser(pw)
        version = browser.version
        try:
            for index in range(1, args.samples + 1):
                result = run_sample(browser, args, output, index, fixture, html_sha)
                results.append(result)
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
    report = {'scope': 'Fresh production browser workload; not a cross-host speedup comparison',
              'url': args.url, 'synthetic_only': True, 'rows': args.rows, 'edits': args.edits,
              'samples': args.samples, 'browser_version': version, 'host': platform.platform(),
              'logical_cpus': os.cpu_count(), 'dist_sha256': html_sha,
              'budgets': {'median_batch_ms': args.median_budget_ms, 'p95_batch_ms': args.p95_budget_ms,
                          'maximum_active_frame_gap_ms': args.frame_budget_ms},
              'metrics': metrics, 'checks': checks, 'results': results,
              'source_before': before, 'source_after': after, 'passed': all(checks.values())}
    (output / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'summary': str(output / 'summary.json'), 'metrics': metrics, 'checks': checks, 'passed': report['passed']}))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
