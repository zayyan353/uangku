"""Synthetic production-browser coverage for the Bank Jago PDF reader.

The PDF is generated here with the layout of the bank's "Pocket Transactions
History" export: Type0 font with a ToUnicode map, FlateDecode content. All
names, accounts and amounts are invented.
"""
from __future__ import annotations
import argparse, json, os, re, time, traceback, zlib
from pathlib import Path
from browser_support import assert_production_url, install_playwright_path, launch_browser, new_page, stored_document
install_playwright_path()
from playwright.sync_api import sync_playwright, expect
from recovery_browser import saldo

URL = os.environ.get('UANGKU_TEST_URL', 'http://127.0.0.1:4180')

# (date, time, party lines, party detail lines, title lines, id lines, note lines, amount, balance)
ROWS = [
    ('01 Jan 2026', '08.00', ['Pemindahan dari Akun', 'Lama'], [], ['Pemindahan dari Akun', 'Lama'], ['11111111'], [], '+1.000,50', '1.000,50'),
    ('02 Jan 2026', '09.15', ['BUDI CONTOH SANT'], ['ALTOPay 9990001112'], ['Transfer Masuk'], ['900000000001_20260102_', '9990001112'], ['BUDI CONTOH SANT'], '+500.000,00', '501.000,50'),
    ('02 Jan 2026', '09.20', ['Budi Contoh'], ['Pindah uang antar Kantong'], ['Tambah Uang Kantong'], ['22222222'], [], '-100.000', '401.000,50'),
    ('03 Jan 2026', '10.05', ['PENJUAL CONTOH'], ['BCA 0000111122'], ['Transfer Keluar'], ['26003T000001'], ['bayar kursus'], '-1.000', '400.000,50'),
    ('04 Feb 2026', '12.30', ['GoPay'], ['0320260204000001AbCdEf', 'GhID-1'], ['Pembayaran dengan', 'Jago Pay'], ['0320260204000001AbCd', 'EfGhID-1'], ['004 - GO-FOODWarung Contoh'], '-60.000', '340.000,50'),
    ('05 Feb 2026', '06.48', ['TOKO.CONTOH'], ['•••• 0000'], ['Transaksi POS'], ['600000000001'], [], '-20.864,10', '319.136,40'),
    ('05 Feb 2026', '07.02', ['TOKO.CONTOH'], ['Jago'], ['Transaksi POS'], ['600000000001'], [], '+20.864,10', '340.000,50'),
    ('07 Mar 2026', '22.20', ['Bonus Jago Debit Card'], [], ['Bonus'], ['260307-ABCD-EFGH12'], ['Promo Debit Card'], '+10.000,00', '350.000,50'),
    ('08 Mar 2026', '07.00', ['Layanan Contoh'], [], ['Biaya Layanan Contoh'], ['260308-ZZZZ-000001'], [], '-1.000', '349.000,50'),
    ('09 Mar 2026', '07.00', ['ORANG LAIN'], ['BNI 0000000000'], ['Transfer Masuk'], ['260309-ZZZZ-000002'], [], '+5.000,00', '354.000,50'),
]
EXPECTED_TYPES = ['income', 'income', 'expense', 'expense', 'expense', 'expense', 'income', 'income', 'expense', 'income']


def pdf(pages):
    """pages: list of lists of (x, y, size, text). One Identity-H font, mapped by ToUnicode."""
    chars = sorted({ord(c) for page in pages for *_, text in page for c in text})
    cmap = ('/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n'
            f'{len(chars)} beginbfchar ' + ' '.join(f'<{c:04X}> <{c:04X}>' for c in chars) + ' endbfchar\nendcmap end end')
    objects = []

    def add(body):
        objects.append(body)
        return len(objects)

    def stream(data):
        packed = zlib.compress(data)
        return b'<< /Filter /FlateDecode /Length %d >>\nstream\n' % len(packed) + packed + b'\nendstream'

    catalog = add(b''); tree = add(b'')
    unicode_map = add(stream(cmap.encode()))
    descendant = add(b'<< /Type /Font /Subtype /CIDFontType2 /BaseFont /ABCDEF+Synthetic >>')
    font = add(b'<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+Synthetic /Encoding /Identity-H /DescendantFonts [%d 0 R] /ToUnicode %d 0 R >>' % (descendant, unicode_map))
    kids = []
    for page in pages:
        content = '\n'.join(f'/F1 {size} Tf BT {x} {y} Td <{"".join(f"{ord(c):04X}" for c in text)}> Tj ET' for x, y, size, text in page)
        body = add(stream(content.encode()))
        kids.append(add(b'<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595 842] /Contents %d 0 R /Resources << /Font << /F1 %d 0 R >> >> >>' % (tree, body, font)))
    objects[catalog - 1] = b'<< /Type /Catalog /Pages %d 0 R >>' % tree
    objects[tree - 1] = b'<< /Type /Pages /Count %d /Kids [%s] >>' % (len(kids), b' '.join(b'%d 0 R' % k for k in kids))
    out = bytearray(b'%PDF-1.6\n')
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b'%d 0 obj\n' % number + body + b'\nendobj\n'
    xref = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objects) + 1) + b''.join(b'%010d 00000 n \n' % o for o in offsets)
    out += b'trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objects) + 1, catalog, xref)
    return bytes(out)


