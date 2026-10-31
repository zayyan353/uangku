"""Synthetic production-browser regression for the optional merchant keyword pack.

Checks effective legacy overlays separately from explicit configuration writes.
No personal statement, financial backup, browser profile or external API is used.
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
                             launch_browser, new_page, stored_document)
install_playwright_path()
from playwright.sync_api import sync_playwright, expect
from category_browser import compact, fixture, nav, settings_fixture, without_categories

FINANCE = 'uangku:v1'
SETTINGS = 'uangku:categories:v1'
UNCAT = 'Belum dikategorikan'
MISSING = object()


def legacy_settings():
    value = settings_fixture()
    value.pop('keywordPackVersion', None)
    return value


def pack_fixture(empty=False):
    data = fixture(empty=True)
    data['state']['wallets'][0]['openingBalance'] = 100_000
    if empty:
        return data
    def entry(id_, note, category=UNCAT, type_='expense', amount=2000):
        return {'id': id_, 'date': '2026-10-31', 'type': type_, 'walletId': 'bank',
                'amount': amount, 'category': category, 'note': note}
    data['state']['entries'] = [
        entry('hop', 'POS HOP SCOOTER REF101'),
        entry('food', 'POS TRENDYOL YEMEK REF102'),
        entry('market', 'POS TRENDYOL MARKET REF103'),
        entry('plus', 'POS TRENDYOL PLUS REF104'),
        entry('generic', 'POS TRENDYOL REF105'),
        entry('manual', 'POS TRENDYOL YEMEK REF106', 'Pendidikan'),
        entry('refund', 'POS HOP SCOOTER IADE REF107'),
        entry('pending', 'POS HOP SCOOTER REF108', type_='unreviewed', amount=-2000),
        entry('unknown', 'POS SHOPPING UNKNOWN REF109'),
    ]
    return data


class Case:
    def __init__(self, browser, args, name, *, settings=MISSING, width=1440, theme='light', empty=False):
        self.args, self.name = args, name
        self.errors, self.byte_checks, self.semantic_checks = [], 0, 0
        self.financial_raw = compact(pack_fixture(empty))
        self.settings_raw = None if settings is MISSING else settings if isinstance(settings, str) else compact(settings)
        parts = urlsplit(args.url)
        values = [{'name': FINANCE, 'value': self.financial_raw},
                  {'name': 'uangku:theme:v1', 'value': theme},
                  {'name': 'uangku:preferences:v1', 'value': compact({'currency': 'TRY', 'lastWallets': {'TRY': 'bank'}})}]
        if self.settings_raw is not None:
            values.append({'name': SETTINGS, 'value': self.settings_raw})
        self.context = browser.new_context(
            viewport={'width': width, 'height': 1000 if width > 600 else 844},
            is_mobile=width < 600, has_touch=width < 600, color_scheme=theme,
            timezone_id='Europe/Istanbul', accept_downloads=True,
            storage_state={'cookies': [], 'origins': [{'origin': f'{parts.scheme}://{parts.netloc}', 'localStorage': values}]})
        self.page = self.new_page()
        self.page.goto(args.url, wait_until='networkidle')
        nav(self.page, 'Transaksi')

    def new_page(self):
        page = new_page(self.context)
        page.set_default_timeout(12_000)
        page.on('pageerror', lambda error: self.errors.append(str(error)))
        return page

    def settings_text(self):
        return self.page.evaluate('(key)=>localStorage.getItem(key)', SETTINGS)

    def settings_value(self):
        return json.loads(self.settings_text())

    def unchanged(self, *, settings=True):
        assert self.page.evaluate('(key)=>localStorage.getItem(key)', FINANCE) == self.financial_raw
        if settings:
            assert self.settings_text() == self.settings_raw, 'Read-only keyword overlay wrote configuration'
        self.byte_checks += 1

    def manager(self, page=None):
        page = page or self.page
        page.get_by_role('button', name='Kelola kategori', exact=True).click()
        dialog = page.get_by_role('dialog', name='Kelola kategori', exact=True)
        expect(dialog).to_be_visible()
        return dialog

    def save(self, dialog):
        dialog.get_by_role('button', name='Simpan pengaturan', exact=True).click()
        expect(dialog).to_have_count(0)

    def automation(self):
        self.page.get_by_role('button', name='Isi kategori otomatis', exact=True).click()
        dialog = self.page.get_by_role('dialog', name='Isi kategori otomatis', exact=True)
        expect(dialog).to_be_visible()
        return dialog

    def screenshot(self, state):
        assert not self.page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
        dialog = self.page.get_by_role('dialog')
        if dialog.count():
            assert not dialog.evaluate('(el)=>el.scrollWidth>el.clientWidth+1')
        self.page.screenshot(path=str(self.args.output / f'{self.name}-{state}.png'))


def row_for(dialog, note):
    row = dialog.locator('.category-automation-row').filter(has_text=note)
    expect(row).to_have_count(1)
    return row


def assert_manual_rules(settings, original):
    by_id = {rule['id']: rule for rule in settings['rules']}
    for rule in original['rules']:
        assert by_id[rule['id']] == rule, 'A manual rule changed during keyword upgrade/save'
        for field in ['id', 'keyword', 'category', 'mode']:
            assert by_id[rule['id']][field].encode('utf-8') == rule[field].encode('utf-8')


def fresh_defaults(case):
    p = case.page
    before = stored_document(p)
    case.unchanged()
    dialog = case.manager()
    expect(dialog.locator('.category-manager-rules li')).to_have_count(81)
    case.screenshot('manager')
    dialog.get_by_role('button', name='Batal', exact=True).click()
    dialog = case.automation()
    for note, category in [('POS HOP SCOOTER REF101', 'Scooter'),
                           ('POS TRENDYOL YEMEK REF102', 'Makan & minum'),
                           ('POS TRENDYOL MARKET REF103', 'Bahan makanan'),
                           ('POS TRENDYOL PLUS REF104', 'Langganan'),
                           ('POS TRENDYOL REF105', 'Belanja online')]:
        expect(row_for(dialog, note).get_by_role('combobox')).to_have_value(category)
    for note in ['POS HOP SCOOTER IADE REF107', 'POS HOP SCOOTER REF108']:
        expect(row_for(dialog, note).get_by_role('combobox')).to_have_value('')
    assert dialog.locator('.category-automation-row').filter(has_text='POS TRENDYOL YEMEK REF106').count() == 0
    assert dialog.locator('.category-automation-row').filter(has_text='POS SHOPPING UNKNOWN REF109').count() == 0
    case.unchanged()
    case.screenshot('automation')
    dialog.get_by_role('button', name='Terapkan 5 kategori', exact=True).click()
    expect(dialog).to_have_count(0)
    after = stored_document(p)
    assert without_categories(after) == without_categories(before)
    entries = {row['id']: row for row in after['state']['entries']}
    assert entries['manual']['category'] == 'Pendidikan'
    assert entries['generic']['category'] == 'Belanja online' and entries['refund']['category'] == UNCAT
    assert entries['pending']['category'] == UNCAT and entries['pending']['type'] == 'unreviewed'
    assert case.settings_text() is None, 'Applying categories persisted untouched default settings'
    case.semantic_checks += 1


def legacy_overlay(case):
    original = legacy_settings()
    case.unchanged()
    dialog = case.automation()
    expect(row_for(dialog, 'POS HOP SCOOTER REF101').get_by_role('combobox')).to_have_value('Scooter')
    dialog.get_by_role('button', name='Batal', exact=True).click()
    case.unchanged()
    dialog = case.manager()
    assert dialog.locator('.category-manager-rules li').count() > len(original['rules'])
    case.unchanged()
    case.save(dialog)
    saved = case.settings_value()
    assert saved['keywordPackVersion'] == 5 and saved['names'][:len(original['names'])] == original['names']
    assert set(saved['names']) - set(original['names']) == {'Belanja online', 'Pembayaran Apple', 'Scooter', 'Tarik tunai', 'Setor tunai', 'Transfer', 'Cashback'}
    assert_manual_rules(saved, original)
    assert any(rule['id'] == 'keyword-pack-hop-scooter' for rule in saved['rules'])
    case.unchanged(settings=False)
    case.page.reload(wait_until='networkidle')
    assert case.settings_value() == saved
    case.unchanged(settings=False)


def archived_category(case):
    original = legacy_settings()
    original['names'].remove('Transportasi')
    dialog = case.automation()
    assert dialog.locator('.category-automation-row').filter(has_text='POS HOP SCOOTER REF101').count() == 0
    dialog.get_by_role('button', name='Batal', exact=True).click()
    case.unchanged()
    dialog = case.manager()
    assert dialog.locator('.category-manager-names li').filter(has_text='Transportasi').count() == 0
    case.save(dialog)
    saved = case.settings_value()
    assert 'Transportasi' not in saved['names']
    assert not any(rule['id'].startswith('keyword-pack-hop-') for rule in saved['rules'])
    assert_manual_rules(saved, original)
    case.unchanged(settings=False)


def custom_keyword(case):
    original = legacy_settings()
    custom = {'id': 'my-hop-manual', 'keyword': 'HOP SCOOTER', 'category': 'Pendidikan', 'mode': 'suggest'}
    original['rules'].append(custom)
    dialog = case.automation()
    row = row_for(dialog, 'POS HOP SCOOTER REF101')
    expect(row.get_by_role('combobox')).to_have_value('')
    expect(row).to_contain_text('Pendidikan')
    assert 'Transportasi' not in ' '.join(row.locator('.field-help').all_text_contents())
    dialog.get_by_role('button', name='Batal', exact=True).click()
    case.unchanged()
    dialog = case.manager()
    case.save(dialog)
    saved = case.settings_value()
    assert_manual_rules(saved, original)
    assert not any(rule['id'] == 'keyword-pack-hop-scooter' for rule in saved['rules'])
    case.unchanged(settings=False)


def manual_generic(case):
    original = legacy_settings()
    custom = {'id': 'my-trendyol-rule', 'keyword': 'TRENDYOL', 'category': 'Pendidikan', 'mode': 'auto'}
    original['rules'].append(custom)
    dialog = case.automation()
    for note, category in [('POS TRENDYOL YEMEK REF102', 'Makan & minum'), ('POS TRENDYOL MARKET REF103', 'Bahan makanan')]:
        row = row_for(dialog, note)
        expect(row.get_by_role('combobox')).to_have_value('')
        reasons = ' '.join(row.locator('.field-help').all_text_contents())
        assert 'Pendidikan' in reasons and category in reasons, reasons
    dialog.get_by_role('button', name='Batal', exact=True).click()
    case.unchanged()
    dialog = case.manager()
    case.save(dialog)
    assert_manual_rules(case.settings_value(), original)
    case.unchanged(settings=False)


def broad_manual_suggestion(case):
    original = legacy_settings()
    original['rules'].append({'id': 'my-broad-hop-suggestion', 'keyword': 'HOP', 'category': 'Transportasi', 'mode': 'suggest'})
    dialog = case.automation()
    row = row_for(dialog, 'POS HOP SCOOTER REF101')
    expect(row.get_by_role('combobox')).to_have_value('')
    expect(row).to_contain_text('Transportasi')
    expect(row.locator('.field-help').filter(has_text='Saran')).to_have_count(1)
    dialog.get_by_role('button', name='Batal', exact=True).click()
    case.unchanged()
    dialog = case.manager()
    case.save(dialog)
    saved = case.settings_value()
    assert_manual_rules(saved, original)
    assert any(rule['id'] == 'keyword-pack-hop-scooter' for rule in saved['rules'])
    case.page.reload(wait_until='networkidle'); nav(case.page, 'Transaksi')
    dialog = case.automation()
    expect(row_for(dialog, 'POS HOP SCOOTER REF101').get_by_role('combobox')).to_have_value('')
    case.unchanged(settings=False)


def deleted_rule(case):
    p = case.page
    dialog = case.manager()
    row = dialog.locator('.category-manager-rules li:has(input[value="HOP SCOOTER"])')
    expect(row).to_have_count(1)
    row.get_by_role('button', name=re.compile('^Hapus aturan ')).click()
    path = case.args.output / 'deleted-pack-rule-settings.json'
    with p.expect_download() as download:
        dialog.get_by_role('button', name='Ekspor pengaturan kategori', exact=True).click()
    download.value.save_as(path)
    exported = json.loads(path.read_text(encoding='utf-8'))
    assert exported['settings']['keywordPackVersion'] == 5
    case.save(dialog)
    assert not any(rule['id'] == 'keyword-pack-hop-scooter' for rule in case.settings_value()['rules'])
    p.reload(wait_until='networkidle'); nav(p, 'Transaksi')
    dialog = case.manager()
    assert dialog.locator('.category-manager-rules li:has(input[value="HOP SCOOTER"])').count() == 0
    dialog.get_by_label('Kata kunci aturan baru', exact=True).fill('HOP SCOOTER')
    dialog.get_by_label('Kategori aturan baru', exact=True).select_option('Transportasi')
    dialog.get_by_role('button', name='Tambah aturan', exact=True).click()
    case.save(dialog)
    assert any(rule['keyword'] == 'HOP SCOOTER' for rule in case.settings_value()['rules'])
    dialog = case.manager()
    dialog.get_by_label('File pengaturan kategori', exact=True).set_input_files(path)
    expect(dialog.get_by_role('status')).to_contain_text('Belum mengganti pengaturan tersimpan')
    case.save(dialog)
    p.reload(wait_until='networkidle'); nav(p, 'Transaksi')
    assert case.settings_value() == exported['settings']
    dialog = case.automation()
    assert dialog.locator('.category-automation-row').filter(has_text='POS HOP SCOOTER REF101').count() == 0
    case.unchanged(settings=False)


def corrupt_settings(case):
    expect(case.page.locator('.category-toolbar .notice.warning')).to_contain_text('Pencocokan otomatis dihentikan')
    dialog = case.automation()
    expect(dialog.locator('.category-automation-row')).to_have_count(0)
    case.unchanged()


def legacy_quota(case):
    p = case.page
    p.evaluate('''()=>{const set=Storage.prototype.setItem;window.rejectPackSave=true;
        Storage.prototype.setItem=function(key,value){if(key==='uangku:categories:v1'&&window.rejectPackSave)
        throw new DOMException('Synthetic keyword quota','QuotaExceededError');return set.call(this,key,value);};}''')
    dialog = case.automation()
    expect(row_for(dialog, 'POS HOP SCOOTER REF101').get_by_role('combobox')).to_have_value('Scooter')
    dialog.get_by_role('button', name='Batal', exact=True).click()
    dialog = case.manager()
    dialog.get_by_role('button', name='Simpan pengaturan', exact=True).click()
    expect(dialog.get_by_role('alert')).to_be_visible()
    case.unchanged()
    assert 'keywordPackVersion' not in case.settings_value()
    p.evaluate('window.rejectPackSave=false')
    case.save(dialog)
    assert case.settings_value()['keywordPackVersion'] == 5
    assert_manual_rules(case.settings_value(), legacy_settings())
    case.unchanged(settings=False)


def legacy_cas(case):
    p = case.page
    second = case.new_page()
    second.goto(case.args.url, wait_until='networkidle'); nav(second, 'Transaksi')
    first_dialog, second_dialog = case.manager(), case.manager(second)
    first_dialog.get_by_label('Nama kategori baru', exact=True).fill('Kategori tab pertama')
    first_dialog.get_by_role('button', name='Tambah kategori', exact=True).click()
    second_dialog.get_by_label('Nama kategori baru', exact=True).fill('Kategori tab usang')
    second_dialog.get_by_role('button', name='Tambah kategori', exact=True).click()
    case.save(first_dialog)
    saved_text = case.settings_text()
    second_dialog.get_by_role('button', name='Simpan pengaturan', exact=True).click()
    expect(second_dialog.get_by_role('alert')).to_be_visible()
    assert case.settings_text() == saved_text
    assert case.settings_value()['keywordPackVersion'] == 5
    assert 'Kategori tab pertama' in case.settings_value()['names'] and 'Kategori tab usang' not in case.settings_value()['names']
    assert_manual_rules(case.settings_value(), legacy_settings())
    case.unchanged(settings=False)


def capacity_fallback(case):
    expect(case.page.locator('.category-toolbar .notice.warning')).to_contain_text('Pengaturan lama tetap dipakai')
    dialog = case.automation()
    expect(dialog.locator('.category-automation-row')).to_have_count(0)
    case.unchanged()
    assert len(case.settings_value()['rules']) == 200 and 'keywordPackVersion' not in case.settings_value()


def pack_import(case):
    p = case.page
    path = case.args.output / 'keyword-pack-synthetic.xlsx'
    rows = [['Synthetic only'], ['Currency', 'TL'], *[[] for _ in range(9)],
            ['Tarih', 'Fiş No', 'Açıklama', 'İşlem Tutarı', 'Bakiye'],
            ['31.10.2026', 'SYNTH-HOP', 'POS HOP SCOOTER REF-A', -20, 80],
            ['31.10.2026', 'SYNTH-FOOD', 'POS TRENDYOL YEMEK REF-B', -5, 75],
            ['31.10.2026', 'SYNTH-GENERIC', 'POS TRENDYOL REF-C', -3, 72],
            ['31.10.2026', 'SYNTH-MARKET', 'POS TRENDYOL MARKET REF-D', -2, 70]]
    xml = ''.join('<row>' + ''.join(f'<c t="{"n" if isinstance(value, (int, float)) else "str"}"><v>{escape(str(value))}</v></c>' for value in row) + '</row>' for row in rows)
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
        archive.writestr('xl/workbook.xml', f'<workbook {ns}><workbookPr date1904="0"/></workbook>')
        archive.writestr('xl/worksheets/sheet1.xml', f'<worksheet {ns}><sheetData>{xml}</sheetData></worksheet>')
    nav(p, 'Impor mutasi')
    p.get_by_label('Dompet impor', exact=True).select_option('bank')
    p.get_by_label('File mutasi Ziraat', exact=True).set_input_files(path)
    expect(p.get_by_role('heading', name='Periksa sebelum disimpan', exact=True)).to_be_visible()
    table_rows = p.locator('.import-table tbody tr')
    for note, category in [('POS HOP SCOOTER REF-A', 'Scooter'), ('POS TRENDYOL YEMEK REF-B', 'Makan & minum'),
                           ('POS TRENDYOL MARKET REF-D', 'Bahan makanan'), ('POS TRENDYOL REF-C', 'Belanja online')]:
        expect(table_rows.filter(has_text=note).locator('.import-row-category')).to_have_value(category)
    table_rows.filter(has_text='POS TRENDYOL YEMEK REF-B').locator('.import-row-category').select_option('Pendidikan')
    p.get_by_role('button', name='Simpan 4 transaksi', exact=True).click()
    expect(p.get_by_role('heading', name='Periksa sebelum disimpan', exact=True)).to_have_count(0)
    data = stored_document(p)
    assert len(data['state']['entries']) == len(data['metadata']['facts']) == 4
    entries = {entry['note']: entry for entry in data['state']['entries']}
    assert entries['POS HOP SCOOTER REF-A']['category'] == 'Scooter'
    assert entries['POS TRENDYOL YEMEK REF-B']['category'] == 'Pendidikan'
    assert entries['POS TRENDYOL MARKET REF-D']['category'] == 'Bahan makanan'
    assert entries['POS TRENDYOL REF-C']['category'] == 'Belanja online'
    assert {fact['description'] for fact in data['metadata']['facts']} == set(entries)
    assert {fact['signedAmount'] for fact in data['metadata']['facts']} == {-2000, -500, -300, -200}
    assert case.settings_text() is None
    case.semantic_checks += 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--url', default=os.environ.get('UANGKU_TEST_URL', 'http://127.0.0.1:4180'))
    parser.add_argument('--only', default='')
    args = parser.parse_args()
    args.output = args.output.resolve(); args.output.mkdir(parents=True, exist_ok=True)
    build = assert_production_url(args.url)
    archived = legacy_settings(); archived['names'].remove('Transportasi')
    custom = legacy_settings(); custom['rules'].append({'id': 'my-hop-manual', 'keyword': 'HOP SCOOTER', 'category': 'Pendidikan', 'mode': 'suggest'})
    generic = legacy_settings(); generic['rules'].append({'id': 'my-trendyol-rule', 'keyword': 'TRENDYOL', 'category': 'Pendidikan', 'mode': 'auto'})
    broad = legacy_settings(); broad['rules'].append({'id': 'my-broad-hop-suggestion', 'keyword': 'HOP', 'category': 'Transportasi', 'mode': 'suggest'})
    full = legacy_settings(); full['rules'] = [{'id': f'custom-{i}', 'keyword': f'PAYEE {i:03}', 'category': 'Pendidikan', 'mode': 'suggest'} for i in range(200)]
    cases = [('fresh-default-desktop', {}, fresh_defaults),
             ('fresh-default-mobile-dark', {'width': 390, 'theme': 'dark'}, fresh_defaults),
             ('legacy-effective-overlay-explicit-save', {'settings': legacy_settings()}, legacy_overlay),
             ('archived-category-not-reintroduced', {'settings': archived}, archived_category),
             ('manual-hop-keyword-suppresses-pack', {'settings': custom}, custom_keyword),
             ('manual-trendyol-generic-stays-conflicting', {'settings': generic}, manual_generic),
             ('manual-broad-hop-suggest-not-upgraded-to-auto', {'settings': broad}, broad_manual_suggestion),
             ('deleted-pack-rule-export-reload-import', {}, deleted_rule),
             ('corrupt-settings-stop-automatic-matching', {'settings': '{bad'}, corrupt_settings),
             ('legacy-overlay-quota-retry', {'settings': legacy_settings()}, legacy_quota),
             ('legacy-overlay-stale-tab-CAS', {'settings': legacy_settings()}, legacy_cas),
             ('legacy-capacity-fallback-preserves-original', {'settings': full}, capacity_fallback),
             ('fresh-pack-synthetic-XLSX-import', {'empty': True}, pack_import)]
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
              'scope': 'Chromium desktop and mobile emulation; no personal file or physical-device access',
              'results': results, 'passed': bool(results) and all(row['status'] == 'passed' for row in results) and identity['passed']}
    (args.output / 'summary.json').write_bytes((json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    print(compact({'passed': sum(row['status'] == 'passed' for row in results), 'failed': sum(row['status'] != 'passed' for row in results), 'dist_sha256': build}), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
