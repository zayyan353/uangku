"""Synthetic production-browser coverage for reconstructed source/transfer flows."""
from __future__ import annotations
import argparse,json,os,re,time,traceback
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile,ZIP_DEFLATED
from browser_support import assert_production_url,install_playwright_path,launch_browser,new_page,stored_document,read_document
install_playwright_path()
from playwright.sync_api import sync_playwright,expect
from recovery_browser import write_statement,saldo

KEY='uangku:v1'
URL=os.environ.get('UANGKU_TEST_URL','http://127.0.0.1:4180')
MOBILE=False
def fixture():
    return {'app':'uangku','version':1,'demo':False,'state':{'version':1,'wallets':[
        {'id':'bank','name':'Synthetic Ziraat','currency':'TRY','kind':'bank','openingBalance':0},
        {'id':'cash','name':'Synthetic second bank','currency':'TRY','kind':'bank','openingBalance':0}], 'entries':[]}}
def nav(page,label):page.locator('.sidebar' if page.locator('.sidebar').is_visible() else '.mobile-nav').get_by_role('button',name=re.compile('^'+re.escape(label)+r'(?:\s+\d+)?$')).click()
def wait_doc(page,predicate):
    end=time.monotonic()+20
    while time.monotonic()<end:
        data=stored_document(page)
        if data and predicate(data):return data
        page.wait_for_timeout(50)
    raise AssertionError('Persisted document did not reach expected state')
def context_page(browser,initial):
    context=browser.new_context(viewport={'width':390,'height':844} if MOBILE else {'width':1440,'height':1000},is_mobile=MOBILE,has_touch=MOBILE,timezone_id='Europe/Istanbul',accept_downloads=True)
    raw=json.dumps(initial,ensure_ascii=False,separators=(',',':'))
    context.add_init_script('if(localStorage.getItem("uangku:v1")===null)localStorage.setItem("uangku:v1",'+json.dumps(raw)+');')
    page=new_page(context);page.set_default_timeout(15000)
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(URL,wait_until='networkidle')
    page.locator('.currency-tab').filter(has_text='Lira Turki').click()
    return context,page,errors
def import_file(page,path,wallet='bank'):
    nav(page,'Impor mutasi');page.get_by_label('Dompet impor',exact=True).select_option(wallet)
    page.get_by_label('File mutasi Ziraat',exact=True).set_input_files(path)
    expect(page.get_by_role('heading',name='Periksa sebelum disimpan')).to_be_visible()
