"""Synthetic production coverage for currency availability, scales and mapped imports.

All fixtures and workbooks are generated here. No personal profile, transaction
backup or bank export is read. The fixture encoder and stored-data decoder are
test-side implementations of the documented tuple format, not app helpers.
"""
from __future__ import annotations
import argparse
from collections import Counter
import copy
import csv
import io
import json
import os
from pathlib import Path
import re
import sys
import time
import traceback
from urllib.parse import urlsplit
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED

from browser_support import (SCHEMAS, assert_production_url, install_playwright_path,
    launch_browser, new_page, read_document, stored_document)
install_playwright_path()
from playwright.sync_api import sync_playwright, expect
from category_browser import compact, nav
from theme_browser import TEXT_CONTRAST_JS, CONTROL_CONTRAST_JS

KEY = 'uangku:v1'
AT = '2026-10-31T12:00:00Z'
VISIBLE = ['IDR', 'TRY', 'USD', 'EUR', 'JPY', 'KWD', 'CLF']


def wallet(id_, currency, opening=0):
    return {'id':id_, 'name':'Synthetic '+currency+' '+id_, 'currency':currency,
        'kind':'bank', 'openingBalance':opening}


def entry(id_, wallet_id, amount=100, type_='expense', **extra):
    return {'id':id_, 'walletId':wallet_id, 'date':'2026-10-31', 'type':type_,
        'amount':amount, 'category':'Pendidikan', 'note':'Synthetic record '+id_, **extra}


def document(*, extended=False, entries=None, archives=None):
    wallets = [wallet('usd','USD',1_000_000), wallet('try','TRY',10_000)]
    if extended:
        wallets += [wallet('eur','EUR',10_000), wallet('jpy','JPY',100_000),
            wallet('kwd','KWD',100_000), wallet('clf','CLF',100_000)]
    data = {'app':'uangku','version':1,'demo':False,
        'state':{'version':1,'wallets':wallets,'entries':entries or []}}
    if extended or archives:
        data['metadata'] = {'policy':'unverified-unless-linked','facts':[], 'links':[],
            'statements':[], 'currencies':[{'code':code} for code in VISIBLE]}
        if archives:
            data['metadata']['walletArchives'] = [{'walletId':id_,'at':AT} for id_ in archives]
    return data


def encode_fixture(data):
    if not data.get('metadata'):
        return data
    arrays = {'wallets':data['state']['wallets'], 'entries':data['state']['entries'],
        **{key:value for key,value in data['metadata'].items() if key!='policy'}}
    positions = {name:{row['id']:index for index,row in enumerate(rows) if 'id' in row}
        for name,rows in arrays.items()}
    tables = {}
    for name,rows in arrays.items():
        schema=SCHEMAS[name]
        fields=[field for field in schema if any(field in row for row in rows)]
        defaults={field:copy.deepcopy(rows[0][field]) for field in fields
            if rows and all(field in row and row[field]==rows[0][field] for row in rows)}
        defaults.pop('id',None)
        def transform(field,value):
            value=copy.deepcopy(value);kind=schema[field]
            if kind in ['wallets','entries','facts','statements','baselines']:
                return positions[kind][value]
            if kind=='afacts':return [positions['facts'][id_] for id_ in value]
            return value
        packed=[]
        for row in rows:
            mask=0; cells=[]
            for bit,field in enumerate(fields):
                if field not in row or field in defaults:continue
                mask|=1<<bit;cells.append(transform(field,row[field]))
            packed.append([mask,*cells])
        tables[name]={'k':fields,'d':{field:transform(field,value) for field,value in defaults.items()},'r':packed}
    # The stored format requires canonical shared defaults and string interning.
    # Implement those documented wire rules locally, without invoking app code.
    counts=Counter()
    for name,table in tables.items():
        for field,value in table['d'].items():
            if SCHEMAS[name][field]=='s' and isinstance(value,str):counts[value]+=1
        for row in table['r']:
            cell=1
            for bit,field in enumerate(table['k']):
                if row[0]&(1<<bit):
                    if SCHEMAS[name][field]=='s' and isinstance(row[cell],str):counts[row[cell]]+=1
                    cell+=1
    cost=lambda value:len(compact(value).encode('utf-8'))
    dictionary=sorted(value for value,count in counts.items() if count*(cost(value)-6)>cost(value)+1)
    indices={value:index for index,value in enumerate(dictionary)}
    for name,table in tables.items():
        for field,value in table['d'].items():
            if SCHEMAS[name][field]=='s' and isinstance(value,str) and value in indices:table['d'][field]=indices[value]
        for row in table['r']:
            cell=1
            for bit,field in enumerate(table['k']):
                if row[0]&(1<<bit):
                    if SCHEMAS[name][field]=='s' and isinstance(row[cell],str) and row[cell] in indices:row[cell]=indices[row[cell]]
                    cell+=1
    return {'app':'uangku','version':2,'codec':'table-tuples-v6','demo':data['demo'],
        'd':dictionary,'t':tables,'policy':data['metadata']['policy']}


def without_currency_availability(data):
    out=copy.deepcopy(data)
    metadata=out.get('metadata')
    if metadata is not None:
        metadata.pop('currencies',None)
        if metadata=={'policy':'unverified-unless-linked','facts':[],'links':[],'statements':[]}:
            out.pop('metadata')
    return out


