"""Minimum local reconstruction regressions; synthetic fresh browser contexts only.

Run a production preview first. Example:
  UANGKU_TEST_URL=http://127.0.0.1:4173 python tests/recovery_browser.py --output PATH

Uses an installed Chrome/Edge executable and a scoped Playwright dependency.
No existing browser profile, cloud runtime, bank account or real backup is read.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
from browser_support import (backup_action, install_playwright_path, launch_browser,
                             read_document, stored_document, assert_production_url)
install_playwright_path()
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('UANGKU_TEST_URL', 'http://127.0.0.1:4180')
KEY = 'uangku:v1'
LEDGER_LOCK = KEY + ':coordinated-write'  # src/lib/fullRestoreStorage.ts
FIXED_TIME = datetime(2026, 10, 30, 12, tzinfo=timezone.utc)
LIMIT = 8 * 1024 * 1024


def fixture(entries=None, *, try_opening=12_000):
    return {'app': 'uangku', 'version': 1, 'demo': False, 'state': {
        'version': 1,
        'wallets': [
            {'id': 'bca-idr', 'name': 'Synthetic A', 'currency': 'IDR', 'kind': 'bank', 'openingBalance': 100_000},
            {'id': 'cash-idr', 'name': 'Synthetic B', 'currency': 'IDR', 'kind': 'bank', 'openingBalance': 0},
            {'id': 'ziraat-try', 'name': 'Synthetic Ziraat', 'currency': 'TRY', 'kind': 'bank', 'openingBalance': try_opening},
        ],
        'entries': entries or [],
    }}


def expense(id_, amount=100, *, wallet='bca-idr', date='2026-10-30', note='Synthetic'):
    return {'id': id_, 'date': date, 'type': 'expense', 'walletId': wallet, 'amount': amount,
            'category': 'Belanja', 'note': note}


def stored(page):
    return stored_document(page, KEY)


def persisted_notes(page):
    return sorted(e['note'] for e in stored(page)['state']['entries'])


def saldo(data, wallet):
    result = next(w['openingBalance'] for w in data['state']['wallets'] if w['id'] == wallet)
    for e in data['state']['entries']:
        if e['walletId'] == wallet:
            result += e['amount'] if e['type'] in ['income', 'adjustment', 'unreviewed', 'movement'] else -e['amount'] - e.get('fee', 0)
        if e['type'] == 'transfer' and e.get('toWalletId') == wallet:
            result += e.get('toAmount', 0)
    return result


def nav(page, label):
    page.locator('.sidebar').get_by_role('button', name=re.compile('^' + re.escape(label) + r'(?:\s+\d+)?$')).click()


def open_expense(page, *, note, amount='1', wallet='bca-idr', date='2026-10-30'):
    page.get_by_role('button', name='Catat transaksi', exact=True).first.click()
    dlg = page.get_by_role('dialog')
    dlg.get_by_label('Dompet asal', exact=True).select_option(wallet)
    dlg.get_by_label('Nominal', exact=True).fill(amount)
    dlg.locator('input[type=date]').fill(date)
    dlg.get_by_label(re.compile('Keterangan')).fill(note)
    return dlg


def save_expense(page, **kwargs):
    dlg = open_expense(page, **kwargs)
    dlg.get_by_role('button', name='Simpan transaksi', exact=True).click()
    expect(page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
    expect(page.get_by_role('dialog')).to_have_count(0)


@contextmanager
def isolated(browser, initial, output, name, *, viewport=None, init_extra=None):
    context = browser.new_context(viewport=viewport or {'width': 1440, 'height': 1000}, accept_downloads=True,
                                  timezone_id='Europe/Istanbul')
    if initial is not None:
        raw = json.dumps(initial, ensure_ascii=False, separators=(',', ':'))
        context.add_init_script('if (localStorage.getItem(' + json.dumps(KEY) + ') === null) localStorage.setItem('
                                + json.dumps(KEY) + ', ' + json.dumps(raw) + ');')
    if init_extra:
        context.add_init_script(init_extra)
    errors = []
    # page.clock belongs to the context and covers every tab; WebKit refuses a second install.
    context.clock.install(time=FIXED_TIME)

    def add_page():
        page = context.new_page()
        page.set_default_timeout(25_000)
        page.on('pageerror', lambda err: errors.append(str(err)))
        page.goto(URL, wait_until='networkidle')
        expect(page.locator('.balance-card')).to_be_visible()
        return page

    try:
        yield context, add_page, errors
        assert errors == [], 'Unexpected page error: ' + repr(errors)
    except Exception:
        for index, page in enumerate(context.pages):
            if not page.is_closed():
                try:
                    page.screenshot(path=str(output / f'{name}-{index}-failure.png'), full_page=True, timeout=5_000)
                except Exception:
                    pass
        raise
    finally:
        context.close()


def test_stale_form(browser, output):
    with isolated(browser, fixture(), output, 'stale-form') as (_, new_page, _):
        a, b = new_page(), new_page()
        draft_a = open_expense(a, note='Tab A durable')
        draft_b = open_expense(b, note='Tab B recoverable', amount='2')
        draft_a.get_by_role('button', name='Simpan transaksi', exact=True).click()
        a.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).state.entries.length === 1', arg=KEY)
        draft_b.get_by_role('button', name='Simpan transaksi', exact=True).click()
        expect(b.get_by_test_id('save-status')).to_contain_text('konflik')
        assert persisted_notes(a) == ['Tab A durable']
        b.get_by_role('dialog').get_by_role('button', name='Batal', exact=True).click()
        b.get_by_role('button', name='Buang isian', exact=True).click()
        with b.expect_download() as info:
            b.get_by_role('button', name='Unduh pekerjaan yang belum tersimpan', exact=True).click()
        path = output / 'stale-form-recovery-synthetic.json'
        info.value.save_as(path)
        recovered = json.loads(path.read_text(encoding='utf-8'))
        assert 'Tab B recoverable' in [e['note'] for e in recovered['state']['entries']]
        a.reload(wait_until='networkidle')
        assert persisted_notes(a) == ['Tab A durable']


def test_clean_sync_and_concurrent_forms(browser, output):
    with isolated(browser, fixture(), output, 'two-tabs') as (_, new_page, _):
        a, b = new_page(), new_page()
        save_expense(a, note='Sequential A')
        b.wait_for_function('(key) => JSON.parse(localStorage.getItem(key)).state.entries.length === 1', arg=KEY)
        b.bring_to_front()
        save_expense(b, note='Sequential B')
        assert persisted_notes(a) == ['Sequential A', 'Sequential B']
        a.bring_to_front()
        a.wait_for_timeout(100)
        open_expense(a, note='Concurrent A')
        open_expense(b, note='Concurrent B')
        a.get_by_role('dialog').locator('form').evaluate('(form) => form.requestSubmit()')
        b.get_by_role('dialog').locator('form').evaluate('(form) => form.requestSubmit()')
        # Each tab either saved (its form closed) or lost the race (form open, conflict shown). A fixed
        # wait was too short when the second write was slow, and read the ledger before it landed.
        for tab in (a, b):
            tab.wait_for_function('''() => !document.querySelector('[role=dialog]')
              || document.querySelector('[data-testid=save-status]')?.textContent.includes('konflik')''')
        # Who won is read from each tab itself: a form closes only after its save succeeded. Reading the
        # ledger through one tab is not enough to tell, because in Firefox a tab's view of localStorage can
        # trail another tab's write; that once named a tab that had saved as the loser.
        tabs = ((a, 'Concurrent A'), (b, 'Concurrent B'))
        saved = [note for tab, note in tabs if tab.get_by_role('dialog').count() == 0]
        assert saved, 'Neither concurrent save succeeded'
        expected = sorted(['Sequential A', 'Sequential B', *saved])
        # Then both tabs must come to hold exactly the records of the saves that reported success.
        for tab, _ in tabs:
            tab.wait_for_function('''({key, expected}) => JSON.stringify(JSON.parse(localStorage.getItem(key))
              .state.entries.map(entry => entry.note).sort()) === JSON.stringify(expected)''',
                                  arg={'key': KEY, 'expected': expected})
        assert sorted(persisted_notes(a)) == expected == sorted(persisted_notes(b))
        for tab, note in tabs:
            if note not in saved:
                expect(tab.get_by_test_id('save-status')).to_contain_text('konflik')
                expect(tab.get_by_role('dialog')).to_be_visible()


STALE_VIEW = """(key) => {
  const frozen = localStorage.getItem(key), read = Storage.prototype.getItem, write = Storage.prototype.setItem;
  window.__staleReads = 0;
  Storage.prototype.getItem = function (name) {
    if (this === localStorage && name === key) { window.__staleReads++; return frozen; }
    return read.call(this, name);
  };
  // A tab always sees its own writes: its first write of that key ends the stale view.
  Storage.prototype.setItem = function (name, value) {
    if (this === localStorage && name === key) { Storage.prototype.getItem = read; Storage.prototype.setItem = write; }
    return write.call(this, name, value);
  };
}"""


def test_stale_view_save_conflicts(browser, output):
    """MW-162: a tab whose view of localStorage trails another tab's save must not overwrite that save.

    The trailing view is forced, so nothing here depends on timing: tab B keeps reading the ledger text it
    loaded until it writes the ledger itself. That is what a tab can read for some milliseconds after another
    tab's write, also inside the ledger lock.
    """
    with isolated(browser, fixture(), output, 'stale-view') as (_, new_page, _):
        a, b = new_page(), new_page()
        b.evaluate(STALE_VIEW, KEY)
        save_expense(a, note='Stale view A')
        assert persisted_notes(a) == ['Stale view A']
        b.bring_to_front()
        open_expense(b, note='Stale view B', amount='2').get_by_role('button', name='Simpan transaksi', exact=True).click()
        b.wait_for_function("""() => !document.querySelector('[role=dialog]')
          || document.querySelector('[data-testid=save-status]')?.textContent.includes('konflik')""")
        # The stored ledger is read through A: B's own view is the forced one for as long as B has not written.
        kept = persisted_notes(a)
        assert kept == ['Stale view A'], f'Tab B saved over tab A from a stale view; stored notes are now {kept}'
        expect(b.get_by_test_id('save-status')).to_contain_text('konflik')
        expect(b.get_by_role('dialog')).to_be_visible()
        expect(b.get_by_role('dialog').get_by_label(re.compile('Keterangan'))).to_have_value('Stale view B')
        assert b.evaluate('window.__staleReads') > 0
        a.reload(wait_until='networkidle')
        assert persisted_notes(a) == ['Stale view A']


def test_stale_restore_observer(browser, output):
    """MW-163: an idle tab sees the restore journal and staged categories before the new ledger."""
    from full_backup_browser import CATEGORIES, personal_settings, pick_backup, synthetic_page

    journal_key = 'uangku:full-restore:v1'
    before = fixture([expense('old', note='Before restore')])
    restored = fixture([expense('restored', note='From backup')])
    settings = personal_settings()
    old_settings = {**settings, 'names': [*settings['names'], 'Old profile only']}
    backup = {'app': 'uangku-full-backup', 'version': 1, 'ledger': restored, 'categorySettings': settings}
    with synthetic_page(browser, URL, 1440, before, old_settings) as writer:
        observer = writer.context.new_page()
        observer.goto(URL, wait_until='networkidle')
        nav(observer, 'Transaksi')
        manage = observer.get_by_role('button', name='Kelola kategori', exact=True)
        expect(manage).to_be_enabled()
        observer.evaluate("""([ledger, journal]) => {
          const read = Storage.prototype.getItem, oldLedger = localStorage.getItem(ledger);
          window.__journalView = null;
          window.__writes = [];
          Storage.prototype.getItem = function(key) {
            if (this === localStorage && key === ledger) return oldLedger;
            if (this === localStorage && key === journal) return window.__journalView;
            return read.call(this, key);
          };
          for (const name of ['setItem', 'removeItem']) {
            const original = Storage.prototype[name];
            Storage.prototype[name] = function(key, ...args) {
              if (this === localStorage) window.__writes.push([name, key]);
              return original.call(this, key, ...args);
            };
          }
          window.__catchUp = () => {
            Storage.prototype.getItem = read;
            window.dispatchEvent(new StorageEvent('storage', {key: ledger}));
          };
        }""", [KEY, journal_key])
        writer.evaluate("""journal => {
          const write = Storage.prototype.setItem;
          Storage.prototype.setItem = function(key, value) {
            if (this === localStorage && key === journal) window.__restoreJournal = value;
            return write.call(this, key, value);
          };
        }""", journal_key)
        pick_backup(writer, 'synthetic-full.json', json.dumps(backup).encode())
        writer.get_by_role('dialog').get_by_role('button', name='Pulihkan semuanya', exact=True).click()
        expect(writer.locator('.toast')).to_contain_text('Cadangan lengkap dipulihkan')
        journal = writer.evaluate('window.__restoreJournal')
        staged_categories = json.loads(journal)['afterCategories']
        assert json.loads(staged_categories) == settings
        observer.wait_for_function('([key, raw]) => localStorage.getItem(key) === raw',
                                   arg=[CATEGORIES, staged_categories])
        observer.evaluate("""async ([journal, value, lock]) => {
          window.__journalView = value;
          window.dispatchEvent(new Event('focus'));
          window.dispatchEvent(new StorageEvent('storage', {key: journal}));
          // Both refresh handlers have requested the ledger lock. Drain them before checking durable data.
          await navigator.locks.request(lock, () => {});
        }""", [journal_key, journal, LEDGER_LOCK])

        reader = writer.context.new_page()
        reader.goto(URL, wait_until='networkidle')
        assert stored(reader) == restored, 'Fresh tab did not read the restored ledger'
        writes = observer.evaluate('window.__writes')
        assert json.loads(reader.evaluate('key => localStorage.getItem(key)', CATEGORIES)) == settings, (
            f'Fresh tab lost the restored categories after the observer refreshed: {writes}')
        assert writes == [], f'Observer changed storage while its ledger view was stale: {writes}'

        # The last storage event can be the ledger. The observer must leave the pending state without reloading.
        expect(manage).to_be_disabled()
        observer.evaluate('window.__catchUp()')
        expect(manage).to_be_enabled()
        manage.click()
        manager = observer.get_by_role('dialog', name='Kelola kategori', exact=True)
        manager.get_by_role('tab', name=re.compile('^Kategori')).click()
        names = manager.locator('.category-manager-names')
        expect(names.get_by_text('Unused QA label', exact=True)).to_be_visible()
        expect(names.get_by_text('Old profile only', exact=True)).to_have_count(0)


QUEUED_SAVE_ROUNDS = 5
QUEUED_SAVE_ENTRIES = 1500


def test_queued_saves_one_winner(browser, output, rounds=QUEUED_SAVE_ROUNDS, seed_entries=QUEUED_SAVE_ENTRIES):
    """MW-162: two tabs wait behind the ledger lock and then commit back to back, with no human-sized gap.

    A tab's view of localStorage can trail the other tab's write by milliseconds, also inside the lock. Each
    round exactly one save may report success, the other must keep its form open with a conflict, and every
    save that reported success must still be stored at the end.
    """
    # A ledger of realistic size: in Chromium the other tab's view trails longer the larger the stored text is.
    seeded = [expense(f'seed-{i}', 100 + i, note=f'Benih {i:04d}') for i in range(seed_entries)]
    with isolated(browser, fixture(seeded), output, 'queued-saves') as (_, new_page, _):
        tabs = {'A': new_page(), 'B': new_page()}
        gate = tabs['A']
        kept = [entry['note'] for entry in seeded]

        def queued():
            return gate.evaluate("""async (name) => (await navigator.locks.query()).pending
              .filter(lock => lock.name === name).length""", LEDGER_LOCK)

        for index in range(rounds):
            order = ['A', 'B'] if index % 2 == 0 else ['B', 'A']
            notes = {name: f'Antre {index} {name}' for name in tabs}
            for name, tab in tabs.items():
                open_expense(tab, note=notes[name], amount=str(index + 1))
            # The test holds the ledger lock itself, so both saves wait in its queue in a known order.
            assert gate.evaluate("""(name) => new Promise(held => { navigator.locks.request(name,
              () => new Promise(release => { window.__releaseLedgerGate = release; held(true); })); })""", LEDGER_LOCK)
            for position, name in enumerate(order, start=1):
                tabs[name].get_by_role('dialog').locator('form').evaluate('(form) => form.requestSubmit()')
                # wait_for_function does not await an async predicate, so the queue is polled from here.
                deadline = time.monotonic() + 15
                while queued() != position:
                    assert time.monotonic() < deadline, f'Round {index}: save {position} never queued behind the ledger lock'
                    gate.wait_for_timeout(10)
            gate.evaluate('() => window.__releaseLedgerGate()')
            for tab in tabs.values():
                tab.wait_for_function("""() => !document.querySelector('[role=dialog]')
                  || document.querySelector('[data-testid=save-status]')?.textContent.includes('konflik')""")
            # A form closes only after its save succeeded; which tab's record survives is not assumed.
            saved = [name for name in order if tabs[name].get_by_role('dialog').count() == 0]
            assert len(saved) == 1, f'Round {index}: {len(saved)} of 2 queued saves reported success'
            kept.append(notes[saved[0]])
            for name, tab in tabs.items():
                if name not in saved:
                    expect(tab.get_by_test_id('save-status')).to_contain_text('konflik')
                    expect(tab.get_by_role('dialog')).to_be_visible()
                    # Drops the losing draft; the next round starts from the stored ledger.
                    tab.reload(wait_until='networkidle')
                    expect(tab.locator('.balance-card')).to_be_visible()
                tab.wait_for_function("""({key, expected}) => JSON.stringify(JSON.parse(localStorage.getItem(key))
                  .state.entries.map(entry => entry.note).sort()) === JSON.stringify(expected)""",
                                      arg={'key': KEY, 'expected': sorted(kept)})
        assert persisted_notes(gate) == sorted(kept)


def test_concurrent_cash_cleanup(browser, output):
    """MW-164a: two passive tabs clean the same legacy wallet while retaining the publisher's new entry."""
    initial = fixture([expense('old')])
    expected = fixture([*initial['state']['entries'], expense('published', note='Published entry')])
    expected['state']['wallets'].append({'id': 'cash-used', 'name': 'Keep cash', 'kind': 'cash',
                                         'currency': 'IDR', 'openingBalance': 500})
    legacy = deepcopy(expected)
    legacy['state']['wallets'].append({'id': 'cash-empty', 'name': 'Remove cash', 'kind': 'cash',
                                       'currency': 'IDR', 'openingBalance': 0})
    with isolated(browser, initial, output, 'cash-cleanup') as (context, new_page, _):
        observers = [new_page(), new_page()]
        publisher = context.new_page()
        publisher.route('**/synthetic-publisher', lambda route: route.fulfill(content_type='text/html', body=''))
        publisher.goto(URL.rstrip('/') + '/synthetic-publisher')
        # Hold the writer lock until both observers have prepared their automatic cleanup.
        publisher.evaluate("""([name, key, legacy]) => new Promise(held => navigator.locks.request(name,
          () => new Promise(release => {
            window.releaseCleanupGate = release;
            localStorage.setItem(key, JSON.stringify(legacy));
            held(true);
          })))""", [LEDGER_LOCK, KEY, legacy])
        try:
            for tab in observers:
                expect(tab.get_by_test_id('save-status')).to_contain_text('Sedang menyimpan')
        finally:
            publisher.evaluate('() => window.releaseCleanupGate()')
        for tab in observers:
            expect(tab.get_by_test_id('save-status')).to_have_text('Tersimpan di browser')
            expect(tab.get_by_role('button', name='Ubah Published entry', exact=True)).to_be_visible()
        for tab in [publisher, *observers]:
            tab.wait_for_function('key => !localStorage.getItem(key).includes("cash-empty")', arg=KEY)
            assert stored(tab)['state'] == expected['state']


