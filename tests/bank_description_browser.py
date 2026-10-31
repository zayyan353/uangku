"""Synthetic production-browser checks for bank wording and pack v3.

Operation hints/category annotations are tested separately from financial type,
source facts, wallet ownership and transfer pairing. No personal files are read.
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
                             launch_browser, stored_document)
install_playwright_path()
from playwright.sync_api import sync_playwright, expect
from category_browser import compact, fixture, nav, without_categories
from keyword_pack_browser import Case as BaseCase, MISSING, row_for

FINANCE = 'uangku:v1'
SETTINGS = 'uangku:categories:v1'
UNCAT = 'Belum dikategorikan'

AUTO = [
    ('tax', 'Referanslı HAVALE BSMV TAHSİLATI BANK101', 'Biaya bank', 'transfer-fee'),
    ('commission', 'FAST KOMİSYONU TAHSİLATI BANK102', 'Biaya bank', 'transfer-fee'),
    ('online', 'SANAL POS ALIŞVERİŞ İŞYERİ S/GIB HARCLAR VERGI BANK103', 'Belanja online', 'online-purchase'),
    ('food', 'SANAL POS ALIŞVERİŞ İŞYERİ TRENDYOL YEMEK BANK104', 'Makan & minum', 'online-purchase'),
    ('confirmed-cashback', 'PREPAID İADESİ BANK105', 'Cashback', 'cashback'),
]
PENDING = [
    ('withdrawal', 'ATM PARA ÇEKME BANK201', 'Tarik tunai', 'atm-withdrawal', -5000),
    ('deposit', 'ATM YATAN BANK202', 'Setor tunai', 'atm-deposit', 6000),
    ('domestic-deposit', 'YURTİÇİ ATM P.Y. BANK203', 'Setor tunai', 'atm-deposit', 2000),
    ('havale', 'Referanslı HAVALE SENTETIK ALICI BANK204', 'Transfer', 'bank-transfer', -700),
    ('fast', 'FAST SENTETIK ALICI BANK205', 'Transfer', 'bank-transfer', -800),
    ('eft', 'EFT SENTETIK ALICI BANK206', 'Transfer', 'bank-transfer', 900),
    ('cashback', 'PREPAID İADE BANK207', 'Cashback', 'cashback', 125),
    ('old-pending-fee', 'HAVALE KOMİSYONU TAHSİLATI LEGACY BANK208', 'Biaya bank', 'transfer-fee', -50),
]
NAMED_POS = 'POS ALIŞVERİŞ İŞYERİ SYNTHETIC ALI FAST DEMIR BANK301'


def v2_settings():
    return {'version': 1, 'keywordPackVersion': 2,
            'names': [UNCAT, 'Biaya bank', 'Belanja online', 'Makan & minum', 'Pendidikan', 'Kategori pribadi'],
            'rules': [
                {'id': 'keyword-pack-trendyol-food', 'keyword': 'TRENDYOL YEMEK', 'category': 'Makan & minum', 'mode': 'auto'},
                {'id': 'my-withdrawal', 'keyword': 'ATM PARA ÇEKME', 'category': 'Pendidikan', 'mode': 'suggest'},
                {'id': 'my-havale', 'keyword': 'HAVALE', 'category': 'Pendidikan', 'mode': 'suggest'},
                {'id': 'my-private', 'keyword': 'PRIVATE LITERAL MERCHANT', 'category': 'Kategori pribadi', 'mode': 'suggest'},
            ]}


def bank_fixture(empty=False):
    data = fixture(empty=True)
    data['state']['wallets'][0]['openingBalance'] = 500_000
    if empty:
        return data
    entries = [{'id': id_, 'date': '2026-10-31', 'walletId': 'bank',
                'type': 'income' if id_ == 'confirmed-cashback' else 'expense',
                'amount': 125 if id_ == 'confirmed-cashback' else 1000,
                'category': UNCAT, 'note': note} for id_, note, _, _ in AUTO]
    entries += [{'id': id_, 'date': '2026-10-31', 'walletId': 'bank', 'type': 'unreviewed',
                 'amount': amount, 'category': UNCAT, 'note': note} for id_, note, _, _, amount in PENDING]
    entries += [
        {'id': 'named-pos', 'date': '2026-10-31', 'walletId': 'bank', 'type': 'expense', 'amount': 200, 'category': UNCAT, 'note': NAMED_POS},
        {'id': 'manual-online', 'date': '2026-10-31', 'walletId': 'bank', 'type': 'expense', 'amount': 300, 'category': 'Pendidikan', 'note': 'SANAL POS ALIŞVERİŞ İŞYERİ GIB MANUAL'},
        {'id': 'manual-atm', 'date': '2026-10-31', 'walletId': 'bank', 'type': 'unreviewed', 'amount': -400, 'category': 'Transportasi', 'note': 'ATM PARA ÇEKME MANUAL'},
        {'id': 'existing-transfer', 'date': '2026-10-31', 'walletId': 'bank', 'type': 'transfer', 'amount': 500, 'toWalletId': 'cash', 'toAmount': 500, 'category': '', 'note': 'ATM PARA ÇEKME ALREADY PAIRED'},
    ]
    data['state']['entries'] = entries
    return data


class Case(BaseCase):
    def __init__(self, browser, args, name, *, settings=MISSING, width=1440, theme='light', empty=False):
        self.args, self.name = args, name
        self.errors, self.byte_checks, self.semantic_checks = [], 0, 0
        self.financial_raw = compact(bank_fixture(empty))
        self.settings_raw = None if settings is MISSING else compact(settings)
        parts = urlsplit(args.url)
        values = [{'name': FINANCE, 'value': self.financial_raw},
                  {'name': 'uangku:theme:v1', 'value': theme},
                  {'name': 'uangku:preferences:v1', 'value': compact({'currency': 'TRY', 'lastWallets': {'TRY': 'bank'}})}]
        if self.settings_raw is not None:
            values.append({'name': SETTINGS, 'value': self.settings_raw})
        self.context = browser.new_context(
            viewport={'width': width, 'height': 1000 if width > 600 else 844}, is_mobile=width < 600,
            has_touch=width < 600, color_scheme=theme, timezone_id='Europe/Istanbul', accept_downloads=True,
            storage_state={'cookies': [], 'origins': [{'origin': f'{parts.scheme}://{parts.netloc}', 'localStorage': values}]})
        self.page = self.new_page()
        self.page.goto(args.url, wait_until='networkidle')
        nav(self.page, 'Transaksi')


def expect_hint(row, kind):
    direct = row.get_attribute('data-bank-operation') == kind
    nested = row.locator(f'[data-bank-operation="{kind}"]')
    assert direct or nested.count() > 0, f'Bank interpretation hint {kind} is missing'
    if not direct:
        expect(nested.first).to_be_visible()


def approved_pending_type(id_):
    if id_ in ['withdrawal', 'manual-atm', 'old-pending-fee']:
        return 'expense'
    if id_ in ['deposit', 'domestic-deposit', 'cashback']:
        return 'income'
    return 'movement'


def fresh_preview(case):
    p = case.page
    before = stored_document(p)
    dialog = case.manager()
    expect(dialog.locator('.category-manager-names li')).to_have_count(30)
    expect(dialog.locator('.category-manager-rules li')).to_have_count(81)
    dialog.get_by_role('button', name='Batal', exact=True).click()
    dialog = case.automation()
    expect(dialog.locator('.category-automation-row')).to_have_count(len(AUTO) + len(PENDING) + 2)
    for _, note, category, kind in AUTO:
        row = row_for(dialog, note)
        expect(row.get_by_role('combobox')).to_have_value(category)
        expect_hint(row, kind)
    for _, note, category, kind, _ in PENDING:
        row = row_for(dialog, note)
        expect(row.get_by_role('combobox')).to_have_value(category)
        expect_hint(row, kind)
        row.get_by_role('combobox').select_option(category)
    expect(row_for(dialog, NAMED_POS).get_by_role('combobox')).to_have_value('Belanja')
    expect_hint(row_for(dialog, NAMED_POS), 'card-purchase')
    expect(row_for(dialog, 'ATM PARA ÇEKME MANUAL').get_by_role('combobox')).to_have_value('Transportasi')
    assert dialog.locator('.category-automation-row').filter(has_text='GIB MANUAL').count() == 0
    assert dialog.locator('.category-automation-row').filter(has_text='ALREADY PAIRED').count() == 0
    case.unchanged()
    case.screenshot('category-review')
    dialog.get_by_role('button', name=f'Terapkan {len(AUTO) + len(PENDING) + 2} kategori', exact=True).click()
    expect(dialog).to_have_count(0)
    after = stored_document(p)
    confirmed = copy.deepcopy(before)
    for entry in confirmed['state']['entries']:
        if entry['id'] in {row[0] for row in PENDING} or entry['id'] == 'manual-atm':
            entry['type'] = approved_pending_type(entry['id'])
            if entry['type'] in ['expense', 'income']: entry['amount'] = abs(entry['amount'])
    assert without_categories(after) == without_categories(confirmed)
    by_id = {entry['id']: entry for entry in after['state']['entries']}
    for id_, _, category, _ in AUTO:
        assert by_id[id_]['category'] == category
    for id_, _, category, _, amount in PENDING:
        expected_type = approved_pending_type(id_)
        assert by_id[id_]['category'] == category and by_id[id_]['type'] == expected_type and by_id[id_]['amount'] == (abs(amount) if expected_type in ['expense', 'income'] else amount)
    assert by_id['manual-online']['category'] == 'Pendidikan'
    assert by_id['manual-atm']['category'] == 'Transportasi'
    assert by_id['named-pos']['category'] == 'Belanja' and by_id['named-pos']['type'] == 'expense'
    assert sum(entry['type'] == 'transfer' for entry in after['state']['entries']) == 1
    assert by_id['existing-transfer'] == next(entry for entry in before['state']['entries'] if entry['id'] == 'existing-transfer')
    assert case.settings_text() is None
    # Presentation hints do not change a reviewed financial posting either.
    table = p.locator('.transactions-table tbody tr')
    expect_hint(table.filter(has_text='ATM PARA ÇEKME BANK201'), 'atm-withdrawal')
    assert table.filter(has_text=NAMED_POS).locator('[data-bank-operation="bank-transfer"]').count() == 0
    case.semantic_checks += 1


SOURCE_ROWS = [
    ('withdrawal', 'ATM PARA ÇEKME SOURCE01', -10000, 90000, UNCAT, 'expense', 'atm-withdrawal'),
    ('deposit', 'ATM YATAN SOURCE02', 5000, 95000, 'Setor tunai', 'income', 'atm-deposit'),
    ('domestic', 'YURTİÇİ ATM P.Y. SOURCE03', 2000, 97000, 'Setor tunai', 'income', 'atm-deposit'),
    ('deposit-alias', 'ATM PARA YATIRMA SOURCE04', 500, 97500, 'Setor tunai', 'income', 'atm-deposit'),
    ('havale', 'Referanslı HAVALE SENTETIK ALICI SOURCE05', -3000, 94500, 'Transfer', 'movement', 'bank-transfer'),
    ('fast', 'FAST SENTETIK ALICI SOURCE06', -1500, 93000, 'Transfer', 'movement', 'bank-transfer'),
    ('eft', 'EFT SENTETIK ALICI SOURCE07', 1000, 94000, 'Transfer', 'movement', 'bank-transfer'),
    ('tax', 'HAVALE BSMV TAHSİLATI SOURCE08', -25, 93975, 'Biaya bank', 'expense', 'transfer-fee'),
    ('commission', 'FAST KOMİSYONU TAHSİLATI SOURCE09', -50, 93925, 'Biaya bank', 'expense', 'transfer-fee'),
    ('cashback', 'PREPAID İADE SOURCE10', 125, 94050, 'Cashback', 'income', 'cashback'),
    ('online', 'SANAL POS ALIŞVERİŞ İŞYERİ S/GIB HARCLAR VERGI SOURCE11', -500, 93550, 'Pendidikan', 'expense', 'online-purchase'),
    ('food', 'SANAL POS ALIŞVERİŞ İŞYERİ TRENDYOL YEMEK SOURCE12', -1000, 92550, 'Makan & minum', 'expense', 'online-purchase'),
    ('named', 'POS ALIŞVERİŞ İŞYERİ SYNTHETIC ALI FAST DEMIR SOURCE13', -200, 92350, 'Belanja', 'expense', 'card-purchase'),
]


def write_statement(path):
    rows = [['Synthetic bank-operation examples'], ['Currency', 'TL'], *[[] for _ in range(9)],
            ['Tarih', 'Fiş No', 'Açıklama', 'İşlem Tutarı', 'Bakiye'],
            *[['31.10.2026', f'SYNTH-{id_}', description, amount / 100, balance / 100]
              for id_, description, amount, balance, _, _, _ in SOURCE_ROWS]]
    xml = ''.join('<row>' + ''.join(f'<c t="{"n" if isinstance(value, (int, float)) else "str"}"><v>{escape(str(value))}</v></c>' for value in row) + '</row>' for row in rows)
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
        archive.writestr('xl/workbook.xml', f'<workbook {ns}><workbookPr date1904="0"/></workbook>')
        archive.writestr('xl/worksheets/sheet1.xml', f'<worksheet {ns}><sheetData>{xml}</sheetData></worksheet>')


def source_flow(case):
    p = case.page
    path = case.args.output / f'{case.name}-synthetic.xlsx'
    write_statement(path)
    nav(p, 'Impor mutasi')
    p.get_by_label('Dompet impor', exact=True).select_option('bank')
    p.get_by_label('File mutasi Ziraat', exact=True).set_input_files(path)
    expect(p.get_by_role('heading', name='Periksa sebelum disimpan', exact=True)).to_be_visible()
    rows = p.locator('.import-table tbody tr')
    for id_, description, _, _, category, type_, kind in SOURCE_ROWS:
        row = rows.filter(has_text=description)
        expect(row).to_have_count(1)
        expect(row.locator('select').first).to_have_value(type_)
        if kind != 'none':
            expect_hint(row, kind)
        else:
            assert row.locator('[data-bank-operation="bank-transfer"]').count() == 0
        expected_initial = 'Tarik tunai' if id_ == 'withdrawal' else category
        if id_ == 'online':
            expected_initial = 'Belanja online'
        expect(row.locator('.import-row-category')).to_have_value(expected_initial)
        if category != expected_initial:
            row.locator('.import-row-category').select_option(category)
    p.get_by_role('button', name=f'Simpan {len(SOURCE_ROWS)} transaksi', exact=True).click()
    expect(p.get_by_role('heading', name='Periksa sebelum disimpan', exact=True)).to_have_count(0)
    before = stored_document(p)
    assert len(before['state']['entries']) == len(before['metadata']['facts']) == len(SOURCE_ROWS)
    by_note = {entry['note']: entry for entry in before['state']['entries']}
    facts = {fact['description']: fact for fact in before['metadata']['facts']}
    for id_, description, amount, balance, category, type_, _ in SOURCE_ROWS:
        assert by_note[description]['type'] == type_ and by_note[description]['category'] == category
        assert by_note[description]['amount'] == (abs(amount) if type_ == 'expense' else amount)
        assert facts[description]['signedAmount'] == amount and facts[description]['balanceAfter'] == balance
        assert facts[description]['reference'] == f'SYNTH-{id_}'
    assert not any(entry['type'] == 'transfer' or entry.get('toWalletId') or entry['walletId'] == 'cash' for entry in before['state']['entries'])
    assert {entry['note'] for entry in before['state']['entries'] if entry['type'] == 'income'} == {row[1] for row in SOURCE_ROWS if row[5] == 'income'}
    assert sum(entry['amount'] for entry in before['state']['entries'] if entry['type'] == 'income') == 7625
    assert sum(entry['amount'] for entry in before['state']['entries'] if entry['type'] == 'expense') == 11775
    assert next(wallet for wallet in before['state']['wallets'] if wallet['id'] == 'cash')['openingBalance'] == 0
    assert json.loads(p.evaluate('(key)=>localStorage.getItem(key)', FINANCE))['version'] == 2
    # Categorizing an already-confirmed ATM expense changes only its category.
    nav(p, 'Transaksi')
    dialog = case.automation()
    expect(dialog.locator('.category-automation-row')).to_have_count(1)
    row = row_for(dialog, SOURCE_ROWS[0][1])
    expect(row.get_by_role('combobox')).to_have_value('Tarik tunai')
    expect_hint(row, 'atm-withdrawal')
    row.get_by_role('combobox').select_option('Tarik tunai')
    dialog.get_by_role('button', name='Terapkan 1 kategori', exact=True).click()
    expect(dialog).to_have_count(0)
    after = stored_document(p)
    assert without_categories(after) == without_categories(before)
    assert after['metadata']['facts'] == before['metadata']['facts']
    assert {entry['id'] for entry in after['state']['entries']} == {entry['id'] for entry in before['state']['entries']}
    withdrawal = next(entry for entry in after['state']['entries'] if entry['note'] == SOURCE_ROWS[0][1])
    assert withdrawal['category'] == 'Tarik tunai' and withdrawal['type'] == 'expense' and withdrawal['amount'] == 10000
    source_id = next(link['source'] for link in after['metadata']['links'] if link['entryId'] == withdrawal['id'])
    annotation = next(item for item in after['metadata']['annotations'] if item['sourceId'] == source_id)
    assert annotation['category'] == 'Tarik tunai' and annotation['confirmedType'] == 'expense'
    saved_raw = p.evaluate('(key)=>localStorage.getItem(key)', FINANCE)
    p.reload(wait_until='networkidle')
    assert stored_document(p) == after
    assert p.evaluate('(key)=>localStorage.getItem(key)', FINANCE) == saved_raw
    assert case.settings_text() is None
    nav(p, 'Transaksi')
    expect_hint(p.locator('.transactions-table tbody tr').filter(has_text=SOURCE_ROWS[0][1]), 'atm-withdrawal')
    case.screenshot('saved-source-table')
    case.semantic_checks += 4


def migration(case):
    original = v2_settings()
    dialog = case.automation()
    row = row_for(dialog, 'ATM PARA ÇEKME BANK201')
    expect(row.get_by_role('combobox')).to_have_value('')
    assert 'Pendidikan' in ' '.join(row.locator('.field-help').all_text_contents())
    dialog.get_by_role('button', name='Batal', exact=True).click()
    case.unchanged()
    dialog = case.manager(); case.save(dialog)
    saved = case.settings_value()
    assert saved['keywordPackVersion'] == 5
    assert saved['names'][:len(original['names'])] == original['names']
    assert set(saved['names']) - set(original['names']) == {'Tarik tunai', 'Setor tunai', 'Transfer', 'Cashback'}
    by_id = {rule['id']: rule for rule in saved['rules']}
    for rule in original['rules']:
        assert by_id[rule['id']] == rule
    assert 'bank-v3-atm-withdrawal' not in by_id and 'bank-v3-havale' not in by_id
    assert not {'shopping-trendyol', 'subscription-apple', 'keyword-pack-hop-scooter', 'keyword-pack-estram'} & set(by_id)
    case.unchanged(settings=False)
    case.page.reload(wait_until='networkidle')
    assert case.settings_value() == saved
    case.unchanged(settings=False)


def archived_bank_fee(case):
    dialog = case.manager()
    assert dialog.locator('.category-manager-names li').filter(has_text='Biaya bank').count() == 0
    case.save(dialog)
    saved = case.settings_value()
    assert saved['keywordPackVersion'] == 5 and 'Biaya bank' not in saved['names']
    assert not any(rule['id'] in ['bank-v3-havale-tax', 'bank-v3-havale-commission'] for rule in saved['rules'])
    original = json.loads(case.settings_raw)
    by_id = {rule['id']: rule for rule in saved['rules']}
    assert all(by_id[rule['id']] == rule for rule in original['rules'])
    case.unchanged(settings=False)


def delete_movement_category(case):
    p = case.page
    dialog = case.manager()
    dialog.get_by_role('button', name='Hapus kategori Tarik tunai', exact=True).click()
    path = case.args.output / 'v3-inactive-withdrawal-category.json'
    with p.expect_download() as download:
        dialog.get_by_role('button', name='Ekspor pengaturan kategori', exact=True).click()
    download.value.save_as(path)
    exported = json.loads(path.read_text(encoding='utf-8'))
    assert exported['settings']['keywordPackVersion'] == 5 and 'Tarik tunai' not in exported['settings']['names']
    case.save(dialog)
    p.reload(wait_until='networkidle'); nav(p, 'Transaksi')
    dialog = case.automation()
    row = row_for(dialog, 'ATM PARA ÇEKME BANK201')
    expect(row.get_by_role('combobox')).to_have_value('')
    assert row.get_by_role('option', name='Tarik tunai', exact=True).count() == 0
    dialog.get_by_role('button', name='Batal', exact=True).click()
    # The factual operation hint survives independently from active choices.
    expect_hint(p.locator('.transactions-table tbody tr').filter(has_text='ATM PARA ÇEKME BANK201'), 'atm-withdrawal')
    dialog = case.manager()
    dialog.get_by_label('Nama kategori baru', exact=True).fill('Tarik tunai')
    dialog.get_by_role('button', name='Tambah kategori', exact=True).click()
    case.save(dialog)
    dialog = case.manager()
    dialog.get_by_label('File pengaturan kategori', exact=True).set_input_files(path)
    expect(dialog.get_by_role('status')).to_contain_text('Belum mengganti pengaturan tersimpan')
    case.save(dialog)
    p.reload(wait_until='networkidle'); nav(p, 'Transaksi')
    assert case.settings_value() == exported['settings']
    dialog = case.automation()
    row = row_for(dialog, 'ATM PARA ÇEKME BANK201')
    expect(row.get_by_role('combobox')).to_have_value('')
    assert row.get_by_role('option', name='Tarik tunai', exact=True).count() == 0
    case.unchanged(settings=False)


def migration_quota(case):
    p = case.page
    p.evaluate('''()=>{const set=Storage.prototype.setItem;window.rejectBankSettings=true;
        Storage.prototype.setItem=function(key,value){if(key==='uangku:categories:v1'&&window.rejectBankSettings)
        throw new DOMException('Synthetic bank-mapping quota','QuotaExceededError');return set.call(this,key,value);};}''')
    dialog = case.manager()
    dialog.get_by_role('button', name='Simpan pengaturan', exact=True).click()
    expect(dialog.get_by_role('alert')).to_be_visible()
    case.unchanged()
    assert case.settings_value()['keywordPackVersion'] == 2
    p.evaluate('window.rejectBankSettings=false')
    case.save(dialog)
    assert case.settings_value()['keywordPackVersion'] == 5
    by_id = {rule['id']: rule for rule in case.settings_value()['rules']}
    assert all(by_id[rule['id']] == rule for rule in v2_settings()['rules'])
    case.unchanged(settings=False)


def migration_capacity(case):
    expect(case.page.locator('.category-toolbar .notice.warning')).to_contain_text('Pengaturan lama tetap dipakai')
    dialog = case.automation()
    # Known financial interpretations remain reviewable, but the rejected
    # settings upgrade must not introduce any of its new category choices.
    rows = dialog.locator('.category-automation-row')
    expect(rows).to_have_count(len(PENDING) + 1)
    for index in range(rows.count()):
        row = rows.nth(index)
        expect(row.get_by_role('combobox')).to_have_value('Transportasi' if 'ATM PARA ÇEKME MANUAL' in row.text_content() else '')
        assert row.get_by_role('option', name='Tarik tunai', exact=True).count() == 0
    case.unchanged()
    assert case.settings_value()['keywordPackVersion'] == 2 and len(case.settings_value()['rules']) == 200


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--url', default=os.environ.get('UANGKU_TEST_URL', 'http://127.0.0.1:4180'))
    parser.add_argument('--only', default='')
    args = parser.parse_args()
    args.output = args.output.resolve(); args.output.mkdir(parents=True, exist_ok=True)
    build = assert_production_url(args.url)
    archived = v2_settings(); archived['names'].remove('Biaya bank')
    full = v2_settings(); full['rules'] = [{'id': f'personal-{index}', 'keyword': f'PRIVATE MARKER {index:03}', 'category': 'Pendidikan', 'mode': 'suggest'} for index in range(200)]
    cases = [
        ('bank-preview-desktop', {}, fresh_preview),
        ('bank-preview-mobile-dark', {'width': 390, 'theme': 'dark'}, fresh_preview),
        ('bank-source-desktop', {'empty': True}, source_flow),
        ('bank-source-mobile-dark', {'empty': True, 'width': 390, 'theme': 'dark'}, source_flow),
        ('v2-v3-manual-rules-deleted-old-rules', {'settings': v2_settings()}, migration),
        ('v2-archived-bank-fee-not-reintroduced', {'settings': archived}, archived_bank_fee),
        ('v3-movement-category-delete-export-reload-import', {}, delete_movement_category),
        ('v2-migration-quota-draft-preserved', {'settings': v2_settings()}, migration_quota),
        ('v2-migration-capacity-fallback', {'settings': full}, migration_capacity),
    ]
    results = []
    with sync_playwright() as pw:
        browser = launch_browser(pw); version = browser.version
        try:
            for name, options, run in cases:
                if args.only and args.only not in name:
                    continue
                began, case = time.monotonic(), None
                result = {'name': name, 'status': 'failed'}
                try:
                    assert assert_production_url(args.url) == build, 'Production build changed during suite'
                    case = Case(browser, args, name, **options)
                    run(case)
                    assert not case.errors, case.errors
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
                        result.update({'exact_byte_invariance_checks': case.byte_checks,
                                       'semantic_invariance_checks': case.semantic_checks, 'page_errors': case.errors})
                        case.context.close()
                result['seconds'] = round(time.monotonic() - began, 3)
                results.append(result)
                print(compact({key: value for key, value in result.items() if key != 'traceback'}), flush=True)
        finally:
            browser.close()
    identity = {'passed': False}
    try:
        identity = {'passed': assert_production_url(args.url) == build}
    except Exception as error:
        identity['error'] = str(error)
    report = {'synthetic_only': True, 'fresh_contexts': True, 'dist_sha256': build, 'browser_version': version,
              'url': args.url, 'final_build_identity': identity,
              'scope': 'Chromium desktop/mobile emulation; no personal financial file or external service',
              'results': results, 'passed': bool(results) and all(row['status'] == 'passed' for row in results) and identity['passed']}
    (args.output / 'summary.json').write_bytes((json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    print(compact({'passed': sum(row['status'] == 'passed' for row in results), 'failed': sum(row['status'] != 'passed' for row in results), 'dist_sha256': build}), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