def jago_statement(rows, per_page=5):
    pages, page, y = [], [], 0
    month = ''
    months = {'Jan': 'Januari', 'Feb': 'Februari', 'Mar': 'Maret'}

    def start(first):
        nonlocal page, y
        page = [(348, 809.89, 12, 'Pocket Transactions History')]
        header = 647.74 if first else 717.74
        if first:
            page += [(20, 753.89, 16, 'BUDI CONTOH SANTOSO'), (20, 735.89, 12, 'Kantong Utama 100200300400'),
                     (505.68, 691.89, 12, f'IDR {rows[-1][8]}'), (20, 705.89, 10, 'Menampilkan transaksi IDR dari')]
        page += [(x, header, 9, label) for x, label in [(24, 'Tanggal & Waktu'), (86, 'Sumber/Tujuan'), (186, 'Rincian Transaksi'), (290, 'Catatan'), (457.08, 'Jumlah'), (551.29, 'Saldo')]]
        page += [(103, 31.7, 9, 'PT Bank Jago Tbk berizin dan diawasi oleh OJK'), (521.64, 27.7, 9, 'www.jago.com')]
        pages.append(page)
        y = header - 22

    start(True)
    for index, (date, clock, party, party_detail, title, ids, note, amount, balance) in enumerate(rows):
        if index and index % per_page == 0:
            start(False)
        label = date.split(' ', 1)[1]
        if label != month:
            month = label
            page.append((24, y, 9, f'{months[label.split()[0]]} {label.split()[1]}'))
            y -= 20
        top = y
        page += [(24, top, 10, date), (24, top - 12, 8, clock)]
        line = top + 0.25
        for text in party: page.append((86, line, 10, text)); line -= 12
        for text in party_detail: page.append((86, line, 8, text)); line -= 9.6
        detail = top - 0.17
        for text in title: page.append((186, detail, 10, text)); detail -= 12
        for part, text in enumerate(ids): page.append((186, detail, 8, text if part else f'ID# {text}')); detail -= 9.6
        note_y = top
        for text in note: page.append((290, note_y, 9, text)); note_y -= 10.8
        page += [(500 - len(amount) * 5, top - 0.5, 10, amount), (590 - len(balance) * 5, top - 0.5, 10, balance)]
        y = min(line, detail, note_y, top - 12) - 18
    page.append((20, y - 20, 10, 'Info Penting'))
    return pdf(pages)


def fixture():
    return {'app': 'uangku', 'version': 1, 'demo': False, 'state': {'version': 1, 'wallets': [
        {'id': 'ziraat', 'name': 'Ziraat contoh', 'currency': 'TRY', 'kind': 'bank', 'openingBalance': 0},
        {'id': 'other-idr', 'name': 'Bank lain contoh', 'currency': 'IDR', 'kind': 'bank', 'openingBalance': 0},
        {'id': 'jago', 'name': 'Jago contoh', 'currency': 'IDR', 'kind': 'bank', 'openingBalance': 0}], 'entries': []}}


def nav(page, label):
    page.locator('.sidebar' if page.locator('.sidebar').is_visible() else '.mobile-nav').get_by_role('button', name=re.compile('^' + re.escape(label) + r'(?:\s+\d+)?$')).click()


def wait_doc(page, predicate):
    end = time.monotonic() + 20
    while time.monotonic() < end:
        data = stored_document(page)
        if data and predicate(data):
            return data
        page.wait_for_timeout(50)
    raise AssertionError('Persisted document did not reach expected state')


def context_page(browser, mobile):
    context = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1440, 'height': 1000},
                                  is_mobile=mobile, has_touch=mobile, timezone_id='Asia/Jakarta')
    raw = json.dumps(fixture(), ensure_ascii=False, separators=(',', ':'))
    context.add_init_script('if(localStorage.getItem("uangku:v1")===null)localStorage.setItem("uangku:v1",' + json.dumps(raw) + ');')
    page = new_page(context); page.set_default_timeout(15000)
    errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(URL, wait_until='networkidle')
    return context, page, errors


def open_jago(page):
    nav(page, 'Impor mutasi')
    page.get_by_role('button', name='Bank Jago PDF · otomatis', exact=True).click()
    expect(page.get_by_role('button', name='Bank Jago PDF · otomatis', exact=True)).to_have_attribute('aria-pressed', 'true')
    # Only IDR wallets are offered, and the one named after the bank is chosen.
    expect(page.get_by_label('Dompet impor', exact=True)).to_have_value('jago')
    options = page.get_by_label('Dompet impor', exact=True).locator('option').all_inner_texts()
    assert options == ['Bank lain contoh · IDR', 'Jago contoh · IDR'], options


