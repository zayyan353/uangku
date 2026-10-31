"""Synthetic bank-only browser checks for ATM cashflow and pack v4.

No real financial files or browser profiles are accessed. Used legacy cash is
tested separately as a preserved read-only archive, never as an active account.
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
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED

from browser_support import (assert_production_url, install_playwright_path,
                             launch_browser, read_document, stored_document)
install_playwright_path()
from playwright.sync_api import sync_playwright, expect
from category_browser import compact, nav, without_categories
from keyword_pack_browser import Case as BaseCase, MISSING, row_for

FINANCE, SETTINGS, UNCAT = 'uangku:v1', 'uangku:categories:v1', 'Belum dikategorikan'
MOVEMENTS = [
    ('withdrawal', 'ATM PARA ÇEKME AUTO101', -10000, 'Tarik tunai'),
    ('deposit', 'ATM YATAN AUTO102', 5000, 'Setor tunai'),
    ('domestic', 'YURTİÇİ ATM P.Y. AUTO103', 2000, 'Setor tunai'),
    ('havale', 'Referanslı HAVALE SYNTHETIC AUTO104', -3000, 'Transfer'),
    ('fast', 'FAST SYNTHETIC AUTO105', 1000, 'Transfer'),
    ('eft', 'EFT SYNTHETIC AUTO106', -500, 'Transfer'),
    ('virman', 'VIRMAN SYNTHETIC AUTO107', -600, 'Transfer'),
]
V3_RULES = [
    ('bank-v3-atm-withdrawal', 'ATM PARA ÇEKME', 'Tarik tunai'),
    ('bank-v3-atm-deposit', 'ATM YATAN', 'Setor tunai'),
    ('bank-v3-atm-domestic-deposit', 'YURTİÇİ ATM P.Y.', 'Setor tunai'),
    ('bank-v3-atm-cash-deposit', 'ATM PARA YATIRMA', 'Setor tunai'),
    ('bank-v3-havale', 'HAVALE', 'Transfer'),
    ('bank-v3-eft', 'EFT', 'Transfer'),
    ('bank-v3-fast', 'FAST', 'Transfer'),
    ('bank-v3-virman', 'VIRMAN', 'Transfer'),
]


def v3_settings():
    return {'version': 1, 'keywordPackVersion': 3,
            'names': [UNCAT, 'Tarik tunai', 'Setor tunai', 'Transfer', 'Cashback', 'Biaya bank', 'Pendidikan'],
            'rules': [{'id': id_, 'keyword': keyword, 'category': category, 'mode': 'suggest'}
                      for id_, keyword, category in V3_RULES]
                     + [{'id': 'my-manual', 'keyword': 'PERSONAL LITERAL KEYWORD', 'category': 'Pendidikan', 'mode': 'suggest'}]}


def document(empty=False):
    entries = [] if empty else [
        {'id': id_, 'date': '2026-10-31', 'type': 'movement', 'walletId': 'bank',
         'amount': amount, 'category': UNCAT, 'note': note}
        for id_, note, amount, _ in MOVEMENTS]
    if not empty:
        entries += [
            {'id': 'old-credit', 'date': '2026-10-31', 'type': 'unreviewed', 'walletId': 'bank', 'amount': 125, 'category': UNCAT, 'note': 'PREPAID BONUS AUTO201'},
            {'id': 'income-credit', 'date': '2026-10-31', 'type': 'income', 'walletId': 'bank', 'amount': 100, 'category': UNCAT, 'note': 'PREPAID BONUS AUTO202'},
            {'id': 'debit', 'date': '2026-10-31', 'type': 'expense', 'walletId': 'bank', 'amount': 250, 'category': UNCAT, 'note': 'PREPAID BONUS AUTO203'},
            {'id': 'pending-debit', 'date': '2026-10-31', 'type': 'unreviewed', 'walletId': 'bank', 'amount': -300, 'category': UNCAT, 'note': 'PREPAID BONUS AUTO204'},
            {'id': 'iade-debit', 'date': '2026-10-31', 'type': 'expense', 'walletId': 'bank', 'amount': 100, 'category': UNCAT, 'note': 'PREPAID İADE AUTO205'},
            {'id': 'unknown-credit', 'date': '2026-10-31', 'type': 'unreviewed', 'walletId': 'bank', 'amount': 700, 'category': UNCAT, 'note': 'SYNTHETIC UNKNOWN CREDIT AUTO206'},
            {'id': 'manual', 'date': '2026-10-31', 'type': 'movement', 'walletId': 'bank', 'amount': -400, 'category': 'Pendidikan', 'note': 'ATM PARA ÇEKME MANUAL'},
        ]
    return {'app': 'uangku', 'version': 1, 'demo': False, 'state': {'version': 1,
            'wallets': [{'id': 'bank', 'name': 'Synthetic Ziraat', 'currency': 'TRY', 'kind': 'bank', 'openingBalance': 500_000},
                        {'id': 'second', 'name': 'Synthetic second bank', 'currency': 'TRY', 'kind': 'bank', 'openingBalance': 0}],
            'entries': entries}}


def bank_balances(data):
    result = {wallet['id']: wallet['openingBalance'] for wallet in data['state']['wallets']}
    for entry in data['state']['entries']:
        result[entry['walletId']] += -entry['amount'] - entry.get('fee', 0) if entry['type'] in ['expense', 'transfer'] else entry['amount']
        if entry['type'] == 'transfer':
            result[entry['toWalletId']] += entry['toAmount']
    return result


def approved_type(id_):
    return 'expense' if id_ in ['withdrawal', 'manual'] else 'income' if id_ in ['deposit', 'domestic'] else 'movement'


class Case(BaseCase):
    def __init__(self, browser, args, name, *, settings=MISSING, width=1440, theme='light', empty=False, initial=MISSING):
        self.browser, self.args, self.name = browser, args, name
        self.errors, self.byte_checks, self.semantic_checks = [], 0, 0
        data = document(empty) if initial is MISSING else initial
        if data is None:
            self.financial_raw = None
        else:
            wire = copy.deepcopy(data)
            if any(entry['type'] == 'movement' for entry in wire['state']['entries']) and not wire.get('metadata'):
                wire['version'] = 3
            self.financial_raw = compact(wire)
        self.settings_raw = None if settings is MISSING else compact(settings)
        parts = urlsplit(args.url)
        values = [{'name': 'uangku:theme:v1', 'value': theme},
                  {'name': 'uangku:preferences:v1', 'value': compact({'currency': 'TRY', 'lastWallets': {'TRY': 'bank'}})}]
        if self.financial_raw is not None:
            values.append({'name': FINANCE, 'value': self.financial_raw})
        if self.settings_raw is not None:
            values.append({'name': SETTINGS, 'value': self.settings_raw})
        self.context = browser.new_context(viewport={'width': width, 'height': 1000 if width > 600 else 844},
            is_mobile=width < 600, has_touch=width < 600, color_scheme=theme, timezone_id='Europe/Istanbul', accept_downloads=True,
            storage_state={'cookies': [], 'origins': [{'origin': f'{parts.scheme}://{parts.netloc}', 'localStorage': values}]})
        self.page = self.new_page(); self.page.goto(args.url, wait_until='networkidle')
        nav(self.page, 'Transaksi')


def direct_categories(case):
    p = case.page
    before = stored_document(p)
    assert json.loads(case.financial_raw)['version'] == 3
    dialog = case.manager()
    expect(dialog.locator('.category-manager-rules li')).to_have_count(81)
    dialog.get_by_role('button', name='Batal', exact=True).click()
    dialog = case.automation()
    for _, note, _, category in MOVEMENTS:
        row = row_for(dialog, note)
        expect(row.get_by_role('combobox')).to_have_value(category)
        assert 'dompet pasangan' not in row.inner_text().lower(), 'Bank-only movement must not require a cash counterwallet'
    for note in ['PREPAID BONUS AUTO201', 'PREPAID BONUS AUTO202']:
        expect(row_for(dialog, note).get_by_role('combobox')).to_have_value('Cashback')
    for note in ['PREPAID BONUS AUTO203', 'PREPAID BONUS AUTO204', 'PREPAID İADE AUTO205']:
        rows = dialog.locator('.category-automation-row').filter(has_text=note)
        if rows.count():
            expect(rows.get_by_role('combobox')).to_have_value('')
    expect(row_for(dialog, 'ATM PARA ÇEKME MANUAL').get_by_role('combobox')).to_have_value('Pendidikan')
    case.unchanged(); case.screenshot('automatic-categories')
    dialog.get_by_role('button', name=f'Terapkan {len(MOVEMENTS) + 3} kategori', exact=True).click()
    expect(dialog).to_have_count(0)
    after = stored_document(p)
    confirmed = copy.deepcopy(before)
    next(entry for entry in confirmed['state']['entries'] if entry['id'] == 'old-credit')['type'] = 'income'
    for entry in confirmed['state']['entries']:
        if entry['id'] in ['withdrawal', 'deposit', 'domestic', 'manual']:
            entry['type'] = approved_type(entry['id'])
            entry['amount'] = abs(entry['amount'])
    assert without_categories(after) == without_categories(confirmed)
    assert bank_balances(after) == bank_balances(before)
    assert len(after['state']['entries']) == len(before['state']['entries'])
    by_id = {entry['id']: entry for entry in after['state']['entries']}
    for id_, _, amount, category in MOVEMENTS:
        type_ = approved_type(id_)
        assert by_id[id_]['category'] == category and by_id[id_]['type'] == type_ and by_id[id_]['amount'] == (abs(amount) if type_ != 'movement' else amount)
        assert not set(by_id[id_]) & {'toWalletId', 'toAmount', 'fee', 'rate'}
    assert by_id['old-credit']['type'] == 'income' and by_id['old-credit']['category'] == 'Cashback'
    assert by_id['manual']['category'] == 'Pendidikan' and by_id['manual']['type'] == 'expense' and by_id['manual']['amount'] == 400
    assert all(by_id[id_]['category'] == UNCAT for id_ in ['debit', 'pending-debit', 'iade-debit', 'unknown-credit'])
    assert all(wallet['kind'] != 'cash' for wallet in after['state']['wallets'])
    assert json.loads(p.evaluate('(key)=>localStorage.getItem(key)', FINANCE))['version'] == 3
    backup_path = case.args.output / f'{case.name}-plain-v3.json'
    with p.expect_download() as download:
        p.get_by_role('button', name='Cadangkan data' if p.locator('.sidebar').is_visible() else 'Cadangkan', exact=True).click()
    download.value.save_as(backup_path)
    assert json.loads(backup_path.read_text(encoding='utf-8'))['version'] == 3
    assert read_document(backup_path) == after
    p.reload(wait_until='networkidle'); assert stored_document(p) == after
    case.semantic_checks += 3


SOURCE = [
    ('atm', 'ATM PARA ÇEKME V4-S01', -10000, 90000, 'expense', 'Tarik tunai'),
    ('deposit', 'ATM YATAN V4-S02', 5000, 95000, 'income', 'Setor tunai'),
    ('havale', 'HAVALE SYNTHETIC V4-S03', -3000, 92000, 'movement', 'Transfer'),
    ('fast', 'FAST SYNTHETIC V4-S04', 1000, 93000, 'movement', 'Transfer'),
    ('eft', 'EFT SYNTHETIC V4-S05', -500, 92500, 'movement', 'Transfer'),
    ('bonus', 'PREPAID BONUS V4-S06', 125, 92625, 'income', 'Cashback'),
    ('iade', 'PREPAID İADE V4-S07', 87, 92712, 'income', 'Cashback'),
    ('debit', 'PREPAID BONUS V4-S08', -50, 92662, 'expense', UNCAT),
    ('debit-iade', 'PREPAID İADE V4-S09', -26, 92636, 'unreviewed', UNCAT),
    ('unknown', 'SYNTHETIC UNKNOWN CREDIT V4-S10', 700, 93336, 'unreviewed', UNCAT),
    ('fee', 'HAVALE BSMV TAHSİLATI V4-S11', -25, 93311, 'expense', 'Biaya bank'),
    ('named', 'POS ALIŞVERİŞ İŞYERİ SYNTHETIC ALI FAST DEMIR V4-S12', -200, 93111, 'expense', 'Belanja'),
    ('food', 'SANAL POS ALIŞVERİŞ İŞYERİ TRENDYOL YEMEK V4-S13', -300, 92811, 'expense', 'Makan & minum'),
]


def write_statement(path, records=SOURCE, date='31.10.2026'):
    rows = [['Synthetic bank-only example'], ['Currency', 'TL'], *[[] for _ in range(9)],
            ['Tarih', 'Fiş No', 'Açıklama', 'İşlem Tutarı', 'Bakiye'],
            *[[date, f'SYNTH-{id_}', note, amount / 100, balance / 100]
              for id_, note, amount, balance, _, _ in records]]
    xml = ''.join('<row>' + ''.join(f'<c t="{"n" if isinstance(value, (int, float)) else "str"}"><v>{escape(str(value))}</v></c>' for value in row) + '</row>' for row in rows)
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
        archive.writestr('xl/workbook.xml', f'<workbook {ns}><workbookPr date1904="0"/></workbook>')
        archive.writestr('xl/worksheets/sheet1.xml', f'<worksheet {ns}><sheetData>{xml}</sheetData></worksheet>')


def import_statement(case, path):
    p = case.page; nav(p, 'Impor mutasi')
    p.get_by_label('Dompet impor', exact=True).select_option('bank')
    p.get_by_label('File mutasi Ziraat', exact=True).set_input_files(path)
    expect(p.get_by_role('heading', name='Periksa sebelum disimpan', exact=True)).to_be_visible()


def source_flow(case):
    p = case.page; path = case.args.output / f'{case.name}-synthetic.xlsx'; write_statement(path)
    import_statement(case, path)
    rows = p.locator('.import-table tbody tr')
    for _, note, _, _, type_, category in SOURCE:
        row = rows.filter(has_text=note)
        expect(row.locator('select').first).to_have_value(type_)
        expect(row.locator('.import-row-category')).to_have_value(category)
    p.get_by_role('button', name=f'Simpan {len(SOURCE)} transaksi', exact=True).click()
    expect(p.get_by_role('heading', name='Periksa sebelum disimpan', exact=True)).to_have_count(0)
    data = stored_document(p); entries = {entry['note']: entry for entry in data['state']['entries']}
    facts = {fact['description']: fact for fact in data['metadata']['facts']}
    assert len(entries) == len(facts) == len(SOURCE)
    for _, note, amount, balance, type_, category in SOURCE:
        assert entries[note]['type'] == type_ and entries[note]['category'] == category
        assert entries[note]['amount'] == (abs(amount) if type_ in ['expense', 'income'] else amount)
        assert facts[note]['signedAmount'] == amount and facts[note]['balanceAfter'] == balance
        assert not set(entries[note]) & {'toWalletId', 'toAmount', 'rate', 'fee'}
    assert all(wallet['kind'] != 'cash' for wallet in data['state']['wallets'])
    balance = next(wallet['openingBalance'] for wallet in data['state']['wallets'] if wallet['id'] == 'bank')
    balance += sum(-entry['amount'] if entry['type'] == 'expense' else entry['amount'] for entry in data['state']['entries'])
    assert balance == 92811
    assert sum(entry['amount'] for entry in data['state']['entries'] if entry['type'] == 'income') == 5212
    assert sum(entry['amount'] for entry in data['state']['entries'] if entry['type'] == 'expense') == 10575
    wire = json.loads(p.evaluate('(key)=>localStorage.getItem(key)', FINANCE))
    assert wire['version'] == 2 and wire['codec'] == 'table-tuples-v4'
    saved_raw = p.evaluate('(key)=>localStorage.getItem(key)', FINANCE)
    p.reload(wait_until='networkidle'); assert stored_document(p) == data
    assert p.evaluate('(key)=>localStorage.getItem(key)', FINANCE) == saved_raw
    import_statement(case, path)
    expect(p.get_by_role('button', name='Simpan 0 transaksi', exact=True)).to_be_disabled()
    assert stored_document(p) == data
    nav(p, 'Ringkasan')
    # Overview reports all signed bank credits/debits, including movements and
    # pending rows. Confirmed-type/category totals above remain independently checked.
    assert sum(amount for _, _, amount, _, _, _ in SOURCE if amount > 0) == 6912
    assert sum(-amount for _, _, amount, _, _, _ in SOURCE if amount < 0) == 14101
    expect(p.get_by_test_id('cashflow-inflow')).to_contain_text('69,12')
    expect(p.get_by_test_id('cashflow-outflow')).to_contain_text('141,01')
    backup_path = case.args.output / f'{case.name}-source-v4.json'
    with p.expect_download() as download:
        p.get_by_role('button', name='Cadangkan data' if p.locator('.sidebar').is_visible() else 'Cadangkan', exact=True).click()
    download.value.save_as(backup_path)
    assert json.loads(backup_path.read_text(encoding='utf-8'))['codec'] == 'table-tuples-v4'
    assert read_document(backup_path) == data
    case.semantic_checks += 5


def migration(case):
    original = v3_settings(); case.unchanged()
    dialog = case.manager(); case.save(dialog)
    saved = case.settings_value(); assert saved['keywordPackVersion'] == 5
    assert saved['names'] == original['names']
    by_id = {rule['id']: rule for rule in saved['rules']}
    for rule in original['rules']:
        assert by_id[rule['id']] == ({**rule, 'mode': 'auto'} if rule['id'].startswith('bank-v3-') else rule)
    assert len(saved['rules']) == len(original['rules']) + 1
    assert by_id['bank-v4-prepaid-credit']['keyword'] == 'PREPAID' and by_id['bank-v4-prepaid-credit']['category'] == 'Cashback'
    assert not {'bank-v3-prepaid-cashback', 'shopping-trendyol', 'keyword-pack-hop-scooter'} & set(by_id)
    case.unchanged(settings=False)


def deleted_rule(case):
    dialog = case.manager(); case.save(dialog)
    saved = case.settings_value(); assert saved['keywordPackVersion'] == 5
    assert not any(rule['id'] == 'bank-v3-fast' for rule in saved['rules'])
    case.page.reload(wait_until='networkidle'); nav(case.page, 'Transaksi')
    dialog = case.automation()
    assert dialog.locator('.category-automation-row').filter(has_text='FAST SYNTHETIC AUTO105').count() == 0
    case.unchanged(settings=False)


def custom_suggestion(case):
    original = json.loads(case.settings_raw)
    dialog = case.automation()
    row = row_for(dialog, 'Referanslı HAVALE SYNTHETIC AUTO104')
    expect(row.get_by_role('combobox')).to_have_value('')
    assert 'Pendidikan' in ' '.join(row.locator('.field-help').all_text_contents())
    dialog.get_by_role('button', name='Batal', exact=True).click()
    case.unchanged()
    dialog = case.manager(); case.save(dialog)
    assert next(rule for rule in case.settings_value()['rules'] if rule['id'] == 'bank-v3-havale') == next(rule for rule in original['rules'] if rule['id'] == 'bank-v3-havale')
    case.unchanged(settings=False)


def no_cash_defaults(case):
    p = case.page
    assert p.evaluate('(key)=>localStorage.getItem(key)', FINANCE) is None
    p.get_by_role('button', name='Mulai pakai data sendiri', exact=True).click()
    p.get_by_role('dialog').get_by_role('button', name='Mulai dari kosong', exact=True).click()
    data = stored_document(p)
    assert len(data['state']['wallets']) == 10 and all(wallet['kind'] != 'cash' for wallet in data['state']['wallets'])
    nav(p, 'Dompet'); p.get_by_role('button', name='Tambah dompet', exact=True).first.click()
    dialog = p.get_by_role('dialog')
    for currency in ['IDR', 'TRY', 'USD']:
        dialog.get_by_label(re.compile('^Mata uang')).select_option(currency)
        assert 'cash' not in dialog.get_by_label(re.compile('^Jenis dompet')).locator('option').evaluate_all('(els)=>els.map(el=>el.value)')
    dialog.get_by_role('button', name='Batal', exact=True).click()


def movement_form(case):
    p = case.page
    before_raw = p.evaluate('(key)=>localStorage.getItem(key)', FINANCE)
    p.get_by_role('button', name='Catat transaksi', exact=True).click()
    dialog = p.get_by_role('dialog')
    dialog.get_by_role('button', name='Perpindahan dana', exact=True).click()
    dialog.get_by_label('Dompet asal', exact=True).select_option('bank')
    for invalid in ['-10', '0']:
        dialog.get_by_label('Nominal', exact=True).fill(invalid)
        dialog.get_by_role('button', name='Simpan transaksi', exact=True).click()
        expect(dialog.get_by_role('alert')).to_contain_text('lebih besar dari nol')
        assert p.evaluate('(key)=>localStorage.getItem(key)', FINANCE) == before_raw
    dialog.get_by_label('Nominal', exact=True).fill('10')
    dialog.get_by_label('Arah perpindahan dana', exact=True).select_option('out')
    dialog.get_by_label(re.compile('^Keterangan')).fill('SYNTHETIC FORM OUT')
    dialog.get_by_role('button', name='Simpan transaksi', exact=True).click()
    expect(dialog).to_have_count(0)
    data = stored_document(p)
    out = next(entry for entry in data['state']['entries'] if entry['note'] == 'SYNTHETIC FORM OUT')
    assert out['type'] == 'movement' and out['amount'] == -1000
    p.get_by_role('button', name='Ubah SYNTHETIC FORM OUT', exact=True).click()
    dialog = p.get_by_role('dialog')
    expect(dialog.get_by_label('Arah perpindahan dana', exact=True)).to_have_value('out')
    expect(dialog.get_by_label('Nominal', exact=True)).to_have_value('10')
    current_raw = p.evaluate('(key)=>localStorage.getItem(key)', FINANCE)
    dialog.get_by_label('Nominal', exact=True).fill('-10')
    dialog.get_by_role('button', name='Simpan transaksi', exact=True).click()
    expect(dialog.get_by_role('alert')).to_contain_text('lebih besar dari nol')
    assert p.evaluate('(key)=>localStorage.getItem(key)', FINANCE) == current_raw
    dialog.get_by_label('Nominal', exact=True).fill('12')
    dialog.get_by_label('Arah perpindahan dana', exact=True).select_option('in')
    dialog.get_by_role('button', name='Simpan transaksi', exact=True).click()
    expect(dialog).to_have_count(0)
    updated = stored_document(p)
    edited = next(entry for entry in updated['state']['entries'] if entry['id'] == out['id'])
    assert edited['amount'] == 1200 and edited['type'] == 'movement'
    assert len(updated['state']['entries']) == len(data['state']['entries'])
    p.reload(wait_until='networkidle'); assert stored_document(p) == updated
    case.semantic_checks += 3


def legacy_cash_document():
    data = document(empty=True)
    data['state']['wallets'][0]['openingBalance'] = 10000
    data['state']['wallets'] += [
        {'id': 'legacy-cash', 'name': 'Legacy cash used', 'currency': 'TRY', 'kind': 'cash', 'openingBalance': 5000},
        {'id': 'unused-cash', 'name': 'Legacy cash unused', 'currency': 'USD', 'kind': 'cash', 'openingBalance': 0},
    ]
    data['state']['entries'] = [
        {'id': 'legacy-expense', 'date': '2026-10-31', 'type': 'expense', 'walletId': 'legacy-cash', 'amount': 1000, 'category': 'Belanja', 'note': 'LEGACY CASH EXPENSE'},
        {'id': 'legacy-transfer', 'date': '2026-10-31', 'type': 'transfer', 'walletId': 'bank', 'amount': 2000, 'toWalletId': 'legacy-cash', 'toAmount': 2000, 'category': '', 'note': 'LEGACY CASH TRANSFER'},
    ]
    return data


def legacy_cash_archive(case):
    p = case.page
    p.wait_for_function("!JSON.parse(localStorage.getItem('uangku:v1')).state.wallets.some(w=>w.id==='unused-cash')")
    expected = legacy_cash_document()
    expected['state']['wallets'] = [wallet for wallet in expected['state']['wallets'] if wallet['id'] != 'unused-cash']
    assert stored_document(p) == expected
    saved_raw = p.evaluate('(key)=>localStorage.getItem(key)', FINANCE)
    nav(p, 'Dompet')
    assert p.get_by_role('button', name='Atur dompet Legacy cash used', exact=True).count() == 0
    p.get_by_role('button', name='Lihat arsip cash lama', exact=True).click()
    dialog = p.get_by_role('dialog', name='Arsip cash lama', exact=True)
    expect(dialog).to_contain_text('Legacy cash used')
    expect(dialog).to_contain_text('LEGACY CASH EXPENSE')
    expect(dialog).to_contain_text('LEGACY CASH TRANSFER')
    expect(dialog).to_contain_text('60')
    assert dialog.get_by_role('textbox').count() == dialog.get_by_role('combobox').count() == 0
    assert dialog.get_by_role('button', name=re.compile('Hapus|Simpan|Ubah')).count() == 0
    dialog.get_by_role('button', name='Tutup arsip', exact=True).click()
    nav(p, 'Ringkasan')
    expect(p.locator('.balance-number')).to_contain_text('80')
    p.get_by_role('button', name='Catat transaksi', exact=True).click()
    dialog = p.get_by_role('dialog')
    assert 'legacy-cash' not in dialog.get_by_label('Dompet asal', exact=True).locator('option').evaluate_all('(els)=>els.map(el=>el.value)')
    dialog.get_by_role('button', name='Batal', exact=True).click()
    path = case.args.output / 'legacy-cash-preserved.json'
    with p.expect_download() as download:
        p.get_by_role('button', name='Cadangkan data', exact=True).click()
    download.value.save_as(path); assert read_document(path) == expected
    p.reload(wait_until='networkidle'); assert stored_document(p) == expected
    assert p.evaluate('(key)=>localStorage.getItem(key)', FINANCE) == saved_raw
    case.semantic_checks += 3


def legacy_prepaid_source(case):
    p = case.page
    path = case.args.output / 'legacy-prepaid-source.xlsx'
    record = [('bonus', 'PREPAID BONUS LEGACY-SOURCE', 125, 100125, 'income', 'Cashback')]
    write_statement(path, record); import_statement(case, path)
    p.get_by_role('button', name='Simpan 1 transaksi', exact=True).click()
    expect(p.get_by_role('heading', name='Periksa sebelum disimpan', exact=True)).to_have_count(0)
    original = stored_document(p)
    legacy = copy.deepcopy(original)
    legacy['state']['entries'][0]['type'] = 'unreviewed'
    legacy['state']['entries'][0]['category'] = 'Pendidikan'
    for annotation in legacy['metadata']['annotations']:
        annotation['confirmedType'] = 'unreviewed'; annotation['category'] = 'Pendidikan'
    old = Case(case.browser, case.args, case.name + '-old', initial=legacy)
    try:
        old.unchanged()
        import_statement(old, path)
        expect(old.page.get_by_role('button', name='Simpan 0 transaksi', exact=True)).to_be_disabled()
        assert stored_document(old.page)['state']['entries'][0]['type'] == 'unreviewed'
        old.unchanged()
        nav(old.page, 'Transaksi'); dialog = old.automation()
        row = row_for(dialog, 'PREPAID BONUS LEGACY-SOURCE')
        expect(row.get_by_role('combobox')).to_have_value('Pendidikan')
        dialog.get_by_role('button', name='Terapkan 1 kategori', exact=True).click()
        expect(dialog).to_have_count(0)
        confirmed = stored_document(old.page)
        assert confirmed['metadata']['facts'] == legacy['metadata']['facts']
        assert confirmed['state']['wallets'] == legacy['state']['wallets']
        assert confirmed['state']['entries'][0]['id'] == legacy['state']['entries'][0]['id']
        assert confirmed['state']['entries'][0]['type'] == 'income'
        assert confirmed['state']['entries'][0]['amount'] == 125 and confirmed['state']['entries'][0]['category'] == 'Pendidikan'
        assert confirmed['metadata']['annotations'][0]['confirmedType'] == 'income'
        assert confirmed['metadata']['annotations'][0]['category'] == 'Pendidikan'
        assert not old.errors
        case.byte_checks += old.byte_checks; case.semantic_checks += 3
    finally:
        old.context.close()


def legacy_atm_source(case):
    p = case.page
    path = case.args.output / 'legacy-atm-movement-source.xlsx'
    records = [
        ('withdrawal', 'ATM PARA ÇEKME LEGACY-SOURCE', -10000, 90000, 'expense', 'Pendidikan'),
        ('deposit', 'ATM YATAN LEGACY-SOURCE', 5000, 95000, 'income', 'Transportasi'),
        ('rail', 'HAVALE LEGACY-SOURCE', -3000, 92000, 'movement', 'Transfer'),
    ]
    write_statement(path, records); import_statement(case, path)
    # Create an actual valid old-policy source document via the import UI.
    # This deliberately selects movement, then preserves each manual category.
    for _, note, _, _, _, category in records:
        row = p.locator('.import-table tbody tr').filter(has_text=note)
        row.locator('select').first.select_option('movement')
        row.locator('.import-row-category').select_option(category)
    p.get_by_role('button', name='Simpan 3 transaksi', exact=True).click()
    expect(p.get_by_role('heading', name='Periksa sebelum disimpan', exact=True)).to_have_count(0)
    nav(p, 'Transaksi')
    manual_notes = {
        records[0][1]: 'Catatan manual penarikan untuk pendidikan',
        records[1][1]: 'Catatan manual setoran untuk transportasi',
    }
    for source_note, manual_note in manual_notes.items():
        p.get_by_role('button', name='Ubah ' + source_note, exact=True).click()
        dialog = p.get_by_role('dialog')
        dialog.get_by_label(re.compile('^Keterangan')).fill(manual_note)
        dialog.get_by_role('button', name='Simpan transaksi', exact=True).click()
        expect(dialog).to_have_count(0)
    before = stored_document(p)
    assert len(before['state']['entries']) == 3
    assert all(entry['type'] == 'movement' for entry in before['state']['entries'])
    assert bank_balances(before) == {'bank': 92000, 'second': 0}
    old_raw = p.evaluate('(key)=>localStorage.getItem(key)', FINANCE)
    p.reload(wait_until='networkidle')
    assert p.evaluate('(key)=>localStorage.getItem(key)', FINANCE) == old_raw
    assert stored_document(p) == before, 'Reading old ATM movements must not reclassify them'
    import_statement(case, path)
    expect(p.get_by_role('button', name='Simpan 0 transaksi', exact=True)).to_be_disabled()
    assert p.evaluate('(key)=>localStorage.getItem(key)', FINANCE) == old_raw
    nav(p, 'Transaksi'); dialog = case.automation()
    expect(dialog.locator('.category-automation-row')).to_have_count(2)
    for _, source_note, _, _, type_, category in records[:2]:
        row = row_for(dialog, manual_notes[source_note])
        expect(row.get_by_role('combobox')).to_have_value(category)
        expect(row.locator('.bank-type-confirmation')).to_contain_text('Pengeluaran tarik tunai' if type_ == 'expense' else 'Pemasukan setor tunai')
    assert p.evaluate('(key)=>localStorage.getItem(key)', FINANCE) == old_raw
    case.screenshot('legacy-atm-reviewed-types')
    dialog.get_by_role('button', name='Terapkan 2 kategori', exact=True).click()
    expect(dialog).to_have_count(0)
    after = stored_document(p); expected = copy.deepcopy(before)
    source_types = {}
    for entry in expected['state']['entries']:
        if entry['note'] in manual_notes.values():
            entry['type'] = 'expense' if entry['note'] == manual_notes[records[0][1]] else 'income'
            entry['amount'] = abs(entry['amount'])
            link = next(link for link in expected['metadata']['links'] if link['entryId'] == entry['id'])
            source_types[link['source']] = entry['type']
    for annotation in expected['metadata']['annotations']:
        if annotation['sourceId'] in source_types:
            annotation['confirmedType'] = source_types[annotation['sourceId']]
    assert after == expected, 'Only the explicitly approved ATM type and its magnitude representation may change'
    assert after['metadata']['facts'] == before['metadata']['facts']
    assert len(after['state']['entries']) == len(before['state']['entries']) == 3
    assert bank_balances(after) == bank_balances(before)
    assert sum(entry['amount'] for entry in after['state']['entries'] if entry['type'] == 'income') == 5000
    assert sum(entry['amount'] for entry in after['state']['entries'] if entry['type'] == 'expense') == 10000
    assert next(entry for entry in after['state']['entries'] if entry['note'] == records[2][1]) == next(entry for entry in before['state']['entries'] if entry['note'] == records[2][1])
    saved_raw = p.evaluate('(key)=>localStorage.getItem(key)', FINANCE)
    p.reload(wait_until='networkidle'); assert stored_document(p) == after
    assert p.evaluate('(key)=>localStorage.getItem(key)', FINANCE) == saved_raw
    import_statement(case, path)
    expect(p.get_by_role('button', name='Simpan 0 transaksi', exact=True)).to_be_disabled()
    assert stored_document(p) == after
    assert case.settings_text() is None
    case.byte_checks += 5; case.semantic_checks += 8


def pair_movements(case, incoming=False):
    p = case.page
    debit = case.args.output / f'{case.name}-debit.xlsx'
    credit = case.args.output / f'{case.name}-credit.xlsx'
    debit_note, credit_note = 'HAVALE PAIR DEBIT', 'EFT PAIR CREDIT'
    write_statement(debit, [('debit', debit_note, -10000, 90000, 'movement', 'Transfer')], '30.10.2026')
    write_statement(credit, [('credit', credit_note, 10000, 10000, 'movement', 'Transfer')])
    import_statement(case, debit); p.get_by_role('button', name='Simpan 1 transaksi', exact=True).click()
    expect(p.get_by_role('heading', name='Periksa sebelum disimpan', exact=True)).to_have_count(0)
    nav(p, 'Impor mutasi'); p.get_by_label('Dompet impor', exact=True).select_option('second')
    p.get_by_label('File mutasi Ziraat', exact=True).set_input_files(credit)
    expect(p.get_by_role('heading', name='Periksa sebelum disimpan', exact=True)).to_be_visible()
    p.get_by_role('button', name='Simpan 1 transaksi', exact=True).click()
    expect(p.get_by_role('heading', name='Periksa sebelum disimpan', exact=True)).to_have_count(0)
    before = stored_document(p); by_note = {entry['note']: entry for entry in before['state']['entries']}
    assert len(by_note) == 2 and all(entry['type'] == 'movement' for entry in by_note.values())
    nav(p, 'Transaksi')
    p.get_by_role('button', name='Ubah ' + (credit_note if incoming else debit_note), exact=True).click()
    dialog = p.get_by_role('dialog'); dialog.get_by_role('button', name='Transfer', exact=True).click()
    other = by_note[debit_note if incoming else credit_note]
    dialog.get_by_label(re.compile('^Catatan pasangan di dompet')).select_option(other['id'])
    if dialog.get_by_label('Alasan perubahan', exact=True).count():
        dialog.get_by_label('Alasan perubahan', exact=True).fill('Pairing the two synthetic owned bank postings')
    dialog.get_by_role('button', name=re.compile('^Simpan (transaksi|hasil cek)$')).click()
    expect(dialog).to_have_count(0)
    after = stored_document(p)
    assert len(after['state']['entries']) == 1
    paired = after['state']['entries'][0]
    assert paired['type'] == 'transfer' and paired['id'] == by_note[debit_note]['id']
    assert paired['walletId'] == 'bank' and paired['toWalletId'] == 'second'
    assert paired['amount'] == paired['toAmount'] == 10000 and not paired.get('fee')
    assert after['metadata']['facts'] == before['metadata']['facts']
    dates = next(row for row in after['metadata']['transfers'] if row['entryId'] == paired['id'])
    assert dates['sourceDate'] == '2026-10-30' and dates['destinationDate'] == '2026-10-31'
    assert after['state']['wallets'] == before['state']['wallets']
    assert bank_balances(after) == bank_balances(before) == {'bank': 90000, 'second': 10000}
    p.reload(wait_until='networkidle'); assert stored_document(p) == after
    case.semantic_checks += 3


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--url', default=os.environ.get('UANGKU_TEST_URL', 'http://127.0.0.1:4180')); parser.add_argument('--only', default='')
    args = parser.parse_args(); args.output = args.output.resolve(); args.output.mkdir(parents=True, exist_ok=True)
    build = assert_production_url(args.url)
    removed = v3_settings(); removed['rules'] = [rule for rule in removed['rules'] if rule['id'] != 'bank-v3-fast']
    custom = v3_settings(); next(rule for rule in custom['rules'] if rule['id'] == 'bank-v3-havale')['category'] = 'Pendidikan'
    cases = [('no-cash-defaults-and-create-options', {'initial': None}, no_cash_defaults),
             ('bank-auto-plain-desktop', {}, direct_categories),
             ('bank-auto-plain-mobile-dark', {'width': 390, 'theme': 'dark'}, direct_categories),
             ('bank-auto-source-desktop', {'empty': True}, source_flow),
             ('bank-auto-source-mobile-dark', {'empty': True, 'width': 390, 'theme': 'dark'}, source_flow),
             ('v3-v4-exact-eight-updates', {'settings': v3_settings()}, migration),
             ('v3-deleted-fast-rule-not-readded', {'settings': removed}, deleted_rule),
             ('v3-custom-suggestion-preserved', {'settings': custom}, custom_suggestion),
             ('movement-form-sign-and-zero-guard', {'empty': True}, movement_form),
             ('legacy-cash-readonly-archive-and-prune', {'initial': legacy_cash_document()}, legacy_cash_archive),
             ('known-prepaid-source-preserved-until-explicit-apply', {'empty': True}, legacy_prepaid_source),
             ('old-atm-movement-source-explicit-apply', {'empty': True}, legacy_atm_source),
             ('explicit-pair-from-debit-movement', {'empty': True}, pair_movements),
             ('explicit-pair-from-credit-movement', {'empty': True}, lambda case: pair_movements(case, True))]
    results = []
    with sync_playwright() as pw:
        browser = launch_browser(pw); version = browser.version
        try:
            for name, options, run in cases:
                if args.only and args.only not in name: continue
                began, case = time.monotonic(), None; result = {'name': name, 'status': 'failed'}
                try:
                    assert assert_production_url(args.url) == build, 'Production build changed during suite'
                    case = Case(browser, args, name, **options); run(case); assert not case.errors, case.errors; result['status'] = 'passed'
                except Exception as error:
                    result.update({'error': str(error), 'traceback': traceback.format_exc()})
                    if case:
                        try: case.page.screenshot(path=str(args.output / f'{name}-failure.png'), full_page=True)
                        except Exception: pass
                finally:
                    if case:
                        result.update({'exact_byte_invariance_checks': case.byte_checks, 'semantic_invariance_checks': case.semantic_checks, 'page_errors': case.errors}); case.context.close()
                result['seconds'] = round(time.monotonic() - began, 3); results.append(result)
                print(compact({key: value for key, value in result.items() if key != 'traceback'}), flush=True)
        finally: browser.close()
    identity = {'passed': False}
    try: identity = {'passed': assert_production_url(args.url) == build}
    except Exception as error: identity['error'] = str(error)
    report = {'synthetic_only': True, 'fresh_contexts': True, 'dist_sha256': build, 'browser_version': version, 'url': args.url, 'final_build_identity': identity,
              'scope': 'Chromium desktop/mobile emulation; no personal financial file or external service', 'results': results,
              'passed': bool(results) and all(row['status'] == 'passed' for row in results) and identity['passed']}
    (args.output / 'summary.json').write_bytes((json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    print(compact({'passed': sum(row['status'] == 'passed' for row in results), 'failed': sum(row['status'] != 'passed' for row in results), 'dist_sha256': build}), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__': raise SystemExit(main())
