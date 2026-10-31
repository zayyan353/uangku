"""Synthetic production-browser coverage for categories and local literal rules.

No personal statement or financial backup is read. Each case uses a fresh browser
context; source metadata is created through the real synthetic XLSX import UI.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
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
                             launch_browser, new_page, read_document, stored_document)
install_playwright_path()
from playwright.sync_api import sync_playwright, expect
from theme_browser import TEXT_CONTRAST_JS, CONTROL_CONTRAST_JS

FINANCE = 'uangku:v1'
SETTINGS = 'uangku:categories:v1'
UNCAT = 'Belum dikategorikan'


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def settings_fixture():
    return {'version': 1, 'keywordPackVersion': 4,
            'names': [UNCAT, 'Bahan makanan', 'Makan & minum', 'Transportasi',
                      'Kesehatan', 'Pendidikan', 'Kategori lama'],
            'rules': [
                {'id': 'bim', 'keyword': 'BİM', 'category': 'Bahan makanan', 'mode': 'auto'},
                {'id': 'eczane', 'keyword': 'ECZANESİ', 'category': 'Kesehatan', 'mode': 'auto'},
                {'id': 'uber', 'keyword': 'UBER', 'category': 'Transportasi', 'mode': 'suggest'},
                {'id': 'conflict-a', 'keyword': 'KEDAI', 'category': 'Makan & minum', 'mode': 'auto'},
                {'id': 'conflict-b', 'keyword': 'KEDAI ALPHA', 'category': 'Transportasi', 'mode': 'auto'},
                {'id': 'historical', 'keyword': 'WARISAN', 'category': 'Kategori lama', 'mode': 'auto'},
            ]}


def fixture(empty=False):
    def entry(id_, note, category=UNCAT, type_='expense', amount=2000, **extra):
        return {'id': id_, 'date': '2026-10-31', 'type': type_, 'walletId': 'bank',
                'amount': amount, 'category': category, 'note': note, **extra}
    entries = [] if empty else [
        entry('auto', 'POS BİM MARKET 123'),
        entry('pending', 'POS ECZANESİ HEALTH 456', type_='unreviewed', amount=-1000),
        entry('suggest', 'POS UBER TRIP 789'),
        entry('conflict', 'POS KEDAI ALPHA 987'),
        entry('unknown', 'POS UNKNOWN QRS 654'),
        entry('manual', 'POS MİGROS MANUAL', 'Pendidikan'),
        entry('historical', 'Historical category retained', 'Kategori lama'),
        entry('transfer', 'POS BİM transfer protected', '', 'transfer', 100,
              toWalletId='cash', toAmount=100),
        entry('adjustment', 'POS BİM adjustment protected', '', 'adjustment', 50),
    ]
    return {'app': 'uangku', 'version': 1, 'demo': False, 'state': {'version': 1,
            'wallets': [{'id': 'bank', 'name': 'Synthetic Ziraat', 'currency': 'TRY',
                         'kind': 'bank', 'openingBalance': 100_000 if not empty else 0},
                        {'id': 'cash', 'name': 'Synthetic second bank', 'currency': 'TRY',
                         'kind': 'bank', 'openingBalance': 0}], 'entries': entries}}


def nav(page, label):
    scope = page.locator('.sidebar' if page.locator('.sidebar').is_visible() else '.mobile-nav')
    scope.get_by_role('button', name=re.compile('^' + re.escape(label) + r'(?:\s+\d+)?$')).click()


def without_categories(data):
    result = copy.deepcopy(data)
    for entry in result['state']['entries']:
        entry.pop('category', None)
    for annotation in result.get('metadata', {}).get('annotations', []):
        annotation.pop('category', None)
    return result


class Case:
    def __init__(self, browser, args, name, *, width=1440, theme='light', empty=False):
        self.args, self.name, self.width = args, name, width
        self.errors, self.contrasts = [], []
        self.byte_comparisons, self.semantic_comparisons = 0, 0
        self.raw = compact(fixture(empty))
        self.settings_raw = compact(settings_fixture())
        parts = urlsplit(args.url)
        self.context = browser.new_context(
            viewport={'width': width, 'height': 1000 if width > 600 else 844},
            is_mobile=width < 600, has_touch=width < 600, color_scheme=theme,
            timezone_id='Europe/Istanbul', accept_downloads=True,
            storage_state={'cookies': [], 'origins': [{'origin': f'{parts.scheme}://{parts.netloc}',
                'localStorage': [{'name': FINANCE, 'value': self.raw},
                    {'name': SETTINGS, 'value': self.settings_raw},
                    {'name': 'uangku:theme:v1', 'value': theme},
                    {'name': 'uangku:preferences:v1', 'value': compact({'currency': 'TRY', 'lastWallets': {'TRY': 'bank'}})}]}]})
        self.page = self.new_page()
        self.page.goto(args.url, wait_until='networkidle')
        expect(self.page.get_by_label('Tema tampilan', exact=True)).to_be_visible()
        self.before_preferences = self.page.evaluate("localStorage.getItem('uangku:preferences:v1')")
        nav(self.page, 'Transaksi')

    def new_page(self):
        page = new_page(self.context)
        page.set_default_timeout(12_000)
        page.on('pageerror', lambda error: self.errors.append(str(error)))
        return page

    def unchanged(self, raw=None):
        assert self.page.evaluate('(key)=>localStorage.getItem(key)', FINANCE) == (self.raw if raw is None else raw), 'Settings action changed financial storage'
        assert self.page.evaluate("localStorage.getItem('uangku:preferences:v1')") == self.before_preferences
        self.byte_comparisons += 1

    def manager(self, page=None):
        page = page or self.page
        page.get_by_role('button', name='Kelola kategori', exact=True).click()
        dialog = page.get_by_role('dialog', name='Kelola kategori', exact=True)
        expect(dialog).to_be_visible()
        return dialog

    def add_name(self, dialog, name):
        dialog.get_by_label('Nama kategori baru', exact=True).fill(name)
        dialog.get_by_role('button', name='Tambah kategori', exact=True).click()
        expect(dialog.locator('.category-manager-names li').filter(has_text=name)).to_have_count(1)

    def add_rule(self, dialog, keyword, category, mode='auto'):
        dialog.get_by_label('Kata kunci aturan baru', exact=True).fill(keyword)
        dialog.get_by_label('Kategori aturan baru', exact=True).select_option(category)
        dialog.get_by_label('Mode aturan baru', exact=True).select_option(mode)
        dialog.get_by_role('button', name='Tambah aturan', exact=True).click()

    def save_manager(self, dialog):
        dialog.get_by_role('button', name='Simpan pengaturan', exact=True).click()
        expect(dialog).to_have_count(0)

    def capture(self, state):
        page = self.page
        page.evaluate('''async()=>{await Promise.all(document.getAnimations().filter(a=>
            a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));}''')
        body = page.locator('[role=dialog] .modal-body')
        extent = body.evaluate('(el)=>Math.max(0,el.scrollHeight-el.clientHeight)')
        for offset in sorted(set([0, round(extent / 2), extent])):
            body.evaluate('(el,y)=>el.scrollTop=y', offset)
            for kind, script in [('text', TEXT_CONTRAST_JS), ('controls', CONTROL_CONTRAST_JS)]:
                report = page.evaluate(script)
                report.update({'state': state, 'kind': kind, 'scroll_offset': offset})
                self.contrasts.append(report)
                assert not report['failures'], report['failures'][:10]
        body.evaluate('(el)=>el.scrollTop=0')
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1'), state + ': page overflow'
        assert not page.get_by_role('dialog').evaluate('(el)=>el.scrollWidth>el.clientWidth+1'), state + ': dialog overflow'
        page.screenshot(path=str(self.args.output / f'{self.name}-{state}.png'))


def manager_lifecycle(case):
    p = case.page
    dialog = case.manager()
    assert dialog.get_by_role('button', name='Hapus kategori ' + UNCAT, exact=True).count() == 0
    case.add_name(dialog, 'Kopi pribadi')
    case.add_rule(dialog, 'TEHPRIBADI', 'Kopi pribadi', 'auto')
    count = dialog.locator('.category-manager-rules li').count()
    expect(dialog.get_by_label(f'Mode aturan {count}', exact=True)).to_have_value('auto')
    dialog.get_by_label(f'Mode aturan {count}', exact=True).select_option('suggest')
    dialog.get_by_role('button', name='Hapus kategori Kategori lama', exact=True).click()
    expect(dialog.get_by_text('Kategori tidak aktif.', exact=False)).to_be_visible()
    case.unchanged()
    export_path = case.args.output / f'{case.name}-settings.json'
    with p.expect_download() as download:
        dialog.get_by_role('button', name='Ekspor pengaturan kategori', exact=True).click()
    download.value.save_as(export_path)
    wrapper = json.loads(export_path.read_text(encoding='utf-8'))
    assert set(wrapper) == {'app', 'version', 'settings'} and wrapper['app'] == 'uangku-category-settings'
    assert wrapper['settings']['rules'][-1]['mode'] == 'suggest'
    case.save_manager(dialog)
    saved = p.evaluate('(key)=>JSON.parse(localStorage.getItem(key))', SETTINGS)
    assert saved == wrapper['settings'] and 'Kategori lama' not in saved['names']
    case.unchanged()
    p.reload(wait_until='networkidle')
    nav(p, 'Transaksi')
    p.get_by_role('button', name='Ubah Historical category retained', exact=True).click()
    edit = p.get_by_role('dialog')
    expect(edit.get_by_label(re.compile('^Kategori'))).to_have_value('Kategori lama')
    edit.get_by_role('button', name='Batal', exact=True).click()
    case.unchanged()
    dialog = case.manager()
    dialog.get_by_role('button', name='Hapus kategori Kopi pribadi', exact=True).click()
    dialog.get_by_role('button', name=f'Hapus aturan {len(saved["rules"])}: TEHPRIBADI', exact=True).click()
    case.save_manager(dialog)
    assert not any(rule['keyword'] == 'TEHPRIBADI' for rule in p.evaluate('(key)=>JSON.parse(localStorage.getItem(key)).rules', SETTINGS))
    dialog = case.manager()
    dialog.get_by_label('File pengaturan kategori', exact=True).set_input_files(export_path)
    expect(dialog.get_by_role('status')).to_contain_text('Belum mengganti pengaturan tersimpan')
    assert 'Kopi pribadi' not in p.evaluate('(key)=>JSON.parse(localStorage.getItem(key)).names', SETTINGS)
    invalid = case.args.output / f'{case.name}-invalid-settings.json'
    invalid.write_bytes(compact({**wrapper, 'instruction': 'untrusted extra field'}).encode('utf-8'))
    dialog.get_by_label('File pengaturan kategori', exact=True).set_input_files(invalid)
    expect(dialog.get_by_role('alert')).to_be_visible()
    oversized = case.args.output / f'{case.name}-oversized-settings.json'
    oversized.write_bytes(b' ' * (128 * 1024 + 1))
    dialog.get_by_label('File pengaturan kategori', exact=True).set_input_files(oversized)
    expect(dialog.get_by_role('alert')).to_contain_text('128 KiB')
    expect(dialog.locator('.category-manager-names li').filter(has_text='Kopi pribadi')).to_have_count(1)
    case.save_manager(dialog)
    assert p.evaluate('(key)=>JSON.parse(localStorage.getItem(key))', SETTINGS) == saved
    case.unchanged()


def history_automation(case):
    p = case.page
    before = stored_document(p)
    p.get_by_role('button', name='Isi kategori otomatis', exact=True).click()
    dialog = p.get_by_role('dialog', name='Isi kategori otomatis', exact=True)
    rows = dialog.locator('.category-automation-row')
    expect(rows).to_have_count(4)
    expected = [('POS BİM MARKET 123', 'Bahan makanan'),
                ('POS ECZANESİ HEALTH 456', 'Kesehatan'),
                ('POS UBER TRIP 789', 'Transportasi'),
                ('POS KEDAI ALPHA 987', 'Makan & minum')]
    for note, category in expected:
        row = rows.filter(has_text=note)
        expect(row).to_have_count(1)
        expect(row.get_by_role('combobox')).to_have_value('Bahan makanan' if note == expected[0][0] else '')
        row.get_by_role('combobox').select_option(category)
    assert rows.filter(has_text='POS UNKNOWN QRS 654').count() == 0
    assert rows.filter(has_text='POS MİGROS MANUAL').count() == 0
    assert rows.filter(has_text='protected').count() == 0
    dialog.get_by_role('button', name='Terapkan 4 kategori', exact=True).click()
    expect(dialog).to_have_count(0)
    after = stored_document(p)
    assert without_categories(after) == without_categories(before)
    entries = {row['id']: row for row in after['state']['entries']}
    assert entries['auto']['category'] == 'Bahan makanan'
    assert entries['pending']['category'] == 'Kesehatan' and entries['pending']['type'] == 'unreviewed' and entries['pending']['amount'] == -1000
    assert entries['suggest']['category'] == 'Transportasi' and entries['conflict']['category'] == 'Makan & minum'
    assert entries['manual']['category'] == 'Pendidikan' and entries['unknown']['category'] == UNCAT
    p.reload(wait_until='networkidle')
    assert stored_document(p) == after
    case.semantic_comparisons += 2


def write_statement(path):
    rows = [['Synthetic only'], ['Currency', 'TL'], *[[] for _ in range(9)],
            ['Tarih', 'Fiş No', 'Açıklama', 'İşlem Tutarı', 'Bakiye'],
            ['31.10.2026', 'SYNTH-A', 'POS BİM MARKET', -20, 80],
            ['31.10.2026', 'SYNTH-B', 'POS UNKNOWN QRS', -5, 75],
            ['31.10.2026', 'SYNTH-C', 'FAST GELEN SYNTHETIC', 10, 85],
            ['31.10.2026', 'SYNTH-D', 'POS UBER TRIP', -3, 82]]
    xml = ''.join('<row>' + ''.join(f'<c t="{"n" if isinstance(value, (int, float)) else "str"}"><v>{escape(str(value))}</v></c>' for value in row) + '</row>' for row in rows)
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
        archive.writestr('xl/workbook.xml', f'<workbook {ns}><workbookPr date1904="0"/></workbook>')
        archive.writestr('xl/worksheets/sheet1.xml', f'<worksheet {ns}><sheetData>{xml}</sheetData></worksheet>')


def source_import(case):
    p = case.page
    path = case.args.output / f'{case.name}-synthetic.xlsx'
    write_statement(path)
    nav(p, 'Impor mutasi')
    p.get_by_label('Dompet impor', exact=True).select_option('bank')
    p.get_by_label('File mutasi Ziraat', exact=True).set_input_files(path)
    expect(p.get_by_role('heading', name='Periksa sebelum disimpan', exact=True)).to_be_visible()
    rows = p.locator('.import-table tbody tr')
    bim = rows.filter(has_text='POS BİM MARKET')
    unknown = rows.filter(has_text='POS UNKNOWN QRS')
    uber = rows.filter(has_text='POS UBER TRIP')
    pending = rows.filter(has_text='FAST GELEN SYNTHETIC')
    expect(bim.locator('.import-row-category')).to_have_value('Bahan makanan')
    expect(unknown.locator('.import-row-category')).to_have_value(UNCAT)
    expect(uber.locator('.import-row-category')).to_have_value(UNCAT)
    expect(pending.locator('select').first).to_have_value('movement')
    bim.locator('.import-row-category').select_option('Pendidikan')
    p.get_by_role('button', name='Simpan 4 transaksi', exact=True).click()
    expect(p.get_by_role('heading', name='Periksa sebelum disimpan', exact=True)).to_have_count(0)
    before = stored_document(p)
    assert before['metadata']['facts'] and len(before['state']['entries']) == 4
    entries = {row['note']: row for row in before['state']['entries']}
    assert entries['POS BİM MARKET']['category'] == 'Pendidikan'
    assert entries['POS UNKNOWN QRS']['category'] == UNCAT
    assert entries['FAST GELEN SYNTHETIC']['type'] == 'movement'
    # Adding a new rule never silently mutates already stored history.
    raw_before = p.evaluate('(key)=>localStorage.getItem(key)', FINANCE)
    dialog = case.manager()
    case.add_rule(dialog, 'UNKNOWN QRS', 'Kesehatan', 'auto')
    case.save_manager(dialog)
    case.unchanged(raw_before)
    nav(p, 'Transaksi')
    p.get_by_role('button', name='Isi kategori otomatis', exact=True).click()
    dialog = p.get_by_role('dialog', name='Isi kategori otomatis', exact=True)
    auto_rows = dialog.locator('.category-automation-row')
    expect(auto_rows).to_have_count(2)
    expect(auto_rows.filter(has_text='POS UNKNOWN QRS').get_by_role('combobox')).to_have_value('Kesehatan')
    expect(auto_rows.filter(has_text='POS UBER TRIP').get_by_role('combobox')).to_have_value('')
    dialog.get_by_role('button', name='Terapkan 1 kategori', exact=True).click()
    expect(dialog).to_have_count(0)
    after = stored_document(p)
    assert without_categories(after) == without_categories(before), 'Category batch changed bank facts, financial values or other annotation fields'
    assert after['metadata']['facts'] == before['metadata']['facts']
    entry = next(row for row in after['state']['entries'] if row['note'] == 'POS UNKNOWN QRS')
    source_id = next(link['source'] for link in after['metadata']['links'] if link['entryId'] == entry['id'])
    assert entry['category'] == 'Kesehatan'
    assert next(row for row in after['metadata']['annotations'] if row['sourceId'] == source_id)['category'] == 'Kesehatan'
    assert next(row for row in after['state']['entries'] if row['note'] == 'POS BİM MARKET')['category'] == 'Pendidikan'
    assert next(row for row in after['state']['entries'] if row['note'] == 'FAST GELEN SYNTHETIC')['type'] == 'movement'
    assert json.loads(p.evaluate('(key)=>localStorage.getItem(key)', FINANCE))['version'] == 2
    case.semantic_comparisons += 2
    # Known-source reimport cannot reapply rules over the user's prior category.
    nav(p, 'Impor mutasi')
    p.get_by_label('File mutasi Ziraat', exact=True).set_input_files(path)
    expect(p.get_by_role('button', name='Simpan 0 transaksi', exact=True)).to_be_disabled()
    assert stored_document(p) == after


def stale_settings(case):
    p = case.page
    second = case.new_page()
    second.goto(case.args.url, wait_until='networkidle')
    nav(second, 'Transaksi')
    a, b = case.manager(), case.manager(second)
    case.add_name(a, 'Kategori tab pertama')
    case.add_name(b, 'Kategori tab usang')
    case.save_manager(a)
    b.get_by_role('button', name='Simpan pengaturan', exact=True).click()
    expect(b.get_by_role('alert')).to_be_visible()
    expect(b.locator('.category-manager-names li').filter(has_text='Kategori tab usang')).to_have_count(1)
    saved = p.evaluate('(key)=>JSON.parse(localStorage.getItem(key))', SETTINGS)
    assert 'Kategori tab pertama' in saved['names'] and 'Kategori tab usang' not in saved['names']
    b.get_by_role('button', name='Batal', exact=True).click()
    b = case.manager(second)
    expect(b.locator('.category-manager-names li').filter(has_text='Kategori tab pertama')).to_have_count(1)
    assert b.locator('.category-manager-names li').filter(has_text='Kategori tab usang').count() == 0
    case.unchanged()


def settings_quota(case):
    p = case.page
    p.evaluate('''()=>{const set=Storage.prototype.setItem;window.rejectCategorySave=true;
        Storage.prototype.setItem=function(key,value){if(key==='uangku:categories:v1'&&window.rejectCategorySave)
        throw new DOMException('Synthetic settings quota','QuotaExceededError');return set.call(this,key,value);};}''')
    dialog = case.manager()
    case.add_name(dialog, 'Kategori draf kuota')
    dialog.get_by_role('button', name='Simpan pengaturan', exact=True).click()
    expect(dialog.get_by_role('alert')).to_be_visible()
    expect(dialog.locator('.category-manager-names li').filter(has_text='Kategori draf kuota')).to_have_count(1)
    assert p.evaluate('(key)=>localStorage.getItem(key)', SETTINGS) == case.settings_raw
    case.unchanged()
    p.evaluate('window.rejectCategorySave=false')
    case.save_manager(dialog)
    assert 'Kategori draf kuota' in p.evaluate('(key)=>JSON.parse(localStorage.getItem(key)).names', SETTINGS)
    case.unchanged()


def pending_settings(case):
    p = case.page
    holder = case.new_page()
    holder.goto(case.args.url, wait_until='networkidle')
    holder.evaluate('''()=>{window.categoryLockReady=false;navigator.locks.request('uangku:category-settings',
        async()=>{window.categoryLockReady=true;await new Promise(resolve=>window.releaseCategoryLock=resolve);});}''')
    holder.wait_for_function('window.categoryLockReady===true')
    dialog = case.manager()
    case.add_name(dialog, 'Kategori simpan tertunda')
    dialog.get_by_role('button', name='Simpan pengaturan', exact=True).click()
    expect(dialog.locator('.category-manager')).to_have_attribute('aria-busy', 'true')
    expect(dialog.get_by_label('Nama kategori baru', exact=True)).to_be_disabled()
    p.keyboard.press('Escape')
    expect(dialog).to_be_visible()
    dialog.get_by_role('button', name='Tutup', exact=True).click()
    expect(dialog).to_be_visible()
    case.unchanged()
    holder.evaluate('window.releaseCategoryLock()')
    expect(dialog).to_have_count(0)
    assert 'Kategori simpan tertunda' in p.evaluate('(key)=>JSON.parse(localStorage.getItem(key)).names', SETTINGS)
    case.unchanged()


def financial_quota(case):
    p = case.page
    before = stored_document(p)
    p.evaluate('''()=>{const set=Storage.prototype.setItem;window.rejectFinancialSave=true;
        Storage.prototype.setItem=function(key,value){if(key==='uangku:v1'&&window.rejectFinancialSave)
        throw new DOMException('Synthetic ledger quota','QuotaExceededError');return set.call(this,key,value);};}''')
    p.get_by_role('button', name='Isi kategori otomatis', exact=True).click()
    dialog = p.get_by_role('dialog', name='Isi kategori otomatis', exact=True)
    dialog.get_by_role('button', name='Terapkan 1 kategori', exact=True).click()
    expect(dialog.get_by_role('alert')).to_be_visible()
    expect(dialog.locator('.category-automation-row').filter(has_text='POS BİM MARKET 123').get_by_role('combobox')).to_have_value('Bahan makanan')
    case.unchanged()
    dialog.get_by_role('button', name='Batal', exact=True).click()
    expect(p.get_by_test_id('save-status')).to_contain_text(re.compile('belum tersimpan', re.I))
    draft_path = case.args.output / f'{case.name}-draft.json'
    with p.expect_download() as download:
        p.get_by_role('button', name='Unduh pekerjaan yang belum tersimpan', exact=True).click()
    download.value.save_as(draft_path)
    draft = read_document(draft_path)
    assert without_categories(draft) == without_categories(before)
    assert next(row for row in draft['state']['entries'] if row['id'] == 'auto')['category'] == 'Bahan makanan'
    assert len(draft['state']['entries']) == len(before['state']['entries'])
    p.evaluate('window.rejectFinancialSave=false')
    p.get_by_role('button', name='Coba simpan lagi', exact=True).click()
    expect(p.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
    assert stored_document(p) == draft
    assert len({row['id'] for row in stored_document(p)['state']['entries']}) == len(before['state']['entries'])
    p.reload(wait_until='networkidle')
    assert stored_document(p) == draft
    case.semantic_comparisons += 3


def financial_conflict(case):
    p = case.page
    before = stored_document(p)
    p.get_by_role('button', name='Isi kategori otomatis', exact=True).click()
    dialog = p.get_by_role('dialog', name='Isi kategori otomatis', exact=True)
    second = case.new_page()
    second.goto(case.args.url, wait_until='networkidle')
    nav(second, 'Transaksi')
    second.get_by_role('button', name='Ubah POS BİM MARKET 123', exact=True).click()
    edit = second.get_by_role('dialog')
    edit.get_by_label(re.compile('^Kategori')).select_option('Pendidikan')
    edit.get_by_role('button', name='Simpan transaksi', exact=True).click()
    expect(edit).to_have_count(0)
    remote = stored_document(second)
    assert next(row for row in remote['state']['entries'] if row['id'] == 'auto')['category'] == 'Pendidikan'
    remote_raw = second.evaluate('(key)=>localStorage.getItem(key)', FINANCE)
    assert without_categories(remote) == without_categories(before)
    dialog.get_by_role('button', name='Terapkan 1 kategori', exact=True).click()
    expect(dialog.get_by_role('alert')).to_be_visible()
    case.unchanged(remote_raw)
    dialog.get_by_role('button', name='Batal', exact=True).click()
    expect(p.get_by_test_id('save-status')).to_contain_text(re.compile('konflik', re.I))
    p.get_by_role('button', name='Coba simpan lagi', exact=True).click()
    expect(p.get_by_test_id('save-status')).to_contain_text(re.compile('konflik', re.I))
    case.unchanged(remote_raw)
    p.get_by_role('button', name='Muat catatan terbaru', exact=True).click()
    confirm = p.get_by_role('dialog', name='Muat catatan terbaru?', exact=True)
    confirm.get_by_role('button', name='Muat catatan terbaru', exact=True).click()
    expect(confirm).to_have_count(0)
    expect(p.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
    assert stored_document(p) == remote
    case.semantic_comparisons += 2


def visuals(case):
    dialog = case.manager()
    case.capture('manager')
    dialog.get_by_role('button', name='Batal', exact=True).click()
    case.page.get_by_role('button', name='Isi kategori otomatis', exact=True).click()
    case.capture('automation')
    case.unchanged()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--url', default=os.environ.get('UANGKU_TEST_URL', 'http://127.0.0.1:4180'))
    parser.add_argument('--only', default='')
    args = parser.parse_args()
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    build = assert_production_url(args.url)
    results = []
    cases = [('manager-desktop-light', {}, manager_lifecycle),
             ('manager-mobile-dark', {'width': 390, 'theme': 'dark'}, manager_lifecycle),
             ('history-auto-suggest-conflict-pending', {}, history_automation),
             ('source-import-desktop', {'empty': True}, source_import),
             ('source-import-mobile-dark', {'empty': True, 'width': 390, 'theme': 'dark'}, source_import),
             ('settings-stale-tab-CAS', {}, stale_settings),
             ('settings-quota-retains-draft', {}, settings_quota),
             ('settings-pending-close-guard', {}, pending_settings),
             ('financial-quota-draft-and-retry', {}, financial_quota),
             ('financial-stale-category-conflict', {}, financial_conflict)]
    for width, theme in [(1440, 'light'), (1440, 'dark'), (390, 'light'), (390, 'dark'), (320, 'dark')]:
        cases.append((f'visual-{width}-{theme}', {'width': width, 'theme': theme}, visuals))
    with sync_playwright() as pw:
        browser = launch_browser(pw)
        version = browser.version
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
                        result.update({'exact_financial_byte_comparisons': case.byte_comparisons,
                                       'financial_semantic_invariance_checks': case.semantic_comparisons,
                                       'page_errors': case.errors, 'contrasts': case.contrasts})
                        case.context.close()
                result['seconds'] = round(time.monotonic() - began, 3)
                results.append(result)
                print(compact({key: value for key, value in result.items() if key not in ['contrasts', 'traceback']}), flush=True)
        finally:
            browser.close()
    final_identity = {'passed': False}
    try:
        final_identity = {'passed': assert_production_url(args.url) == build}
    except Exception as error:
        final_identity['error'] = str(error)
    report = {'synthetic_only': True, 'fresh_contexts': True, 'browser_version': version,
              'dist_sha256': build, 'url': args.url, 'final_build_identity': final_identity,
              'scope': 'Chromium desktop and mobile emulation; no physical-device or manual screen-reader claim',
              'contrast_scope': 'Visible steady-state solid text/control/placeholder samples at modal scroll positions; gradients and disabled controls excluded',
              'results': results, 'passed': bool(results) and all(row['status'] == 'passed' for row in results) and final_identity['passed']}
    (args.output / 'summary.json').write_bytes((json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    print(compact({'passed': sum(row['status'] == 'passed' for row in results),
                   'failed': sum(row['status'] != 'passed' for row in results), 'dist_sha256': build}), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
