"""Synthetic production checks for user-confirmed merchant mappings and pack v2.

Fixtures model prior v1 settings explicitly. Original bank files and personal
backups are never loaded; the source scenario creates its own XLSX workbook.
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

EXPECTED = [
    ('trendyol', 'POS TRENDYOL CONF001', 'Belanja online'),
    ('apple-bill', 'POS APPLE.COM/BILL CONF002', 'Pembayaran Apple'),
    ('apple-general', 'POS APPLE.COM CONF003', 'Pembayaran Apple'),
    ('hop', 'POS HOP SCOOTER CONF004', 'Scooter'),
    ('hop-short', 'POS HOP SCOOT CONF005', 'Scooter'),
    ('composite', 'POS UBERTRENDYOLGOGETIRY CONF006', 'Makan & minum'),
    ('composite-typo', 'POS UBERTRENYOLGOGETIR CONF007', 'Makan & minum'),
    ('composite-typo-y', 'POS UBERTRENYOLGOGETIRY CONF008', 'Makan & minum'),
    ('uber-eats', 'POS UBER EATS YEMEK CONF009', 'Makan & minum'),
    ('uber-eat', 'POS UBER EAT YEMEK CONF010', 'Makan & minum'),
    ('yemek-joined', 'POS YEMEKSEPETI CONF011', 'Makan & minum'),
    ('yemek-spaced', 'POS YEMEK SEPETI CONF012', 'Makan & minum'),
    ('yemek-old', 'POS YEMEK SEPET CONF013', 'Makan & minum'),
    ('youtube', 'POS GOOGLE YOUTUBE CONF014', 'Langganan'),
    ('trendyol-food', 'POS TRENDYOL YEMEK CONF022', 'Makan & minum'),
    ('trendyol-market', 'POS TRENDYOL MARKET CONF023', 'Bahan makanan'),
    ('trendyol-plus', 'POS TRENDYOL PLUS CONF024', 'Langganan'),
]
SUGGESTED = [('yemekpay', 'POS YEMEKPAY CONF015'),
             ('refund', 'POS TRENDYOL IADE CONF016'),
             ('pending', 'POS HOP SCOOTER CONF017'),
             ('uber-ride', 'POS UBER RIDES CONF025')]
BUILTIN_UPDATES = {
    'shopping-trendyol': ('Belanja online', 'auto'),
    'subscription-apple': ('Pembayaran Apple', 'auto'),
    'keyword-pack-hop-scooter': ('Scooter', 'auto'),
    'keyword-pack-hop-scoot': ('Scooter', 'auto'),
    'keyword-pack-composite-delivery': ('Makan & minum', 'auto'),
    'keyword-pack-yemek-sepet': ('Makan & minum', 'auto'),
    'keyword-pack-youtube-generic': ('Langganan', 'auto'),
}


def v1_settings():
    return {'version': 1, 'keywordPackVersion': 1,
            'names': [UNCAT, 'Belanja', 'Makan & minum', 'Transportasi', 'Langganan',
                      'Pendidikan', 'Bahan makanan', 'Hiburan', 'Kategori pribadi'],
            'rules': [
                {'id': 'shopping-trendyol', 'keyword': 'TRENDYOL', 'category': 'Belanja', 'mode': 'suggest'},
                {'id': 'subscription-apple', 'keyword': 'APPLE.COM/BILL', 'category': 'Langganan', 'mode': 'suggest'},
                {'id': 'keyword-pack-hop-scooter', 'keyword': 'HOP SCOOTER', 'category': 'Transportasi', 'mode': 'auto'},
                {'id': 'keyword-pack-hop-scoot', 'keyword': 'HOP SCOOT', 'category': 'Transportasi', 'mode': 'auto'},
                {'id': 'keyword-pack-composite-delivery', 'keyword': 'UBERTRENDYOLGOGETIRY', 'category': 'Makan & minum', 'mode': 'suggest'},
                {'id': 'keyword-pack-yemek-sepet', 'keyword': 'YEMEK SEPET', 'category': 'Makan & minum', 'mode': 'suggest'},
                {'id': 'keyword-pack-youtube-generic', 'keyword': 'GOOGLE YOUTUBE', 'category': 'Hiburan', 'mode': 'suggest'},
                {'id': 'keyword-pack-yemekpay', 'keyword': 'YEMEKPAY', 'category': 'Makan & minum', 'mode': 'suggest'},
                {'id': 'my-custom', 'keyword': 'PRIVATE LITERAL MERCHANT', 'category': 'Kategori pribadi', 'mode': 'suggest'},
            ]}


def confirmed_fixture(empty=False):
    data = fixture(empty=True)
    data['state']['wallets'][0]['openingBalance'] = 500_000
    if empty:
        return data
    entries = [{'id': id_, 'date': '2026-10-31', 'type': 'expense', 'walletId': 'bank',
                'amount': 1000, 'category': UNCAT, 'note': note} for id_, note, _ in EXPECTED]
    entries += [{'id': id_, 'date': '2026-10-31', 'type': 'unreviewed' if id_ == 'pending' else 'expense',
                 'walletId': 'bank', 'amount': -1000 if id_ == 'pending' else 1000,
                 'category': UNCAT, 'note': note} for id_, note in SUGGESTED]
    entries += [{'id': id_, 'date': '2026-10-31', 'type': 'expense', 'walletId': 'bank',
                 'amount': 1000, 'category': category, 'note': note} for id_, note, category in [
                     ('manual-hop', 'POS HOP SCOOTER MANUAL', 'Transportasi'),
                     ('manual-apple', 'POS APPLE.COM/BILL MANUAL', 'Langganan'),
                     ('manual-trendyol', 'POS TRENDYOL MANUAL', 'Pendidikan'),
                     ('unknown', 'POS UNKNOWN XYZ CONF021', UNCAT)]]
    data['state']['entries'] = entries
    return data


class Case(BaseCase):
    def __init__(self, browser, args, name, *, settings=MISSING, width=1440, theme='light', empty=False):
        self.args, self.name = args, name
        self.errors, self.byte_checks, self.semantic_checks = [], 0, 0
        self.financial_raw = compact(confirmed_fixture(empty))
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


def fresh_default(case):
    p = case.page
    before = stored_document(p)
    dialog = case.manager()
    expect(dialog.locator('.category-manager-rules li')).to_have_count(81)
    expect(dialog.locator('.category-manager-names li')).to_have_count(30)
    case.screenshot('manager')
    dialog.get_by_role('button', name='Batal', exact=True).click()
    dialog = case.automation()
    expect(dialog.locator('.category-automation-row')).to_have_count(len(EXPECTED) + len(SUGGESTED))
    for _, note, category in EXPECTED:
        expect(row_for(dialog, note).get_by_role('combobox')).to_have_value(category)
    for _, note in SUGGESTED:
        expect(row_for(dialog, note).get_by_role('combobox')).to_have_value('')
    assert dialog.locator('.category-automation-row').filter(has_text='MANUAL').count() == 0
    case.unchanged()
    case.screenshot('automation')
    dialog.get_by_role('button', name=f'Terapkan {len(EXPECTED)} kategori', exact=True).click()
    expect(dialog).to_have_count(0)
    after = stored_document(p)
    assert without_categories(after) == without_categories(before)
    entries = {entry['id']: entry for entry in after['state']['entries']}
    for id_, _, category in EXPECTED:
        assert entries[id_]['category'] == category
    for id_, _ in SUGGESTED:
        assert entries[id_]['category'] == UNCAT
    assert entries['pending']['type'] == 'unreviewed' and entries['pending']['amount'] == -1000
    for id_, category in [('manual-hop', 'Transportasi'), ('manual-apple', 'Langganan'), ('manual-trendyol', 'Pendidikan')]:
        assert entries[id_]['category'] == category
    assert case.settings_text() is None
    case.semantic_checks += 1


def migrated_settings(case):
    original = v1_settings()
    case.unchanged()
    dialog = case.automation()
    for note, category in [('POS TRENDYOL CONF001', 'Belanja online'), ('POS HOP SCOOTER CONF004', 'Scooter'),
                           ('POS APPLE.COM/BILL CONF002', 'Pembayaran Apple'), ('POS GOOGLE YOUTUBE CONF014', 'Langganan')]:
        expect(row_for(dialog, note).get_by_role('combobox')).to_have_value(category)
    dialog.get_by_role('button', name='Batal', exact=True).click()
    case.unchanged()
    dialog = case.manager()
    case.save(dialog)
    saved = case.settings_value()
    assert saved['keywordPackVersion'] == 5
    assert saved['names'][:len(original['names'])] == original['names']
    assert set(saved['names']) - set(original['names']) == {'Belanja online', 'Pembayaran Apple', 'Scooter', 'Tarik tunai', 'Setor tunai', 'Transfer', 'Cashback'}
    by_id = {rule['id']: rule for rule in saved['rules']}
    for rule in original['rules']:
        if rule['id'] in BUILTIN_UPDATES:
            category, mode = BUILTIN_UPDATES[rule['id']]
            assert by_id[rule['id']] == {**rule, 'category': category, 'mode': mode}
        else:
            assert by_id[rule['id']] == rule
    additions = [rule for rule in saved['rules'] if rule['id'] not in {old['id'] for old in original['rules']}]
    assert len([rule for rule in additions if not rule['id'].startswith(('bank-v3-', 'bank-v4-', 'bank-v5-'))]) == 7
    # Three fee rules stay absent because this personal v1 catalog has no Biaya bank.
    assert len([rule for rule in additions if rule['id'].startswith(('bank-v3-', 'bank-v4-', 'bank-v5-'))]) == 14
    # The v1 marker records deliberate absence; v2 must not repopulate old packs.
    assert not {'keyword-pack-estram', 'keyword-pack-trendyol-food', 'keyword-pack-cagri-market', 'grocery-bim'} & set(by_id)
    case.unchanged(settings=False)
    case.page.reload(wait_until='networkidle')
    assert case.settings_value() == saved
    case.unchanged(settings=False)


def custom_override(case, id_, note, expected_category):
    original = json.loads(case.settings_raw)
    chosen = next(rule for rule in original['rules'] if rule['id'] == id_)
    dialog = case.automation()
    row = row_for(dialog, note)
    expect(row.get_by_role('combobox')).to_have_value('')
    assert expected_category in ' '.join(row.locator('.field-help').all_text_contents())
    dialog.get_by_role('button', name='Batal', exact=True).click()
    case.unchanged()
    dialog = case.manager()
    case.save(dialog)
    saved = case.settings_value()
    assert saved['keywordPackVersion'] == 5
    assert next(rule for rule in saved['rules'] if rule['id'] == id_) == chosen
    assert next(rule for rule in saved['rules'] if rule['id'] == 'my-custom') == next(rule for rule in original['rules'] if rule['id'] == 'my-custom')
    case.page.reload(wait_until='networkidle'); nav(case.page, 'Transaksi')
    dialog = case.automation()
    expect(row_for(dialog, note).get_by_role('combobox')).to_have_value('')
    case.unchanged(settings=False)


def deleted_category(case):
    p = case.page
    dialog = case.manager()
    dialog.get_by_role('button', name='Hapus kategori Scooter', exact=True).click()
    export_path = case.args.output / 'v2-archived-category-settings.json'
    with p.expect_download() as download:
        dialog.get_by_role('button', name='Ekspor pengaturan kategori', exact=True).click()
    download.value.save_as(export_path)
    exported = json.loads(export_path.read_text(encoding='utf-8'))
    assert exported['settings']['keywordPackVersion'] == 5 and 'Scooter' not in exported['settings']['names']
    case.save(dialog)
    p.reload(wait_until='networkidle'); nav(p, 'Transaksi')
    assert case.settings_value()['keywordPackVersion'] == 5 and 'Scooter' not in case.settings_value()['names']
    dialog = case.automation()
    assert dialog.locator('.category-automation-row').filter(has_text='POS HOP SCOOTER CONF004').count() == 0
    dialog.get_by_role('button', name='Batal', exact=True).click()
    dialog = case.manager()
    dialog.get_by_label('Nama kategori baru', exact=True).fill('Scooter')
    dialog.get_by_role('button', name='Tambah kategori', exact=True).click()
    case.save(dialog)
    assert 'Scooter' in case.settings_value()['names']
    dialog = case.manager()
    dialog.get_by_label('File pengaturan kategori', exact=True).set_input_files(export_path)
    expect(dialog.get_by_role('status')).to_contain_text('Belum mengganti pengaturan tersimpan')
    case.save(dialog)
    p.reload(wait_until='networkidle'); nav(p, 'Transaksi')
    assert case.settings_value() == exported['settings']
    case.unchanged(settings=False)


def v1_quota(case):
    p = case.page
    p.evaluate('''()=>{const set=Storage.prototype.setItem;window.blockConfirmedSave=true;
        Storage.prototype.setItem=function(key,value){if(key==='uangku:categories:v1'&&window.blockConfirmedSave)
        throw new DOMException('Synthetic confirmed-mapping quota','QuotaExceededError');return set.call(this,key,value);};}''')
    dialog = case.manager()
    dialog.get_by_role('button', name='Simpan pengaturan', exact=True).click()
    expect(dialog.get_by_role('alert')).to_be_visible()
    case.unchanged()
    assert case.settings_value()['keywordPackVersion'] == 1
    p.evaluate('window.blockConfirmedSave=false')
    case.save(dialog)
    assert case.settings_value()['keywordPackVersion'] == 5
    case.unchanged(settings=False)


def v1_cas(case):
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
    assert case.settings_text() == saved_text and case.settings_value()['keywordPackVersion'] == 5
    assert 'Kategori tab pertama' in case.settings_value()['names'] and 'Kategori tab usang' not in case.settings_value()['names']
    case.unchanged(settings=False)


def synthetic_import(case):
    p = case.page
    path = case.args.output / 'confirmed-mapping-synthetic.xlsx'
    records = [
        ('SYNTH-A', 'POS TRENDYOL SOURCE-A', -20, 80),
        ('SYNTH-B', 'POS APPLE.COM/BILL SOURCE-B', -5, 75),
        ('SYNTH-C', 'POS HOP SCOOTER SOURCE-C', -3, 72),
        ('SYNTH-D', 'POS UBERTRENYOLGOGETIRY SOURCE-D', -2, 70),
        ('SYNTH-E', 'POS GOOGLE YOUTUBE IADE SOURCE-E', 7, 77),
        ('SYNTH-F', 'POS YEMEKPAY SOURCE-F', -1, 76),
    ]
    rows = [['Synthetic only'], ['Currency', 'TL'], *[[] for _ in range(9)],
            ['Tarih', 'Fiş No', 'Açıklama', 'İşlem Tutarı', 'Bakiye'],
            *[['31.10.2026', *record] for record in records]]
    xml = ''.join('<row>' + ''.join(f'<c t="{"n" if isinstance(value, (int, float)) else "str"}"><v>{escape(str(value))}</v></c>' for value in row) + '</row>' for row in rows)
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
        archive.writestr('xl/workbook.xml', f'<workbook {ns}><workbookPr date1904="0"/></workbook>')
        archive.writestr('xl/worksheets/sheet1.xml', f'<worksheet {ns}><sheetData>{xml}</sheetData></worksheet>')
    nav(p, 'Impor mutasi')
    p.get_by_label('Dompet impor', exact=True).select_option('bank')
    p.get_by_label('File mutasi Ziraat', exact=True).set_input_files(path)
    expect(p.get_by_role('heading', name='Periksa sebelum disimpan', exact=True)).to_be_visible()
    rows = p.locator('.import-table tbody tr')
    expected = [('POS TRENDYOL SOURCE-A', 'Belanja online'), ('POS APPLE.COM/BILL SOURCE-B', 'Pembayaran Apple'),
                ('POS HOP SCOOTER SOURCE-C', 'Scooter'), ('POS UBERTRENYOLGOGETIRY SOURCE-D', 'Makan & minum'),
                ('POS GOOGLE YOUTUBE IADE SOURCE-E', UNCAT), ('POS YEMEKPAY SOURCE-F', UNCAT)]
    for note, category in expected:
        expect(rows.filter(has_text=note).locator('.import-row-category')).to_have_value(category)
    rows.filter(has_text='POS TRENDYOL SOURCE-A').locator('.import-row-category').select_option('Pendidikan')
    expect(rows.filter(has_text='POS GOOGLE YOUTUBE IADE SOURCE-E').locator('select').first).to_have_value('unreviewed')
    p.get_by_role('button', name='Simpan 6 transaksi', exact=True).click()
    expect(p.get_by_role('heading', name='Periksa sebelum disimpan', exact=True)).to_have_count(0)
    data = stored_document(p)
    assert len(data['state']['entries']) == len(data['metadata']['facts']) == 6
    entries = {entry['note']: entry for entry in data['state']['entries']}
    for note, category in expected:
        assert entries[note]['category'] == ('Pendidikan' if note == 'POS TRENDYOL SOURCE-A' else category)
    assert entries['POS GOOGLE YOUTUBE IADE SOURCE-E']['type'] == 'unreviewed'
    assert entries['POS GOOGLE YOUTUBE IADE SOURCE-E']['amount'] == 700
    assert {fact['description'] for fact in data['metadata']['facts']} == set(entries)
    assert {fact['signedAmount'] for fact in data['metadata']['facts']} == {-2000, -500, -300, -200, 700, -100}
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
    trendyol = v1_settings(); trendyol['rules'][0].update(category='Pendidikan', mode='suggest')
    hop = v1_settings(); hop['names'].append('Scooter'); hop['rules'][2].update(category='Scooter', mode='suggest')
    apple = v1_settings(); apple['rules'][1].update(category='Pendidikan', mode='suggest')
    cases = [
        ('confirmed-default-desktop', {}, fresh_default),
        ('confirmed-default-mobile-dark', {'width': 390, 'theme': 'dark'}, fresh_default),
        ('v1-builtins-upgraded-readonly-until-save', {'settings': v1_settings()}, migrated_settings),
        ('custom-trendyol-rule-preserved', {'settings': trendyol}, lambda case: custom_override(case, 'shopping-trendyol', 'POS TRENDYOL CONF001', 'Pendidikan')),
        ('custom-hop-suggestion-preserved', {'settings': hop}, lambda case: custom_override(case, 'keyword-pack-hop-scooter', 'POS HOP SCOOTER CONF004', 'Scooter')),
        ('custom-apple-rule-preserved', {'settings': apple}, lambda case: custom_override(case, 'subscription-apple', 'POS APPLE.COM/BILL CONF002', 'Pendidikan')),
        ('v2-category-deletion-export-reload-import', {}, deleted_category),
        ('v1-migration-quota-retains-old-marker', {'settings': v1_settings()}, v1_quota),
        ('v1-migration-stale-tab-CAS', {'settings': v1_settings()}, v1_cas),
        ('confirmed-synthetic-XLSX-manual-override-pending', {'empty': True}, synthetic_import),
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
              'scope': 'Chromium desktop/mobile emulation; no real financial file or external service used',
              'results': results, 'passed': bool(results) and all(row['status'] == 'passed' for row in results) and identity['passed']}
    (args.output / 'summary.json').write_bytes((json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    print(compact({'passed': sum(row['status'] == 'passed' for row in results), 'failed': sum(row['status'] != 'passed' for row in results), 'dist_sha256': build}), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
