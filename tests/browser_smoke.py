"""Synthetic end-to-end checks. Requires Python Playwright + Chromium.

Build and run a production preview first, then python tests/browser_smoke.py.
No uploaded or real financial data is used, copied, logged, or committed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
import traceback
import os
import re
import tempfile
from datetime import date, timedelta
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED

from browser_support import (FIXED_TIME, install_playwright_path, launch_browser,
                             new_page, read_document, stored_document, assert_production_url)
install_playwright_path()
from playwright.sync_api import sync_playwright, expect


BASE_URL = os.environ.get("UANGKU_TEST_URL", "http://127.0.0.1:4180")
KEY = "uangku:v1"


def stored(page):
    return stored_document(page, KEY)


def state(page):
    return stored(page)["state"]


def balance(data, wallet_id):
    total = next(w["openingBalance"] for w in data["wallets"] if w["id"] == wallet_id)
    for entry in data["entries"]:
        if entry["walletId"] == wallet_id:
            if entry["type"] in ("income", "adjustment", "unreviewed", "movement"):
                total += entry["amount"]
            else:
                total -= entry["amount"] + entry.get("fee", 0)
        if entry["type"] == "transfer" and entry.get("toWalletId") == wallet_id:
            total += entry["toAmount"]
    return total


def nav(page, label):
    page.locator(".sidebar").get_by_role("button", name=re.compile(r"^" + re.escape(label) + r"(?:\s+\d+)?$")).click()


def dialog(page):
    return page.get_by_role("dialog")


def own_data(page):
    page.get_by_role("button", name="Mulai pakai data sendiri").click()
    dialog(page).get_by_role("button", name="Mulai dari kosong", exact=True).click()
    expect(page.locator(".demo-banner")).to_have_count(0)
    assert not stored(page)["demo"]


def write_fixture(path, *, extra_newest=0):
    # A tiny synthetic XLSX with the same documented column structure.
    newest = FIXED_TIME.date()
    transactions = [
        [newest.strftime("%d.%m.%Y"), "REF-REPEAT", "POS toko contoh", -25.5, 174.5],
        [(newest - timedelta(days=1)).strftime("%d.%m.%Y"), "REF-REPEAT", "MUTASI MASUK contoh", 100, 200],
        [(newest - timedelta(days=2)).strftime("%d.%m.%Y"), "OTHER", "POS belanja contoh", -20, 100],
    ]
    if extra_newest >= 1:
        transactions.insert(0, [newest.strftime("%d.%m.%Y"), "NEW-1", "POS tambahan pertama", -10, 164.5])
    if extra_newest >= 2:
        transactions.insert(0, [newest.strftime("%d.%m.%Y"), "NEW-2", "POS tambahan kedua", -5, 159.5])
    rows = [
        ["Rekening contoh; bukan data pribadi"], ["Mata uang", "TL"],
        *[[] for _ in range(9)],
        ["Tarih", "Fiş No", "Açıklama", "İşlem Tutarı", "Bakiye"],
        *transactions,
        [], ["Catatan akhir laporan"],
    ]
    xml_rows = []
    for row in rows:
        cells = []
        for value in row:
            numeric = isinstance(value, (int, float))
            cells.append(f'<c t="{"n" if numeric else "str"}"><v>{escape(str(value))}</v></c>')
        xml_rows.append("<row>" + "".join(cells) + "</row>")
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        archive.writestr("xl/workbook.xml", f'<workbook {ns}><workbookPr date1904="0"/></workbook>')
        archive.writestr("xl/worksheets/sheet1.xml", f'<worksheet {ns}><sheetData>{"".join(xml_rows)}</sheetData></worksheet>')


def check_desktop(browser, tmp):
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True, timezone_id="Europe/Istanbul")
    page = new_page(context)
    page.set_default_timeout(8000)
    errors = []
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.goto(BASE_URL)
    expect(page.locator(".balance-card")).to_be_visible()
    # Startup is deliberately read-only: verify the actual demo export without
    # inventing a persisted ledger to satisfy the old automatic-write contract.
    assert stored(page) is None
    with page.expect_download() as demo_download:
        page.locator(".sidebar").get_by_role("button", name="Cadangkan data", exact=True).click()
    demo_path = tmp / "startup-demo-synthetic.json"
    demo_download.value.save_as(demo_path)
    demo = read_document(demo_path)
    assert demo["demo"] and len(demo["state"]["wallets"]) == 5
    assert all(wallet['kind'] != 'cash' for wallet in demo['state']['wallets'])
    assert stored(page) is None
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
    page.screenshot(path=str(tmp / "desktop.png"), full_page=True)
    own_data(page)
    assert len(state(page)["wallets"]) == 10
    assert all(wallet['kind'] != 'cash' for wallet in state(page)['wallets'])
    assert state(page)["entries"] == []

    # Set opening balance for an existing account.
    nav(page, "Dompet")
    page.get_by_role("button", name="Atur dompet BCA", exact=True).click()
    dialog(page).get_by_label(re.compile("Saldo awal")).fill("500000")
    dialog(page).get_by_role("button", name="Simpan dompet", exact=True).click()
    assert balance(state(page), "bca-idr") == 50_000_000

    # Create an additional wallet without disturbing the existing accounts.
    page.get_by_role("button", name="Tambah dompet", exact=True).first.click()
    dialog(page).get_by_label("Nama dompet", exact=True).fill("Rekening Uji")
    dialog(page).get_by_label(re.compile("^Jenis dompet")).select_option("bank")
    dialog(page).get_by_label(re.compile("Saldo awal")).fill("100")
    dialog(page).get_by_role("button", name="Simpan dompet", exact=True).click()
    assert len(state(page)["wallets"]) == 11

    # Expense with the category left at its optional default.
    nav(page, "Ringkasan")
    page.get_by_role("button", name="Catat transaksi", exact=True).click()
    dialog(page).get_by_label("Dompet asal", exact=True).select_option("bca-idr")
    dialog(page).get_by_label("Nominal", exact=True).fill("25000")
    dialog(page).get_by_label(re.compile("Keterangan")).fill("Tes makan")
    dialog(page).get_by_role("button", name="Simpan transaksi", exact=True).click()
    entry = state(page)["entries"][-1]
    assert entry["category"] == "Belum dikategorikan"
    assert entry["amount"] == 2_500_000
    assert balance(state(page), "bca-idr") == 47_500_000

    # Same-currency transfer: both balances change; only its fee is spending.
    page.get_by_role("button", name="Pindah uang", exact=True).click()
    dialog(page).get_by_label("Dompet asal", exact=True).select_option("bca-idr")
    dialog(page).get_by_label("Dompet tujuan", exact=True).select_option("bca-digital-idr")
    dialog(page).get_by_label("Nominal", exact=True).fill("100000")
    dialog(page).get_by_label(re.compile("Biaya tambahan")).fill("2500")
    dialog(page).get_by_role("button", name="Simpan transaksi", exact=True).click()
    assert balance(state(page), "bca-idr") == 37_250_000
    assert balance(state(page), "bca-digital-idr") == 10_000_000
    expect(page.get_by_test_id("cashflow-outflow")).to_contain_text("27.500")

    # Cross-currency transfer cannot save before explicit rate confirmation.
    page.get_by_role("button", name="Pindah uang", exact=True).click()
    dialog(page).get_by_label("Dompet asal", exact=True).select_option("bca-idr")
    dialog(page).get_by_label("Dompet tujuan", exact=True).select_option("ziraat-try")
    dialog(page).get_by_label("Nominal", exact=True).fill("100000")
    dialog(page).get_by_label("Kurs transaksi", exact=True).fill("0,0025")
    dialog(page).get_by_role("button", name="Simpan transaksi", exact=True).click()
    expect(dialog(page).get_by_role("alert")).to_contain_text("Konfirmasi kurs")
    assert len(state(page)["entries"]) == 2
    dialog(page).get_by_label("Kurs ini sesuai transaksi saya", exact=True).check()
    dialog(page).get_by_role("button", name="Simpan transaksi", exact=True).click()
    assert balance(state(page), "bca-idr") == 27_250_000
    assert balance(state(page), "ziraat-try") == 25_000
    assert state(page)["entries"][-1]["rate"] == 0.0025

    # Verify persistence with a real reload.
    before = stored(page)
    page.reload()
    expect(page.locator(".balance-card")).to_be_visible()
    assert stored(page) == before

    # Download the actual backup, mutate, then restore it through the UI.
    with page.expect_download() as download_info:
        page.locator(".sidebar").get_by_role("button", name="Cadangkan data", exact=True).click()
    backup_path = tmp / "synthetic-backup.json"
    download_info.value.save_as(backup_path)
    assert read_document(backup_path) == before
    invalid_path = tmp / "invalid-backup.json"
    invalid_path.write_text('{"app":"foreign-app"}')
    page.get_by_label("File cadangan Uangku", exact=True).set_input_files(invalid_path)
    expect(page.locator('.toast')).to_be_visible()
    assert stored(page) == before
    page.get_by_label("File cadangan Uangku", exact=True).set_input_files(backup_path)
    dialog(page).get_by_role("button", name="Pulihkan data", exact=True).click()
    assert stored(page) == before

    # Fresh synthetic-only context for import/reimport and signed pending flow.
    import_context = browser.new_context(viewport={"width": 1440, "height": 1000}, timezone_id="Europe/Istanbul")
    ip = new_page(import_context)
    ip.set_default_timeout(8000)
    ip.on("pageerror", lambda err: errors.append(str(err)))
    ip.goto(BASE_URL)
    expect(ip.locator(".balance-card")).to_be_visible()
    own_data(ip)
    nav(ip, "Impor mutasi")
    fixture = tmp / "synthetic-ziraat.xlsx"
    write_fixture(fixture)
    ip.get_by_label("File mutasi Ziraat", exact=True).set_input_files(fixture)
    expect(ip.get_by_role("button", name="Simpan 3 transaksi", exact=True)).to_be_visible()
    ip.get_by_role("button", name="Simpan 3 transaksi", exact=True).click()
    assert len(state(ip)["entries"]) == 3
    assert balance(state(ip), "ziraat-try") == 17_450
    assert any(e["type"] == "unreviewed" and e["amount"] == 10_000 for e in state(ip)["entries"])
    imported = stored(ip)
    ip.get_by_label("File mutasi Ziraat", exact=True).set_input_files(fixture)
    expect(ip.get_by_role("button", name="Simpan 0 transaksi", exact=True)).to_be_disabled()
    assert ip.locator(".duplicate-row").count() == 3
    assert stored(ip) == imported

    # Reviewing an imported credit must retain its fingerprint for future imports.
    credit_before = next(e for e in state(ip)["entries"] if e["type"] == "unreviewed")
    nav(ip, "Transaksi")
    ip.get_by_role("button", name="Cek MUTASI MASUK contoh", exact=True).click()
    dialog(ip).get_by_role("button", name="Simpan hasil cek", exact=True).click()
    credit_after = next(e for e in state(ip)["entries"] if e["id"] == credit_before["id"])
    assert credit_after["type"] == "income"
    assert credit_after.get("sourceKey") == credit_before["sourceKey"], "Review must retain imported credit sourceKey"
    nav(ip, "Impor mutasi")
    ip.get_by_label("File mutasi Ziraat", exact=True).set_input_files(fixture)
    expect(ip.get_by_role("button", name="Simpan 0 transaksi", exact=True)).to_be_disabled()
    assert ip.locator(".duplicate-row").count() == 3

    # Restore a malformed local storage payload must not silently overwrite it.
    bad_context = browser.new_context(timezone_id="Europe/Istanbul")
    bp = new_page(bad_context)
    bp.goto(BASE_URL)
    bp.evaluate("key => localStorage.setItem(key, '{broken')", KEY)
    bp.reload()
    expect(bp.get_by_test_id('save-status')).to_contain_text('Data lama dilindungi')
    assert bp.evaluate("key => localStorage.getItem(key)", KEY) == "{broken"

    assert errors == [], errors
    bad_context.close(); import_context.close(); context.close()
    return ["demo and own-data setup", "wallet creation/opening balance", "bank expense/category optional", "same-currency transfer and fees", "manual FX confirmation", "reload persistence", "backup download/valid+invalid restore", "synthetic XLSX import/reimport", "reviewed imported credit deduplication", "signed pending balances", "corrupt storage preservation", "zero browser page errors"]


def check_mobile(browser, tmp):
    context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, timezone_id="Europe/Istanbul")
    page = new_page(context)
    page.goto(BASE_URL)
    expect(page.locator(".balance-card")).to_be_visible()
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
    page.screenshot(path=str(tmp / "mobile.png"), full_page=True)
    page.get_by_role("button", name="Catat transaksi", exact=True).click()
    expect(dialog(page)).to_be_visible()
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
    expect(dialog(page).get_by_role("button", name="Simpan transaksi", exact=True)).to_be_visible()
    dialog(page).get_by_role("button", name="Tutup", exact=True).click()
    mobile_nav = page.locator(".mobile-nav")
    mobile_nav.get_by_role("button", name="Dompet", exact=True).click()
    expect(page.locator(".wallet-grid")).to_be_visible()
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
    mobile_nav.get_by_role("button", name="Impor mutasi", exact=True).click()
    expect(page.locator(".import-dropzone")).to_be_visible()
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
    context.close()
    return ["mobile390 overview/wallet/import layout", "mobile transaction modal", "mobile bottom navigation"]


def check_regressions(browser, tmp):
    """Exercise fixes around imported pairs, failed persistence, and safe totals."""
    all_errors = []

    def fresh():
        context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True, timezone_id="Europe/Istanbul")
        page = new_page(context)
        page.set_default_timeout(8000)
        page.on("pageerror", lambda err: all_errors.append(str(err)))
        page.goto(BASE_URL)
        expect(page.locator(".balance-card")).to_be_visible()
        own_data(page)
        return context, page

    def seed(page, *, paired):
        data = stored(page)
        for wallet in data["state"]["wallets"]:
            if wallet["id"] == "papara-try":
                wallet["openingBalance"] = 20_000
            if wallet["id"] == "ziraat-try":
                wallet["openingBalance"] = 10_000
        current_date = FIXED_TIME.date().isoformat()
        incoming = {"id": "synthetic-arrival", "date": current_date,
                    "type": "unreviewed", "walletId": "ziraat-try", "amount": 10_000,
                    "category": "Belum dikategorikan", "note": "Kredit transfer contoh",
                    "sourceKey": "synthetic-incoming-fingerprint", "importBatch": "synthetic-import"}
        outgoing = {"id": "synthetic-departure", "date": current_date,
                    "type": "unreviewed", "walletId": "papara-try", "amount": -10_000,
                    "category": "Belum dikategorikan", "note": "Debit transfer contoh",
                    "sourceKey": "synthetic-outgoing-fingerprint", "importBatch": "synthetic-import"}
        data["state"]["entries"] = [outgoing, incoming] if paired else [incoming]
        page.evaluate("([key, data]) => localStorage.setItem(key, JSON.stringify(data))", [KEY, data])
        page.reload()
        expect(page.locator(".balance-card")).to_be_visible()
        page.locator(".currency-tab").filter(has_text="Lira Turki").click()
        nav(page, "Transaksi")
        return data

    # A received import always keeps its arrival wallet and amount fixed.
    context, page = fresh()
    seed(page, paired=False)
    original_arrival_balance = balance(state(page), "ziraat-try")
    page.get_by_role("button", name="Cek Kredit transfer contoh", exact=True).click()
    dialog(page).get_by_role("button", name="Transfer", exact=True).click()
    source = dialog(page).get_by_label("Dompet asal", exact=True)
    assert source.locator('option[value="ziraat-try"]').count() == 0
    expect(dialog(page).get_by_label("Dompet tujuan", exact=True)).to_be_disabled()
    source.select_option("papara-try")
    dialog(page).get_by_label("Nominal", exact=True).fill("100")
    # A single bank leg does not prove the counterpart's posting date. Supply
    # the known synthetic source date explicitly rather than having it guessed.
    dialog(page).get_by_label('Tanggal debit', exact=True).fill(FIXED_TIME.date().isoformat())
    dialog(page).get_by_role("button", name="Simpan hasil cek", exact=True).click()
    saved = state(page)
    assert len(saved["entries"]) == 1
    transfer = saved["entries"][0]
    assert transfer["type"] == "transfer"
    assert transfer["walletId"] == "papara-try" and transfer["toWalletId"] == "ziraat-try"
    assert transfer["toAmount"] == 10_000
    assert transfer["toSourceKey"] == "synthetic-incoming-fingerprint"
    assert balance(saved, "ziraat-try") == original_arrival_balance
    assert balance(saved, "papara-try") == 10_000
    context.close()

    # Pair two imported sides: adding a fee would double count bank cashflow.
    context, page = fresh()
    original = seed(page, paired=True)["state"]
    page.get_by_role("button", name="Cek Kredit transfer contoh", exact=True).click()
    dialog(page).get_by_role("button", name="Transfer", exact=True).click()
    dialog(page).get_by_label("Dompet asal", exact=True).select_option("papara-try")
    dialog(page).get_by_label(re.compile("^Catatan pasangan")).select_option("synthetic-departure")
    dialog(page).get_by_label(re.compile("Biaya tambahan")).fill("5")
    dialog(page).get_by_role("button", name="Simpan hasil cek", exact=True).click()
    expect(dialog(page).get_by_role("alert")).to_contain_text("Catat biaya bank")
    assert state(page) == original
    dialog(page).get_by_label(re.compile("Biaya tambahan")).fill("0")
    dialog(page).get_by_role("button", name="Simpan hasil cek", exact=True).click()
    combined = state(page)
    assert len(combined["entries"]) == 1
    combined_transfer = combined["entries"][0]
    assert combined_transfer["sourceKey"] == "synthetic-outgoing-fingerprint"
    assert combined_transfer["toSourceKey"] == "synthetic-incoming-fingerprint"
    assert balance(combined, "papara-try") == balance(original, "papara-try")
    assert balance(combined, "ziraat-try") == balance(original, "ziraat-try")
    context.close()

    # Storage writes fail after a real mutation: download must contain RAM's newest data.
    context, page = fresh()
    stale = stored(page)
    page.evaluate("""() => {
      Storage.prototype.setItem = function () {
        throw new DOMException('Synthetic storage quota failure', 'QuotaExceededError');
      };
    }""")
    page.get_by_role("button", name="Catat transaksi", exact=True).click()
    dialog(page).get_by_label("Dompet asal", exact=True).select_option("bca-idr")
    dialog(page).get_by_label("Nominal", exact=True).fill("25")
    dialog(page).get_by_label(re.compile("Keterangan")).fill("Catatan terbaru belum tersimpan")
    dialog(page).get_by_role("button", name="Simpan transaksi", exact=True).click()
    expect(page.get_by_test_id("save-status")).to_contain_text("penyimpanan gagal")
    assert stored(page) == stale
    # Failed persistence intentionally keeps the editor open. Closing it does
    # not discard the recoverable draft held by the coordinated writer.
    dialog(page).get_by_role('button', name='Batal', exact=True).click()
    expect(dialog(page)).to_have_count(0)
    with page.expect_download() as download_info:
        page.get_by_role("button", name="Unduh pekerjaan yang belum tersimpan", exact=True).click()
    recovery_path = tmp / "quota-recovery-backup.json"
    download_info.value.save_as(recovery_path)
    recovery = read_document(recovery_path)
    assert len(recovery["state"]["entries"]) == 1
    assert recovery["state"]["entries"][0]["note"] == "Catatan terbaru belum tersimpan"
    assert recovery["state"]["entries"][0]["amount"] == 2500
    context.close()

    # Each wallet can be safe while their currency aggregate would overflow.
    context, page = fresh()
    data = stored(page)
    for wallet in data["state"]["wallets"]:
        if wallet["id"] == "bca-idr":
            wallet["openingBalance"] = 9_007_199_254_740_891  # MAX_SAFE_INTEGER - 100
        elif wallet["id"] == "bca-digital-idr":
            wallet["openingBalance"] = 50
    page.evaluate("([key, data]) => localStorage.setItem(key, JSON.stringify(data))", [KEY, data])
    page.reload()
    expect(page.locator(".balance-card")).to_be_visible()
    before = stored(page)
    nav(page, "Dompet")
    page.get_by_role("button", name="Atur dompet BCA Digital", exact=True).click()
    dialog(page).get_by_label(re.compile("Saldo awal")).fill("2")
    dialog(page).get_by_role("button", name="Simpan dompet", exact=True).click()
    expect(dialog(page)).to_be_visible()
    expect(dialog(page).get_by_role("alert")).to_contain_text(re.compile("terlalu besar|batas|melebihi", re.I))
    assert stored(page) == before
    context.close()
    assert all_errors == [], all_errors
    return ["incoming transfer destination/amount preservation", "paired imports preserve both fingerprints/balances", "paired imports reject duplicate extra fee", "quota recovery downloads newest in-memory data", "currency aggregate overflow rejected"]


def check_daily_use(browser, tmp):
    """Daily-entry shortcuts and global review scope, using synthetic records."""
    errors = []

    def fresh():
        context = browser.new_context(viewport={"width": 1440, "height": 1000}, timezone_id="Europe/Istanbul")
        page = new_page(context)
        page.set_default_timeout(8000)
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.goto(BASE_URL)
        expect(page.locator(".balance-card")).to_be_visible()
        own_data(page)
        return context, page

    # Last manually used wallet and active currency survive a genuine reload.
    context, page = fresh()
    page.locator(".currency-tab").filter(has_text="Lira Turki").click()
    page.get_by_role("button", name="Catat transaksi", exact=True).click()
    amount = dialog(page).get_by_label("Nominal", exact=True)
    expect(amount).to_be_focused()
    dialog(page).get_by_label("Dompet asal", exact=True).select_option("papara-try")
    amount.fill("10")
    dialog(page).get_by_label(re.compile("Keterangan")).fill("Ewallet lira uji preferensi")
    dialog(page).get_by_role("button", name="Simpan transaksi", exact=True).click()
    page.get_by_role("button", name="Catat transaksi", exact=True).click()
    expect(dialog(page).get_by_label("Dompet asal", exact=True)).to_have_value("papara-try")
    dialog(page).get_by_role("button", name="Tutup", exact=True).click()
    page.reload()
    expect(page.locator(".currency-tab").filter(has_text="Lira Turki")).to_have_attribute("aria-pressed", "true")
    page.get_by_role("button", name="Catat transaksi", exact=True).click()
    expect(dialog(page).get_by_label("Dompet asal", exact=True)).to_have_value("papara-try")
    expect(dialog(page).get_by_label("Nominal", exact=True)).to_be_focused()
    dialog(page).get_by_role("button", name="Tutup", exact=True).click()

    # A same-currency destination should be the default instead of a surprise FX form.
    page.get_by_role("button", name="Pindah uang", exact=True).click()
    source_id = dialog(page).get_by_label("Dompet asal", exact=True).input_value()
    destination_id = dialog(page).get_by_label("Dompet tujuan", exact=True).input_value()
    currencies = {wallet["id"]: wallet["currency"] for wallet in state(page)["wallets"]}
    assert source_id != destination_id
    assert currencies[source_id] == currencies[destination_id] == "TRY"
    expect(dialog(page).get_by_label("Kurs transaksi", exact=True)).to_have_count(0)
    dialog(page).get_by_role("button", name="Tutup", exact=True).click()

    # Save-and-repeat keeps useful context, clears the previous purchase, and cannot resave blanks.
    page.get_by_role("button", name="Catat transaksi", exact=True).click()
    repeated_date = (FIXED_TIME.date() - timedelta(days=1)).isoformat()
    dialog(page).get_by_label("Tanggal", exact=True).fill(repeated_date)
    dialog(page).get_by_label("Nominal", exact=True).fill("15")
    dialog(page).get_by_label(re.compile("Keterangan")).fill("Catatan berulang pertama")
    count_before = len(state(page)["entries"])
    dialog(page).get_by_role("button", name="Simpan & catat lagi", exact=True).click()
    expect(dialog(page)).to_be_visible()
    expect(dialog(page).get_by_label("Nominal", exact=True)).to_have_value("")
    expect(dialog(page).get_by_label(re.compile("Keterangan"))).to_have_value("")
    expect(dialog(page).get_by_label("Dompet asal", exact=True)).to_have_value("papara-try")
    expect(dialog(page).get_by_label("Tanggal", exact=True)).to_have_value(repeated_date)
    expect(dialog(page).get_by_label("Nominal", exact=True)).to_be_focused()
    assert len(state(page)["entries"]) == count_before + 1
    dialog(page).get_by_role("button", name="Simpan & catat lagi", exact=True).click()
    assert len(state(page)["entries"]) == count_before + 1
    dialog(page).get_by_label("Nominal", exact=True).fill("20")
    dialog(page).get_by_label(re.compile("Keterangan")).fill("Catatan berulang kedua")
    dialog(page).get_by_role("button", name="Simpan transaksi", exact=True).click()
    assert len(state(page)["entries"]) == count_before + 2
    assert len([entry for entry in state(page)["entries"] if entry["note"] == "Catatan berulang pertama"]) == 1
    assert len([entry for entry in state(page)["entries"] if entry["note"] == "Catatan berulang kedua"]) == 1
    context.close()

    # Queue membership must reach older records in currencies other than the active view.
    context, page = fresh()
    data = stored(page)
    data['state']['wallets'].append({'id': 'synthetic-usd-bank', 'name': 'Synthetic USD bank',
                                   'currency': 'USD', 'kind': 'bank', 'openingBalance': 0})
    this_month = FIXED_TIME.date().replace(day=1)
    old_day = (this_month - timedelta(days=1)).replace(day=5).isoformat()
    older_day = ((this_month - timedelta(days=1)).replace(day=1) - timedelta(days=1)).replace(day=5).isoformat()
    data["state"]["entries"] = [
        {"id": "older-try-pending", "date": old_day, "type": "unreviewed", "walletId": "ziraat-try", "amount": 10_000,
         "category": "Belum dikategorikan", "note": "Kredit TL periode lama", "sourceKey": "synthetic-older-try-source"},
        {"id": "older-usd-pending", "date": older_day, "type": "unreviewed", "walletId": "synthetic-usd-bank", "amount": -5000,
         "category": "Belum dikategorikan", "note": "Debit USD periode lama", "sourceKey": "synthetic-older-usd-source"},
    ]
    page.evaluate("([key, value]) => localStorage.setItem(key, JSON.stringify(value))", [KEY, data])
    page.reload()
    expect(page.locator(".balance-card")).to_be_visible()
    expect(page.locator(".currency-tab").filter(has_text="Rupiah")).to_have_attribute("aria-pressed", "true")
    expect(page.locator(".pending-banner")).to_contain_text("2")
    expect(page.locator(".sidebar .nav-count")).to_have_text("2")
    original_balance = balance(state(page), "ziraat-try")
    page.locator(".pending-banner").click()
    expect(page.locator(".currency-toolbar")).to_have_count(0)
    expect(page.locator('.review-scope')).to_contain_text(re.compile(r"Semua mata uang.*(?:semua|seluruh) (?:bulan|periode)", re.IGNORECASE))
    expect(page.locator(".transactions-table tbody tr")).to_have_count(2)
    page.get_by_role("button", name="Cek Kredit TL periode lama", exact=True).click()
    dialog(page).get_by_label(re.compile("^Kategori")).select_option("Pemasukan")
    dialog(page).get_by_role("button", name="Simpan hasil cek", exact=True).click()
    reviewed = next(entry for entry in state(page)["entries"] if entry["id"] == "older-try-pending")
    assert reviewed["type"] == "income"
    assert reviewed["sourceKey"] == "synthetic-older-try-source"
    assert balance(state(page), "ziraat-try") == original_balance
    expect(page.locator(".transactions-table tbody tr")).to_have_count(1)
    expect(page.locator(".sidebar .nav-count")).to_have_text("1")
    context.close()

    # A pending file read cannot switch targets or leak a result into a new import view.
    context, page = fresh()
    fixture = tmp / "synthetic-delayed-ziraat.xlsx"
    write_fixture(fixture)
    page.evaluate("""() => {
      const original = File.prototype.arrayBuffer;
      window.__uangkuPendingReads = [];
      File.prototype.arrayBuffer = function () {
        const file = this;
        return new Promise((resolve, reject) => {
          window.__uangkuPendingReads.push(() => original.call(file).then(resolve, reject));
        });
      };
    }""")
    nav(page, "Impor mutasi")
    page.get_by_label("File mutasi Ziraat", exact=True).set_input_files(fixture)
    expect(page.get_by_label("Dompet impor", exact=True)).to_be_disabled()
    expect(page.get_by_text("Membaca mutasi…", exact=True)).to_be_visible()
    assert page.evaluate("window.__uangkuPendingReads.length") == 1
    nav(page, "Dompet")
    nav(page, "Impor mutasi")
    page.get_by_label("Dompet impor", exact=True).select_option("papara-try")
    page.evaluate("async () => { await Promise.all(window.__uangkuPendingReads.splice(0).map(release => release())); }")
    expect(page.get_by_label("Dompet impor", exact=True)).to_have_value("papara-try")
    expect(page.locator(".import-preview")).to_have_count(0)
    assert state(page)["entries"] == []
    page.get_by_label("File mutasi Ziraat", exact=True).set_input_files(fixture)
    expect(page.get_by_label("Dompet impor", exact=True)).to_be_disabled()
    page.evaluate("async () => { await Promise.all(window.__uangkuPendingReads.splice(0).map(release => release())); }")
    expect(page.get_by_role("button", name="Simpan 3 transaksi", exact=True)).to_be_visible()
    expect(page.get_by_label("Dompet impor", exact=True)).to_have_value("papara-try")
    page.get_by_role("button", name="Simpan 3 transaksi", exact=True).click()
    assert len(state(page)["entries"]) == 3
    assert all(entry["walletId"] == "papara-try" for entry in state(page)["entries"])
    assert balance(state(page), "papara-try") == 17_450
    context.close()

    # Switching an expense's source before selecting Transfer must recalculate its destination.
    context, page = fresh()
    for currency_label, bank_id, alternate_id, expected_currency in [
        ("Rupiah", "bca-idr", "bca-digital-idr", "IDR"),
        ("Lira Turki", "ziraat-try", "papara-try", "TRY"),
    ]:
        page.locator(".currency-tab").filter(has_text=currency_label).click()
        page.get_by_role("button", name="Catat transaksi", exact=True).click()
        expect(dialog(page).get_by_label("Dompet asal", exact=True)).to_have_value(bank_id)
        dialog(page).get_by_label("Dompet asal", exact=True).select_option(alternate_id)
        dialog(page).get_by_role("button", name="Transfer", exact=True).click()
        source_id = dialog(page).get_by_label("Dompet asal", exact=True).input_value()
        destination_id = dialog(page).get_by_label("Dompet tujuan", exact=True).input_value()
        wallet_map = {wallet["id"]: wallet for wallet in state(page)["wallets"]}
        assert source_id == alternate_id and destination_id != source_id
        assert wallet_map[destination_id]["currency"] == expected_currency
        assert wallet_map[destination_id]["kind"] == "bank"
        expect(dialog(page).get_by_label("Kurs transaksi", exact=True)).to_have_count(0)
        dialog(page).get_by_role("button", name="Tutup", exact=True).click()
    assert state(page)["entries"] == []
    context.close()

    # Recheck the ledger boundary at commit, not only when the preview was loaded.
    context, page = fresh()
    fixture = tmp / "synthetic-preview-boundary-ziraat.xlsx"
    write_fixture(fixture)
    nav(page, "Impor mutasi")
    page.get_by_label("File mutasi Ziraat", exact=True).set_input_files(fixture)
    expect(page.get_by_role("button", name="Simpan 3 transaksi", exact=True)).to_be_visible()
    page.get_by_role("button", name="Catat transaksi", exact=True).click()
    dialog(page).get_by_label("Dompet asal", exact=True).select_option("ziraat-try")
    dialog(page).get_by_label("Nominal", exact=True).fill("10")
    dialog(page).get_by_label(re.compile("Keterangan")).fill("Manual setelah pratinjau")
    dialog(page).get_by_role("button", name="Simpan transaksi", exact=True).click()
    manual_only = stored(page)
    assert len(manual_only["state"]["entries"]) == 1
    page.get_by_role("button", name="Simpan 3 transaksi", exact=True).click()
    expect(page.get_by_role("alert")).to_contain_text("sebelum batas awal")
    assert stored(page) == manual_only
    assert state(page)["entries"][0]["note"] == "Manual setelah pratinjau"
    context.close()
    assert errors == [], errors
    return ["last manual ewallet reused and persisted", "active TL currency retained after reload", "TL transfer defaults to another TRY wallet", "save-and-repeat clears purchase but preserves context without duplicates", "global pending queue reaches older other-currency entries", "pending review preserves balance and import fingerprint", "delayed import locks target and invalidates stale view results", "expense-to-transfer source switch recalculates same-currency bank destination", "import commit rechecks ledger boundary after intervening manual entry"]


def check_import_cleanup(browser, tmp):
    """Bulk cleanup must change labels or confirmed types without changing cashflow."""
    errors = []

    def fresh():
        context = browser.new_context(viewport={"width": 1440, "height": 1000}, timezone_id="Europe/Istanbul")
        page = new_page(context)
        page.set_default_timeout(8000)
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.goto(BASE_URL)
        expect(page.locator(".balance-card")).to_be_visible()
        own_data(page)
        return context, page

    def seed(page, entries):
        data = stored(page)
        for wallet in data["state"]["wallets"]:
            if wallet["id"] == "bca-idr":
                wallet["openingBalance"] = 20_000
            elif wallet["id"] == "bca-digital-idr":
                wallet["openingBalance"] = 10_000
        data["state"]["entries"] = entries
        page.evaluate("([key, value]) => localStorage.setItem(key, JSON.stringify(value))", [KEY, data])
        page.reload()
        expect(page.locator(".balance-card")).to_be_visible()
        nav(page, "Transaksi")
        return state(page)

    def ledger_select(page, note):
        return page.get_by_label(f"Pilih {note} untuk kategori", exact=True)

    current_date = FIXED_TIME.date().isoformat()

    def entry(entry_id, note, amount, kind="expense", wallet="bca-idr", **extra):
        return {"id": entry_id, "date": current_date, "type": kind, "walletId": wallet,
                "amount": amount, "category": "Belum dikategorikan", "note": note,
                "sourceKey": f"synthetic-cleanup-{entry_id}", **extra}

    # Assign two categories at once; preserve all monetary fields and original fingerprints.
    context, page = fresh()
    original = seed(page, [
        entry("expense-a", "Belanja contoh A", 1000),
        entry("expense-b", "Belanja contoh B", 2000),
        entry("pending-out", "Debit belum jelas", -3000, "unreviewed"),
        entry("pending-in", "Kredit belum jelas", 4000, "unreviewed"),
        entry("existing-transfer", "Transfer tetap", 500, "transfer", toWalletId="bca-digital-idr", toAmount=500, rate=1),
        entry("existing-adjustment", "Penyesuaian tetap", 100, "adjustment", wallet="bca-digital-idr"),
    ])
    original_balances = {wallet["id"]: balance(original, wallet["id"]) for wallet in original["wallets"]}
    for note in ["Belanja contoh A", "Belanja contoh B"]:
        ledger_select(page, note).check()
    page.get_by_label("Kategori transaksi terpilih", exact=True).select_option("Makan & minum")
    page.get_by_role("button", name="Terapkan ke 2 transaksi", exact=True).click()
    changed = state(page)
    assert {e["id"] for e in changed["entries"]} == {e["id"] for e in original["entries"]}
    for before in original["entries"]:
        after = next(e for e in changed["entries"] if e["id"] == before["id"])
        expected = {**before, "category": "Makan & minum"} if before["id"] in ["expense-a", "expense-b"] else before
        assert after == expected
    assert {wallet["id"]: balance(changed, wallet["id"]) for wallet in changed["wallets"]} == original_balances

    # Categorizing pending movements alone must not silently assert expense or income.
    for note in ["Debit belum jelas", "Kredit belum jelas"]:
        ledger_select(page, note).check()
    page.get_by_label("Kategori transaksi terpilih", exact=True).select_option("Transportasi")
    expect(page.get_by_label("Konfirmasi jenis transaksi yang belum dicek", exact=True)).not_to_be_checked()
    page.get_by_role("button", name="Terapkan ke 2 transaksi", exact=True).click()
    pending_only = state(page)
    for entry_id, signed_amount in [("pending-out", -3000), ("pending-in", 4000)]:
        pending = next(e for e in pending_only["entries"] if e["id"] == entry_id)
        assert pending["type"] == "unreviewed" and pending["amount"] == signed_amount
        assert pending["category"] == "Transportasi"

    # The explicit confirmation changes type/sign representation, never wallet cashflow.
    for note in ["Debit belum jelas", "Kredit belum jelas"]:
        ledger_select(page, note).check()
    page.get_by_label("Kategori transaksi terpilih", exact=True).select_option("Lainnya")
    page.get_by_label("Konfirmasi jenis transaksi yang belum dicek", exact=True).check()
    page.get_by_role("button", name="Terapkan ke 2 transaksi", exact=True).click()
    confirmed = state(page)
    debit = next(e for e in confirmed["entries"] if e["id"] == "pending-out")
    credit = next(e for e in confirmed["entries"] if e["id"] == "pending-in")
    assert debit["type"] == "expense" and debit["amount"] == 3000
    assert credit["type"] == "income" and credit["amount"] == 4000
    assert debit["sourceKey"] == "synthetic-cleanup-pending-out"
    assert credit["sourceKey"] == "synthetic-cleanup-pending-in"
    assert {wallet["id"]: balance(confirmed, wallet["id"]) for wallet in confirmed["wallets"]} == original_balances
    for note in ["Transfer tetap", "Penyesuaian tetap"]:
        row = page.locator(".transactions-table tbody tr").filter(has_text=note)
        checkbox = row.locator('input[type="checkbox"]')
        if checkbox.count():
            expect(checkbox).to_be_disabled()

    # Ledger view changes clear selection so a hidden entry cannot be changed accidentally.
    ledger_select(page, "Belanja contoh A").check()
    page.get_by_label("Cari transaksi", exact=True).fill("Belanja contoh B")
    expect(ledger_select(page, "Belanja contoh B")).not_to_be_checked()
    apply_buttons = page.get_by_role("button", name=re.compile(r"^Terapkan ke \d+ transaksi$"))
    if apply_buttons.count():
        expect(apply_buttons).to_be_disabled()
    page.get_by_label("Cari transaksi", exact=True).fill("")
    expect(ledger_select(page, "Belanja contoh A")).not_to_be_checked()
    assert state(page) == confirmed

    # A financial mutation invalidates an older bulk-selection intent as well.
    ledger_select(page, "Belanja contoh A").check()
    expect(page.locator(".bulk-review-panel")).to_be_visible()
    page.get_by_role("button", name="Catat transaksi", exact=True).click()
    dialog(page).get_by_label("Dompet asal", exact=True).select_option("bca-idr")
    dialog(page).get_by_label("Nominal", exact=True).fill("5")
    dialog(page).get_by_label(re.compile("Keterangan")).fill("Catatan setelah pilihan kategori")
    dialog(page).get_by_role("button", name="Simpan transaksi", exact=True).click()
    expect(page.locator(".bulk-review-panel")).to_have_count(0)
    expect(ledger_select(page, "Belanja contoh A")).not_to_be_checked()
    after_manual = state(page)
    assert len(after_manual["entries"]) == len(confirmed["entries"]) + 1
    for before in confirmed["entries"]:
        assert next(e for e in after_manual["entries"] if e["id"] == before["id"]) == before
    assert next(e for e in after_manual["entries"] if e["id"] == "expense-a")["category"] == "Makan & minum"
    context.close()

    # Preview categorization persists, while filters preserve global selection.
    context, page = fresh()
    fixture = tmp / "synthetic-cleanup-base.xlsx"
    expanded_fixture = tmp / "synthetic-cleanup-expanded.xlsx"
    write_fixture(fixture)
    write_fixture(expanded_fixture, extra_newest=2)
    nav(page, "Impor mutasi")
    page.get_by_label("File mutasi Ziraat", exact=True).set_input_files(fixture)
    expect(page.get_by_role("button", name="Simpan 3 transaksi", exact=True)).to_be_visible()
    page.get_by_label("Kategori mutasi terpilih", exact=True).select_option("Makan & minum")
    page.get_by_role("button", name="Terapkan kategori ke 3 mutasi", exact=True).click()
    page.get_by_role("button", name="Simpan 3 transaksi", exact=True).click()
    imported = state(page)
    assert len(imported["entries"]) == 3
    assert all(e["category"] == "Makan & minum" for e in imported["entries"])
    assert any(e["type"] == "unreviewed" and e["amount"] == 10000 for e in imported["entries"])
    assert balance(imported, "ziraat-try") == 17450
    page.get_by_label("File mutasi Ziraat", exact=True).set_input_files(expanded_fixture)
    expect(page.get_by_role("button", name="Simpan 2 transaksi", exact=True)).to_be_visible()
    assert page.locator(".duplicate-row").count() == 3
    page.get_by_label("Tampilkan mutasi", exact=True).select_option("new")
    expect(page.locator(".import-table tbody tr")).to_have_count(2)
    page.get_by_label("Cari mutasi", exact=True).fill("tambahan pertama")
    expect(page.locator(".import-table tbody tr")).to_have_count(1)
    page.get_by_label("Pilih semua transaksi baru", exact=True).uncheck()
    expect(page.get_by_role("button", name="Simpan 1 transaksi", exact=True)).to_be_visible()
    page.get_by_label("Kategori mutasi terpilih", exact=True).select_option("Transportasi")
    zero_apply = page.get_by_role("button", name="Terapkan kategori ke 0 mutasi", exact=True)
    expect(zero_apply).to_be_disabled()
    page.get_by_label("Cari mutasi", exact=True).fill("tambahan kedua")
    expect(page.get_by_role("button", name="Simpan 1 transaksi", exact=True)).to_be_visible()
    page.get_by_role("button", name="Terapkan kategori ke 1 mutasi", exact=True).click()
    second_row = page.locator(".import-table tbody tr").filter(has_text="POS tambahan kedua")
    expect(second_row.get_by_label(re.compile(r"^Kategori mutasi "))).to_have_value("Transportasi")
    page.get_by_label("Cari mutasi", exact=True).fill("tambahan pertama")
    first_row = page.locator(".import-table tbody tr").filter(has_text="POS tambahan pertama")
    expect(first_row.get_by_label(re.compile(r"^Kategori mutasi "))).to_have_value("Belum dikategorikan")
    page.get_by_label("Cari mutasi", exact=True).fill("")
    page.get_by_label("Pilih semua transaksi baru", exact=True).check()
    expect(page.get_by_role("button", name="Simpan 2 transaksi", exact=True)).to_be_visible()
    page.get_by_label("Tampilkan mutasi", exact=True).select_option("duplicate")
    expect(page.locator(".import-table tbody tr")).to_have_count(3)
    for checkbox in page.locator('.import-table tbody input[type="checkbox"]').all():
        expect(checkbox).to_be_disabled()
        expect(checkbox).not_to_be_checked()
    page.get_by_label("Tampilkan mutasi", exact=True).select_option("selected")
    expect(page.locator(".import-table tbody tr")).to_have_count(2)
    page.get_by_role("button", name="Simpan 2 transaksi", exact=True).click()
    assert len(state(page)["entries"]) == 5
    second_saved = next(e for e in state(page)["entries"] if e["note"] == "POS tambahan kedua")
    assert second_saved["category"] == "Transportasi"
    page.get_by_label("File mutasi Ziraat", exact=True).set_input_files(expanded_fixture)
    expect(page.get_by_role("button", name="Simpan 0 transaksi", exact=True)).to_be_disabled()
    assert page.locator(".duplicate-row").count() == 5
    context.close()

    # Suggestions are conservative hints; clicking one does not commit a transfer.
    context, page = fresh()
    original = seed(page, [
        entry("pair-source", "Sisi keluar cocok", -5000, "unreviewed"),
        entry("pair-destination", "Sisi masuk cocok", 5000, "unreviewed", wallet="bca-digital-idr"),
        entry("foreign-currency", "Beda mata uang", 5000, "unreviewed", wallet="ziraat-try"),
        entry("wrong-amount", "Nominal berbeda", 6000, "unreviewed", wallet="jago-idr"),
        entry("same-wallet", "Dompet sama", 5000, "unreviewed"),
    ])
    original_balances = {wallet["id"]: balance(original, wallet["id"]) for wallet in original["wallets"]}
    page.get_by_role("button", name="Cek Sisi keluar cocok", exact=True).click()
    suggested = dialog(page).get_by_role("button", name=re.compile(r"^Cocokkan transfer BCA Digital pada "))
    expect(suggested).to_be_visible()
    expect(dialog(page).get_by_role("button", name=re.compile(r"^Cocokkan transfer Ziraat pada "))).to_have_count(0)
    expect(dialog(page).get_by_role("button", name=re.compile(r"^Cocokkan transfer Bank Jago pada "))).to_have_count(0)
    expect(dialog(page).get_by_role("button", name=re.compile(r"^Cocokkan transfer BCA pada "))).to_have_count(0)
    assert state(page) == original
    suggested.click()
    expect(dialog(page).get_by_label("Dompet asal", exact=True)).to_have_value("bca-idr")
    expect(dialog(page).get_by_label("Dompet tujuan", exact=True)).to_have_value("bca-digital-idr")
    expect(dialog(page).get_by_label(re.compile(r"^Catatan pasangan"))).to_have_value("pair-destination")
    assert state(page) == original
    dialog(page).get_by_role("button", name="Simpan hasil cek", exact=True).click()
    combined = state(page)
    assert len(combined["entries"]) == 4
    transfer = next(e for e in combined["entries"] if e["id"] == "pair-source")
    assert transfer["type"] == "transfer"
    assert transfer["sourceKey"] == "synthetic-cleanup-pair-source"
    assert transfer["toSourceKey"] == "synthetic-cleanup-pair-destination"
    assert {wallet["id"]: balance(combined, wallet["id"]) for wallet in combined["wallets"]} == original_balances
    context.close()
    assert errors == [], errors
    return ["bulk expense categories preserve IDs/fingerprints/balances", "category-only cleanup leaves pending cashflow unreviewed", "explicit bulk type confirmation preserves signed cashflow", "transfers/adjustments excluded from bulk category selection", "ledger filter changes clear hidden selection", "financial mutations clear stale bulk selection", "preview categories persist through import and duplicate checks", "preview filters preserve global selection but bulk edits only visible rows", "preview select-all excludes duplicates and respects visible rows", "same-currency exact transfer suggestions require explicit save"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path(tempfile.mkdtemp(prefix="uangku-browser-evidence-")))
    parser.add_argument("--group", action="append", default=[])
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    source_root = Path(__file__).resolve().parents[1]
    def source_hashes():
        return {str(p.relative_to(source_root)).replace("\\", "/"): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted((source_root / "src").rglob("*")) if p.is_file()}
    before = source_hashes()
    dist_sha = assert_production_url(BASE_URL)
    groups = [("desktop", check_desktop), ("mobile", check_mobile),
              ("regressions", check_regressions), ("daily-use", check_daily_use),
              ("import-cleanup", check_import_cleanup)]
    results = []
    with sync_playwright() as playwright:
        browser = launch_browser(playwright)
        browser_version = browser.version
        try:
            for name, check in groups:
                if args.group and name not in args.group:
                    continue
                began = time.monotonic()
                try:
                    scenarios = check(browser, output)
                    result = {"group": name, "status": "passed", "scenarios": scenarios}
                except Exception as err:
                    result = {"group": name, "status": "failed", "scenarios": [],
                              "error": str(err), "traceback": traceback.format_exc()}
                    for index, context in enumerate(browser.contexts):
                        for page_index, page in enumerate(context.pages):
                            if not page.is_closed():
                                try:
                                    page.screenshot(path=str(output / f"{name}-{index}-{page_index}-failure.png"), full_page=True, timeout=5000)
                                except Exception:
                                    pass
                result["seconds"] = round(time.monotonic() - began, 3)
                results.append(result)
                print(json.dumps(result, ensure_ascii=False), flush=True)
        finally:
            browser.close()
    after = source_hashes()
    report = {"scope": "39 original behavior scenarios ported to explicit no-write startup and asynchronous coordinated saves",
              "url": BASE_URL, "browser_version": browser_version, "synthetic_only": True,
              "dist_sha256": dist_sha,
              "source_before": before, "source_after": after, "source_stable": before == after,
              "results": results, "passed_scenarios": sum(len(r["scenarios"]) for r in results if r["status"] == "passed"),
              "failed_groups": sum(r["status"] != "passed" for r in results)}
    (output / "summary.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"summary": str(output / "summary.json"), "passed_scenarios": report["passed_scenarios"],
                      "failed_groups": report["failed_groups"], "source_stable": report["source_stable"]}))
    return 0 if not report["failed_groups"] and report["source_stable"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
