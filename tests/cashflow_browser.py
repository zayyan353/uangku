"""Synthetic, read-only cashflow overview coverage against the pinned build.

Every context is fresh and contains generated data. No personal statement,
financial backup, existing browser profile, or merchant schedule is read.
The aggregate reference totals are distributed independently into synthetic
entries; they are not a reconstruction of the user's financial history.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
from pathlib import Path
import re
import time
import traceback
from urllib.parse import urlsplit

from browser_support import (assert_production_url, install_playwright_path,
                             launch_browser, new_page, read_document,
                             stored_document)
install_playwright_path()
from playwright.sync_api import sync_playwright, expect
from category_browser import compact, nav
from theme_browser import TEXT_CONTRAST_JS, CONTROL_CONTRAST_JS

FINANCE = 'uangku:v1'
UNCAT = 'Belum dikategorikan'
AT = '2026-10-31T12:00:00Z'


def wallet(id_='bank', name='Synthetic bank alpha', currency='TRY',
           opening=10_000, kind='bank'):
    return {'id': id_, 'name': name, 'currency': currency,
            'kind': kind, 'openingBalance': opening}


def entry(id_, amount, type_='unreviewed', *, date='2026-10-15',
          wallet_id='bank', category=UNCAT, **extra):
    return {'id': id_, 'date': date, 'type': type_, 'walletId': wallet_id,
            'amount': amount, 'category': category,
            'note': f'Synthetic flow {id_}', **extra}


def document(entries=None, wallets=None, metadata=None):
    value = {'app': 'uangku', 'version': 1, 'demo': False,
             'state': {'version': 1, 'wallets': wallets or [wallet()],
                       'entries': entries or []}}
    if metadata is not None:
        value['metadata'] = metadata
    return value


def metadata(transfers=None):
    return {'policy': 'unverified-unless-linked', 'facts': [], 'links': [],
            'statements': [], **({'transfers': transfers} if transfers else {})}


def transfer_context(id_, source='2026-10-15', destination='2026-10-15'):
    return {'entryId': id_, 'sourceDate': source, 'destinationDate': destination,
            'decision': {'reason': 'Synthetic explicit transfer dates', 'at': AT}}


def divided(total, count):
    """Independent weighted partition with an exact remainder, not bank rows."""
    weights = [index * index + 3 for index in range(1, count + 1)]
    amounts = [total * weight // sum(weights) for weight in weights]
    amounts[-1] += total - sum(amounts)
    assert sum(amounts) == total and all(amount > 0 for amount in amounts)
    return amounts


def reference_fixture():
    rows = []
    for side, total, count in [('credit', 19_489_724, 7),
                               ('debit', 19_038_042, 11)]:
        for index, amount in enumerate(divided(total, count)):
            type_ = ['income' if side == 'credit' else 'expense',
                     'movement', 'unreviewed'][index % 3]
            signed = -amount if side == 'debit' and type_ != 'expense' else amount
            rows.append(entry(f'{side}-{index}', signed, type_,
                              date=f'2026-10-{index + 2:02d}'))
    assert 3_330 + 19_489_724 - 19_038_042 == 455_012
    return document(rows, [wallet(opening=3_330)])


def ordinary_fixture():
    return document([
        entry('confirmed-in', 5_000, 'income', category='Pemasukan'),
        entry('confirmed-out', 2_100, 'expense', category='Pendidikan'),
        entry('pending-in', 700), entry('pending-out', -400),
        entry('movement-in', 1_300, 'movement', category='Transfer'),
        entry('movement-out', -600, 'movement', category='Transfer'),
        entry('adjustment', 250, 'adjustment', category=''),
    ])


def money_text(amount):
    whole, fraction = divmod(abs(amount), 100)
    return ('-' if amount < 0 else '') + f'{whole:,}'.replace(',', '.') + (
        f',{fraction:02d}' if fraction else '')


class Case:
    def __init__(self, browser, args, name, *, data=None, width=1440,
                 theme='light', currency='TRY'):
        self.args, self.name, self.width = args, name, width
        self.errors, self.byte_checks, self.semantic_checks = [], 0, 0
        self.contrasts = []
        self.data = copy.deepcopy(data if data is not None else ordinary_fixture())
        wire = copy.deepcopy(self.data)
        if any(row['type'] == 'movement' for row in wire['state']['entries']):
            assert not wire.get('metadata'), 'Use compatible source entries in logical metadata fixtures'
            wire['version'] = 3
        self.raw = compact(wire)
        parts = urlsplit(args.url)
        self.context = browser.new_context(
            viewport={'width': width, 'height': 1000 if width > 600 else 844},
            is_mobile=width < 600, has_touch=width < 600, color_scheme=theme,
            timezone_id='Europe/Istanbul', accept_downloads=True,
            storage_state={'cookies': [], 'origins': [{
                'origin': f'{parts.scheme}://{parts.netloc}',
                'localStorage': [{'name': FINANCE, 'value': self.raw},
                    {'name': 'uangku:theme:v1', 'value': theme},
                    {'name': 'uangku:preferences:v1', 'value': compact({
                        'currency': currency, 'lastWallets': {currency: 'bank'}})}]}]})
        self.page = new_page(self.context)
        self.page.set_default_timeout(12_000)
        self.page.on('pageerror', lambda err: self.errors.append(str(err)))
        self.page.goto(args.url, wait_until='networkidle')
        nav(self.page, 'Ringkasan')
        expect(self.page.get_by_label('Cakupan arus rekening', exact=True)).to_be_visible()
        expect(self.page.get_by_label('Periode arus rekening', exact=True)).to_have_value('month')
        self.assert_unchanged()

    def assert_unchanged(self):
        assert self.page.evaluate('(key)=>localStorage.getItem(key)', FINANCE) == self.raw, 'Read/filter action changed financial bytes'
        self.byte_checks += 1

    def amount(self, field, value):
        node = self.page.get_by_test_id('cashflow-' + field)
        expect(node).to_be_visible()
        actual = node.inner_text().replace('\u2212', '-').replace('\xa0', '').replace(' ', '')
        expected = money_text(value)
        if node.get_attribute('data-amount') is not None:
            assert node.get_attribute('data-amount') == str(value), (field, value, actual)
        else:
            # Currency glyphs may be before or after the exact decimal. Match
            # numeric boundaries so 1.000 is never accepted as 11.000.
            assert re.search(r'(?<![\d.,-])' + re.escape(expected) + r'(?![\d.,])', actual), (field, expected, actual)

    def totals(self, inflow, outflow, opening, closing, adjustment=0, internal=0):
        for field, value in [('inflow', inflow), ('outflow', outflow),
                             ('opening', opening), ('closing', closing),
                             ('adjustment', adjustment), ('internal-net', internal)]:
            self.amount(field, value)
        assert opening + inflow - outflow + adjustment + internal == closing
        reconciliation = self.page.get_by_test_id('cashflow-reconciliation')
        expect(reconciliation).to_be_visible()
        expect(reconciliation).to_have_attribute('data-complete', 'true')
        expect(reconciliation).to_contain_text('Perhitungan saldo periode cocok.')
        self.assert_unchanged()

    def scope(self, value):
        self.page.get_by_label('Cakupan arus rekening', exact=True).select_option(value)
        self.assert_unchanged()

    def month(self, value):
        self.page.get_by_label('Bulan laporan', exact=True).fill(value)
        self.assert_unchanged()

    def period(self, value):
        self.page.get_by_label('Periode arus rekening', exact=True).select_option(value)
        self.assert_unchanged()


def reference(case):
    expect(case.page.get_by_label('Cakupan arus rekening', exact=True)).to_have_value('all')
    expect(case.page.get_by_text(re.compile('^Uang masuk rekening'))).to_be_visible()
    expect(case.page.get_by_text(re.compile('^Uang keluar rekening'))).to_be_visible()
    case.totals(19_489_724, 19_038_042, 3_330, 455_012)
    case.period('all')
    case.totals(19_489_724, 19_038_042, 3_330, 455_012)
    case.page.reload(wait_until='networkidle')
    case.assert_unchanged()
    case.totals(19_489_724, 19_038_042, 3_330, 455_012)


def pending_and_adjustment(case):
    case.totals(7_000, 3_100, 10_000, 14_150, 250)
    panel = case.page.locator('.panel').filter(has=case.page.get_by_role(
        'heading', name='Kategori pengeluaran terkonfirmasi', exact=True))
    expect(panel).to_be_visible()
    expect(panel).to_contain_text('Pendidikan')
    expect(panel).to_contain_text('21')
    expect(panel).not_to_contain_text('Transfer')
    nav(case.page, 'Transaksi')
    case.page.get_by_label('Filter jenis transaksi', exact=True).select_option('pending')
    expect(case.page.locator('.transactions-table tbody tr')).to_have_count(2)
    case.assert_unchanged()
    nav(case.page, 'Ringkasan')
    case.totals(7_000, 3_100, 10_000, 14_150, 250)


def transfer_dominant(case):
    case.totals(25_000, 24_000, 1_000, 2_000)
    expect(case.page.get_by_test_id('cashflow-breakdown')).to_contain_text('Transfer')
    case.assert_unchanged()


def period_cutoff(case):
    case.totals(7_000, 3_100, 10_700, 14_850, 250)
    case.period('all')
    case.totals(8_000, 3_400, 10_000, 14_850, 250)
    case.period('month'); case.month('2026-09')
    case.totals(1_000, 300, 10_000, 10_700)
    case.month('2026-10')
    case.totals(7_000, 3_100, 10_700, 14_850, 250)


def internal_same_date(case):
    case.totals(0, 200, 15_000, 14_800)
    case.scope('bank')
    case.totals(0, 4_200, 10_000, 5_800)
    case.scope('digital')
    case.totals(4_000, 0, 5_000, 9_000)
    case.scope('all')
    case.totals(0, 200, 15_000, 14_800)


def split_dates(case):
    case.totals(0, 0, 10_800, 14_800, internal=4_000)
    case.scope('bank')
    case.totals(0, 0, 5_800, 5_800)
    case.scope('digital')
    case.totals(4_000, 0, 5_000, 9_000)
    case.scope('all'); case.month('2026-09')
    case.totals(0, 200, 15_000, 10_800, internal=-4_000)
    case.period('all')
    case.totals(0, 200, 15_000, 14_800)


def fx(case):
    case.totals(0, 4_200, 10_000, 5_800)
    case.scope('bank')
    case.page.get_by_role('button', name=re.compile('USD.*Dolar AS')).click()
    expect(case.page.get_by_label('Cakupan arus rekening', exact=True)).to_have_value('all')
    case.totals(1_000, 0, 2_000, 3_000)
    case.scope('usd')
    case.totals(1_000, 0, 2_000, 3_000)
    case.page.get_by_role('button', name=re.compile('TL.*Lira Turki')).click()
    expect(case.page.get_by_label('Cakupan arus rekening', exact=True)).to_have_value('all')
    case.totals(0, 4_200, 10_000, 5_800)


def unknown_dates(case):
    case.amount('inflow', 0); case.amount('outflow', 0)
    expect(case.page.get_by_test_id('cashflow-warning')).to_be_visible()
    expect(case.page.get_by_test_id('cashflow-warning')).to_contain_text(re.compile('tanggal|Tanggal'))
    expect(case.page.get_by_test_id('cashflow-closing')).to_contain_text(re.compile('Belum|belum|—'))
    expect(case.page.get_by_test_id('cashflow-reconciliation')).to_have_attribute('data-complete', 'false')
    expect(case.page.get_by_test_id('cashflow-reconciliation')).not_to_contain_text('Perhitungan saldo periode cocok.')
    expect(case.page.get_by_test_id('cashflow-reconciliation')).not_to_contain_text(re.compile('selisih\\s*:?\\s*₺?\\s*0', re.I))
    case.assert_unchanged()
    case.scope('digital')
    case.totals(4_000, 0, 5_000, 9_000)


def future_month(case):
    case.month('2026-11')
    case.amount('inflow', 0); case.amount('outflow', 0)
    expect(case.page.get_by_test_id('cashflow-warning')).to_contain_text(re.compile('belum|Belum'))
    expect(case.page.get_by_test_id('cashflow-closing')).to_contain_text(re.compile('Belum|belum|—'))
    expect(case.page.get_by_test_id('cashflow-reconciliation')).to_have_attribute('data-complete', 'false')
    case.period('all')
    case.totals(7_000, 3_100, 10_000, 14_150, 250)


def cash_archive(case):
    case.totals(1_200, 700, 10_000, 10_500)
    scope = case.page.get_by_label('Cakupan arus rekening', exact=True)
    assert 'archived-cash' not in scope.locator('option').evaluate_all('(rows)=>rows.map(row=>row.value)')
    case.scope('bank'); case.totals(1_200, 700, 10_000, 10_500)
    before = stored_document(case.page)
    assert next(w for w in before['state']['wallets'] if w['id'] == 'archived-cash')['kind'] == 'cash'
    assert len([e for e in before['state']['entries'] if e['walletId'] == 'archived-cash']) == 2
    case.semantic_checks += 1
    case.page.reload(wait_until='networkidle')
    case.assert_unchanged()


def source_read_and_backup(case):
    before = stored_document(case.page)
    assert before['metadata']['facts'] == case.data['metadata']['facts']
    case.semantic_checks += 1
    case.totals(1_000, 300, 10_000, 10_700)
    for scope in ['digital', 'bank', 'all']:
        case.scope(scope)
    for period in ['all', 'month']:
        case.period(period)
    nav(case.page, 'Transaksi')
    case.page.get_by_label('Cari transaksi', exact=True).fill('Synthetic')
    case.assert_unchanged()
    nav(case.page, 'Ringkasan')
    file = case.args.output / f'{case.name}-synthetic-backup.json'
    with case.page.expect_download() as download:
        case.page.get_by_role('button', name='Cadangkan data', exact=True).click()
    download.value.save_as(file)
    assert read_document(file) == before
    case.semantic_checks += 1
    case.assert_unchanged()
    case.page.reload(wait_until='networkidle')
    assert stored_document(case.page) == before
    case.semantic_checks += 1
    case.assert_unchanged()


def visual(case):
    pending_and_adjustment(case)
    page = case.page
    for selector in ['Cakupan arus rekening', 'Periode arus rekening']:
        node = page.get_by_label(selector, exact=True)
        node.scroll_into_view_if_needed()
        box = node.bounding_box()
        assert box and box['x'] >= -1 and box['x'] + box['width'] <= case.width + 1, (selector, box)
        node.focus(); expect(node).to_be_focused()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Horizontal page overflow'
    page.get_by_test_id('cashflow-inflow').scroll_into_view_if_needed()
    page.screenshot(path=str(case.args.output / f'{case.name}-overview.png'), full_page=True)
    samples = [('headline', page.get_by_test_id('cashflow-inflow'), TEXT_CONTRAST_JS),
               ('reconciliation-equation', page.locator('.cashflow-equation'), TEXT_CONTRAST_JS),
               ('reconciliation-explanation', page.locator('.cashflow-explanation').last, TEXT_CONTRAST_JS),
               ('breakdown', page.get_by_test_id('cashflow-breakdown'), TEXT_CONTRAST_JS),
               ('control', page.get_by_label('Cakupan arus rekening', exact=True), CONTROL_CONTRAST_JS)]
    for kind, target, script in samples:
        target.scroll_into_view_if_needed()
        result = page.evaluate(script)
        result['kind'] = kind
        case.contrasts.append(result)
        assert result['samples'] > 0, 'No visible contrast samples'
        assert not result['failures'], result['failures']
    case.assert_unchanged()


def source_fixture():
    rows = [entry('source-in', 1_000, 'income'),
            entry('source-out', 300, 'expense', category='Pendidikan')]
    m = metadata()
    balance = 10_000
    for index, row in enumerate(rows):
        signed = -row['amount'] if row['type'] == 'expense' else row['amount']
        balance += signed
        fact_id = f'fact-{index}'
        m['facts'].append({'id': fact_id, 'walletId': 'bank', 'currency': 'TRY',
            'postedOn': row['date'], 'signedAmount': signed,
            'balanceAfter': balance, 'description': f'Synthetic source row {index}',
            'fingerprintVersion': 'ziraat-v1', 'fingerprint': f'ziraat:{index + 1:016x}'})
        m['links'].append({'entryId': row['id'], 'source': fact_id})
    m['statements'] = [{'id': 'statement', 'walletId': 'bank', 'currency': 'TRY',
        'periodStart': '2026-10-15', 'periodEnd': '2026-10-15',
        'openingBalance': 10_000, 'closingBalance': 10_700,
        'rowIds': [fact['id'] for fact in m['facts']]}]
    return document(rows, [wallet(), wallet('digital', 'Synthetic ewallet', opening=0, kind='ewallet')], m)


def cases():
    dominant = document([entry('available', 25_000, 'income'),
        entry('transfer-away', -22_500, 'movement', category='Transfer',
              note='HAVALE SYNTHETIC OUTBOUND FIXTURE'),
        entry('spending', 1_000, 'expense', category='Pendidikan'),
        entry('still-pending', -500)], [wallet(opening=1_000)])
    period = ordinary_fixture()
    period['state']['entries'] += [entry('prior-in', 1_000, 'income', date='2026-09-20'),
        entry('prior-out', 300, 'expense', date='2026-09-21'),
        entry('future', 9_000, 'income', date='2026-11-01')]
    internal = document([entry('paired', 4_000, 'transfer', category='',
        toWalletId='digital', toAmount=4_000, fee=200)],
        [wallet(), wallet('digital', 'Synthetic ewallet', opening=5_000, kind='ewallet')],
        metadata([transfer_context('paired')]))
    split = copy.deepcopy(internal)
    split['state']['entries'][0]['date'] = '2026-09-30'
    split['metadata']['transfers'][0].update(sourceDate='2026-09-30', destinationDate='2026-10-02')
    unknown = copy.deepcopy(internal)
    unknown['metadata']['transfers'][0]['sourceDate'] = None
    foreign = document([entry('fx', 4_000, 'transfer', category='',
        toWalletId='usd', toAmount=1_000, fee=200, rate=.25)],
        [wallet(), wallet('usd', 'Synthetic dollar bank', currency='USD', opening=2_000)],
        metadata([transfer_context('fx')]))
    future = ordinary_fixture()
    future['state']['entries'].append(entry('future', 9_000, 'income', date='2026-11-01'))
    archived_cash = document([entry('bank-in', 1_200, 'income'),
        entry('bank-out', 700, 'expense'),
        entry('archived-in', 100, 'income', wallet_id='archived-cash'),
        entry('archived-out', 300, 'expense', wallet_id='archived-cash')],
        [wallet(), wallet('archived-cash', 'Synthetic archived cash', opening=5_000, kind='cash')])
    result = [
        ('aggregate-generated-reference', {'data': reference_fixture()}, reference),
        ('pending-and-adjustment-separate', {}, pending_and_adjustment),
        ('transfer-out-dominant-no-hidden-funds', {'data': dominant}, transfer_dominant),
        ('month-opening-cutoff-all-history', {'data': period}, period_cutoff),
        ('paired-principal-fee-individual-scopes', {'data': internal}, internal_same_date),
        ('split-date-internal-net-bridge', {'data': split}, split_dates),
        ('fx-currency-scoped-principal', {'data': foreign}, fx),
        ('unknown-posting-date-incomplete', {'data': unknown}, unknown_dates),
        ('future-month-not-started', {'data': future}, future_month),
        ('cash-archive-excluded-preserved', {'data': archived_cash}, cash_archive),
        ('immutable-source-backup-read-filter', {'data': source_fixture()}, source_read_and_backup),
    ]
    for width in [320, 390]:
        for theme in ['dark', 'light']:
            result.append((f'visual-{width}-{theme}', {'width': width, 'theme': theme}, visual))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--url', default=os.environ.get('UANGKU_TEST_URL', 'http://127.0.0.1:4180'))
    parser.add_argument('--only', default='')
    args = parser.parse_args(); args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    build, results = assert_production_url(args.url), []
    with sync_playwright() as pw:
        browser = launch_browser(pw); version = browser.version
        try:
            for name, options, run in cases():
                if args.only and args.only not in name:
                    continue
                began, case = time.monotonic(), None
                result = {'name': name, 'status': 'failed'}
                try:
                    assert assert_production_url(args.url) == build, 'Build changed during suite'
                    case = Case(browser, args, name, **options); run(case)
                    assert not case.errors, case.errors
                    result['status'] = 'passed'
                except Exception as error:
                    result.update(error=str(error), traceback=traceback.format_exc())
                    if case:
                        try:
                            case.page.screenshot(path=str(args.output / f'{name}-failure.png'), full_page=True)
                        except Exception:
                            pass
                finally:
                    if case:
                        result.update(exact_financial_byte_comparisons=case.byte_checks,
                            source_semantic_invariance_checks=case.semantic_checks,
                            page_errors=case.errors, contrasts=case.contrasts)
                        case.context.close()
                result['seconds'] = round(time.monotonic() - began, 3)
                results.append(result)
                print(compact({key: value for key, value in result.items()
                               if key not in ['traceback', 'contrasts']}), flush=True)
        finally:
            browser.close()
    final = {'passed': False}
    try:
        final = {'passed': assert_production_url(args.url) == build}
    except Exception as error:
        final['error'] = str(error)
    report = {'synthetic_only': True, 'fresh_contexts': True,
        'browser_version': version, 'dist_sha256': build, 'url': args.url,
        'scope': 'Chromium automated desktop and mobile emulation; no physical device or manual screen reader claim',
        'contrast_scope': 'Visible solid foreground/background and selected control samples; gradients and disabled controls excluded',
        'final_build_identity': final, 'results': results,
        'passed': bool(results) and all(row['status'] == 'passed' for row in results) and final['passed']}
    (args.output / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(compact({'passed': sum(row['status'] == 'passed' for row in results),
                   'failed': sum(row['status'] != 'passed' for row in results), 'dist_sha256': build}), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
