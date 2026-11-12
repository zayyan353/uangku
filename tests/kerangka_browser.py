"""Browser coverage for KERANGKA_HALAMAN items that only had manual checks.

Covered, on desktop 1440px and phone 390px with synthetic data:
1.1.1 nickname, 1.6.2 wallet rows and "+N dompet lainnya", 1.7.2 category name
opens its history, 1.7.3 "+N kategori lainnya", 1.10.2 start guide, 2.3.3
"Riwayat" on a wallet card, 3.4.7 page turn scrolls to the list, 3.6.3 inline
category in the review queue and "Semua sudah rapi".
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import time
import traceback

from browser_support import (assert_production_url, install_playwright_path, launch_browser,
                             new_page, stored_document)
install_playwright_path()
from playwright.sync_api import sync_playwright, expect

KEY = 'uangku:v1'
NICKNAME_KEY = 'uangku:nickname:v1'
WALLETS = [('bank-a', 'Bank A'), ('bank-b', 'Bank B'), ('bank-c', 'Bank C'),
           ('bank-d', 'Bank D'), ('bank-e', 'Bank E'), ('bank-f', 'Bank F')]
WALLET_IDS = {name: id_ for id_, name in WALLETS}
# Confirmed October expenses by category, largest first: four rows show, two hide behind "+2 kategori lainnya".
CATEGORY_ROWS = [('Makan & minum', [300_000, 200_000]), ('Transportasi', [300_000]), ('Langganan', [120_000, 80_000]),
                 ('Bahan makanan', [50_000]), ('Pakaian', [20_000])]
PAGING_ROWS = 110  # Belanja, 1.000 each: with the rows above October has 117 rows, so page 2 is full.
PENDING_NOTE = 'Synthetic pending row'


def ledger(entries, wallets=WALLETS):
    return {'app': 'uangku', 'version': 1, 'demo': False, 'state': {'version': 1,
        'wallets': [{'id': id_, 'name': name, 'currency': 'IDR', 'kind': 'bank', 'openingBalance': 1_000_000}
                    for id_, name in wallets],
        'entries': entries}}


def main_fixture():
    entries = []
    for category, amounts in CATEGORY_ROWS:
        for index, amount in enumerate(amounts):
            entries.append({'id': f'{category}-{index}', 'date': '2026-10-20', 'type': 'expense', 'walletId': 'bank-a',
                            'amount': amount, 'category': category, 'note': f'Synthetic {category} {index}'})
    entries += [{'id': f'page-{i:03d}', 'date': '2026-10-10', 'type': 'expense', 'walletId': 'bank-b',
                 'amount': 1_000, 'category': 'Belanja', 'note': f'Synthetic paging row {i:03d}'}
                for i in range(PAGING_ROWS)]
    # September keeps the uncategorised row out of October's category totals; the queue spans every period.
    entries.append({'id': 'pending', 'date': '2026-09-15', 'type': 'expense', 'walletId': 'bank-c',
                    'amount': 15_000, 'category': '', 'note': PENDING_NOTE})
    return ledger(entries)


def empty_fixture():
    return ledger([], WALLETS[:2])


def open_context(browser, mobile, fixture):
    context = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 1000},
                                  is_mobile=mobile, has_touch=mobile, timezone_id='Europe/Istanbul')
    raw = json.dumps(fixture, ensure_ascii=False, separators=(',', ':'))
    context.add_init_script('if(localStorage.getItem(' + json.dumps(KEY) + ')===null)localStorage.setItem('
                            + json.dumps(KEY) + ',' + json.dumps(raw) + ');')
    page = new_page(context)
    page.set_default_timeout(15_000)
    return context, page, raw


def title(page):
    return page.locator('h1.page-title')


def settle(page):
    """Page turns and history jumps scroll on the next animation frame."""
    page.evaluate('() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))')


def run_main(browser, args, output, mobile):
    label = 'mobile' if mobile else 'desktop'
    context, page, raw = open_context(browser, mobile, main_fixture())
    errors = []
    page.on('pageerror', lambda err: errors.append(str(err)))
    checks = []
    nav = page.locator('.mobile-nav' if mobile else '.sidebar')

    def go(name):
        nav.get_by_role('button', name=re.compile('^' + name)).first.click()

    def unchanged(step):
        assert page.evaluate('(key) => localStorage.getItem(key)', KEY) == raw, f'{step} changed the stored ledger'

    def in_history(wallet, period, step):
        expect(title(page)).to_have_text('Catatan kecil, lebih tenang.')
        expect(page.get_by_label('Dompet riwayat', exact=True)).to_have_value(wallet)
        expect(page.get_by_label('Periode transaksi', exact=True)).to_have_value(period)
        checks.append(step)

    try:
        page.goto(args.url, wait_until='networkidle')
        expect(page.locator('.balance-card')).to_be_visible()

        # 1.1.1: no stored name gives a neutral greeting and "U"; the name lives outside the ledger.
        account = page.get_by_role('button', name='Menu akun', exact=True)
        expect(title(page)).to_have_text(re.compile(r'^Halo\.'))
        expect(account).to_have_text('U')
        account.click()
        nickname = page.get_by_label('Nama panggilan', exact=True)
        expect(nickname).to_have_value('')
        nickname.fill('Sari Dewi')
        expect(title(page)).to_have_text(re.compile(r'^Halo, Sari Dewi\.'))
        expect(account).to_have_text('S')
        if not mobile:
            expect(page.locator('.sidebar .avatar')).to_have_text('S')
        assert page.evaluate('(key) => localStorage.getItem(key)', NICKNAME_KEY) == 'Sari Dewi'
        unchanged('Nickname')
        page.keyboard.press('Escape')
        expect(nickname).to_be_hidden()
        expect(account).to_be_focused()
        page.reload(wait_until='networkidle')
        expect(title(page)).to_have_text(re.compile(r'^Halo, Sari Dewi\.'))
        account.click()
        expect(nickname).to_have_value('Sari Dewi')
        nickname.fill('')
        expect(title(page)).to_have_text(re.compile(r'^Halo\.'))
        expect(account).to_have_text('U')
        assert page.evaluate('(key) => localStorage.getItem(key)', NICKNAME_KEY) is None
        page.keyboard.press('Escape')
        unchanged('Clearing the nickname')
        checks.append('1.1.1 nickname')

        # 1.6.2: four wallets show, the rest behind a link to Dompet; a row opens that wallet's history.
        rows = page.locator('.wallet-panel .wallet-row')
        expect(rows).to_have_count(4)
        more = page.get_by_test_id('overview-more-wallets')
        expect(more).to_have_text(re.compile(r'^\+2 dompet lainnya'))
        more.click()
        expect(title(page)).to_have_text('Semua dompetmu.')
        checks.append('1.6.2 more wallets')

        # 2.3.3: an active wallet card opens its history for every period.
        page.get_by_role('button', name='Riwayat Bank C', exact=True).click()
        in_history(WALLET_IDS['Bank C'], 'all', '2.3.3 wallet card history')
        expect(page.get_by_text(PENDING_NOTE, exact=True)).to_be_visible()
        page.get_by_role('button', name='Reset filter', exact=True).click()

        go('Ringkasan')
        second = rows.nth(1).locator('.wallet-name').inner_text()
        row = page.get_by_role('button', name=re.compile('^Riwayat ' + re.escape(second) + ', saldo '))
        expect(row).to_have_count(1)
        row.focus()
        page.keyboard.press('Enter')
        in_history(WALLET_IDS[second], 'all', '1.6.2 wallet row history')
        page.get_by_role('button', name='Reset filter', exact=True).click()
        unchanged('Wallet navigation')

        # 1.7.3: "+2 kategori lainnya" shows every category and stays open while the app is open.
        go('Ringkasan')
        categories = page.locator('.category-panel .category-row')
        expect(categories).to_have_count(4)
        toggle = page.get_by_test_id('category-more')
        expect(toggle).to_have_text('+2 kategori lainnya')
        expect(toggle).to_have_attribute('aria-expanded', 'false')
        toggle.click()
        expect(categories).to_have_count(6)
        expect(toggle).to_have_text('Tampilkan lebih sedikit')
        expect(toggle).to_have_attribute('aria-expanded', 'true')
        expect(page.locator('.category-panel .category-open', has_text='Pakaian')).to_be_visible()
        go('Dompet')
        go('Ringkasan')
        expect(categories).to_have_count(6)
        toggle.click()
        expect(categories).to_have_count(4)
        expect(toggle).to_have_text('+2 kategori lainnya')
        checks.append('1.7.3 more categories')

        # 1.7.2: a category name opens Transaksi for the same wallet and period, filtered to it.
        page.locator('.category-panel .category-open', has_text='Langganan').click()
        in_history('all', 'month', '1.7.2 category history')
        expect(page.get_by_label('Filter kategori', exact=True)).to_have_value('Langganan')
        expect(page.locator('.transactions-table tbody tr')).to_have_count(2)
        page.get_by_role('button', name='Reset filter', exact=True).click()
        unchanged('Category navigation')

        # 3.4.7: turning the page brings the top of the list back into view.
        table_rows = page.locator('.transactions-table tbody tr')
        expect(table_rows).to_have_count(50)
        page.evaluate('() => window.scrollTo(0, document.documentElement.scrollHeight)')
        bottom = page.evaluate('window.scrollY')
        page.get_by_role('button', name='Halaman berikutnya', exact=True).click()
        expect(page.get_by_text(re.compile(r'Halaman 2 dari 3'))).to_be_visible()
        expect(table_rows).to_have_count(50)
        settle(page)
        top = page.evaluate("() => document.querySelector('.history-scope').getBoundingClientRect().top")
        scrolled = page.evaluate('window.scrollY')
        assert scrolled < bottom, f'Page turn did not scroll up: {scrolled} >= {bottom}'
        # .history-scope has scroll-margin-top: 84px and page 2 is long enough to scroll it all the way.
        assert abs(top - 84) <= 2, f'List top at {top}px after the page turn, expected 84px'
        unchanged('Page turn')
        checks.append('3.4.7 page turn scroll')

        # 3.6.3: an uncategorised row gets its own category select; the empty queue says so.
        go('Ringkasan')
        page.locator('.pending-banner').click()
        expect(page.get_by_test_id('review-total')).to_have_attribute('data-count', '1')
        quick = page.get_by_label(f'Kategori untuk {PENDING_NOTE}', exact=True)
        expect(quick).to_be_visible()
        quick.select_option('Makan & minum')
        expect(page.get_by_test_id('review-empty')).to_be_visible()
        expect(page.get_by_role('heading', name='Semua sudah rapi', exact=True)).to_be_visible()
        stored = {entry['id']: entry for entry in stored_document(page)['state']['entries']}
        assert stored['pending']['category'] == 'Makan & minum', stored['pending']
        assert stored['pending']['type'] == 'expense' and stored['pending']['amount'] == 15_000, stored['pending']
        assert len(stored) == len(main_fixture()['state']['entries'])
        page.get_by_role('button', name=re.compile(r'^Kembali ke semua transaksi')).click()
        expect(page.get_by_test_id('review-empty')).to_have_count(0)
        expect(table_rows).to_have_count(50)
        checks.append('3.6.3 quick category and empty queue')

        assert not errors, errors
        page.screenshot(path=str(output / f'{label}.png'), full_page=True)
        return {'name': f'{label}-main', 'status': 'passed', 'checks': checks}
    except Exception:
        page.screenshot(path=str(output / f'{label}-main-failure.png'), full_page=True)
        raise
    finally:
        context.close()


def run_start_guide(browser, args, output, mobile):
    label = 'mobile' if mobile else 'desktop'
    context, page, raw = open_context(browser, mobile, empty_fixture())
    errors = []
    page.on('pageerror', lambda err: errors.append(str(err)))
    nav = page.locator('.mobile-nav' if mobile else '.sidebar')
    guide = page.get_by_test_id('start-guide')
    try:
        page.goto(args.url, wait_until='networkidle')
        # 1.10.2: no entries yet, so the guide replaces the panels that would only show Rp 0.
        expect(guide).to_be_visible()
        expect(guide.get_by_role('heading', name='Mulai dari sini', exact=True)).to_be_visible()
        expect(page.locator('.balance-card')).to_be_visible()
        expect(page.locator('.wallet-panel')).to_be_visible()
        expect(page.locator('.category-panel')).to_be_visible()
        for gone in ['Perhitungan saldo periode', 'Rincian arus rekening', 'Transaksi terbaru']:
            expect(page.get_by_role('heading', name=gone, exact=True)).to_have_count(0)
        steps = guide.locator('.start-steps > li')
        expect(steps).to_have_count(3)

        open_wallets = guide.get_by_role('button', name='Buka Dompet', exact=True)
        open_wallets.focus()
        page.keyboard.press('Enter')
        expect(title(page)).to_have_text('Semua dompetmu.')
        nav.get_by_role('button', name=re.compile('^Ringkasan')).click()

        guide.get_by_role('button', name='Catat sekarang', exact=True).click()
        dialog = page.get_by_role('dialog')
        expect(dialog).to_be_visible()
        page.keyboard.press('Escape')
        expect(dialog).to_have_count(0)

        guide.get_by_role('button', name='Buka Impor mutasi', exact=True).click()
        expect(title(page)).to_have_text('Biar file yang bantu.')
        assert page.evaluate('(key) => localStorage.getItem(key)', KEY) == raw, 'Start guide changed the stored ledger'
        assert not errors, errors
        return {'name': f'{label}-start-guide', 'status': 'passed', 'checks': ['1.10.2 start guide']}
    except Exception:
        page.screenshot(path=str(output / f'{label}-start-guide-failure.png'), full_page=True)
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
                for case in [run_main, run_start_guide]:
                    began = time.monotonic()
                    name = f"{'mobile' if mobile else 'desktop'}-{case.__name__.removeprefix('run_').replace('_', '-')}"
                    try:
                        result = case(browser, args, output, mobile)
                    except Exception as err:
                        result = {'name': name, 'status': 'failed', 'error': str(err), 'traceback': traceback.format_exc()}
                    result['seconds'] = round(time.monotonic() - began, 3)
                    results.append(result)
                    print(json.dumps(result, ensure_ascii=False), flush=True)
        finally:
            browser.close()
    report = {'scope': 'KERANGKA_HALAMAN 1.1.1, 1.6.2, 1.7.2, 1.7.3, 1.10.2, 2.3.3, 3.4.7, 3.6.3; '
                       'desktop and phone emulation, synthetic data only',
              'synthetic_only': True, 'browser_version': version, 'dist_sha256': dist_sha,
              'results': results, 'passed': all(r['status'] == 'passed' for r in results)}
    (output / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
