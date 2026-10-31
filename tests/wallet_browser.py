"""Synthetic wallet lifecycle and archival regression against a pinned build.

Fresh contexts only. No personal browser profile, bank statement or financial
backup is opened. A bank, a peer account, source evidence and paired transfer
are generated independently so archival can be proved to retain every posting.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
from pathlib import Path
import re
import sys
import time
import traceback
from urllib.parse import urlsplit

from browser_support import (assert_production_url, install_playwright_path,
    launch_browser, new_page, read_document, stored_document)
install_playwright_path()
from playwright.sync_api import sync_playwright, expect
from category_browser import compact, nav
from bank_review_browser import write_statement
from theme_browser import TEXT_CONTRAST_JS, CONTROL_CONTRAST_JS

FINANCE = 'uangku:v1'
BANK, PEER, EMPTY = 'Synthetic Ziraat', 'Synthetic peer', 'Synthetic unused'


def wallet(id_, name, opening=0, currency='TRY', kind='bank'):
    return {'id': id_, 'name': name, 'currency': currency,
        'kind': kind, 'openingBalance': opening}


def entry(id_, amount, type_='expense', wallet_id='bank', **extra):
    return {'id': id_, 'date': '2026-10-31', 'type': type_,
        'walletId': wallet_id, 'amount': amount, 'category': 'Pendidikan',
        'note': 'Synthetic wallet record '+id_, **extra}


def document(wallets=None, entries=None, metadata=None):
    result = {'app':'uangku','version':1,'demo':False,'state':{'version':1,
        'wallets': wallets if wallets is not None else [wallet('bank',BANK,10000),
            wallet('peer',PEER,5000),wallet('empty',EMPTY)],
        'entries':entries or []}}
    if metadata is not None: result['metadata'] = metadata
    return result


def history_fixture():
    rows = [entry('in',2000,'income',date='2026-10-29'),
        entry('source-out',1000,date='2026-10-30',sourceKey='ziraat:0000000000000001'),
        entry('paired',1000,'transfer',toWalletId='peer',toAmount=1000,
            fee=25,rate=1,category=''),
        entry('future',500,date='2026-11-05'),
        entry('peer-only',200,wallet_id='peer',date='2026-10-30')]
    metadata = {'policy':'unverified-unless-linked','facts':[{
        'id':'synthetic-fact','walletId':'bank','currency':'TRY',
        'postedOn':'2026-10-30','signedAmount':-1000,'balanceAfter':11000,
        'description':'POS ALIŞVERİŞ İŞYERİ: SYNTHETIC WALLET SHOP MUTABAKAT: 900001',
        'reference':'SYN-WALLET-1','fingerprintVersion':'ziraat-v1',
        'fingerprint':'ziraat:0000000000000001'}],
        'links':[{'entryId':'source-out','source':'synthetic-fact'}],
        'statements':[{'id':'synthetic-statement','walletId':'bank','currency':'TRY',
            'periodStart':'2026-10-30','periodEnd':'2026-10-30',
            'openingBalance':12000,'closingBalance':11000,'rowIds':['synthetic-fact']}],
        'transfers':[{'entryId':'paired','sourceDate':'2026-10-31',
            'destinationDate':'2026-10-31'}]}
    return document(entries=rows,metadata=metadata)


def wallet_ids(data):
    return [row['id'] for row in data['state']['wallets']]


def archives(data):
    return {row['walletId'] for row in data.get('metadata',{}).get('walletArchives',[])}


def without_archives(data):
    result = copy.deepcopy(data)
    if result.get('metadata'):
        result['metadata'].pop('walletArchives',None)
        if result['metadata'] == {'policy':'unverified-unless-linked','facts':[],
                                 'links':[],'statements':[]}:
            result.pop('metadata')
    return result


class Case:
    def __init__(self,browser,args,name,*,data=None,width=1440,theme='light',init=None):
        self.args,self.name,self.width = args,name,width
        self.data = copy.deepcopy(data if data is not None else document())
        self.raw = compact(self.data)
        self.byte_checks,self.semantic_checks = 0,0
        self.errors,self.contrasts = [],[]
        parts = urlsplit(args.url)
        self.context = browser.new_context(viewport={'width':width,'height':1000 if width>600 else 844},
            is_mobile=width<600,has_touch=width<600,color_scheme=theme,
            timezone_id='Europe/Istanbul',accept_downloads=True,
            storage_state={'cookies':[],'origins':[{'origin':f'{parts.scheme}://{parts.netloc}',
                'localStorage':[{'name':FINANCE,'value':self.raw},
                    {'name':'uangku:theme:v1','value':theme},
                    {'name':'uangku:preferences:v1','value':compact({'currency':'TRY','lastWallets':{'TRY':'bank'}})}]}]})
        if init:self.context.add_init_script(init)
        self.page = self.new_page()
        nav(self.page,'Dompet')
        self.unchanged()

    def new_page(self):
        page = new_page(self.context)
        page.set_default_timeout(12000)
        page.on('pageerror',lambda error:self.errors.append(str(error)))
        page.goto(self.args.url,wait_until='networkidle')
        return page

    def unchanged(self,raw=None):
        assert self.page.evaluate('(key)=>localStorage.getItem(key)',FINANCE)==(self.raw if raw is None else raw), 'Read-only action changed financial bytes'
        self.byte_checks += 1

    def raw_now(self,page=None):
        return (page or self.page).evaluate('(key)=>localStorage.getItem(key)',FINANCE)

    def saved(self,page=None):
        p = page or self.page
        expect(p.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
        return stored_document(p)

    def form(self,name=None,page=None):
        p=page or self.page
        nav(p,'Dompet')
        active=p.get_by_test_id('wallet-active-tab')
        if active.count():active.click()
        if name is None:
            p.get_by_role('button',name='Tambah dompet',exact=True).first.click()
            title='Tambah dompet'
        else:
            p.get_by_role('button',name='Atur dompet '+name,exact=True).click()
            title='Atur dompet'
        dialog=p.get_by_role('dialog',name=title,exact=True)
        expect(dialog).to_be_visible();return dialog

    def save_form(self,dialog,page=None):
        dialog.get_by_role('button',name='Simpan dompet',exact=True).click()
        expect(dialog).to_have_count(0)
        return self.saved(page)

    def confirm(self,verb,name,page=None):
        p=page or self.page
        dialog=p.get_by_role('dialog')
        expect(dialog).to_be_visible()
        expect(dialog).to_contain_text(name)
        dialog.get_by_role('button',name=re.compile('^'+re.escape(verb))).click()
        return self.saved(p)

    def archive(self,name=BANK,page=None):
        p=page or self.page
        form=self.form(name,p)
        form.get_by_role('button',name='Arsipkan dompet',exact=True).click()
        return self.confirm('Arsipkan',name,p)

    def archived_tab(self,page=None):
        p=page or self.page
        nav(p,'Dompet')
        p.get_by_test_id('wallet-archive-tab').click()

    def restore(self,name=BANK,page=None):
        p=page or self.page
        self.archived_tab(p)
        p.get_by_role('button',name='Pulihkan dompet '+name,exact=True).click()
        return self.confirm('Pulihkan',name,p)

    def screenshot(self,label):
        assert self.page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Horizontal page overflow'
        self.page.screenshot(path=str(self.args.output/f'{self.name}-{label}.png'),full_page=True,animations='disabled')


def create_and_cancel(case):
    p=case.page;before=stored_document(p)
    dialog=case.form();dialog.get_by_label('Nama dompet',exact=True).fill('Synthetic cancelled')
    dialog.get_by_role('button',name='Batal',exact=True).click();case.unchanged()
    dialog=case.form();dialog.get_by_label('Nama dompet',exact=True).fill('Synthetic new ewallet')
    dialog.get_by_label(re.compile('^Jenis dompet')).select_option('ewallet')
    dialog.get_by_label(re.compile(r'^Saldo awal \(TRY\)')).fill('1.234,56')
    after=case.save_form(dialog)
    new=[row for row in after['state']['wallets'] if row['id'] not in wallet_ids(before)]
    assert len(new)==1 and new[0]['name']=='Synthetic new ewallet'
    assert new[0]['kind']=='ewallet' and new[0]['currency']=='TRY' and new[0]['openingBalance']==123456
    assert after['state']['entries']==before['state']['entries']
    assert len(set(wallet_ids(after)))==len(wallet_ids(after))
    case.semantic_checks+=3
    raw=case.raw_now();p.reload(wait_until='networkidle');case.unchanged(raw)


def duplicate_name(case):
    p=case.page;dialog=case.form()
    dialog.get_by_label('Nama dompet',exact=True).fill('  synthetic ziraat  ')
    dialog.get_by_role('button',name='Simpan dompet',exact=True).click()
    expect(dialog.get_by_role('alert')).to_be_visible();case.unchanged()
    expect(dialog.get_by_label('Nama dompet',exact=True)).to_have_value('  synthetic ziraat  ')
    dialog.get_by_label('Nama dompet',exact=True).fill('Synthetic distinct')
    after=case.save_form(dialog)
    assert len(after['state']['wallets'])==len(case.data['state']['wallets'])+1
    case.semantic_checks+=1


def edit_unused(case):
    before=stored_document(case.page);dialog=case.form(EMPTY)
    expect(dialog.get_by_label(re.compile('^Mata uang'))).to_be_disabled()
    dialog.get_by_label('Nama dompet',exact=True).fill('Synthetic renamed')
    dialog.get_by_label(re.compile('^Jenis dompet')).select_option('ewallet')
    dialog.get_by_label(re.compile(r'^Saldo awal \(TRY\)')).fill('12,34')
    after=case.save_form(dialog);expected=copy.deepcopy(before)
    row=next(row for row in expected['state']['wallets'] if row['id']=='empty')
    row.update(name='Synthetic renamed',kind='ewallet',openingBalance=1234)
    assert after==expected;case.semantic_checks+=1


def used_opening_locked(case):
    before=stored_document(case.page);dialog=case.form(BANK)
    expect(dialog.get_by_label(re.compile(r'^Saldo awal \(TRY\)'))).to_be_disabled()
    expect(dialog.get_by_label(re.compile('^Mata uang'))).to_be_disabled()
    expect(dialog).to_contain_text('Cek saldo')
    dialog.get_by_label('Nama dompet',exact=True).fill('Synthetic renamed used bank')
    after=case.save_form(dialog);expected=copy.deepcopy(before)
    next(row for row in expected['state']['wallets'] if row['id']=='bank')['name']='Synthetic renamed used bank'
    assert after==expected;case.semantic_checks+=2


def delete_empty(case):
    before=stored_document(case.page);dialog=case.form(EMPTY)
    dialog.get_by_role('button',name='Hapus dompet',exact=True).click()
    after=case.confirm('Hapus',EMPTY)
    expected=copy.deepcopy(before)
    expected['state']['wallets']=[row for row in expected['state']['wallets'] if row['id']!='empty']
    assert after==expected;case.semantic_checks+=1
    raw=case.raw_now();case.page.reload(wait_until='networkidle');case.unchanged(raw)


def delete_last_and_create(case):
    dialog=case.form(BANK);dialog.get_by_role('button',name='Hapus dompet',exact=True).click()
    after=case.confirm('Hapus',BANK)
    assert after['state']=={'version':1,'wallets':[],'entries':[]};case.semantic_checks+=1
    dialog=case.form();dialog.get_by_label('Nama dompet',exact=True).fill('Synthetic recreated')
    saved=case.save_form(dialog)
    assert len(saved['state']['wallets'])==1 and saved['state']['entries']==[]
    assert saved['state']['wallets'][0]['name']=='Synthetic recreated';case.semantic_checks+=1


def archive_history(case):
    p=case.page;before=stored_document(p);after=case.archive()
    assert archives(after)=={'bank'} and without_archives(after)==without_archives(before)
    case.semantic_checks+=3
    expect(p.get_by_role('button',name='Atur dompet '+BANK,exact=True)).to_have_count(0)
    case.archived_tab();expect(p.get_by_role('button',name='Pulihkan dompet '+BANK,exact=True)).to_be_visible()
    raw=case.raw_now();case.unchanged(raw)
    p.get_by_role('button',name='Lihat histori '+BANK,exact=True).click()
    expect(p.get_by_label('Dompet riwayat',exact=True)).to_have_value('bank')
    expect(p.get_by_label('Periode transaksi',exact=True)).to_have_value('all')
    expect(p.locator('.transactions-table tbody tr')).to_have_count(4)
    expect(p.locator('.transactions-table tbody tr').filter(has_text='Synthetic wallet record peer-only')).to_have_count(0)
    case.unchanged(raw)
    nav(p,'Ringkasan')
    expect(p.get_by_test_id('cashflow-inflow')).to_have_attribute('data-amount','2000')
    expect(p.get_by_test_id('cashflow-outflow')).to_have_attribute('data-amount','1225')
    expect(p.get_by_test_id('cashflow-closing')).to_have_attribute('data-amount','15775')
    nav(p,'Transaksi');p.get_by_label('Periode transaksi',exact=True).select_option('all')
    p.get_by_label('Dompet riwayat',exact=True).select_option('all')
    rows=p.locator('.transactions-table tbody tr')
    expect(rows).to_have_count(len(before['state']['entries']))
    expect(rows.filter(has_text='Synthetic wallet record source-out').get_by_role('button',name=re.compile('^Ubah '))).to_have_count(0)
    expect(rows.filter(has_text='Synthetic wallet record paired').get_by_role('button',name=re.compile('^Hapus '))).to_have_count(0)
    p.get_by_role('button',name='Catat transaksi',exact=True).first.click()
    dialog=p.get_by_role('dialog');values=dialog.get_by_label('Dompet asal',exact=True).locator('option').evaluate_all('(rows)=>rows.map(row=>row.value)')
    assert 'bank' not in values and 'peer' in values
    dialog.get_by_role('button',name='Batal',exact=True).click();case.unchanged(raw)
    p.reload(wait_until='networkidle');assert stored_document(p)==after;case.semantic_checks+=1
    restored=case.restore();assert not archives(restored)
    assert without_archives(restored)==without_archives(before);case.semantic_checks+=1



def archive_last_active_newrecord(case):
    p=case.page;before=stored_document(p);after=case.archive();raw=case.raw_now()
    assert archives(after)=={'bank'} and without_archives(after)==without_archives(before)
    nav(p,'Ringkasan')
    expect(p.get_by_test_id('cashflow-closing')).to_have_attribute('data-amount','9000')
    p.get_by_role('button',name='Catat transaksi',exact=True).first.click()
    dialog=p.get_by_role('dialog',name='Tambah dompet',exact=True)
    expect(dialog).to_be_visible()
    dialog.get_by_role('button',name='Batal',exact=True).click()
    nav(p,'Impor mutasi')
    expect(p.get_by_role('button',name='Pilih file .xlsx',exact=True)).to_be_disabled()
    expect(p.get_by_role('button',name=re.compile('Tambah dompet TRY|Tambah rekening TRY'))).to_be_visible()
    case.unchanged(raw);case.semantic_checks+=2


def archive_export_restore(case):
    p=case.page;before=stored_document(p);archived=case.archive();path=case.args.output/f'{case.name}-synthetic-backup.json'
    with p.expect_download() as download:p.get_by_role('button',name='Cadangkan data',exact=True).click()
    download.value.save_as(path)
    wire=json.loads(path.read_text(encoding='utf-8'))
    assert wire['version']==2 and wire['codec']=='table-tuples-v5'
    assert read_document(path)==archived;case.semantic_checks+=2
    case.restore();assert not archives(stored_document(p))
    p.get_by_label('File cadangan Uangku',exact=True).set_input_files(path)
    dialog=p.get_by_role('dialog',name='Pulihkan cadangan?',exact=True)
    dialog.get_by_role('button',name='Pulihkan data',exact=True).click()
    expect(dialog).to_have_count(0);assert case.saved()==archived
    assert without_archives(archived)==without_archives(before);case.semantic_checks+=2
    raw=case.raw_now();p.reload(wait_until='networkidle');case.unchanged(raw)


def used_delete_blocked(case):
    dialog=case.form(BANK)
    delete=dialog.get_by_role('button',name='Hapus dompet',exact=True)
    if delete.count():expect(delete).to_be_disabled()
    expect(dialog.get_by_role('button',name='Arsipkan dompet',exact=True)).to_be_enabled()
    expect(dialog).to_contain_text(re.compile('histori|transaksi|sumber',re.I))
    case.unchanged();dialog.get_by_role('button',name='Batal',exact=True).click()


def nonzero_archive(case):
    before=stored_document(case.page);dialog=case.form(BANK)
    delete=dialog.get_by_role('button',name='Hapus dompet',exact=True)
    if delete.count():expect(delete).to_be_disabled()
    dialog.get_by_role('button',name='Arsipkan dompet',exact=True).click()
    after=case.confirm('Arsipkan',BANK)
    assert archives(after)=={'bank'} and without_archives(after)==without_archives(before)
    case.semantic_checks+=1
    nav(case.page,'Ringkasan')
    expect(case.page.get_by_test_id('cashflow-closing')).to_have_attribute('data-amount','10000')


def actual_header_cutoff(case):
    p=case.page
    expect(p.get_by_test_id('wallet-current-total')).to_have_attribute('data-amount','15775')
    expect(p.locator('[data-wallet-id="bank"] .wallet-card-balance')).to_contain_text('99,75')
    case.unchanged()
    case.archive();p.get_by_test_id('wallet-active-tab').click()
    expect(p.get_by_test_id('wallet-current-total')).to_have_attribute('data-amount','5800')
    case.archived_tab();expect(p.get_by_test_id('wallet-current-total')).to_have_attribute('data-amount','9975')


def stale_edit_deleted(case):
    p=case.page;other=case.new_page();form=case.form(EMPTY,p)
    form.get_by_label('Nama dompet',exact=True).fill('Synthetic stale edit')
    remote=case.form(EMPTY,other);remote.get_by_role('button',name='Hapus dompet',exact=True).click()
    after=case.confirm('Hapus',EMPTY,other);durable=case.raw_now(other)
    expect(form.get_by_role('button',name='Simpan dompet',exact=True)).to_be_disabled()
    expect(form.get_by_role('status')).to_contain_text(re.compile('dihapus|berubah|diarsipkan'))
    assert case.raw_now(p)==durable and 'empty' not in wallet_ids(stored_document(p))
    expect(form.get_by_label('Nama dompet',exact=True)).to_have_value('Synthetic stale edit')
    assert stored_document(other)==after;case.semantic_checks+=2


def quota_archive_retry(case):
    p=case.page;before=stored_document(p)
    p.evaluate("""()=>{const original=Storage.prototype.setItem;window.rejectWalletWrite=true;
        Storage.prototype.setItem=function(key,value){if(key==='uangku:v1'&&window.rejectWalletWrite)
        throw new DOMException('Synthetic wallet quota','QuotaExceededError');return original.call(this,key,value);};}""")
    dialog=case.form(BANK);dialog.get_by_role('button',name='Arsipkan dompet',exact=True).click()
    p.get_by_role('dialog').get_by_role('button',name=re.compile('^Arsipkan')).click()
    expect(p.get_by_test_id('save-status')).to_contain_text(re.compile('belum tersimpan|penyimpanan gagal',re.I))
    case.unchanged()
    if p.get_by_role('dialog').count():p.get_by_role('dialog').get_by_role('button',name='Batal',exact=True).click()
    draft_path=case.args.output/f'{case.name}-synthetic-draft.json'
    with p.expect_download() as download:p.get_by_role('button',name='Unduh pekerjaan yang belum tersimpan',exact=True).click()
    download.value.save_as(draft_path);draft=read_document(draft_path)
    assert archives(draft)=={'bank'} and without_archives(draft)==without_archives(before);case.semantic_checks+=2
    p.evaluate('window.rejectWalletWrite=false')
    p.get_by_role('button',name='Coba simpan lagi',exact=True).click()
    after=case.saved();assert after==draft and len(after['state']['entries'])==len(before['state']['entries'])
    assert len(archives(after))==1;case.semantic_checks+=2


def import_revalidation(case):
    p=case.page;nav(p,'Impor mutasi')
    target=p.get_by_label('Dompet impor',exact=True)
    expect(target).to_have_value('bank')
    assert target.locator('option').evaluate_all('(rows)=>rows.map(row=>row.value)')==['bank','empty']
    path=case.args.output/f'{case.name}-synthetic-statement.xlsx';write_statement(path)
    p.get_by_label('File mutasi Ziraat',exact=True).set_input_files(path)
    expect(p.get_by_role('heading',name='Periksa sebelum disimpan',exact=True)).to_be_visible()
    other=case.new_page();case.archive(BANK,other)
    p.bring_to_front()
    expect(p.get_by_role('heading',name='Periksa sebelum disimpan',exact=True)).to_have_count(0)
    expect(target).to_have_value('empty')
    raw=case.raw_now();before=stored_document(p)
    assert len(before['state']['entries'])==len(case.data['state']['entries']);case.unchanged(raw)
    case.archive(EMPTY,other);p.bring_to_front()
    expect(p.get_by_role('heading',name='Periksa sebelum disimpan',exact=True)).to_have_count(0)
    expect(p.get_by_role('button',name='Pilih file .xlsx',exact=True)).to_be_disabled()
    expect(p.get_by_role('button',name=re.compile('Tambah dompet TRY|Tambah rekening TRY'))).to_be_visible()
    assert stored_document(p)['state']['entries']==case.data['state']['entries'];case.semantic_checks+=2


def missing_locks(case):
    p=case.page
    expect(p.get_by_test_id('save-status')).to_contain_text('tidak didukung')
    button=p.get_by_role('button',name='Atur dompet '+BANK,exact=True)
    if button.is_enabled():
        button.click();dialog=p.get_by_role('dialog')
        expect(dialog.get_by_role('button',name='Simpan dompet',exact=True)).to_be_disabled()
        expect(dialog.get_by_role('button',name='Arsipkan dompet',exact=True)).to_be_disabled()
    case.unchanged()


def reject_legacy_archive_restore(case):
    p=case.page;bad=copy.deepcopy(case.data)
    bad['metadata']={'policy':'unverified-unless-linked','facts':[], 'links':[], 'statements':[],
        'walletArchives':[{'walletId':'bank','at':'2026-10-31T12:00:00Z'}]}
    path=case.args.output/f'{case.name}-unsupported-synthetic.json';path.write_bytes(compact(bad).encode('utf-8'))
    p.get_by_label('File cadangan Uangku',exact=True).set_input_files(path)
    expect(p.get_by_role('dialog',name='Pulihkan cadangan?',exact=True)).to_have_count(0)
    expect(p.locator('.toast')).to_be_visible();case.unchanged()


def visual(case):
    dialog=case.form(BANK)
    case.screenshot('form')
    for script in [TEXT_CONTRAST_JS,CONTROL_CONTRAST_JS]:
        result=case.page.evaluate(script);assert result['samples']>0
        assert not result['failures'],result['failures'];case.contrasts.append(result)
    dialog.get_by_role('button',name='Batal',exact=True).click()
    after=case.archive();raw=case.raw_now();case.archived_tab()
    close=case.page.get_by_role('button',name='Tutup pemberitahuan',exact=True)
    if close.count():close.click()
    restore=case.page.get_by_role('button',name='Pulihkan dompet '+BANK,exact=True)
    restore.scroll_into_view_if_needed();expect(restore).to_be_visible()
    case.screenshot('archive')
    case.page.screenshot(path=str(case.args.output/f'{case.name}-archive-viewport.png'),animations='disabled')
    result=case.page.evaluate(TEXT_CONTRAST_JS);assert result['samples']>0
    assert not result['failures'],result['failures'];case.contrasts.append(result)
    case.unchanged(raw)
    assert archives(after)=={'bank'};case.semantic_checks+=1


def cases():
    empty=document(wallets=[wallet('ziraat-try',BANK)])
    import_data=history_fixture()
    import_data['state']['wallets']=[wallet('usd','Ziraat USD',currency='USD'),
        *[row for row in import_data['state']['wallets'] if row['id']!='peer']]
    # This import-selection fixture contains no paired transfer to a removed peer.
    import_data['state']['entries']=[row for row in import_data['state']['entries'] if row['type']!='transfer' and row['walletId']!='peer']
    import_data['metadata'].pop('transfers')
    return [
        ('create-cancel-safe-id-currency-kind',{},create_and_cancel),
        ('duplicate-name-inline-error',{},duplicate_name),
        ('edit-unused-wallet-retains-id',{},edit_unused),
        ('used-opening-locked-source-retained',{'data':history_fixture()},used_opening_locked),
        ('delete-empty-wallet',{},delete_empty),
        ('delete-last-wallet-and-create',{'data':empty},delete_last_and_create),
        ('archive-retains-source-transfer-cutoff-history',{'data':history_fixture()},archive_history),
        ('archive-backup-v5-restore-roundtrip',{'data':history_fixture()},archive_export_restore),
        ('archive-last-active-new-record-route',{'data':document(wallets=[wallet('bank',BANK,10000)],entries=[entry('old',1000)])},archive_last_active_newrecord),
        ('used-delete-blocked',{'data':history_fixture()},used_delete_blocked),
        ('nonzero-wallet-archive-retains-balance',{'data':document(wallets=[wallet('bank',BANK,10000)])},nonzero_archive),
        ('wallet-header-uses-actual-cutoff',{'data':history_fixture()},actual_header_cutoff),
        ('stale-edit-cannot-resurrect-deleted-wallet',{},stale_edit_deleted),
        ('archive-quota-draft-and-once-retry',{'data':history_fixture()},quota_archive_retry),
        ('import-target-TRY-revalidates-after-archive',{'data':import_data},import_revalidation),
        ('missing-locks-write-controls-disabled',{'init':"Object.defineProperty(navigator,'locks',{configurable:true,get:()=>undefined});"},missing_locks),
        ('old-format-cannot-smuggle-archive-metadata',{},reject_legacy_archive_restore),
        ('visual-320-dark-wallet-controls',{'data':history_fixture(),'width':320,'theme':'dark'},visual),
        ('visual-320-light-wallet-controls',{'data':history_fixture(),'width':320,'theme':'light'},visual),
    ]


def main():
    if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--url',default=os.environ.get('UANGKU_TEST_URL','http://127.0.0.1:4180'))
    parser.add_argument('--only',default='')
    args=parser.parse_args();args.output=args.output.resolve();args.output.mkdir(parents=True,exist_ok=True)
    build,results=assert_production_url(args.url),[]
    with sync_playwright() as pw:
        browser=launch_browser(pw);version=browser.version
        try:
            for name,options,run in cases():
                if args.only and args.only not in name:continue
                start,case=time.monotonic(),None;result={'name':name,'status':'failed'}
                try:
                    assert assert_production_url(args.url)==build,'Production build changed'
                    case=Case(browser,args,name,**options);run(case)
                    assert not case.errors,case.errors;result['status']='passed'
                except Exception as error:
                    result.update(error=str(error),traceback=traceback.format_exc())
                    if case:
                        try:case.page.screenshot(path=str(args.output/f'{name}-failure.png'),full_page=True,animations='disabled')
                        except Exception:pass
                finally:
                    if case:
                        result.update(exact_financial_byte_checks=case.byte_checks,semantic_checks=case.semantic_checks,
                            page_errors=case.errors,contrasts=case.contrasts);case.context.close()
                result['seconds']=round(time.monotonic()-start,3);results.append(result)
                print(compact({k:v for k,v in result.items() if k not in ['traceback','contrasts']}),flush=True)
        finally:browser.close()
    identity={'passed':False}
    try:identity={'passed':assert_production_url(args.url)==build}
    except Exception as error:identity['error']=str(error)
    report={'synthetic_only':True,'fresh_contexts':True,'browser_version':version,'dist_sha256':build,
        'url':args.url,'final_build_identity':identity,'results':results,
        'scope':'Chromium Windows fresh contexts, desktop and320px mobile emulation; no personal profile or statement',
        'contrast_scope':'Visible solid text/control samples; gradients and disabled controls excluded',
        'passed':bool(results) and all(row['status']=='passed' for row in results) and identity['passed']}
    (args.output/'summary.json').write_bytes((json.dumps(report,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
    print(compact({'passed':sum(row['status']=='passed' for row in results),
        'failed':sum(row['status']!='passed' for row in results),'dist_sha256':build}),flush=True)
    return 0 if report['passed'] else 1


if __name__=='__main__':raise SystemExit(main())