def balance(data,id_):
    value=next(w['openingBalance'] for w in data['state']['wallets'] if w['id']==id_)
    for row in data['state']['entries']:
        if row['walletId']==id_:
            value += -row['amount']-row.get('fee',0) if row['type'] in ['expense','transfer'] else row['amount']
        if row.get('toWalletId')==id_:value+=row['toAmount']
    return value


def write_csv(path, rows, delimiter=','):
    stream=io.StringIO(newline='');writer=csv.writer(stream,delimiter=delimiter)
    writer.writerows(rows);path.write_bytes(stream.getvalue().encode('utf-8'))


def write_xlsx(path, rows, formulas=None):
    formulas=formulas or set()
    xml=[]
    for rindex,row in enumerate(rows):
        cells=[]
        for cindex,value in enumerate(row):
            if value is None:cells.append('<c/>');continue
            kind='n' if isinstance(value,(int,float)) else 'str'
            formula='<f>1+1</f>' if (rindex,cindex) in formulas else ''
            cells.append(f'<c t="{kind}">{formula}<v>{escape(str(value))}</v></c>')
        xml.append('<row>'+''.join(cells)+'</row>')
    ns='xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    with ZipFile(path,'w',ZIP_DEFLATED) as archive:
        archive.writestr('xl/workbook.xml',f'<workbook {ns}><workbookPr date1904="0"/></workbook>')
        archive.writestr('xl/worksheets/sheet1.xml',f'<worksheet {ns}><sheetData>{"".join(xml)}</sheetData></worksheet>')


EUR_ROWS = [
    ['date','reference','description','amount','balance','currency'],
    ['2026-10-29','SYN-E1','SYNTHETIC, euro debit "quoted"','-25.25','74.75','EUR'],
    ['2026-10-30','SYN-E2','SYNTHETIC euro credit','100.00','174.75','EUR'],
    ['2026-10-31','SYN-E3','SYNTHETIC euro final','-5.00','169.75','EUR'],
]