def test_quota_retry(browser, output):
    with isolated(browser, fixture(), output, 'quota') as (_, new_page, _):
        page = new_page()
        page.evaluate('''() => {
          window.__restoreSetItem = Storage.prototype.setItem;
          window.__ledgerWriteAttempts = 0;
          Storage.prototype.setItem = function(key,value) {
            if (key === 'uangku:v1') { window.__ledgerWriteAttempts++; throw new DOMException('Synthetic quota failure','QuotaExceededError'); }
            return window.__restoreSetItem.call(this,key,value);
          };
        }''')
        open_expense(page, note='Quota retained draft', amount='7').get_by_role('button', name='Simpan transaksi', exact=True).click()
        expect(page.get_by_test_id('save-status')).to_contain_text('penyimpanan gagal')
        # MW-97: a refused write for lack of room says so, says what is safe, and says what to download.
        expect(page.get_by_test_id('save-status')).to_contain_text(
            'Penyimpanan browser penuh, jadi perubahan ini belum tersimpan. Catatan yang sudah tersimpan tetap utuh. '
            'Unduh pekerjaan yang belum tersimpan: file itu memuat seluruh transaksi termasuk perubahan ini.')
        assert stored(page)['state']['entries'] == []
        assert 'Tersimpan di browser' not in page.locator('.sidebar-user').inner_text()
        assert 'Transaksi tersimpan.' not in page.locator('body').inner_text()
        page.get_by_role('dialog').get_by_role('button', name='Batal', exact=True).click()
        page.get_by_role('button', name='Buang isian', exact=True).click()
        with page.expect_download() as info:
            page.get_by_role('button', name='Unduh pekerjaan yang belum tersimpan', exact=True).click()
        path = output / 'quota-recovery-synthetic.json'
        info.value.save_as(path)
        assert len(json.loads(path.read_text(encoding='utf-8'))['state']['entries']) == 1
        page.evaluate('''() => {
          Storage.prototype.setItem = function(key,value) {
            if (key === 'uangku:v1') window.__ledgerWriteAttempts++;
            return window.__restoreSetItem.call(this,key,value);
          };
        }''')
        page.get_by_role('button', name='Coba simpan lagi', exact=True).click()
        expect(page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
        assert persisted_notes(page) == ['Quota retained draft']
        assert page.evaluate('window.__ledgerWriteAttempts') == 2
        page.reload(wait_until='networkidle')
        assert persisted_notes(page) == ['Quota retained draft']


def test_no_web_locks(browser, output):
    extra = "Object.defineProperty(navigator,'locks',{configurable:true,get:()=>undefined});"
    with isolated(browser, fixture(), output, 'no-locks', init_extra=extra) as (_, new_page, _):
        page = new_page()
        expect(page.get_by_test_id('save-status')).to_contain_text('tidak didukung')
        open_expense(page, note='Unsupported draft').get_by_role('button', name='Simpan transaksi', exact=True).click()
        expect(page.get_by_test_id('save-status')).to_contain_text('tidak didukung')
        assert stored(page)['state']['entries'] == []


def test_transaction_draft_close(browser, output):
    initial = fixture([expense('draft-edit', note='Original note')])
    with isolated(browser, initial, output, 'transaction-draft-close') as (_, new_page, _):
        page = new_page()
        dialog = page.get_by_role('dialog')
        confirmation = page.get_by_role('dialog', name='Buang isian transaksi?', exact=True)
        keep = confirmation.get_by_role('button', name='Lanjut mengisi', exact=True)
        discard = confirmation.get_by_role('button', name='Buang isian', exact=True)
        start = page.get_by_role('button', name='Catat transaksi', exact=True).first
        start.click()
        page.keyboard.press('Escape')
        expect(dialog).to_have_count(0)

        open_expense(page, note='Unfinished note', amount='123')
        note = dialog.get_by_label(re.compile('Keterangan'))
        for close_method in ('Escape', 'Tutup', 'Batal', 'backdrop'):
            if close_method == 'Escape':
                page.keyboard.press('Escape')
            elif close_method == 'backdrop':
                page.locator('.modal-backdrop').click(position={'x': 2, 'y': 2})
            else:
                dialog.get_by_role('button', name=close_method, exact=True).click()
            expect(keep).to_be_focused()
            expect(dialog).to_have_count(1)
            if close_method == 'Escape':
                page.keyboard.press('Enter')
                expect(note).to_be_focused()
            elif close_method == 'backdrop':
                discard.click()
                break
            else:
                keep.click()
            expect(note).to_have_value('Unfinished note')
            expect(dialog.get_by_label('Nominal', exact=True)).to_have_value('123')
        expect(dialog).to_have_count(0)
        assert stored(page) == initial

        page.get_by_role('button', name='Ubah Original note', exact=True).click()
        note.fill('Changed note')
        dialog.get_by_role('button', name='Tutup', exact=True).click()
        page.keyboard.press('Escape')
        expect(note).to_have_value('Changed note')
        note.fill('Original note')
        dialog.get_by_role('button', name='Batal', exact=True).click()
        expect(dialog).to_have_count(0)
        assert stored(page) == initial

        page.get_by_role('button', name='Pindah uang', exact=True).first.click()
        dialog.get_by_role('button', name='Tanggal masuk berbeda?', exact=True).click()
        dialog.get_by_label('Tanggal kredit', exact=True).fill('2026-11-02')
        page.keyboard.press('Escape')
        expect(keep).to_be_focused()
        keep.click()
        expect(dialog.get_by_label('Tanggal kredit', exact=True)).to_have_value('2026-11-02')
        dialog.get_by_role('button', name='Batal', exact=True).click()
        discard.click()
        assert stored(page) == initial

        open_expense(page, note='Saved once', wallet='cash-idr')
        dialog.get_by_role('button', name='Simpan & catat lagi', exact=True).click()
        expect(dialog.get_by_label('Nominal', exact=True)).to_have_value('')
        expect(dialog.get_by_label('Dompet asal', exact=True)).to_have_value('cash-idr')
        dialog.get_by_role('button', name='Batal', exact=True).click()
        expect(dialog).to_have_count(0)
        assert persisted_notes(page) == ['Original note', 'Saved once']


def test_pending_writer_modal_guard(browser, output):
    with isolated(browser, fixture(), output, 'pending-writer') as (_, new_page, _):
        page = new_page()
        # Patch the prototype: WebKit can recreate the navigator.locks wrapper and drop an own property.
        page.evaluate('''(ledgerLock) => {
          const manager = Object.getPrototypeOf(navigator.locks), request = manager.request;
          manager.request = function (name,options,callback) {
            // Only the ledger write is withheld. A save also asks for other lock names inside it (MW-162),
            // and withholding those as well would replace the release function below before it is called.
            if (name !== ledgerLock) return request.call(this,name,options,callback);
            return request.call(this,name,options,async lock => {
              await new Promise(resolve => { window.__releaseSyntheticWriter = resolve; });
              return callback(lock);
            });
          };
        }''', LEDGER_LOCK)
        dlg = open_expense(page, note='Pending original draft')
        dlg.get_by_role('button', name='Simpan transaksi', exact=True).click()
        expect(page.get_by_test_id('save-status')).to_contain_text('Sedang menyimpan')
        # Saving can be queued before the native lock callback installs this
        # fixture's release promise. Exercise the guards with the lock held.
        page.wait_for_function("() => typeof window.__releaseSyntheticWriter === 'function'")
        # Inspect durable bytes while intentionally withholding the lock. The
        # usual helper waits for a completed save and would deadlock this case.
        assert page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', KEY)['state']['entries'] == []
        dlg.press('Escape')
        expect(page.get_by_role('dialog')).to_have_count(1)
        page.get_by_role('dialog').get_by_role('button', name='Batal', exact=True).evaluate('(button) => button.click()')
        expect(page.get_by_role('dialog')).to_have_count(1)
        page.locator('.modal-backdrop').click(position={'x': 2, 'y': 2}, force=True)
        expect(page.get_by_role('dialog')).to_have_count(1)
        page.get_by_role('button', name='Pindah uang', exact=True).evaluate('(button) => button.click()')
        expect(page.get_by_role('dialog')).to_have_attribute('aria-label', 'Catat transaksi')
        expect(page.get_by_role('dialog').get_by_label(re.compile('Keterangan'))).to_have_value('Pending original draft')
        page.evaluate('window.__releaseSyntheticWriter()')
        expect(page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
        expect(page.get_by_role('dialog')).to_have_count(0)
        assert persisted_notes(page) == ['Pending original draft']


def test_stale_modal_delete(browser, output):
    initial = fixture([expense('original', 100, note='Original record')])
    with isolated(browser, initial, output, 'stale-delete') as (_, new_page, _):
        a, b = new_page(), new_page()
        a.get_by_role('button', name='Ubah Original record', exact=True).click()
        b.get_by_role('button', name='Ubah Original record', exact=True).click()
        b.get_by_role('dialog').get_by_label(re.compile('Keterangan')).fill('Remote edited record')
        b.get_by_role('dialog').get_by_role('button', name='Simpan transaksi', exact=True).click()
        expect(b.get_by_role('dialog')).to_have_count(0)
        a.get_by_role('dialog').get_by_role('button', name='Hapus', exact=True).click()
        a.get_by_role('dialog').get_by_role('button', name='Hapus transaksi', exact=True).click()
        expect(a.get_by_test_id('save-status')).to_contain_text('konflik')
        assert persisted_notes(a) == ['Remote edited record']
        assert stored(a)['state']['entries'][0]['id'] == 'original'


def test_blocked_metadata_confirmation(browser, output):
    initial = fixture([expense('source', 100, note='Unsupported source document')])
    initial['metadata'] = {'policy': 'synthetic-source', 'facts': [], 'links': [], 'statements': []}
    with isolated(browser, initial, output, 'blocked-metadata') as (_, new_page, _):
        page = new_page()
        before = page.evaluate('(key) => localStorage.getItem(key)', KEY)
        expect(page.get_by_test_id('save-status')).to_contain_text('Data lama dilindungi')
        page.locator('.demo-banner button').click()
        dlg = page.get_by_role('dialog')
        expect(dlg).to_contain_text(re.compile(r'data (lama|tersimpan)|catatan (lama|tersimpan)|data.*tidak.*(terbaca|didukung)', re.I))
        assert 'Data contoh akan diganti' not in dlg.inner_text()
        dlg.get_by_role('button', name='Batal', exact=True).click()
        assert page.evaluate('(key) => localStorage.getItem(key)', KEY) == before
        with page.expect_download() as info:
            page.get_by_role('button', name='Unduh pekerjaan yang belum tersimpan', exact=True).click()
        path = output / 'blocked-original-synthetic.json'
        info.value.save_as(path)
        assert path.read_text(encoding='utf-8') == before
        assert json.loads(path.read_text(encoding='utf-8')) == initial


def test_denied_storage_backup(browser, output):
    initial = fixture([expense('private-entry', note='Original ledger')])
    raw = json.dumps(initial, indent=2)
    with isolated(browser, None, output, 'denied-storage-backup') as (_, new_page, _):
        page = new_page()
        page.evaluate('(raw) => localStorage.setItem("uangku:v1", raw)', raw)
        page.add_init_script('''if (sessionStorage.getItem('deny-access')) {
            Object.defineProperty(window, 'localStorage', {get() {
                throw new DOMException('Access denied by test', 'SecurityError');
            }});
        }''')
        page.evaluate("sessionStorage.setItem('deny-access', '1')")
        page.reload(wait_until='networkidle')
        expect(page.get_by_test_id('save-status')).to_contain_text('Data lama dilindungi')
        downloads = []
        page.on('download', lambda item: downloads.append(item.suggested_filename))
        for label in ['Cadangkan semuanya', 'Cadangkan transaksi saja', 'Unduh pekerjaan yang belum tersimpan']:
            backup_action(page, label).click()
            expect(page.locator('.toast')).to_contain_text(re.compile('penyimpanan|akses', re.I))
        page.evaluate("sessionStorage.removeItem('deny-access')")
        page.reload(wait_until='networkidle')
        assert not downloads, 'A blocked storage read produced a download'
        assert page.evaluate('(key) => localStorage.getItem(key)', KEY) == raw
        assert download_backup(page, output / 'after-access-restored.json') == initial


def test_carry_demo_transactions(browser, output):
    with isolated(browser, None, output, 'carry-demo-transactions') as (_, new_page, _):
        page = new_page()
        save_expense(page, wallet='demo-bca', amount='12345', note='Personal note in demo')
        page.reload(wait_until='networkidle')
        before = stored(page)
        personal = next(entry for entry in before['state']['entries'] if entry['note'] == 'Personal note in demo')
        assert before['demo'] and len(before['state']['entries']) > 1
        start = page.get_by_role('button', name='Mulai pakai data sendiri', exact=True)
        dlg = page.get_by_role('dialog')
        start.click()
        dlg.get_by_role('button', name='Batal', exact=True).click()
        assert stored(page) == before, 'Cancelling the review changed the original demo'
        start.click()
        page.evaluate('''() => new Promise(acquired => {
            navigator.locks.request('uangku:v1:coordinated-write', () => new Promise(release => {
                window.releaseDemoWrite = release;
                acquired();
            }));
        })''')
        dlg.get_by_role('button', name='Bawa transaksi saya', exact=True).click()
        expect(dlg).to_contain_text('Sedang menyimpan')
        dlg.press('Escape')
        expect(dlg).to_be_visible()
        assert page.evaluate('(key) => JSON.parse(localStorage.getItem(key)).demo', KEY), 'Ledger changed while its lock was held'
        page.evaluate('window.releaseDemoWrite()')
        expect(dlg).to_have_count(0)
        expect(page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser')
        page.reload(wait_until='networkidle')
        after = stored(page)
        assert not after['demo'] and after['state']['entries'] == [personal], 'Carried ledger or personal entry changed across reload'
        assert saldo(after, personal['walletId']) == -personal['amount'], 'Sample balance leaked into the personal ledger'


def download_backup(page, path):
    with page.expect_download(timeout=60_000) as info:
        page.locator('.sidebar').get_by_role('button', name='Cadangkan transaksi saja', exact=True).click()
    info.value.save_as(path)
    return read_document(path)


def restore_backup(page, path):
    page.get_by_label('File cadangan Uangku', exact=True).set_input_files(path)
    page.get_by_role('dialog').get_by_role('button', name='Pulihkan data', exact=True).click()
    expect(page.get_by_test_id('save-status')).to_contain_text('Tersimpan di browser', timeout=60_000)
    expect(page.get_by_role('dialog')).to_have_count(0)


def test_backup_small(browser, output):
    initial = fixture([expense('small-1', 2_550, note='İstanbul 界 synthetic')])
    with isolated(browser, initial, output, 'backup-small') as (_, new_page, _):
        page = new_page()
        path = output / 'download-small-synthetic.json'
        assert download_backup(page, path) == initial
        save_expense(page, note='Mutation after backup')
        assert len(stored(page)['state']['entries']) == 2
        restore_backup(page, path)
        page.reload(wait_until='networkidle')
        assert stored(page) == initial
        invalid = output / 'invalid-synthetic.json'
        invalid.write_text('{"app":"foreign"}', encoding='utf-8')
        page.get_by_label('File cadangan Uangku', exact=True).set_input_files(invalid)
        assert stored(page) == initial


def test_backup_large(browser, output):
    initial = {'app': 'uangku', 'version': 1, 'demo': False, 'state': {'version': 1,
        'wallets': [{'id': 'a', 'name': 'Synthetic large', 'currency': 'TRY', 'kind': 'bank', 'openingBalance': 1_000_000}],
        'entries': [{'id': f'e{i}', 'date': '2020-01-01', 'type': 'expense', 'walletId': 'a', 'amount': 1, 'category': '', 'note': ''} for i in range(46_000)]}}
    pretty = output / 'legacy-pretty-large-synthetic.json'
    pretty.write_text(json.dumps(initial, ensure_ascii=False, indent=2), encoding='utf-8')
    assert pretty.stat().st_size > LIMIT
    with isolated(browser, initial, output, 'backup-large') as (_, new_page, _):
        page = new_page()
        path = output / 'download-large-synthetic.json'
        assert download_backup(page, path) == initial
        assert path.stat().st_size < LIMIT
        restore_backup(page, path)
        restore_backup(page, pretty)
        page.reload(wait_until='networkidle')
        result = stored(page)
        assert result == initial
        assert saldo(result, 'a') == 954_000


def test_future_balance(browser, output):
    past = {**expense('past', 20_000, note='Past income'), 'type': 'income'}
    future = {**expense('future', 50_000, date='2099-01-01', note='Future income'), 'type': 'income'}
    initial = fixture([past, future])
    with isolated(browser, initial, output, 'future') as (_, new_page, _):
        page = new_page()
        expect(page.locator('.balance-number')).to_contain_text('1.200')
        expect(page.locator('.balance-bottom')).to_contain_text('1.700')
        assert stored(page) == initial
        open_expense(page, note='Future expense UI', date='2099-01-02')
        expect(page.get_by_role('dialog')).to_contain_text(re.compile('masa depan', re.I))
        page.get_by_role('dialog').get_by_role('button', name='Simpan transaksi', exact=True).click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        expect(page.locator('.balance-number')).to_contain_text('1.200')
        page.reload(wait_until='networkidle')
        expect(page.locator('.balance-number')).to_contain_text('1.200')
        assert len(stored(page)['state']['entries']) == 3


def test_adjust_unavailable(browser, output):
    """A zero difference must be based on a current wallet and a readable, saved ledger."""
    for scenario in ('failed-write', 'removed-wallet', 'unreadable', 'midnight'):
        tomorrow = {**expense('tomorrow', 50_000, date='2026-10-31'), 'type': 'income'}
        with isolated(browser, fixture([tomorrow]), output, 'adjust-' + scenario) as (_, new_page, _):
            page = new_page()
            other = new_page() if scenario in ('removed-wallet', 'unreadable') else None
            nav(page, 'Dompet')
            wallet_id = 'cash-idr' if scenario == 'removed-wallet' else 'bca-idr'
            page.locator(f'[data-wallet-id="{wallet_id}"]').get_by_role('button', name='Cek saldo', exact=True).click()
            dialog = page.get_by_role('dialog')
            amount = dialog.get_by_label('Nominal', exact=True)
            matched = dialog.get_by_role('button', name='Saldo cocok · tutup', exact=True)
            save = dialog.get_by_role('button', name='Simpan transaksi', exact=True)
            amount.fill('0' if scenario == 'removed-wallet' else '1000')
            expect(matched).to_be_visible()
            if scenario == 'failed-write':
                # The controller retains the requested balance of 1,100 in its recovery draft only.
                page.evaluate("""(key) => { const write = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v) {
                    if (k === key) throw new DOMException('Synthetic quota', 'QuotaExceededError'); write.call(this,k,v); }; }""", KEY)
                amount.fill('1100')
                save.click()
                expect(page.get_by_test_id('save-status')).to_contain_text('penyimpanan gagal')
            elif scenario == 'removed-wallet':
                other.evaluate("""(key) => { const data = JSON.parse(localStorage.getItem(key));
                    data.state.wallets = data.state.wallets.filter(w => w.id !== 'cash-idr');
                    localStorage.setItem(key, JSON.stringify(data)); }""", KEY)
                expect(dialog.get_by_label('Dompet asal').locator('option:checked')).to_contain_text('tidak tersedia')
            elif scenario == 'unreadable':
                other.evaluate("(key) => localStorage.setItem(key, '{broken')", KEY)
                expect(page.get_by_test_id('save-status')).to_contain_text('pemulihan diperlukan')
            else:
                # No render between the change of day and Enter. Tomorrow's income now belongs to the actual balance.
                page.clock.set_system_time(datetime(2026, 10, 31, 12, tzinfo=timezone.utc))

            before = page.evaluate('(key) => localStorage.getItem(key)', KEY)
            if scenario != 'midnight':
                expect(matched).to_have_count(0)
            amount.press('Enter')
            expect(dialog).to_be_visible()
            expected = {'midnight': 'tanggal hari ini', 'removed-wallet': 'Dompet ini tidak tersedia lagi'}
            expect(dialog.get_by_role('alert')).to_contain_text(expected.get(scenario, 'pemulihan di status penyimpanan'))
            expect(page.locator('.toast').filter(has_text='cocok dengan catatan')).to_have_count(0)
            assert page.evaluate('(key) => localStorage.getItem(key)', KEY) == before, scenario


def test_adjust_today(browser, output):
    tomorrow = {**expense('tomorrow', 5_000_000, date='2026-10-31'), 'type': 'income'}
    initial = fixture([tomorrow])
    initial['state']['wallets'][0]['openingBalance'] = 10_000_000
    with isolated(browser, initial, output, 'adjust-today') as (_, new_page, _):
        page = new_page()
        nav(page, 'Dompet')
        card = page.locator('[data-wallet-id="bca-idr"]')
        expect(card.locator('.wallet-card-balance')).to_contain_text('100.000')
        card.get_by_role('button', name='Cek saldo', exact=True).click()
        dlg = page.get_by_role('dialog')
        hint = dlg.locator('.field-help').filter(has_text='Saldo catatan')
        expect(hint).to_contain_text('100.000')
        target = dlg.get_by_label('Nominal', exact=True)
        save = dlg.get_by_role('button', name='Simpan transaksi', exact=True)
        matched = dlg.get_by_role('button', name='Saldo cocok · tutup', exact=True)
        difference = dlg.get_by_test_id('adjustment-difference')
        toast = page.locator('.toast')
        open_check = lambda: card.get_by_role('button', name='Cek saldo', exact=True).click()

        warns = """() => {
            const event = new Event('beforeunload', { cancelable: true });
            window.dispatchEvent(event);
            return event.defaultPrevented;
        }"""
        # Comparing the ledger's contents alone would miss a write of the same bytes.
        page.evaluate("""() => {
            window.__balanceStorageCalls = [];
            for (const method of ['setItem', 'removeItem', 'clear']) {
                const original = Storage.prototype[method];
                Storage.prototype[method] = function (...args) {
                    if (this === localStorage) window.__balanceStorageCalls.push([method, args[0]]);
                    return original.apply(this, args);
                };
            }
        }""")

        # MW-116a: a balance that matches the record ends as a success. The main button says so, closes without the
        # discard question, and nothing is written.
        expect(matched).to_have_count(0)
        target.fill('100000')
        expect(difference).to_have_text('Sama dengan catatan, jadi tidak ada selisih untuk dicatat.')
        expect(save).to_have_count(0)
        assert not page.evaluate(warns), 'The matching figure alone warned on unload'
        matched.click()
        expect(dlg).to_have_count(0)
        expect(toast).to_have_text('Saldo Synthetic A cocok dengan catatan. Tidak ada yang perlu dicatat.')
        expect(toast).not_to_have_class(re.compile(r'\berror\b'))
        assert stored(page) == initial
        toast.get_by_role('button', name='Tutup pemberitahuan', exact=True).click()
        # Enter in the field is the same main action.
        open_check()
        target.fill('100000')
        target.press('Enter')
        expect(dlg).to_have_count(0)
        expect(toast).to_contain_text('cocok dengan catatan')
        toast.get_by_role('button', name='Tutup pemberitahuan', exact=True).click()
        # Escape and Batal leave a matched check without the discard question and without a message.
        for leave in (lambda: page.keyboard.press('Escape'), lambda: dlg.get_by_role('button', name='Batal', exact=True).click()):
            open_check()
            target.fill('100000')
            expect(matched).to_be_visible()
            leave()
            expect(dlg).to_have_count(0)
            expect(toast).to_have_count(0)
        # A note typed next to the matched figure is still work: leaving asks first, and the main button still closes.
        open_check()
        target.fill('100000')
        dlg.get_by_label('Keterangan').fill('Synthetic note beside a matched balance')
        assert page.evaluate(warns), 'A note beside the matching figure did not warn on unload'
        page.keyboard.press('Escape')
        expect(page.get_by_role('dialog', name='Buang isian transaksi?', exact=True)).to_be_visible()
        dlg.get_by_role('button', name='Lanjut mengisi', exact=True).click()
        expect(dlg.get_by_label('Keterangan')).to_have_value('Synthetic note beside a matched balance')
        calls = page.evaluate('window.__balanceStorageCalls')
        assert calls == [], f'A matched balance changed localStorage: {calls}'
        # A different figure alone is an unsaved adjustment, even after the note has been cleared.
        dlg.get_by_label('Keterangan').fill('')
        target.fill('110000')
        assert page.evaluate(warns), 'The differing figure alone did not warn on unload'
        expect(matched).to_have_count(0)
        expect(save).to_be_visible()
        page.keyboard.press('Escape')
        expect(page.get_by_role('dialog', name='Buang isian transaksi?', exact=True)).to_be_visible()
        dlg.get_by_role('button', name='Lanjut mengisi', exact=True).click()
        assert stored(page) == initial
        dlg.get_by_label('Keterangan').fill('Saldo uji hari ini')
        save.click()
        expect(dlg).to_have_count(0)
        expect(card.locator('.wallet-card-balance')).to_contain_text('110.000')
        first = stored(page)['state']['entries']
        adjustment = next(e for e in first if e['type'] == 'adjustment')
        assert len(first) == 2 and tomorrow in first and adjustment['amount'] == 1_000_000

        nav(page, 'Transaksi')
        page.get_by_role('button', name='Ubah Saldo uji hari ini', exact=True).click()
        expect(hint).to_contain_text('110.000')
        expect(target).to_have_value('110000')
        # An existing check is not closed as "matched": a zero difference there means its record should go.
        before_edit = stored(page)
        target.fill('100000')
        expect(difference).to_have_text('Sama dengan catatan, jadi tidak ada selisih untuk dicatat.')
        expect(matched).to_have_count(0)
        save.click()
        expect(dlg.get_by_role('alert')).to_contain_text('Saldo sudah cocok')
        assert stored(page) == before_edit
        target.fill('105000')
        save.click()
        expect(dlg).to_have_count(0)
        page.reload(wait_until='networkidle')
        rows = stored(page)['state']['entries']
        assert len(rows) == 2 and tomorrow in rows and {**adjustment, 'amount': 500_000} in rows


def write_statement(path):
    transactions = [
        ['30.10.2026', 'R-3', 'POS toko contoh', -25.5, 174.5],
        ['29.10.2026', 'R-2', 'HAVALE contoh', 100, 200],
        ['28.10.2026', 'R-1', 'POS belanja contoh', -20, 100],
    ]
    rows = [['Synthetic statement only'], ['Mata uang', 'TL'], *[[] for _ in range(9)],
            ['Tarih', 'Fiş No', 'Açıklama', 'İşlem Tutarı', 'Bakiye'], *transactions]
    xml = []
    for row in rows:
        cells = [f'<c t="{"n" if isinstance(v,(int,float)) else "str"}"><v>{escape(str(v))}</v></c>' for v in row]
        xml.append('<row>' + ''.join(cells) + '</row>')
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    with ZipFile(path, 'w', ZIP_DEFLATED) as z:
        z.writestr('xl/workbook.xml', f'<workbook {ns}><workbookPr date1904="0"/></workbook>')
        z.writestr('xl/worksheets/sheet1.xml', f'<worksheet {ns}><sheetData>{"".join(xml)}</sheetData></worksheet>')


def test_import_overlap(browser, output, *, after_preview):
    name = 'manual-after-preview' if after_preview else 'manual-before-preview'
    with isolated(browser, fixture(), output, name) as (_, new_page, _):
        page = new_page()
        path = output / f'{name}.xlsx'
        write_statement(path)
        if not after_preview:
            save_expense(page, note='POS belanja contoh', amount='20', wallet='ziraat-try', date='2026-10-28')
        nav(page, 'Impor mutasi')
        page.get_by_label('File mutasi Ziraat', exact=True).set_input_files(path)
        expect(page.locator('.import-preview')).to_be_visible()
        if after_preview:
            save_expense(page, note='POS belanja contoh', amount='20', wallet='ziraat-try', date='2026-10-28')
        expect(page.get_by_role('button', name='Lewati', exact=True)).to_have_count(1)
        page.get_by_role('button', name='Lewati', exact=True).click()
        page.get_by_role('button', name='Simpan 2 transaksi', exact=True).click()
        expect(page.locator('.import-preview')).to_have_count(0)
        page.reload(wait_until='networkidle')
        data = stored(page)
        assert len(data['state']['entries']) == 3
        assert saldo(data, 'ziraat-try') == 17_450
        assert len({e['id'] for e in data['state']['entries']}) == 3


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--case', action='append', default=[])
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    dist_sha = assert_production_url(URL)
    candidates = [os.environ.get('UANGKU_BROWSER_EXECUTABLE'),
                  r'C:\Program Files\Google\Chrome\Application\chrome.exe',
                  r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe']
    executable = next((p for p in candidates if p and Path(p).is_file()), None)
    cases = [
        ('stale-form-conflict', test_stale_form),
        ('two-tabs-sync-and-concurrent', test_clean_sync_and_concurrent_forms),
        ('stale-view-save-conflicts', test_stale_view_save_conflicts),
        ('stale-restore-observer', test_stale_restore_observer),
        ('queued-saves-one-winner', test_queued_saves_one_winner),
        ('concurrent-cash-cleanup', test_concurrent_cash_cleanup),
        ('quota-recovery-retry', test_quota_retry),
        ('missing-web-locks', test_no_web_locks),
        ('transaction-draft-close', test_transaction_draft_close),
        ('pending-writer-modal-guard', test_pending_writer_modal_guard),
        ('stale-modal-delete', test_stale_modal_delete),
        ('blocked-metadata-confirmation', test_blocked_metadata_confirmation),
        ('denied-storage-backup', test_denied_storage_backup),
        ('carry-demo-transactions', test_carry_demo_transactions),
        ('backup-small-roundtrip', test_backup_small),
        ('backup-large-and-legacy-pretty', test_backup_large),
        ('future-actual-vs-all-records', test_future_balance),
        ('adjust-today-with-future-income', test_adjust_today),
        ('adjust-unavailable', test_adjust_unavailable),
        ('manual-before-preview', lambda b, o: test_import_overlap(b, o, after_preview=False)),
        ('manual-after-preview', lambda b, o: test_import_overlap(b, o, after_preview=True)),
    ]
    results = []
    source = {str(p.relative_to(ROOT)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in sorted((ROOT / 'src').rglob('*')) if p.is_file()}
    with sync_playwright() as pw:
        if executable:
            os.environ['CHROMIUM_PATH'] = executable
        browser = launch_browser(pw)
        version = browser.version
        for name, function in cases:
            if args.case and name not in args.case:
                continue
            began = time.monotonic()
            try:
                function(browser, output)
                result = {'name': name, 'status': 'passed'}
            except Exception as err:
                result = {'name': name, 'status': 'failed', 'error': str(err)}
            result['seconds'] = round(time.monotonic() - began, 3)
            results.append(result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
        browser.close()
    final_source = {str(p.relative_to(ROOT)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in sorted((ROOT / 'src').rglob('*')) if p.is_file()}
    report = {'scope': 'Fresh local minimum reconstruction; not the cloud H release gates',
              'url': URL, 'browser_executable': executable, 'browser_version': version,
              'dist_sha256': dist_sha,
              'synthetic_only': True, 'real_profile_used': False,
              'source_before': source, 'source_after': final_source,
              'source_stable': source == final_source, 'results': results,
              'passed': sum(r['status'] == 'passed' for r in results),
              'failed': sum(r['status'] != 'passed' for r in results)}
    (output / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'summary': str(output / 'summary.json'), 'passed': report['passed'], 'failed': report['failed'], 'source_stable': report['source_stable']}))
    return 0 if not report['failed'] and report['source_stable'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
