"""Synthetic production regression for bank operation review and category clarity.

Fresh browser contexts only. No personal statement, saved browser profile, or
external classification is accessed. The generated workbook keeps source text,
signed amounts, running balances and duplicate identities independently checked.
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
    launch_browser, new_page, read_document, stored_document)
install_playwright_path()
from playwright.sync_api import sync_playwright, expect
from category_browser import compact, nav
from keyword_pack_browser import row_for
from theme_browser import TEXT_CONTRAST_JS, CONTROL_CONTRAST_JS

FINANCE, SETTINGS, UNCAT = 'uangku:v1', 'uangku:categories:v1', 'Belum dikategorikan'
REFUND = 'FACR-SYNTHETIC tam atm sorunlu işlem iadesi'
CARD = 'POS ALIŞVERİŞ (YURTİÇİ) KART NO: 0000 **** **** 0000 İŞYERİ: SYNTHETIC ALI FAST DEMIR MUTABAKAT: 111001'
SOURCE_ROWS = [
    ('card', CARD, -3600, 'expense', 'Belanja'),
    ('grocery', 'POS ALIŞVERİŞ İŞYERİ: BİM SYNTHETIC MARKET MUTABAKAT: 111002', -5200, 'expense', 'Bahan makanan'),
    ('food', 'SANAL POS ALIŞVERİŞ İŞYERİ: TRENDYOL YEMEK MUTABAKAT: 111003', -2100, 'expense', 'Makan & minum'),
    ('refund', REFUND, 1000, 'income', 'Pengembalian dana'),
    ('prepaid', 'PREPAID İADE SYNTHETIC 111005', 75, 'income', 'Cashback'),
    ('unknown-in', 'SYNTHETIC UNKNOWN CREDIT 111006', 700, 'unreviewed', UNCAT),
    ('ambiguous-refund', 'SYNTHETIC UNKNOWN İADESİ 111007', 200, 'unreviewed', UNCAT),
    ('refund-debit', 'TAM ATM SORUNLU İŞLEM İADESİ SYNTHETIC 111008', -100, 'unreviewed', UNCAT),
    ('card-credit', 'POS ALIŞVERİŞ İŞYERİ: SYNTHETIC UNKNOWN CREDIT SHOP MUTABAKAT: 111009', 400, 'unreviewed', UNCAT),
    ('purpose', 'POS ALIŞVERİŞ İŞYERİ: UBER TRIP SYNTHETIC MUTABAKAT: 111010', -500, 'expense', UNCAT),
]


def entry(id_, note, amount=2000, type_='expense', category=UNCAT, **extra):
    return {'id': id_, 'date': '2026-10-31', 'walletId': 'bank', 'type': type_,
        'amount': amount, 'category': category, 'note': note, **extra}


def document(entries=None):
    return {'app': 'uangku', 'version': 1, 'demo': False, 'state': {'version': 1,
        'wallets': [{'id': 'bank', 'name': 'Synthetic Ziraat', 'currency': 'TRY', 'kind': 'bank', 'openingBalance': 100000}],
        'entries': entries or []}}


def legacy_document():
    return document([
        entry('old-card', CARD),
        entry('old-refund', REFUND, 1000, 'unreviewed'),
        entry('manual-card', CARD+' MANUAL', 300, category='Pendidikan'),
        entry('manual-refund', REFUND+' MANUAL', 500, 'unreviewed', 'Pendidikan'),
        entry('ordinary-prepaid', 'PREPAID BONUS SYNTHETIC', 125, 'unreviewed'),
    ])


def signed(entry_):
    return -entry_['amount'] - entry_.get('fee', 0) if entry_['type'] in ['expense', 'transfer'] else entry_['amount']


def balance(data):
    return data['state']['wallets'][0]['openingBalance'] + sum(signed(row) for row in data['state']['entries'])


def counts(rows):
    types = [row for row in rows if row['type'] == 'unreviewed']
    categories = [row for row in rows if row['type'] in ['income', 'expense', 'unreviewed'] and row['category'] in ['', UNCAT]]
    return len({row['id'] for row in types+categories}), len(types), len(categories)


def write_statement(path, records=SOURCE_ROWS):
    running, data = 100000, []
    for id_, note, amount, _, _ in records:
        running += amount
        data.append(['31.10.2026', 'SYNTH-'+id_, note, amount/100, running/100])
    rows = [['Synthetic bank review example'], ['Currency', 'TL'], *[[] for _ in range(9)],
        ['Tarih', 'Fiş No', 'Açıklama', 'İşlem Tutarı', 'Bakiye'], *data]
    xml = ''.join('<row>'+''.join(f'<c t="{"n" if isinstance(value,(int,float)) else "str"}"><v>{escape(str(value))}</v></c>' for value in row)+'</row>' for row in rows)
    ns='xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    with ZipFile(path,'w',ZIP_DEFLATED) as archive:
        archive.writestr('xl/workbook.xml',f'<workbook {ns}><workbookPr date1904="0"/></workbook>')
        archive.writestr('xl/worksheets/sheet1.xml',f'<worksheet {ns}><sheetData>{xml}</sheetData></worksheet>')
    return running


class Case:
    def __init__(self,browser,args,name,*,data=None,settings=None,width=1440,theme='light'):
        self.args,self.name,self.width=args,name,width
        self.data=copy.deepcopy(data if data is not None else document())
        self.raw=compact(self.data)
        self.settings_raw=None if settings is None else compact(settings)
        self.byte_checks,self.semantic_checks=0,0
        self.errors,self.contrasts=[],[]
        parts=urlsplit(args.url)
        values=[{'name':FINANCE,'value':self.raw},
            {'name':'uangku:theme:v1','value':theme},
            {'name':'uangku:preferences:v1','value':compact({'currency':'TRY','lastWallets':{'TRY':'bank'}})}]
        if settings is not None:values.append({'name':SETTINGS,'value':self.settings_raw})
        self.context=browser.new_context(viewport={'width':width,'height':1000 if width>600 else 844},
            is_mobile=width<600,has_touch=width<600,color_scheme=theme,timezone_id='Europe/Istanbul',accept_downloads=True,
            storage_state={'cookies':[],'origins':[{'origin':f'{parts.scheme}://{parts.netloc}','localStorage':values}]})
        self.page=new_page(self.context)
        self.page.set_default_timeout(12000)
        self.page.on('pageerror',lambda error:self.errors.append(str(error)))
        self.page.goto(args.url,wait_until='networkidle')
        nav(self.page,'Transaksi')
        self.unchanged()

    def unchanged(self,raw=None,settings=True):
        assert self.page.evaluate('(key)=>localStorage.getItem(key)',FINANCE)==(self.raw if raw is None else raw),'Read action changed financial storage'
        if settings:assert self.page.evaluate('(key)=>localStorage.getItem(key)',SETTINGS)==self.settings_raw,'Read action wrote category configuration'
        self.byte_checks+=1

    def automation(self):
        self.page.get_by_role('button',name='Isi kategori otomatis',exact=True).click()
        dialog=self.page.get_by_role('dialog',name='Isi kategori otomatis',exact=True)
        expect(dialog).to_be_visible();return dialog

    def queue(self):
        nav(self.page,'Transaksi')
        self.page.get_by_label('Filter jenis transaksi',exact=True).select_option('pending')

    def count(self,prefix,total,types,categories):
        for suffix,value in [('total',total),('types',types),('categories',categories)]:
            node=self.page.get_by_test_id(prefix+'-'+suffix)
            expect(node).to_have_attribute('data-count',str(value))

    def import_(self,path):
        nav(self.page,'Impor mutasi')
        self.page.get_by_label('Dompet impor',exact=True).select_option('bank')
        self.page.get_by_label('File mutasi Ziraat',exact=True).set_input_files(path)
        expect(self.page.get_by_role('heading',name='Periksa sebelum disimpan',exact=True)).to_be_visible()

    def amount(self,field,value):
        expect(self.page.get_by_test_id('cashflow-'+field)).to_have_attribute('data-amount',str(value))

    def screenshot(self,label):
        assert self.page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Page overflows horizontally'
        self.page.screenshot(path=str(self.args.output/f'{self.name}-{label}.png'),full_page=True,animations='disabled')


def import_flow(case):
    p=case.page;path=case.args.output/f'{case.name}-synthetic.xlsx'
    closing=write_statement(path);case.import_(path)
    table=p.locator('.import-table tbody tr')
    for id_,note,amount,type_,category in SOURCE_ROWS:
        row=table.filter(has_text=note)
        expect(row).to_have_count(1)
        expect(row.locator('select').first).to_have_value(type_)
        expect(row.locator('.import-row-category')).to_have_value(category)
    case.count('import-review',5,4,5)
    filt=p.get_by_label('Tampilkan mutasi',exact=True)
    for value,n in [('type-pending',4),('category-pending',5),('pending',5),('all',len(SOURCE_ROWS))]:
        filt.select_option(value);expect(table).to_have_count(n)
    case.unchanged()
    p.get_by_role('button',name=f'Simpan {len(SOURCE_ROWS)} transaksi',exact=True).click()
    expect(p.get_by_role('heading',name='Periksa sebelum disimpan',exact=True)).to_have_count(0)
    saved=stored_document(p);by_note={row['note']:row for row in saved['state']['entries']}
    facts={row['description']:row for row in saved['metadata']['facts']}
    assert len(by_note)==len(facts)==len(SOURCE_ROWS)
    for _,note,amount,type_,category in SOURCE_ROWS:
        row=by_note[note]
        assert row['type']==type_ and row['category']==category
        assert signed(row)==amount and facts[note]['signedAmount']==amount
        assert not set(row)&{'toWalletId','toAmount','fee','rate'}
    assert balance(saved)==closing==90875
    case.semantic_checks+=3
    case.queue();case.count('review',5,4,5)
    expect(p.locator('.transactions-table tbody tr')).to_have_count(5)
    reason=p.get_by_label('Alasan perlu dirapikan',exact=True)
    for value,n in [('type',4),('category',5),('all',5)]:
        reason.select_option(value);expect(p.locator('.transactions-table tbody tr')).to_have_count(n)
    raw=p.evaluate('(key)=>localStorage.getItem(key)',FINANCE);case.unchanged(raw)
    nav(p,'Ringkasan')
    case.amount('inflow',2375);case.amount('outflow',11500)
    # This statement starts on31Oct. A1Oct opening predates its approved
    # baseline and must remain unavailable; all-period opening is book opening.
    expect(p.get_by_test_id('cashflow-opening')).not_to_have_attribute('data-amount',re.compile('.+'))
    expect(p.get_by_test_id('cashflow-reconciliation')).to_have_attribute('data-complete','false')
    p.get_by_label('Periode arus rekening',exact=True).select_option('all')
    case.amount('inflow',2375);case.amount('outflow',11500)
    case.amount('opening',100000);case.amount('closing',90875)
    expect(p.get_by_test_id('cashflow-reconciliation')).to_have_attribute('data-complete','true')
    case.unchanged(raw)
    case.import_(path)
    expect(p.get_by_role('button',name='Simpan 0 transaksi',exact=True)).to_be_disabled()
    case.unchanged(raw)
    p.get_by_role('button',name='Batalkan pratinjau',exact=True).click()
    p.reload(wait_until='networkidle');case.unchanged(raw)
    assert stored_document(p)==saved
    case.semantic_checks+=1


def legacy_apply(case):
    p=case.page;before=stored_document(p);case.unchanged()
    dialog=case.automation()
    expect(dialog.locator('.category-automation-row').filter(has_text=CARD).filter(has_not_text='MANUAL').get_by_role('combobox')).to_have_value('Belanja')
    expect(dialog.locator('.category-automation-row').filter(has_text=REFUND).filter(has_not_text='MANUAL').get_by_role('combobox')).to_have_value('Pengembalian dana')
    refund_row=dialog.locator('.category-automation-row').filter(has_text=REFUND).filter(has_not_text='MANUAL')
    expect(refund_row.locator('.bank-type-confirmation')).to_contain_text(re.compile('pengembalian dana',re.I))
    expect(refund_row.locator('.bank-type-confirmation')).not_to_contain_text('Cashback')
    expect(row_for(dialog,REFUND+' MANUAL').get_by_role('combobox')).to_have_value('Pendidikan')
    assert dialog.locator('.category-automation-row').filter(has_text=CARD+' MANUAL').count()==0
    case.unchanged()
    dialog.get_by_role('button',name='Terapkan 4 kategori',exact=True).click()
    expect(dialog).to_have_count(0)
    after=stored_document(p);expected=copy.deepcopy(before)
    by_id={row['id']:row for row in expected['state']['entries']}
    by_id['old-card']['category']='Belanja'
    by_id['old-refund'].update(type='income',category='Pengembalian dana')
    by_id['manual-refund']['type']='income'
    by_id['ordinary-prepaid'].update(type='income',category='Cashback')
    assert after==expected
    assert balance(before)==balance(after)
    assert len(after['state']['entries'])==len({row['id'] for row in after['state']['entries']})==len(before['state']['entries'])
    case.semantic_checks+=3
    raw=p.evaluate('(key)=>localStorage.getItem(key)',FINANCE)
    p.reload(wait_until='networkidle');case.unchanged(raw)
    nav(p,'Transaksi');dialog=case.automation()
    expect(dialog.get_by_role('button',name='Terapkan 0 kategori',exact=True)).to_be_disabled()
    dialog.get_by_role('button',name='Batal',exact=True).click();case.unchanged(raw)


def source_document():
    rows=[entry('source-card','Edited note: NETFLIX',2000),
        entry('source-blank',REFUND,1000,'unreviewed'),
        entry('source-refund','Edited note: ATM YATAN',500,'unreviewed','Pendidikan')]
    data=document(rows);running=100000;facts=[];links=[]
    for row,description in zip(rows,[CARD,'',REFUND]):
        running+=signed(row);fact_id='fact-'+row['id']
        facts.append({'id':fact_id,'walletId':'bank','currency':'TRY','postedOn':row['date'],
            'signedAmount':signed(row),'balanceAfter':running,'description':description,
            'fingerprintVersion':'ziraat-v1','fingerprint':f"ziraat:{len(facts)+1:016x}"})
        links.append({'entryId':row['id'],'source':fact_id})
    data['metadata']={'policy':'unverified-unless-linked','facts':facts,'links':links,
        'statements':[{'id':'statement','walletId':'bank','currency':'TRY','periodStart':'2026-10-31','periodEnd':'2026-10-31',
            'openingBalance':100000,'closingBalance':running,'rowIds':[row['id'] for row in facts]}]}
    return data


def source_first(case):
    p=case.page;before=stored_document(p);dialog=case.automation()
    expect(row_for(dialog,'Edited note: NETFLIX').get_by_role('combobox')).to_have_value('Belanja')
    expect(dialog.locator('.category-automation-row')).to_have_count(2)
    expect(row_for(dialog,'Edited note: ATM YATAN').get_by_role('combobox')).to_have_value('Pendidikan')
    case.unchanged()
    dialog.get_by_role('button',name='Terapkan 2 kategori',exact=True).click();expect(dialog).to_have_count(0)
    after=stored_document(p)
    assert after['metadata']['facts']==before['metadata']['facts']
    assert after['metadata']['links']==before['metadata']['links']
    assert after['metadata']['statements']==before['metadata']['statements']
    assert after['state']['entries'][0]['category']=='Belanja'
    assert after['state']['entries'][1]==before['state']['entries'][1]
    assert after['state']['entries'][2]['type']=='income' and after['state']['entries'][2]['category']=='Pendidikan'
    assert balance(after)==balance(before)
    case.semantic_checks+=5
    raw=p.evaluate('(key)=>localStorage.getItem(key)',FINANCE)
    nav(p,'Ringkasan');case.unchanged(raw)


def personal_settings(mode='suggest',version=4):
    return {'version':1,'keywordPackVersion':version,'names':[UNCAT,'Belanja','Pengembalian dana','Pendidikan','Cashback'],
        'rules':[{'id':'personal-pos','keyword':'SYNTHETIC PRIVATE SHOP','category':'Pendidikan','mode':mode}]}


def personal_rule(case):
    p=case.page;dialog=case.automation()
    rule=json.loads(case.settings_raw)['rules'][0]
    row=row_for(dialog,'SYNTHETIC PRIVATE SHOP')
    expect(row.get_by_role('combobox')).to_have_value('Pendidikan' if rule['mode']=='auto' else '')
    if rule['mode']=='suggest':
        expect(row).to_contain_text('Pendidikan')
        row.get_by_role('combobox').select_option('Pendidikan')
    case.unchanged()
    dialog.get_by_role('button',name='Terapkan 1 kategori',exact=True).click();expect(dialog).to_have_count(0)
    after=stored_document(p)
    assert after['state']['entries'][0]['category']=='Pendidikan'
    assert after['state']['entries'][0]['type']=='expense'
    assert balance(after)==balance(case.data)
    assert p.evaluate('(key)=>localStorage.getItem(key)',SETTINGS)==case.settings_raw
    case.semantic_checks+=2


def deleted_rule(case):
    p=case.page;path=case.args.output/f'{case.name}-synthetic.xlsx'
    write_statement(path,[SOURCE_ROWS[0],SOURCE_ROWS[3]])
    case.import_(path)
    rows=p.locator('.import-table tbody tr')
    for row in rows.all():expect(row.locator('.import-row-category')).to_have_value(UNCAT)
    case.count('import-review',2,0,2)
    case.unchanged()
    p.get_by_role('button',name='Batalkan pratinjau',exact=True).click()
    nav(p,'Transaksi');p.get_by_role('button',name='Kelola kategori',exact=True).click()
    dialog=p.get_by_role('dialog',name='Kelola kategori',exact=True)
    expect(dialog.locator('.category-manager-rules li')).to_have_count(0)
    dialog.get_by_role('button',name='Simpan pengaturan',exact=True).click();expect(dialog).to_have_count(0)
    assert json.loads(p.evaluate('(key)=>localStorage.getItem(key)',SETTINGS))==json.loads(case.settings_raw)
    case.unchanged(settings=False)


def queue_subsets(case):
    p=case.page;case.queue();case.count('review',3,2,2)
    table=p.locator('.transactions-table tbody tr')
    expect(table).to_have_count(3)
    reason=p.get_by_label('Alasan perlu dirapikan',exact=True)
    for value,ids in [('type',['both','type-only']),('category',['both','category-only']),('all',['both','type-only','category-only'])]:
        reason.select_option(value);expect(table).to_have_count(len(ids))
        for id_ in ids:expect(table.filter(has_text='SYNTHETIC '+id_)).to_have_count(1)
        case.unchanged()
    p.reload(wait_until='networkidle');case.unchanged()


def direction_guards(case):
    p=case.page;dialog=case.automation()
    # No wrong-direction/reversal should acquire an automatic category merely
    # from the recognizable words. If a suggestion is displayed it stays skipped.
    for row in dialog.locator('.category-automation-row').all():
        expect(row.get_by_role('combobox')).to_have_value('')
    expect(dialog.get_by_role('button',name='Terapkan 0 kategori',exact=True)).to_be_disabled()
    case.unchanged()
    dialog.get_by_role('button',name='Batal',exact=True).click()
    case.queue();case.count('review',4,4,4)
    expect(p.locator('.transactions-table tbody tr')).to_have_count(4)
    case.unchanged()


def presentation(case):
    p=case.page;rows=p.locator('.transactions-table tbody tr')
    row=rows.filter(has_text='SYNTHETIC ALI FAST DEMIR')
    expect(row).to_have_count(1)
    expect(row.locator('.transaction-title')).not_to_contain_text('KART NO')
    expect(row).to_contain_text('Pembayaran kartu')
    assert row.locator('[data-bank-operation="bank-transfer"]').count()==0
    row.get_by_role('button',name=re.compile('^Rincian nominal')).click()
    dialog=p.get_by_role('dialog',name='Rincian nominal',exact=True)
    expect(dialog).to_contain_text(CARD)
    expect(dialog).to_contain_text('Pembayaran kartu')
    case.unchanged();case.screenshot('source-details')
    dialog.get_by_role('button',name='Tutup rincian',exact=True).click()
    case.unchanged()


def visual(case):
    queue_subsets(case)
    p=case.page;case.queue()
    p.get_by_label('Alasan perlu dirapikan',exact=True).scroll_into_view_if_needed()
    case.screenshot('review')
    # Full-page capture can move the viewport; measure each actual filter
    # only after deliberately centering it, including the wallet scope.
    for label in ['Dompet riwayat', 'Filter jenis transaksi', 'Alasan perlu dirapikan']:
        p.get_by_label(label,exact=True).evaluate("el=>el.scrollIntoView({block:'center'})")
        for script in [TEXT_CONTRAST_JS,CONTROL_CONTRAST_JS]:
            result=p.evaluate(script);case.contrasts.append(result)
            assert result['samples']>0, ('No visible contrast samples',label)
            assert not result['failures'],result['failures']
    case.unchanged()


def cases():
    private=document([entry('private','POS ALIŞVERİŞ İŞYERİ: SYNTHETIC PRIVATE SHOP')])
    deleted={'version':1,'keywordPackVersion':5,'names':[UNCAT,'Belanja','Pengembalian dana'],'rules':[]}
    queue=document([entry('both','SYNTHETIC both',-100,'unreviewed'),
        entry('type-only','SYNTHETIC type-only',100,'unreviewed','Pendidikan'),
        entry('category-only','SYNTHETIC category-only'),
        entry('done','SYNTHETIC done',500,'expense','Pendidikan')])
    directions=document([entry('wrong-refund','tam atm sorunlu işlem iadesi',-100,'unreviewed'),
        entry('unknown-refund','UNKNOWN İADESİ',100,'unreviewed'),
        entry('positive-card','POS ALIŞVERİŞ İŞYERİ: SYNTHETIC SHOP',100,'unreviewed'),
        entry('cancelled-refund','tam atm sorunlu işlem iadesi İPTAL',100,'unreviewed')])
    return [
        ('import-review-desktop',{},import_flow),
        ('import-review-mobile-dark',{'width':320,'theme':'dark'},import_flow),
        ('legacy-reviewed-only-type-and-category',{'data':legacy_document()},legacy_apply),
        ('source-first-manual-category-protection',{'data':source_document()},source_first),
        ('manual-auto-rule-higher-priority',{'data':private,'settings':personal_settings('auto')},personal_rule),
        ('manual-suggestion-not-forced',{'data':private,'settings':personal_settings('suggest')},personal_rule),
        ('deleted-v5-rules-not-restored',{'settings':deleted},deleted_rule),
        ('queue-union-and-subsets',{'data':queue},queue_subsets),
        ('direction-refund-cancellation-guards',{'data':directions},direction_guards),
        ('friendly-card-title-raw-facts-preserved',{'data':document([entry('card',CARD)])},presentation),
        ('visual-320-dark-review',{'data':queue,'width':320,'theme':'dark'},visual),
        ('visual-320-light-review',{'data':queue,'width':320,'theme':'light'},visual),
    ]


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,required=True)
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
                    assert not case.errors,case.errors
                    result['status']='passed'
                except Exception as error:
                    result.update(error=str(error),traceback=traceback.format_exc())
                    if case:
                        try:case.page.screenshot(path=str(args.output/f'{name}-failure.png'),full_page=True)
                        except Exception:pass
                finally:
                    if case:
                        result.update(exact_financial_byte_checks=case.byte_checks,semantic_checks=case.semantic_checks,
                            page_errors=case.errors,contrasts=case.contrasts)
                        case.context.close()
                result['seconds']=round(time.monotonic()-start,3);results.append(result)
                print(compact({key:value for key,value in result.items() if key not in ['traceback','contrasts']}),flush=True)
        finally:browser.close()
    identity={'passed':False}
    try:identity={'passed':assert_production_url(args.url)==build}
    except Exception as error:identity['error']=str(error)
    report={'synthetic_only':True,'fresh_contexts':True,'browser_version':version,'dist_sha256':build,
        'url':args.url,'final_build_identity':identity,'results':results,
        'scope':'Chromium Windows automated desktop and320px mobile emulation; no real user profile or financial file',
        'contrast_scope':'Visible solid text/control backgrounds; gradients and disabled controls excluded',
        'passed':bool(results) and all(row['status']=='passed' for row in results) and identity['passed']}
    (args.output/'summary.json').write_bytes((json.dumps(report,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
    print(compact({'passed':sum(row['status']=='passed' for row in results),'failed':sum(row['status']!='passed' for row in results),'dist_sha256':build}),flush=True)
    return 0 if report['passed'] else 1


if __name__=='__main__':
    raise SystemExit(main())