class Case:
    def __init__(self,browser,args,name,*,data=None,width=1440,theme='light',currency='USD'):
        self.args,self.name,self.width=args,name,width
        self.data=copy.deepcopy(data if data is not None else document())
        self.raw=compact(encode_fixture(self.data));self.errors=[];self.contrasts=[]
        self.byte_checks,self.semantic_checks=0,0
        parts=urlsplit(args.url)
        self.context=browser.new_context(viewport={'width':width,'height':1000 if width>600 else 844},
            is_mobile=width<600,has_touch=width<600,color_scheme=theme,timezone_id='Europe/Istanbul',accept_downloads=True,
            storage_state={'cookies':[],'origins':[{'origin':f'{parts.scheme}://{parts.netloc}', 'localStorage':[
                {'name':KEY,'value':self.raw},{'name':'uangku:theme:v1','value':theme},
                {'name':'uangku:preferences:v1','value':compact({'currency':currency,'lastWallets':{currency:currency.lower()}})}]}]})
        self.page=self.new_page();nav(self.page,'Dompet')
        expect(self.page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
        self.unchanged()

    def new_page(self):
        page=new_page(self.context);page.set_default_timeout(12000)
        page.on('pageerror',lambda error:self.errors.append(str(error)))
        page.goto(self.args.url,wait_until='networkidle');return page

    def raw_now(self,page=None):return (page or self.page).evaluate('(key)=>localStorage.getItem(key)',KEY)
    def unchanged(self,raw=None):
        assert self.raw_now()==(self.raw if raw is None else raw),'Read/preview action rewrote financial storage'
        self.byte_checks+=1

    def saved(self,page=None):
        p=page or self.page
        expect(p.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
        return stored_document(p)

    def currency(self,code):
        nav(self.page,'Dompet')
        self.page.locator('.currency-tabs button').filter(has=self.page.locator('.currency-code',has_text=re.compile('^'+('TL' if code=='TRY' else code)+'$'))).click()

    def manager(self,page=None):
        p=page or self.page
        p.get_by_role('button',name='Kelola mata uang',exact=True).click()
        dialog=p.get_by_role('dialog',name='Kelola mata uang',exact=True)
        expect(dialog).to_be_visible();return dialog

    def add_currency(self,dialog,code):
        dialog.get_by_label('Cari mata uang',exact=True).fill(code)
        dialog.get_by_label('Mata uang tambahan',exact=True).select_option(code)
        dialog.get_by_role('button',name='Tambah mata uang',exact=True).click()

    def save_manager(self,dialog,page=None):
        dialog.get_by_role('button',name='Simpan mata uang',exact=True).click()
        expect(dialog).to_have_count(0);return self.saved(page)

    def import_file(self,path,*,wallet_id='eur',decimal='.',order='oldest',date_format='iso',mode=None,columns=None,header=1,separator=','):
        p=self.page;nav(p,'Impor mutasi')
        p.get_by_role('button',name='CSV / Excel umum',exact=True).click()
        p.get_by_label('Dompet impor',exact=True).select_option(wallet_id)
        if separator!=',':p.get_by_label('Pemisah CSV',exact=True).select_option(separator)
        p.get_by_label('File mutasi umum',exact=True).set_input_files(path)
        expect(p.get_by_label('Worksheet',exact=True)).to_be_visible()
        if header!=1:p.get_by_label('Baris judul kolom',exact=True).fill(str(header))
        if mode:p.get_by_label('Mode nominal',exact=True).select_option(mode)
        for label,index in (columns or {}).items():p.get_by_label(label,exact=True).select_option(str(index))
        p.get_by_label('Format tanggal',exact=True).select_option(date_format)
        p.get_by_label('Pemisah desimal',exact=True).select_option(decimal)
        p.get_by_label('Urutan mutasi',exact=True).select_option(order)
        p.get_by_label('Konfirmasi mata uang file',exact=True).check()
        p.get_by_role('button',name='Buat pratinjau impor',exact=True).click()

    def preview(self):expect(self.page.get_by_role('heading',name='Periksa sebelum disimpan',exact=True)).to_be_visible()
    def save_import(self,n):
        self.page.get_by_role('button',name=f'Simpan {n} transaksi',exact=True).click()
        expect(self.page.get_by_role('heading',name='Periksa sebelum disimpan',exact=True)).to_have_count(0)
        return self.saved()

    def tx(self,source='usd',destination=None,mode='expense'):
        p=self.page;nav(p,'Transaksi')
        if destination:p.get_by_role('button',name='Pindah uang',exact=True).first.click()
        else:p.get_by_role('button',name='Catat transaksi',exact=True).first.click()
        dialog=p.get_by_role('dialog');expect(dialog).to_be_visible()
        if not destination:dialog.get_by_role('button',name='Pemasukan' if mode=='income' else 'Pengeluaran',exact=True).click()
        dialog.get_by_label('Dompet asal',exact=True).select_option(source)
        if destination:dialog.get_by_label('Dompet tujuan',exact=True).select_option(destination)
        return dialog

    def screenshot(self,label):
        assert self.page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Horizontal page overflow'
        self.page.screenshot(path=str(self.args.output/f'{self.name}-{label}.png'),full_page=True,animations='disabled')


def manage_add_wallet(case):
    p=case.page;before=stored_document(p)
    dialog=case.manager();case.add_currency(dialog,'EUR')
    dialog.get_by_role('button',name='Batal',exact=True).click();case.unchanged()
    dialog=case.manager()
    for code in ['EUR','JPY','KWD']:case.add_currency(dialog,code)
    after=case.save_manager(dialog)
    assert [row['code'] for row in after['metadata']['currencies']]==['IDR','TRY','USD','EUR','JPY','KWD']
    assert without_currency_availability(after)==before
    assert json.loads(case.raw_now())['codec']=='table-tuples-v6';case.semantic_checks+=3
    p.get_by_role('button',name='Tambah dompet',exact=True).first.click()
    form=p.get_by_role('dialog',name='Tambah dompet',exact=True)
    form.get_by_label('Nama dompet',exact=True).fill('Synthetic added dinar')
    form.get_by_label(re.compile('^Mata uang')).select_option('KWD')
    form.get_by_label(re.compile('^Saldo awal')).fill('1,234')
    form.get_by_role('button',name='Simpan dompet',exact=True).click();expect(form).to_have_count(0)
    saved=case.saved();new=[w for w in saved['state']['wallets'] if w['id'] not in {x['id'] for x in before['state']['wallets']}]
    assert len(new)==1 and new[0]['currency']=='KWD' and new[0]['openingBalance']==1234
    assert saved['state']['entries']==before['state']['entries'];case.semantic_checks+=2


def hide_used_report(case):
    p=case.page;before=stored_document(p);dialog=case.manager()
    dialog.get_by_role('button',name='Sembunyikan JPY',exact=True).click()
    saved=case.save_manager(dialog)
    assert without_currency_availability(saved)==without_currency_availability(before)
    assert 'JPY' not in [row['code'] for row in saved['metadata']['currencies']]
    dialog=case.manager();expect(dialog.get_by_role('button',name='Tampilkan JPY',exact=True)).to_be_visible()
    dialog.get_by_role('button',name='Buka laporan JPY',exact=True).click()
    expect(p.get_by_test_id('cashflow-closing')).to_have_attribute('data-amount','99000')
    expect(p.locator('.currency-tabs')).to_contain_text('riwayat')
    raw=case.raw_now();p.reload(wait_until='networkidle');case.unchanged(raw)
    assert balance(stored_document(p),'jpy')==99000;case.semantic_checks+=4


def hide_unused_last(case):
    before=stored_document(case.page);dialog=case.manager()
    dialog.get_by_role('button',name='Sembunyikan IDR',exact=True).click();case.add_currency(dialog,'IDR')
    for code in ['TRY','USD']:dialog.get_by_role('button',name='Sembunyikan '+code,exact=True).click()
    expect(dialog.get_by_role('button',name='Sembunyikan IDR',exact=True)).to_be_disabled()
    saved=case.save_manager(dialog)
    assert [row['code'] for row in saved['metadata']['currencies']]==['IDR']
    assert without_currency_availability(saved)==before
    raw=case.raw_now();case.page.reload(wait_until='networkidle');case.unchanged(raw);case.semantic_checks+=2


def backup_archive(case):
    p=case.page;before=stored_document(p);file=case.args.output/f'{case.name}.json'
    with p.expect_download() as task:p.get_by_role('button',name='Cadangkan data',exact=True).click()
    task.value.save_as(file);assert read_document(file)==before
    assert json.loads(file.read_text(encoding='utf-8'))['codec']=='table-tuples-v6'
    case.unchanged();p.get_by_label('File cadangan Uangku',exact=True).set_input_files(file)
    p.get_by_role('dialog').get_by_role('button',name='Pulihkan data',exact=True).click()
    assert case.saved()==before
    case.currency('JPY');p.get_by_test_id('wallet-archive-tab').click()
    expect(p.get_by_role('button',name='Pulihkan dompet Synthetic JPY jpy',exact=True)).to_be_visible()
    case.semantic_checks+=3


def precision_jpy(case):
    p=case.page;dialog=case.tx('jpy');dialog.get_by_label('Nominal',exact=True).fill('1,25')
    dialog.get_by_role('button',name='Simpan transaksi',exact=True).click()
    expect(dialog.get_by_role('alert')).to_be_visible();case.unchanged()
    dialog.get_by_label('Nominal',exact=True).fill('150')
    dialog.get_by_role('button',name='Simpan transaksi',exact=True).click();expect(dialog).to_have_count(0)
    saved=case.saved();assert len(saved['state']['entries'])==1
    assert saved['state']['entries'][0]['amount']==150 and balance(saved,'jpy')==99850
    case.semantic_checks+=2


def precision_kwd_clf(case):
    p=case.page;dialog=case.tx('kwd');dialog.get_by_label('Nominal',exact=True).fill('1.234')
    dialog.get_by_role('button',name='Simpan transaksi',exact=True).click()
    expect(dialog.get_by_role('alert')).to_be_visible();case.unchanged()
    dialog.get_by_label('Nominal',exact=True).fill('1,234')
    dialog.get_by_role('button',name='Simpan transaksi',exact=True).click();expect(dialog).to_have_count(0)
    first=case.saved();assert first['state']['entries'][0]['amount']==1234
    dialog=case.tx('clf');dialog.get_by_label('Nominal',exact=True).fill('0,0001')
    dialog.get_by_role('button',name='Simpan transaksi',exact=True).click();expect(dialog).to_have_count(0)
    saved=case.saved();assert sorted(row['amount'] for row in saved['state']['entries'])==[1,1234]
    assert balance(saved,'kwd')==98766 and balance(saved,'clf')==99999;case.semantic_checks+=3


def fx_usd_jpy(case):
    dialog=case.tx('usd','jpy');dialog.get_by_label('Nominal',exact=True).fill('100')
    dialog.get_by_label('Kurs transaksi',exact=True).fill('150')
    dialog.get_by_label('Kurs ini sesuai transaksi saya',exact=False).check()
    dialog.get_by_role('button',name='Simpan transaksi',exact=True).click();expect(dialog).to_have_count(0)
    data=case.saved();row=data['state']['entries'][0]
    assert (row['amount'],row['toAmount'],row['rate'])==(10000,15000,150)
    assert balance(data,'usd')==990000 and balance(data,'jpy')==115000
    assert len(data['state']['entries'])==1;case.semantic_checks+=3


def fx_jpy_kwd(case):
    dialog=case.tx('jpy','kwd');dialog.get_by_label('Nominal',exact=True).fill('15000')
    dialog.get_by_role('button',name='Isi jumlah diterima',exact=True).click()
    dialog.get_by_label('Nominal diterima',exact=True).fill('1,250')
    dialog.get_by_label('Kurs ini sesuai transaksi saya',exact=False).check()
    dialog.get_by_role('button',name='Simpan transaksi',exact=True).click();expect(dialog).to_have_count(0)
    data=case.saved();row=data['state']['entries'][0]
    assert row['amount']==15000 and row['toAmount']==1250
    assert abs(row['rate']-(1.25/15000))<1e-15
    assert balance(data,'jpy')==85000 and balance(data,'kwd')==101250;case.semantic_checks+=3


def fx_overflow(case):
    dialog=case.tx('jpy','kwd');dialog.get_by_label('Nominal',exact=True).fill(str(9_007_199_254_740_991))
    dialog.get_by_label('Kurs transaksi',exact=True).fill('1')
    expect(dialog.locator('#fx-input-feedback')).to_be_visible()
    dialog.get_by_label('Kurs ini sesuai transaksi saya',exact=False).check()
    dialog.get_by_role('button',name='Simpan transaksi',exact=True).click()
    expect(dialog).to_be_visible();case.unchanged()


def legacy_fx_note_preserves_money(case):
    p=case.page;before=stored_document(p);nav(p,'Transaksi')
    original=before['state']['entries'][0]
    p.get_by_role('button',name='Ubah '+original['note'],exact=True).click()
    dialog=p.get_by_role('dialog',name='Ubah transaksi',exact=True)
    expect(dialog.locator('.rate-preview strong')).not_to_contain_text('—')
    dialog.get_by_label(re.compile('^Keterangan')).fill('SYNTHETIC legacy note revised')
    dialog.get_by_label('Kurs ini sesuai transaksi saya',exact=False).check()
    dialog.get_by_role('button',name='Simpan transaksi',exact=True).click();expect(dialog).to_have_count(0)
    saved=case.saved();row=saved['state']['entries'][0]
    assert row=={**original,'note':'SYNTHETIC legacy note revised'}
    assert len(saved['state']['entries'])==1 and saved['state']['wallets']==before['state']['wallets']
    assert balance(saved,'try')==0 and balance(saved,'usd')==9_007_199_254_740_991
    raw=case.raw_now();p.reload(wait_until='networkidle');case.unchanged(raw)
    assert stored_document(p)['state']['entries'][0]==row;case.semantic_checks+=4


def csv_signed_duplicate(case):
    p=case.page;path=case.args.output/f'{case.name}.csv';write_csv(path,EUR_ROWS)
    case.import_file(path);case.preview();case.unchanged()
    row=p.locator('.import-table tbody tr').filter(has_text=EUR_ROWS[1][2])
    row.locator('.import-row-category').select_option('Pendidikan')
    saved=case.save_import(3)
    assert len(saved['state']['entries'])==len(saved['metadata']['facts'])==3
    assert balance(saved,'eur')==16975
    facts=sorted(saved['metadata']['facts'],key=lambda fact:fact['postedOn'])
    assert [fact['signedAmount'] for fact in facts]==[-2525,10000,-500]
    assert [fact['balanceAfter'] for fact in facts]==[7475,17475,16975]
    assert all(f['currency']=='EUR' and f['fingerprintVersion']=='generic-v1' and f['fingerprint'].startswith('generic:') for f in facts)
    assert next(e for e in saved['state']['entries'] if e['note']==EUR_ROWS[1][2])['category']=='Pendidikan'
    raw=case.raw_now();case.import_file(path);case.preview()
    expect(p.locator('.import-table tbody tr.duplicate-row')).to_have_count(3)
    expect(p.get_by_role('button',name='Simpan 0 transaksi',exact=True)).to_be_disabled()
    case.unchanged(raw);assert len(stored_document(p)['state']['entries'])==3;case.semantic_checks+=7


def xlsx_debit_credit(case):
    path=case.args.output/f'{case.name}.xlsx'
    rows=[['date','reference','description','debit','credit','balance','currency'],
        ['2026-10-29','SYN-K1','SYNTHETIC dinar debit',1.234,None,98.766,'KWD'],
        ['2026-10-30','SYN-K2','SYNTHETIC dinar credit',None,2.001,100.767,'KWD'],
        ['2026-10-31','SYN-K3','SYNTHETIC dinar final',0.007,None,100.760,'KWD']]
    write_xlsx(path,rows);case.import_file(path,wallet_id='kwd',mode='debit-credit');case.preview();case.unchanged()
    saved=case.save_import(3);facts=sorted(saved['metadata']['facts'],key=lambda row:row['postedOn'])
    assert [row['signedAmount'] for row in facts]==[-1234,2001,-7]
    assert [row['balanceAfter'] for row in facts]==[98766,100767,100760]
    assert balance(saved,'kwd')==100760 and len(saved['state']['entries'])==3;case.semantic_checks+=3


def csv_locale_newest(case):
    path=case.args.output/f'{case.name}.csv'
    rows=[['Synthetic export heading'],EUR_ROWS[0]]
    for row in reversed(EUR_ROWS[1:]):
        r=list(row);r[0]='/'.join(reversed(r[0].split('-')));r[3]=r[3].replace('.',',');r[4]=r[4].replace('.',',');rows.append(r)
    write_csv(path,rows,';');case.import_file(path,decimal=',',order='newest',date_format='dmy',header=2,separator=';')
    case.preview();case.unchanged();saved=case.save_import(3)
    assert balance(saved,'eur')==16975 and len(saved['state']['entries'])==3
    assert sorted(row['postedOn'] for row in saved['metadata']['facts'])==['2026-10-29','2026-10-30','2026-10-31'];case.semantic_checks+=2


def reject_file(case,rows,*,wallet_id='eur',mode=None,xlsx=False,formulas=None,label='invalid',match=None):
    path=case.args.output/f'{case.name}-{label}.{"xlsx" if xlsx else "csv"}'
    if xlsx:write_xlsx(path,rows,formulas)
    else:write_csv(path,rows)
    case.import_file(path,wallet_id=wallet_id,mode=mode)
    mapper=case.page.get_by_role('region',name='Pemetaan impor umum',exact=True)
    # A labelled section is a region; fall back to its stable aria attribute.
    if mapper.count()==0:mapper=case.page.locator('[aria-label="Pemetaan impor umum"]')
    alert=mapper.get_by_role('alert');expect(alert).to_be_visible()
    if match:expect(alert).to_contain_text(re.compile(match,re.I))
    expect(case.page.get_by_role('heading',name='Periksa sebelum disimpan',exact=True)).to_have_count(0)
    case.unchanged()


def reject_currency(case):
    rows=copy.deepcopy(EUR_ROWS);rows[2][-1]='USD'
    reject_file(case,rows,match='mata uang|currency')


def reject_nominal(case):
    rows=[EUR_ROWS[0],['2026-10-31','ZERO','SYNTHETIC zero','0','100','EUR']]
    reject_file(case,rows,label='zero',match='nol|zero')
    rows=[['date','description','debit','credit','balance','currency'],
        ['2026-10-31','SYNTHETIC two directions','1','1','100','EUR']]
    reject_file(case,rows,mode='debit-credit',label='two-directions',match='debit|kredit')
    rows=[EUR_ROWS[0],['2026-10-31','PRECISION','SYNTHETIC overprecision','-1.0001','98.9999','KWD']]
    reject_file(case,rows,wallet_id='kwd',label='precision',match='desimal|presisi|nominal')


def reject_formula(case):
    reject_file(case,EUR_ROWS,xlsx=True,formulas={(1,3)},match='rumus|formula')


def reject_balance(case):
    rows=[['date','description','amount','currency'],['2026-10-31','SYNTHETIC missing balance','-10','EUR']]
    reject_file(case,rows,label='missing',match='saldo|kolom')
    rows=copy.deepcopy(EUR_ROWS);rows[2][4]='999.99'
    reject_file(case,rows,label='broken-chain',match='saldo|urutan')


def reject_date_order(case):
    rows=copy.deepcopy(EUR_ROWS);rows[1][0]='2026-02-31'
    reject_file(case,rows,label='calendar',match='tanggal')
    reject_file(case,[EUR_ROWS[0],*reversed(EUR_ROWS[1:])],label='order',match='urutan|tanggal|saldo')


def cross_fixture():
    data=document(extended=True)
    text='SYNTHETIC cross-source record'
    data['state']['entries']=[entry('existing-bank','try',1000,sourceKey='ziraat:0000000000000011',note=text)]
    data['metadata'].update(facts=[{'id':'old-fact','walletId':'try','currency':'TRY','postedOn':'2026-10-31',
        'signedAmount':-1000,'balanceAfter':9000,'description':text,'reference':'OLD-SYNTHETIC',
        'fingerprintVersion':'ziraat-v1','fingerprint':'ziraat:0000000000000011'}],
        links=[{'entryId':'existing-bank','source':'old-fact'}],
        statements=[{'id':'old-statement','walletId':'try','currency':'TRY','periodStart':'2026-10-31','periodEnd':'2026-10-31',
            'openingBalance':10000,'closingBalance':9000,'rowIds':['old-fact']}])
    return data


def cross_scheme(case,distinct=False):
    p=case.page;before=stored_document(p)
    path=case.args.output/f'{case.name}.csv'
    rows=[EUR_ROWS[0],['2026-10-31','NEW-SYNTHETIC','SYNTHETIC cross-source record','-10','90','TRY']]
    write_csv(path,rows);case.import_file(path,wallet_id='try');case.preview();case.unchanged()
    row=p.locator('.import-table tbody tr');expect(row).to_have_count(1)
    expect(row).to_contain_text('identitas format atau referensinya berbeda')
    p.get_by_role('button',name='Simpan 1 transaksi',exact=True).click()
    expect(p.locator('.import-preview')).to_be_visible();case.unchanged()
    row.get_by_role('button',name='Transaksi berbeda' if distinct else 'Pertahankan catatan',exact=True).click()
    if distinct:saved=case.save_import(1)
    else:
        p.get_by_role('button',name='Simpan fakta file saja',exact=True).click()
        expect(p.get_by_role('heading',name='Periksa sebelum disimpan',exact=True)).to_have_count(0)
        saved=case.saved()
    assert next(f for f in saved['metadata']['facts'] if f['id']=='old-fact')==before['metadata']['facts'][0]
    assert saved['state']['entries'][0]==before['state']['entries'][0]
    assert len(saved['metadata']['facts'])==2 and len(saved['state']['entries'])==(2 if distinct else 1)
    assert balance(saved,'try')==(8000 if distinct else 9000)
    if not distinct:assert any(row['kind']=='excluded' for row in saved['metadata']['dispositions'])
    case.semantic_checks+=5


def manual_overlap(case):
    p=case.page;before=stored_document(p);path=case.args.output/f'{case.name}.csv';write_csv(path,EUR_ROWS)
    case.import_file(path);case.preview();case.unchanged()
    row=p.locator('.import-table tbody tr').filter(has_text=EUR_ROWS[1][2])
    expect(row).to_contain_text('Mungkin sudah dicatat manual')
    p.get_by_role('button',name='Simpan 3 transaksi',exact=True).click()
    expect(p.get_by_role('alert')).to_be_visible();case.unchanged()
    row.get_by_role('button',name='Lewati',exact=True).click()
    saved=case.save_import(2)
    assert saved['state']['entries'][0]==before['state']['entries'][0]
    assert len(saved['state']['entries'])==3 and balance(saved,'eur')==16975
    assert len(saved['metadata']['facts'])==3
    assert 'sourceKey' not in next(e for e in saved['state']['entries'] if e['id']=='manual')
    case.semantic_checks+=4


def quota_currency_retry(case):
    p=case.page;before=stored_document(p)
    p.evaluate('''()=>{const set=Storage.prototype.setItem;window.blockCurrencySave=true;
      Storage.prototype.setItem=function(key,value){if(key==='uangku:v1'&&window.blockCurrencySave)
      throw new DOMException('Synthetic currency quota','QuotaExceededError');return set.call(this,key,value)};}''')
    dialog=case.manager();case.add_currency(dialog,'JPY')
    dialog.get_by_role('button',name='Simpan mata uang',exact=True).click()
    expect(dialog.get_by_role('alert')).to_be_visible();case.unchanged()
    p.evaluate('window.blockCurrencySave=false')
    dialog.get_by_role('button',name='Batal',exact=True).click()
    p.get_by_role('button',name='Coba simpan lagi',exact=True).click()
    saved=case.saved()
    assert [r['code'] for r in saved['metadata']['currencies']].count('JPY')==1
    assert without_currency_availability(saved)==before
    raw=case.raw_now();p.reload(wait_until='networkidle');case.unchanged(raw);case.semantic_checks+=2


def stale_currency_manager(case):
    p=case.page;before=stored_document(p);first=case.manager();case.add_currency(first,'JPY')
    other=case.new_page();nav(other,'Dompet');second=case.manager(other);case.add_currency(second,'EUR')
    case.save_manager(second,other);saved_raw=case.raw_now(other)
    first.get_by_role('button',name='Simpan mata uang',exact=True).click()
    expect(first.get_by_role('alert')).to_be_visible()
    assert case.raw_now()==saved_raw
    data=stored_document(other);codes=[r['code'] for r in data['metadata']['currencies']]
    assert 'EUR' in codes and 'JPY' not in codes
    assert without_currency_availability(data)==before;case.semantic_checks+=3;other.close()


def target_archive_reset(case):
    p=case.page;before=stored_document(p);path=case.args.output/f'{case.name}.csv';write_csv(path,EUR_ROWS)
    case.import_file(path);case.preview();case.unchanged()
    other=case.new_page();nav(other,'Dompet')
    other.locator('.currency-tabs button').filter(has=other.locator('.currency-code',has_text=re.compile('^EUR$'))).click()
    other.get_by_role('button',name='Atur dompet Synthetic EUR eur',exact=True).click()
    other.get_by_role('dialog').get_by_role('button',name='Arsipkan dompet',exact=True).click()
    other.get_by_role('dialog').get_by_role('button',name='Arsipkan dompet',exact=True).click()
    case.saved(other);p.evaluate("window.dispatchEvent(new Event('focus'))")
    expect(p.get_by_role('heading',name='Periksa sebelum disimpan',exact=True)).to_have_count(0)
    assert 'eur' not in p.get_by_label('Dompet impor',exact=True).locator('option').evaluate_all('(rows)=>rows.map(row=>row.value)')
    saved=stored_document(other)
    assert saved['state']==before['state'] and len(saved['state']['entries'])==0
    assert any(row['walletId']=='eur' for row in saved['metadata']['walletArchives'])
    case.semantic_checks+=3;other.close()


def mapping_invalidates_preview(case):
    p=case.page;path=case.args.output/f'{case.name}.csv';write_csv(path,EUR_ROWS)
    case.import_file(path);case.preview();case.unchanged()
    confirmation=p.get_by_label('Konfirmasi mata uang file',exact=True)
    # Each setting changes the interpretation of already displayed bank rows.
    # The prior preview must disappear before the user can save those rows.
    for label,changed,restored in [
        ('Kolom keterangan','1','2'),('Pemisah desimal',',','.'),('Urutan mutasi','newest','oldest')]:
        p.get_by_label(label,exact=True).select_option(changed)
        expect(p.get_by_role('heading',name='Periksa sebelum disimpan',exact=True)).to_have_count(0)
        expect(confirmation).not_to_be_checked();case.unchanged()
        p.get_by_label(label,exact=True).select_option(restored)
        confirmation.check();p.get_by_role('button',name='Buat pratinjau impor',exact=True).click()
        case.preview();case.unchanged()
    confirmation.uncheck()
    expect(p.get_by_role('heading',name='Periksa sebelum disimpan',exact=True)).to_have_count(0)
    expect(p.get_by_role('button',name='Buat pratinjau impor',exact=True)).to_be_disabled()
    case.unchanged()


def failed_replacement_does_not_revive_file(case):
    p=case.page;path=case.args.output/f'{case.name}-valid.csv';write_csv(path,EUR_ROWS)
    case.import_file(path);case.preview();case.unchanged()
    broken=case.args.output/f'{case.name}-broken.csv'
    broken.write_bytes(b'date,description,amount,balance,currency\n"unterminated')
    p.get_by_label('File mutasi umum',exact=True).set_input_files(broken)
    mapper=p.locator('[aria-label="Pemetaan impor umum"]')
    expect(mapper.get_by_role('alert')).to_contain_text(re.compile('kutip|CSV',re.I))
    expect(p.get_by_role('heading',name='Periksa sebelum disimpan',exact=True)).to_have_count(0)
    expect(p.get_by_label('Worksheet',exact=True)).to_have_count(0);case.unchanged()
    # A delimiter change can reread the current file, never the old successful
    # file after a failed replacement cleared its bytes.
    p.get_by_label('Pemisah CSV',exact=True).select_option(';')
    expect(p.get_by_label('Worksheet',exact=True)).to_have_count(0)
    expect(p.get_by_role('button',name='Buat pratinjau impor',exact=True)).to_have_count(0)
    expect(mapper).not_to_contain_text(path.name);case.unchanged()


def visual(case):
    p=case.page;dialog=case.manager()
    # This catalog label is deliberately longer than a narrow-screen control.
    dialog.get_by_label('Cari mata uang',exact=True).fill('UYI')
    for label in ['Cari mata uang','Mata uang tambahan']:
        control=dialog.get_by_label(label,exact=True)
        control.evaluate("el=>el.scrollIntoView({block:'center'})");control.focus()
        box=control.bounding_box();assert box and box['x']>=0 and box['x']+box['width']<=case.width+1
    case.screenshot('manager')
    for script in [TEXT_CONTRAST_JS,CONTROL_CONTRAST_JS]:
        dialog.get_by_label('Cari mata uang',exact=True).evaluate("el=>el.scrollIntoView({block:'center'})")
        result=p.evaluate(script);case.contrasts.append(result)
        assert result['samples']>0 and not result['failures'],result['failures']
    dialog.get_by_role('button',name='Batal',exact=True).click();case.unchanged()
    path=case.args.output/f'{case.name}.csv';write_csv(path,EUR_ROWS)
    case.import_file(path);case.preview();case.unchanged();case.screenshot('generic-preview')
    p.get_by_label('Worksheet',exact=True).evaluate("el=>el.scrollIntoView({block:'center'})")
    p.screenshot(path=str(case.args.output/f'{case.name}-generic-mapping-viewport.png'),animations='disabled')
    for label in ['Kolom tanggal','Pemisah desimal','Urutan mutasi']:
        p.get_by_label(label,exact=True).evaluate("el=>el.scrollIntoView({block:'center'})")
        box=p.get_by_label(label,exact=True).bounding_box()
        assert box and box['x']>=0 and box['x']+box['width']<=case.width+1
        for script in [TEXT_CONTRAST_JS,CONTROL_CONTRAST_JS]:
            result=p.evaluate(script);case.contrasts.append(result)
            assert result['samples']>0 and not result['failures'],result['failures']


def cases():
    extended=document(extended=True)
    used=document(extended=True,entries=[entry('yen-spend','jpy',1000)])
    archived=document(extended=True,entries=[entry('yen-spend','jpy',1000)],archives=['jpy'])
    manual=document(extended=True,entries=[entry('manual','eur',2525,date='2026-10-29',note='Synthetic manual euro')])
    legacy_boundary=document(entries=[entry('legacy-boundary','try',8_575_606_148_499_318,
        type_='transfer',toWalletId='usd',toAmount=9_007_199_254_740_991,rate=1.050328,fee=0,
        category='',note='SYNTHETIC legacy boundary transfer')])
    legacy_boundary['state']['wallets']=[wallet('usd','USD',0),wallet('try','TRY',8_575_606_148_499_318)]
    invalid_nominal=lambda case:reject_nominal(case)
    return [
        ('catalog-add-cancel-and-create-precision-wallet',{},manage_add_wallet),
        ('hidden-used-currency-retains-history-report',{'data':used,'currency':'JPY'},hide_used_report),
        ('hide-unused-and-protect-last-visible',{},hide_unused_last),
        ('v6-currency-archive-backup-restore',{'data':archived},backup_archive),
        ('JPY-zero-digit-input',{'data':extended},precision_jpy),
        ('KWD-and-CLF-exact-minor-input',{'data':extended},precision_kwd_clf),
        ('FX-USD-to-JPY-major-rate',{'data':extended},fx_usd_jpy),
        ('FX-JPY-to-KWD-explicit-received',{'data':extended},fx_jpy_kwd),
        ('FX-conversion-overflow-no-write',{'data':extended},fx_overflow),
        ('legacy-FX-note-preserves-rate-and-MAX-target',{'data':legacy_boundary},legacy_fx_note_preserves_money),
        ('mapped-EUR-CSV-quoted-signed-duplicate',{'data':extended},csv_signed_duplicate),
        ('mapped-KWD-XLSX-debit-credit',{'data':extended},xlsx_debit_credit),
        ('mapped-locale-header-newest-order',{'data':extended},csv_locale_newest),
        ('reject-mixed-currency-file',{'data':extended},reject_currency),
        ('reject-zero-both-directions-overprecision',{'data':extended},invalid_nominal),
        ('reject-XLSX-formula',{'data':extended},reject_formula),
        ('reject-missing-or-broken-balances',{'data':extended},reject_balance),
        ('reject-invalid-date-and-order',{'data':extended},reject_date_order),
        ('cross-scheme-source-keep-explicit',{'data':cross_fixture()},cross_scheme),
        ('cross-scheme-source-distinct-explicit',{'data':cross_fixture()},lambda case:cross_scheme(case,True)),
        ('manual-overlap-review-no-duplicate',{'data':manual},manual_overlap),
        ('currency-quota-draft-and-once-retry',{},quota_currency_retry),
        ('currency-stale-manager-CAS',{},stale_currency_manager),
        ('generic-target-archive-invalidates-preview',{'data':extended},target_archive_reset),
        ('generic-mapping-invalidates-preview',{'data':extended},mapping_invalidates_preview),
        ('generic-failed-replacement-cannot-revive-old-file',{'data':extended},failed_replacement_does_not_revive_file),
        ('visual-320-light-currency-mapping',{'data':extended,'width':320},visual),
        ('visual-320-dark-currency-mapping',{'data':extended,'width':320,'theme':'dark'},visual),
    ]


def main():
    if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--url',default=os.environ.get('UANGKU_TEST_URL','http://127.0.0.1:4180'))
    parser.add_argument('--only',default='')
    args=parser.parse_args();args.output=args.output.resolve();args.output.mkdir(parents=True,exist_ok=True)
    build=assert_production_url(args.url);results=[]
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
                except Exception as cause:
                    result.update(error=str(cause),traceback=traceback.format_exc())
                    if case:
                        try:case.screenshot('failure')
                        except Exception:pass
                finally:
                    if case:
                        result.update(exact_financial_byte_checks=case.byte_checks,semantic_checks=case.semantic_checks,
                            page_errors=case.errors,contrasts=case.contrasts)
                        case.context.close()
                result['seconds']=round(time.monotonic()-start,3);results.append(result)
                print(compact({key:value for key,value in result.items() if key not in ['traceback','contrasts']}),flush=True)
        finally:browser.close()
    identity={'passed':assert_production_url(args.url)==build}
    report={'synthetic_only':True,'fresh_contexts':True,'browser_version':version,'dist_sha256':build,
        'url':args.url,'final_build_identity':identity,'results':results,
        'scope':'Chromium desktop and320px mobile emulation with generated CSV/XLSX; no personal data/profile',
        'contrast_scope':'Visible solid text/control samples; gradients and disabled controls excluded',
        'passed':bool(results) and all(row['status']=='passed' for row in results) and identity['passed']}
    (args.output/'summary.json').write_bytes((json.dumps(report,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
    print(compact({'passed':sum(row['status']=='passed' for row in results),
        'failed':sum(row['status']!='passed' for row in results),'dist_sha256':build}),flush=True)
    return 0 if report['passed'] else 1


if __name__=='__main__':raise SystemExit(main())