def import_and_save(browser, out, mobile):
    context, page, errors = context_page(browser, mobile)
    try:
        path = out / 'jago-sintetis.pdf'; path.write_bytes(jago_statement(ROWS))
        open_jago(page)
        page.get_by_label('File mutasi Bank Jago', exact=True).set_input_files(path)
        expect(page.get_by_role('heading', name='Periksa sebelum disimpan')).to_be_visible()
        save = page.get_by_role('button', name=f'Simpan {len(ROWS)} transaksi', exact=True)
        expect(save).to_be_enabled()
        page.screenshot(path=str(out / f'jago-preview{"-mobile" if mobile else ""}.png'), full_page=True)
        width = page.evaluate('() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]')
        assert width[0] <= width[1], f'Halaman impor meluber horizontal: {width}'
        save.click()
        expect(page.get_by_role('heading', name='Periksa sebelum disimpan')).to_have_count(0)
        expect(page.get_by_test_id('import-result')).to_contain_text(f'{len(ROWS)} transaksi tersimpan ke Jago contoh')
        saved = wait_doc(page, lambda d: len(d['state']['entries']) == len(ROWS))
        entries = sorted(saved['state']['entries'], key=lambda e: (e['date'], e['sourceKey']))
        types = [e['type'] for e in sorted(saved['state']['entries'], key=lambda e: next(i for i, f in enumerate(saved['metadata']['facts']) if f['fingerprint'] == e['sourceKey']))]
        assert types == EXPECTED_TYPES, types
        assert all(e['walletId'] == 'jago' for e in entries)
        assert saldo(saved, 'jago') == 35_400_050, saldo(saved, 'jago')
        facts = saved['metadata']['facts']
        assert len(facts) == len(ROWS) and all(f['fingerprintVersion'] == 'generic-v1' and f['currency'] == 'IDR' for f in facts)
        assert any(f['reference'] == '900000000001_20260102_9990001112' for f in facts)
        assert any(e['category'] == 'Makan & minum' for e in entries) and any(e['category'] == 'Cashback' for e in entries)
        # The same file again: every row is already known, nothing to save.
        page.get_by_label('File mutasi Bank Jago', exact=True).set_input_files(path)
        expect(page.get_by_role('heading', name='Periksa sebelum disimpan')).to_be_visible()
        expect(page.get_by_role('button', name='Simpan 0 transaksi', exact=True)).to_be_disabled()
        assert stored_document(page) == saved
        page.reload(wait_until='networkidle'); assert stored_document(page) == saved
        assert not errors, errors
    finally:
        context.close()


def refuses_other_files(browser, out):
    context, page, errors = context_page(browser, False)
    try:
        before = page.evaluate('localStorage.getItem("uangku:v1")')
        open_jago(page)
        other = out / 'bukan-jago.pdf'; other.write_bytes(pdf([[(20, 700, 10, 'Rekening koran bank contoh')]]))
        page.get_by_label('File mutasi Bank Jago', exact=True).set_input_files(other)
        expect(page.get_by_role('alert').first).to_contain_text('bukan PDF riwayat transaksi Bank Jago')
        filtered = out / 'jago-terfilter.pdf'; filtered.write_bytes(jago_statement([ROWS[0], ROWS[2]]))
        page.get_by_label('File mutasi Bank Jago', exact=True).set_input_files(filtered)
        expect(page.get_by_role('alert').first).to_contain_text('Saldo antarbaris tidak cocok')
        sheet = out / 'mutasi.xlsx'; sheet.write_bytes(b'PK\x03\x04')
        page.get_by_label('File mutasi Bank Jago', exact=True).set_input_files(sheet)
        expect(page.get_by_role('alert').first).to_contain_text('hanya membaca PDF riwayat transaksi Bank Jago')
        assert page.get_by_role('heading', name='Periksa sebelum disimpan').count() == 0
        assert page.evaluate('localStorage.getItem("uangku:v1")') == before
        assert not errors, errors
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, default=Path('test-results/jago'))
    args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    build = assert_production_url(URL); results = []
    with sync_playwright() as p:
        browser = launch_browser(p)
        for name, run in [('jago-pdf-import-desktop', lambda: import_and_save(browser, args.output, False)),
                          ('jago-pdf-import-mobile', lambda: import_and_save(browser, args.output, True)),
                          ('jago-pdf-refuses-other-files', lambda: refuses_other_files(browser, args.output))]:
            try:
                run(); results.append({'name': name, 'status': 'passed'})
            except Exception as error:
                results.append({'name': name, 'status': 'failed', 'error': str(error), 'traceback': traceback.format_exc()})
        version = browser.version; browser.close()
    report = {'build': build, 'browser': version, 'synthetic_only': True, 'results': results,
              'passed': sum(x['status'] == 'passed' for x in results), 'failed': sum(x['status'] == 'failed' for x in results)}
    (args.output / 'summary.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False)); raise SystemExit(bool(report['failed']))


if __name__ == '__main__':
    main()