def save_import(page,count):
    page.get_by_role('button',name=f'Simpan {count} transaksi',exact=True).click()
    expect(page.get_by_role('heading',name='Periksa sebelum disimpan')).to_have_count(0)
    expect(page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
def make_statement(path,date,amount,balance,description):
    rows=[['Synthetic only'],['Mata uang','TL'],*[[]for _ in range(9)],['Tarih','Fiş No','Açıklama','İşlem Tutarı','Bakiye'],[date,'SYNTH-REF',description,amount,balance]]
    xml=''.join('<row>'+''.join(f'<c t="{"n"if isinstance(v,(int,float))else"str"}"><v>{escape(str(v))}</v></c>'for v in row)+'</row>'for row in rows)
    ns='xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    with ZipFile(path,'w',ZIP_DEFLATED)as z:
        z.writestr('xl/workbook.xml',f'<workbook {ns}><workbookPr date1904="0"/></workbook>')
        z.writestr('xl/worksheets/sheet1.xml',f'<worksheet {ns}><sheetData>{xml}</sheetData></worksheet>')

def partial_completion_override(browser,out):
    context,page,errors=context_page(browser,fixture())
    try:
        path=out/'partial.xlsx';write_statement(path);import_file(page,path)
        boxes=page.locator('.import-table tbody input[type=checkbox]');boxes.nth(1).uncheck();boxes.nth(2).uncheck()
        save_import(page,1)
        partial=wait_doc(page,lambda d:len(d['state']['entries'])==1)
        assert saldo(partial,'bank')==9450 and len(partial['metadata']['facts'])==3
        facts=partial['metadata']['facts']
        card=page.get_by_label('Rekonsiliasi file tersimpan').locator('details').first
        card.locator('summary').click();card.get_by_label(re.compile('^Alasan pelengkapan ')).fill('Melengkapi semua mutasi file sintetis')
        card.get_by_role('button',name='Pratinjau pelengkapan',exact=True).click()
        expect(card).to_contain_text('174,50')
        card.get_by_role('button',name='Lengkapi dan simpan',exact=True).click()
        complete=wait_doc(page,lambda d:len(d['state']['entries'])==3)
        assert saldo(complete,'bank')==17450 and complete['metadata']['facts']==facts
        page.reload(wait_until='networkidle');nav(page,'Transaksi')
        page.get_by_label('Cari transaksi',exact=True).fill('POS toko contoh')
        page.get_by_role('button',name='Ubah POS toko contoh',exact=True).click()
        dlg=page.get_by_role('dialog');dlg.get_by_label('Nominal',exact=True).fill('30')
        dlg.get_by_role('button',name='Simpan transaksi',exact=True).click()
        expect(dlg.get_by_role('alert')).to_contain_text('alasan')
        assert stored_document(page)==complete
        dlg.get_by_label('Alasan perubahan',exact=True).fill('Koreksi nilai buku berdasarkan bukti sintetis')
        dlg.get_by_role('button',name='Simpan transaksi',exact=True).click();expect(dlg).to_have_count(0)
        corrected=wait_doc(page,lambda d:bool(d['metadata'].get('overrides')))
        assert corrected['metadata']['facts']==facts and saldo(corrected,'bank')==17000
        import_file(page,path)
        page.get_by_role('button',name='Pulihkan fakta bank',exact=True).click();save_import(page,1)
        restored=wait_doc(page,lambda d:saldo(d,'bank')==17450)
        assert restored['metadata']['facts']==facts and len(restored['state']['entries'])==3
        import_file(page,path)
        assert page.get_by_role('button',name='Simpan 0 transaksi',exact=True).is_disabled()
        assert stored_document(page)==restored
        page.screenshot(path=str(out/'source-completion.png'),full_page=True)
        assert not errors,errors
        return restored
    finally:context.close()

def transfer_lifecycle(browser,out):
    context,page,errors=context_page(browser,fixture())
    try:
        debit=out/'debit.xlsx';credit=out/'credit.xlsx'
        # Unknown legacy exchange wording still requires the user's explicit
        # two-account pairing; known HAVALE/EFT now create bank-only movements.
        make_statement(debit,'31.10.2026',-20,100,'DOVIZ debit synthetic')
        make_statement(credit,'01.11.2026',20,20,'DOVIZ credit synthetic')
        import_file(page,debit,'bank');save_import(page,1)
        import_file(page,credit,'cash');save_import(page,1)
        separate=wait_doc(page,lambda d:len(d['state']['entries'])==2)
        nav(page,'Transaksi');page.get_by_label('Filter jenis transaksi',exact=True).select_option('pending')
        page.get_by_role('button',name='Cek DOVIZ debit synthetic',exact=True).click()
        dlg=page.get_by_role('dialog');dlg.get_by_role('button',name=re.compile('^Cocokkan transfer Synthetic second bank')).click()
        expect(dlg.get_by_label('Tanggal debit',exact=True)).to_have_value('2026-10-31')
        expect(dlg.get_by_label('Tanggal kredit',exact=True)).to_have_value('2026-11-01')
        dlg.get_by_role('button',name='Simpan hasil cek',exact=True).click();expect(dlg).to_have_count(0)
        paired=wait_doc(page,lambda d:len(d['state']['entries'])==1)
        assert paired['state']['entries'][0]['type']=='transfer'
        dates=paired['metadata']['transfers'][0]
        assert dates['sourceDate']=='2026-10-31'and dates['destinationDate']=='2026-11-01'
        assert paired['metadata']['facts']==separate['metadata']['facts']
        assert saldo(paired,'bank')==10000 and saldo(paired,'cash')==2000
        page.get_by_label('Filter jenis transaksi',exact=True).select_option('all')
        page.get_by_label('Periode transaksi',exact=True).select_option('all')
        note=paired['state']['entries'][0]['note']
        page.get_by_role('button',name='Hapus '+(note or 'transaksi'),exact=True).click()
        dlg=page.get_by_role('dialog');dlg.get_by_label('Alasan tindakan',exact=True).fill('Uji penghapusan grup sintetis')
        dlg.get_by_role('button',name='Hapus transaksi',exact=True).click()
        deleted=wait_doc(page,lambda d:len(d['state']['entries'])==0)
        assert len(deleted['metadata']['deletedTransfers'])==1 and deleted['metadata']['facts']==paired['metadata']['facts']
        nav(page,'Impor mutasi');page.get_by_label('Alasan pemulihan transfer',exact=True).fill('Memulihkan seluruh grup uji')
        page.get_by_role('button',name='Pulihkan seluruh transfer',exact=True).click()
        again=wait_doc(page,lambda d:len(d['state']['entries'])==1)
        assert again['state']==paired['state'] and again['metadata']['transfers']==paired['metadata']['transfers']
        nav(page,'Transaksi');page.get_by_role('button',name='Ubah '+(note or 'transaksi'),exact=True).click()
        page.get_by_role('dialog').get_by_role('button',name='Pisahkan transfer',exact=True).click()
        dlg=page.get_by_role('dialog');dlg.get_by_label('Alasan tindakan',exact=True).fill('Mengembalikan dua mutasi asli untuk peninjauan')
        dlg.get_by_role('button',name='Pisahkan transfer',exact=True).click()
        unpaired=wait_doc(page,lambda d:len(d['state']['entries'])==2)
        assert sorted(e['date']for e in unpaired['state']['entries'])==['2026-10-31','2026-11-01']
        assert unpaired['metadata']['facts']==paired['metadata']['facts']
        assert saldo(unpaired,'bank')==10000 and saldo(unpaired,'cash')==2000
        page.reload(wait_until='networkidle');assert stored_document(page)==unpaired
        assert not errors,errors
    finally:context.close()

def metadata_backup_roundtrip(browser,out,initial):
    context,page,errors=context_page(browser,initial)
    path=out/'source-backup.json'
    try:
        with page.expect_download()as download:page.get_by_role('button',name='Cadangkan data' if page.locator('.sidebar').is_visible() else 'Cadangkan',exact=True).click()
        download.value.save_as(path)
        assert read_document(path)==initial
        wire=json.loads(path.read_text(encoding='utf-8'))
        assert wire['version']==2
        table=wire['t']['links'];field=table['k'].index('source');mask=table['r'][0][0]
        if mask&(1<<field):table['r'][0][1+sum(bool(mask&(1<<bit))for bit in range(field))]=999999999
        else:table['d']['source']=999999999
        broken=out/'invalid-source-reference.json';broken.write_text(json.dumps(wire),encoding='utf-8')
        before=page.evaluate('localStorage.getItem("uangku:v1")')
        page.get_by_label('File cadangan Uangku',exact=True).set_input_files(broken)
        expect(page.locator('.toast')).to_be_visible()
        assert page.get_by_role('button',name='Pulihkan data',exact=True).count()==0
        assert page.evaluate('localStorage.getItem("uangku:v1")')==before
        assert not errors,errors
    finally:context.close()
    context,page,errors=context_page(browser,fixture())
    try:
        page.get_by_label('File cadangan Uangku',exact=True).set_input_files(path)
        page.get_by_role('dialog').get_by_role('button',name='Pulihkan data',exact=True).click()
        restored=wait_doc(page,lambda d:len(d['state']['entries'])==len(initial['state']['entries']))
        assert restored==initial
        page.reload(wait_until='networkidle');assert stored_document(page)==initial
        assert not errors,errors
    finally:context.close()

def quota_metadata_retry(browser,out,initial):
    context,page,errors=context_page(browser,initial)
    try:
        original=page.evaluate('localStorage.getItem("uangku:v1")')
        page.evaluate('''() => { const set=Storage.prototype.setItem;window.failSourceSave=true;Storage.prototype.setItem=function(k,v){if(k==='uangku:v1'&&window.failSourceSave)throw new DOMException('Synthetic quota','QuotaExceededError');return set.call(this,k,v)}; }''')
        nav(page,'Transaksi');page.get_by_label('Cari transaksi',exact=True).fill('POS toko contoh')
        page.get_by_role('button',name='Ubah POS toko contoh',exact=True).click()
        dlg=page.get_by_role('dialog');dlg.get_by_label('Nominal',exact=True).fill('31')
        dlg.get_by_label('Alasan perubahan',exact=True).fill('Uji kegagalan simpan metadata')
        dlg.get_by_role('button',name='Simpan transaksi',exact=True).click()
        expect(page.get_by_test_id('save-status')).to_contain_text('belum tersimpan')
        assert page.evaluate('localStorage.getItem("uangku:v1")')==original
        dlg.get_by_role('button',name='Batal',exact=True).click()
        with page.expect_download()as download:page.get_by_role('button',name='Unduh pekerjaan yang belum tersimpan',exact=True).click()
        path=out/'source-quota-recovery.json';download.value.save_as(path)
        recovery=read_document(path)
        assert recovery['metadata']['facts']==initial['metadata']['facts']and len(recovery['state']['entries'])==3
        page.evaluate('window.failSourceSave=false')
        page.get_by_role('button',name='Coba simpan lagi',exact=True).click()
        expect(page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
        assert stored_document(page)==recovery
        page.reload(wait_until='networkidle');assert stored_document(page)==recovery
        assert not errors,errors
    finally:context.close()

def main():
    global MOBILE
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=Path('test-results/source'));parser.add_argument('--mobile',action='store_true');args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True);MOBILE=args.mobile
    build=assert_production_url(URL);results=[]
    with sync_playwright()as p:
        browser=launch_browser(p);initial=None
        for name,run in [('partial-completion-override-reimport',lambda:partial_completion_override(browser,args.output)),('two-date-transfer-delete-restore-unpair',lambda:transfer_lifecycle(browser,args.output)),('source-quota-recovery-retry',lambda:quota_metadata_retry(browser,args.output,initial)),('metadata-backup-roundtrip-invalid-reference',lambda:metadata_backup_roundtrip(browser,args.output,initial))]:
            try:
                result=run()
                if result:initial=result
                results.append({'name':name,'status':'passed'})
            except Exception as error:results.append({'name':name,'status':'failed','error':str(error),'traceback':traceback.format_exc()})
        version=browser.version;browser.close()
    report={'build':build,'browser':version,'synthetic_only':True,'mobile_emulation':MOBILE,'results':results,'passed':sum(x['status']=='passed'for x in results),'failed':sum(x['status']=='failed'for x in results)}
    (args.output/'summary.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8');print(json.dumps(report,ensure_ascii=False));raise SystemExit(bool(report['failed']))
if __name__=='__main__':main()
