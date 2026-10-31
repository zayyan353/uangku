"""Synthetic actual-UI proof for source-only capture and explicit backfill.

Uses a fresh browser context and the production build served by UANGKU_TEST_URL.
Never reads an existing browser profile, bank account or personal backup.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import traceback
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

from browser_support import assert_production_url, install_playwright_path, launch_browser, stored_document
install_playwright_path()
from playwright.sync_api import expect, sync_playwright
import source_browser as source
from recovery_browser import saldo


def statement(path: Path, movements):
    """Identical anchor cells give identical bank fingerprints in both files."""
    rows = [['Synthetic backfill only'], ['Mata uang', 'TL'], *[[] for _ in range(9)],
            ['Tarih', 'Fiş No', 'Açıklama', 'İşlem Tutarı', 'Bakiye']]
    rows += [[date, reference, note, amount, balance]
             for date, reference, note, amount, balance in movements]
    xml = ''.join('<row>' + ''.join(
        f'<c t="{"n" if isinstance(value, (int, float)) else "str"}"><v>{escape(str(value))}</v></c>'
        for value in row) + '</row>' for row in rows)
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
        archive.writestr('xl/workbook.xml', f'<workbook {ns}><workbookPr date1904="0"/></workbook>')
        archive.writestr('xl/worksheets/sheet1.xml', f'<worksheet {ns}><sheetData>{xml}</sheetData></worksheet>')


ANCHOR = ('03.10.2026', 'LATE-ANCHOR', 'POS later baseline anchor', -5.5, 174.5)
EARLIER = [('01.10.2026', 'EARLY-INCOME', 'Synthetic earlier income', 100, 200),
           ('02.10.2026', 'EARLY-EXPENSE', 'Synthetic earlier expense', -20, 180)]


def raw_token(page):
    stored_document(page)  # Wait for the coordinated writer before reading bytes.
    return page.evaluate('localStorage.getItem("uangku:v1")')


def source_only(page):
    page.get_by_role('button', name='Simpan fakta file saja', exact=True).click()
    expect(page.get_by_role('heading', name='Periksa sebelum disimpan', exact=True)).to_have_count(0)
    expect(page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')


def newest_card(page):
    card = page.get_by_label('Rekonsiliasi file tersimpan', exact=True).locator('details').first
    card.locator('summary').click()
    expect(card.get_by_label(re.compile('^Alasan pelengkapan '))).to_be_visible()
    return card


def add_manual_extra(page):
    source.nav(page, 'Transaksi')
    page.get_by_role('button', name='Catat transaksi', exact=True).click()
    dialog = page.get_by_role('dialog')
    dialog.get_by_label('Dompet asal', exact=True).select_option('bank')
    dialog.get_by_label('Nominal', exact=True).fill('0,73')
    dialog.locator('input[type=date]').fill('2026-10-02')
    dialog.get_by_label(re.compile('^Keterangan')).fill('Separate manual flow retained through backfill')
    dialog.get_by_role('button', name='Simpan transaksi', exact=True).click()
    expect(dialog).to_have_count(0)
    return source.wait_doc(page, lambda data: len(data['state']['entries']) == 2)


def overlapping_backfill(browser, out: Path):
    context, page, errors = source.context_page(browser, source.fixture())
    try:
        tail, full = out / 'later-period-anchor.xlsx', out / 'earlier-overlapping-history.xlsx'
        statement(tail, [ANCHOR]); statement(full, [*EARLIER, ANCHOR])
        source.import_file(page, tail); source.save_import(page, 1)
        initial = source.wait_doc(page, lambda data: len(data['state']['entries']) == 1)
        assert saldo(initial, 'bank') == 17450
        assert initial['state']['wallets'][0]['openingBalance'] == 18000
        initial_fact = copy.deepcopy(initial['metadata']['facts'][0])
        current = add_manual_extra(page)
        manual = copy.deepcopy(next(entry for entry in current['state']['entries'] if not entry.get('sourceKey')))
        initial_finance, initial_balance = copy.deepcopy(current['state']), saldo(current, 'bank')
        initial_baselines = copy.deepcopy(current['metadata']['baselines'])
        assert initial_balance == 17377

        source.import_file(page, full)
        before_attempt = raw_token(page)
        page.get_by_role('button', name='Simpan 2 transaksi', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('batas awal')
        assert raw_token(page) == before_attempt
        assert stored_document(page)['state'] == initial_finance

        source_only(page)
        captured = source.wait_doc(page, lambda data: len(data['metadata']['statements']) == 2)
        assert captured['state'] == initial_finance
        assert captured['metadata']['baselines'] == initial_baselines
        assert len(captured['metadata']['facts']) == 3
        assert next(fact for fact in captured['metadata']['facts'] if fact['id'] == initial_fact['id']) == initial_fact
        assert saldo(captured, 'bank') == initial_balance

        card = newest_card(page)
        card.get_by_label(re.compile('^Alasan pelengkapan ')).fill('Adopt earlier witnessed boundary and preserve unrelated manual flow')
        before_preview = raw_token(page)
        card.get_by_role('button', name='Pratinjau pelengkapan', exact=True).click()
        expect(card.get_by_role('alert')).to_contain_text('rebase')
        assert raw_token(page) == before_preview
        assert card.get_by_role('button', name='Lengkapi dan simpan', exact=True).count() == 0

        card.get_by_role('checkbox', name=re.compile('^Saya menyetujui batas saldo awal')).check()
        card.get_by_role('button', name='Pratinjau pelengkapan', exact=True).click()
        expect(card.get_by_role('button', name='Lengkapi dan simpan', exact=True)).to_be_visible()
        expect(card).to_contain_text('2 transaksi akan ditambahkan')
        expect(card).to_contain_text('173,77')
        assert raw_token(page) == before_preview  # A proposal is not a write.
        card.get_by_role('button', name='Lengkapi dan simpan', exact=True).click()
        completed = source.wait_doc(page, lambda data: len(data['state']['entries']) == 4)
        assert completed['state']['wallets'][0]['openingBalance'] == 10000
        assert saldo(completed, 'bank') == initial_balance
        assert next(entry for entry in completed['state']['entries'] if entry['id'] == manual['id']) == manual
        assert completed['metadata']['facts'] == captured['metadata']['facts']
        assert len({entry['id'] for entry in completed['state']['entries']}) == 4
        assert len({entry['sourceKey'] for entry in completed['state']['entries'] if entry.get('sourceKey')}) == 3
        assert completed['metadata']['baselines'][0]['boundary']['date'] == '2026-10-01'
        assert len(completed['metadata']['completions']) == 1
        assert len(completed['metadata']['completions'][0]['sourceIds']) == 3
        page.reload(wait_until='networkidle')
        assert stored_document(page) == completed

        token = raw_token(page)
        source.import_file(page, full)
        assert page.get_by_role('button', name='Simpan 0 transaksi', exact=True).is_disabled()
        assert stored_document(page) == completed and raw_token(page) == token
        page.screenshot(path=str(out / 'overlap-backfill-and-repeat.png'), full_page=True)
        assert not errors, errors
        return {'initial_entries': 2, 'completed_entries': 4, 'bank_facts': 3,
                'balance_before_after_minor': initial_balance, 'opening_before': 18000, 'opening_after': 10000,
                'manual_preserved': True, 'repeat_no_duplicate': True, 'source_only_finance_unchanged': True}
    except Exception:
        page.screenshot(path=str(out / 'overlap-failure.png'), full_page=True)
        raise
    finally:
        context.close()


def no_overlap_backfill_refused(browser, out: Path):
    context, page, errors = source.context_page(browser, source.fixture())
    try:
        tail, earlier = out / 'no-overlap-later.xlsx', out / 'no-overlap-earlier.xlsx'
        statement(tail, [ANCHOR]); statement(earlier, EARLIER[:1])
        source.import_file(page, tail); source.save_import(page, 1)
        initial = source.wait_doc(page, lambda data: len(data['state']['entries']) == 1)
        source.import_file(page, earlier)
        before = raw_token(page)
        page.get_by_role('button', name='Simpan 1 transaksi', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('batas awal')
        assert raw_token(page) == before
        source_only(page)
        captured = source.wait_doc(page, lambda data: len(data['metadata']['statements']) == 2)
        assert captured['state'] == initial['state']
        assert captured['metadata']['baselines'] == initial['metadata']['baselines']
        assert captured['metadata']['facts'][0] == initial['metadata']['facts'][0]
        card = newest_card(page)
        card.get_by_label(re.compile('^Alasan pelengkapan ')).fill('Attempt unsafe backfill without the existing anchor')
        card.get_by_role('checkbox', name=re.compile('^Saya menyetujui batas saldo awal')).check()
        before_preview = raw_token(page)
        card.get_by_role('button', name='Pratinjau pelengkapan', exact=True).click()
        expect(card.get_by_role('alert')).to_contain_text('anchor baseline lama')
        assert card.get_by_role('button', name='Lengkapi dan simpan', exact=True).count() == 0
        assert raw_token(page) == before_preview
        assert stored_document(page) == captured
        page.reload(wait_until='networkidle'); assert stored_document(page) == captured
        page.screenshot(path=str(out / 'unsafe-no-overlap-refused.png'), full_page=True)
        assert not errors, errors
        return {'source_only_finance_unchanged': True, 'unsafe_rebase_refused': True,
                'existing_baseline_preserved': True, 'stored_bank_facts': len(captured['metadata']['facts'])}
    except Exception:
        page.screenshot(path=str(out / 'no-overlap-failure.png'), full_page=True)
        raise
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, default=Path('test-results/backfill'))
    parser.add_argument('--mobile', action='store_true'); args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    source.MOBILE = args.mobile
    build = assert_production_url(source.URL)
    results = []
    with sync_playwright() as playwright:
        browser = launch_browser(playwright)
        for name, run in [('source-only-overlap-backfill-manual-repeat', overlapping_backfill),
                          ('source-only-no-overlap-rebase-refused', no_overlap_backfill_refused)]:
            try:
                details = run(browser, args.output)
                results.append({'name': name, 'status': 'passed', 'details': details})
            except Exception as error:
                results.append({'name': name, 'status': 'failed', 'error': str(error), 'traceback': traceback.format_exc()})
        version = browser.version; browser.close()
    report = {'build': build, 'browser': version, 'synthetic_only': True, 'mobile_emulation': args.mobile,
              'results': results, 'passed': sum(row['status'] == 'passed' for row in results),
              'failed': sum(row['status'] == 'failed' for row in results)}
    (args.output / 'summary.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True)); raise SystemExit(bool(report['failed']))


if __name__ == '__main__':
    main()
