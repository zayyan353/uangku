"""Browser round-trip of a generated full backup across two isolated profiles."""
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit
import copy
import json
import re

from browser_support import backup_action, new_page, semantic_document, stored_document
from playwright.sync_api import expect

FINANCE = 'uangku:v1'
CATEGORIES = 'uangku:categories:v1'


def personal_settings():
    return {
        'version': 1, 'keywordPackVersion': 7,
        'names': ['Belum dikategorikan', 'Pendidikan', 'Unused QA label'],
        'rules': [
            {'id': 'z-qa', 'keyword': 'SYNTHETIC Z', 'category': 'Unused QA label', 'mode': 'suggest'},
            {'id': 'a-qa', 'keyword': 'SYNTHETIC A', 'category': 'Pendidikan', 'mode': 'auto'},
        ],
    }


@contextmanager
def synthetic_page(browser, url, width, ledger, settings, *, route=None, verify=None):
    parts = urlsplit(url)
    # Without a ledger the profile is untouched and opens on the built-in sample data.
    stored = [] if ledger is None else [
        {'name': FINANCE, 'value': json.dumps(ledger)},
        {'name': CATEGORIES, 'value': json.dumps(settings)},
    ]
    context = browser.new_context(
        viewport={'width': width, 'height': 844 if width < 600 else 900},
        is_mobile=width < 600, has_touch=width < 600, accept_downloads=True,
        timezone_id='Europe/Istanbul', service_workers='block',
        storage_state={'cookies': [], 'origins': [{
            'origin': f'{parts.scheme}://{parts.netloc}',
            'localStorage': stored,
        }]},
    )
    try:
        if route:
            route(context)
        page = new_page(context)
        page.set_default_timeout(10_000)
        errors = []
        page.on('pageerror', lambda exc: errors.append(str(exc)))
        response = page.goto(url, wait_until='domcontentloaded')
        assert response and response.status == 200
        if verify:
            verify(response)
        expect(page.get_by_label('Tema tampilan', exact=True)).to_be_visible()
        yield page
        assert not errors, errors
    finally:
        context.close()


def raw_pair(page):
    return page.evaluate('keys => keys.map(key => localStorage.getItem(key))', [FINANCE, CATEGORIES])


def pick_backup(page, filename, value):
    # Choosing a JSON file uses the local backup reader; it does not upload a statement.
    with page.expect_file_chooser() as pending:
        backup_action(page, 'Pulihkan cadangan').click()
    pending.value.set_files({'name': filename, 'mimeType': 'application/json', 'buffer': value})


def expect_comparison(dialog, browser, file, only_here, restore_label):
    """MW-93: both sides in numbers, what only this browser has, and which button is put forward."""
    def side(count, day):
        return rf'{count} transaksi, terbaru {day} \S+ 2026\.'
    sides = rf'Di browser ini: {side(*browser)} Di file: {side(*file)}'
    # What would be lost is said first. With nothing missing the text claims only what was checked:
    # presence, not edits to a record both sides have.
    text = (rf'^{only_here} catatan di browser ini tidak ada di file\. {sides}$' if only_here else
            rf'^{sides} Tidak ada catatan yang hanya ada di browser ini\. Perubahan pada catatan yang sama tidak dibandingkan\.$')
    box = dialog.get_by_test_id('restore-comparison')
    expect(box).to_have_text(re.compile(text))
    expect(box).to_have_class(re.compile(r'\bwarning\b') if only_here else re.compile(r'^notice$'))
    expect_buttons(dialog, restore_label, only_here)


def expect_buttons(dialog, restore_label, backup_forward):
    """The restore button is always the dangerous one; "Cadangkan dulu" is primary and focused only when put forward."""
    footer = dialog.locator('.modal-footer')
    backup = footer.get_by_role('button', name='Cadangkan dulu', exact=True)
    expect(footer.get_by_role('button', name=restore_label, exact=True)).to_have_class(re.compile(r'\bdanger\b'))
    expect(backup).to_have_class(re.compile(r'\bprimary\b' if backup_forward else r'\bsecondary\b'))
    expect(footer.locator('.button.primary')).to_have_count(1 if backup_forward else 0)
    if backup_forward:
        expect(backup).to_be_focused()
    else:
        expect(backup).not_to_be_focused()


def expect_no_comparison(dialog, text, backup_forward):
    """Nothing of the user's can be compared: the dialog says why. Only an unreadable store puts the backup forward."""
    expect(dialog.get_by_test_id('restore-comparison')).to_have_text(
        re.compile(rf'^{text} Di file: 2 transaksi, terbaru 15 \S+ 2026\.$'))
    expect_buttons(dialog, 'Pulihkan semuanya', backup_forward)


def close_toast(page):
    toast = page.locator('.toast')
    if toast.is_visible():
        toast.get_by_role('button', name='Tutup pemberitahuan').click()


def round_trip(destination, url, width, *, route=None, verify=None):
    from cashflow_browser import source_fixture
    from category_browser import nav

    ledger = source_fixture()
    settings = personal_settings()
    dest_before = raw_pair(destination)
    assert all(dest_before) and stored_document(destination) != ledger
    assert json.loads(dest_before[1]) != settings
    browser = destination.context.browser
    with synthetic_page(browser, url, width, ledger, settings, route=route, verify=verify) as source:
        before = raw_pair(source)
        assert stored_document(source) == ledger and json.loads(before[1]) == settings
        downloads = []
        source.on('download', lambda item: downloads.append(item))
        with source.expect_download() as pending:
            backup_action(source, 'Cadangkan semuanya').click()
        with TemporaryDirectory(prefix='uangku-full-qa-') as temp:
            path = Path(temp) / 'synthetic.json'
            pending.value.save_as(path)
            file_bytes = path.read_bytes()
        assert len(downloads) == 1
        assert raw_pair(source) == before, 'Export changed the source profile'

    full = json.loads(file_bytes)
    assert full['app'] == 'uangku-full-backup' and full['version'] == 1
    assert semantic_document(full['ledger']) == ledger
    assert full['categorySettings'] == settings

    def full_preview():
        pick_backup(destination, 'synthetic-full.json', file_bytes)
        dialog = destination.get_by_role('dialog', name='Pulihkan cadangan lengkap?', exact=True)
        expect(dialog).to_be_visible()
        for count, label in [(2, 'dompet'), (2, 'transaksi'), (3, 'kategori'), (2, 'aturan')]:
            expect(dialog).to_contain_text(re.compile(rf'\b{count}\s+{label}\b'))
        expect(dialog).to_contain_text('menggantikan')
        # The fixture's nine hand-typed records are not in the file, so the backup is put forward.
        expect_comparison(dialog, (9, 31), (2, 15), 9, 'Pulihkan semuanya')
        assert raw_pair(destination) == dest_before, 'Preview committed data'
        return dialog

    def open_categories(page):
        nav(page, 'Transaksi')
        page.get_by_role('button', name='Kelola kategori', exact=True).click()
        return page.get_by_role('dialog', name='Kelola kategori', exact=True)

    full_preview().get_by_role('button', name='Batal', exact=True).click()
    expect(destination.get_by_role('dialog')).to_have_count(0)
    assert raw_pair(destination) == dest_before

    # Both sides must validate before either can replace existing data.
    for invalid_key in ['ledger', 'categorySettings']:
        toast = destination.locator('.toast')
        if toast.is_visible():
            toast.get_by_role('button', name='Tutup pemberitahuan').click()
        invalid = {**full, invalid_key: {'version': 999}}
        pick_backup(destination, 'synthetic-malformed.json', json.dumps(invalid).encode())
        expect(toast).to_be_visible()
        expect(destination.get_by_role('dialog')).to_have_count(0)
        assert raw_pair(destination) == dest_before, f'Invalid {invalid_key} caused a partial restore'

    # A regular category edit after the preview prevents that stale restore.
    stale = full_preview()
    peer = new_page(destination.context)
    try:
        response = peer.goto(url, wait_until='domcontentloaded')
        if verify:
            verify(response)
        manager = open_categories(peer)
        manager.get_by_role('tab', name=re.compile('^Kategori')).click()
        manager.get_by_label('Nama kategori baru', exact=True).fill('Peer edit QA')
        manager.get_by_role('button', name='Tambah kategori', exact=True).click()
        manager.get_by_role('button', name='Simpan pengaturan', exact=True).click()
        expect(manager).to_have_count(0)
        changed = raw_pair(peer)
        assert changed[0] == dest_before[0] and 'Peer edit QA' in json.loads(changed[1])['names']
        stale.get_by_role('button', name='Pulihkan semuanya', exact=True).click()
        expect(stale).to_have_count(0)
        conflict = destination.locator('[data-testid="save-status"], .toast').filter(
            has_text=re.compile(r'berubah|tab lain|konflik', re.I))
        expect(conflict.first).to_be_visible()
        assert raw_pair(destination) == changed, 'Stale full restore overwrote a newer edit or ledger'
        dest_before = changed
    finally:
        peer.close()
    response = destination.reload(wait_until='domcontentloaded')
    if verify:
        verify(response)

    full_preview().get_by_role('button', name='Pulihkan semuanya', exact=True).click()
    destination.wait_for_function('([key, expected]) => JSON.parse(localStorage.getItem(key))?.rules?.[0]?.id === expected',
                                  arg=[CATEGORIES, 'z-qa'])
    assert stored_document(destination) == ledger, 'Restored ledger or source metadata changed'
    assert json.loads(raw_pair(destination)[1]) == settings
    manager = open_categories(destination)
    expect(manager.locator('.category-manager-names').get_by_text('Unused QA label', exact=True)).to_be_visible()
    for i, rule in enumerate(settings['rules'], start=1):
        expect(manager.get_by_label(f'Kata kunci aturan {i}', exact=True)).to_have_value(rule['keyword'])
        expect(manager.get_by_label(f'Kategori aturan {i}', exact=True)).to_have_value(rule['category'])
        expect(manager.get_by_label(f'Mode aturan {i}', exact=True)).to_have_value(rule['mode'])
    manager.get_by_role('button', name='Batal', exact=True).click()
    destination.get_by_role('button', name='TL Lira Turki', exact=True).click()
    destination.get_by_label('Periode transaksi', exact=True).select_option('all')
    expect(destination.get_by_text('Synthetic flow source-out', exact=True)).to_be_visible()
    response = destination.reload(wait_until='domcontentloaded')
    if verify:
        verify(response)
    expect(destination.get_by_label('Tema tampilan', exact=True)).to_be_visible()
    assert stored_document(destination) == ledger
    assert json.loads(raw_pair(destination)[1]) == settings

    def ledger_preview(name, value):
        pick_backup(destination, name, json.dumps(value).encode())
        dialog = destination.get_by_role('dialog', name='Pulihkan cadangan?', exact=True)
        expect(dialog).to_be_visible()
        return dialog

    def cancel(dialog, unchanged):
        dialog.get_by_role('button', name='Batal', exact=True).click()
        expect(destination.get_by_role('dialog')).to_have_count(0)
        assert raw_pair(destination) == unchanged, 'Preview committed data'

    # MW-93. The browser now holds the two bank rows. The same statement imported on another device has
    # other entry and fact ids but the same bank fingerprints; comparing ids alone would report both.
    restored = raw_pair(destination)
    other = copy.deepcopy(ledger)
    for row in other['state']['entries']:
        row['id'] = 'other-device-' + row['id']
    for fact in other['metadata']['facts']:
        fact['id'] = 'other-device-' + fact['id']
    for link in other['metadata']['links']:
        link.update(entryId='other-device-' + link['entryId'], source='other-device-' + link['source'])
    other['metadata']['statements'][0]['rowIds'] = [fact['id'] for fact in other['metadata']['facts']]
    assert not {row['id'] for row in other['state']['entries']} & {row['id'] for row in ledger['state']['entries']}
    dialog = ledger_preview('synthetic-other-device.json', other)
    expect_comparison(dialog, (2, 15), (2, 15), 0, 'Pulihkan data')
    cancel(dialog, restored)
    # The file kept the bank data of the second row but has no record for it.
    del other['state']['entries'][1], other['metadata']['links'][1]
    dialog = ledger_preview('synthetic-other-device-partial.json', other)
    expect_comparison(dialog, (2, 15), (1, 15), 1, 'Pulihkan data')
    cancel(dialog, restored)

    # A legacy finance-only backup replaces the ledger and preserves the current personal rules.
    saved_categories = raw_pair(destination)[1]
    legacy = json.loads(dest_before[0])
    dialog = ledger_preview('synthetic-legacy.json', legacy)
    expect(dialog).to_contain_text('Pengaturan kategori dan aturan pribadi tetap dipakai')
    expect_comparison(dialog, (2, 15), (9, 31), 2, 'Pulihkan data')
    dialog.get_by_role('button', name='Pulihkan data', exact=True).click()
    expect(dialog).to_have_count(0)
    expect(destination.locator('.toast')).to_contain_text('Cadangan berhasil dipulihkan')
    assert stored_document(destination) == semantic_document(legacy)
    assert raw_pair(destination)[1] == saved_categories

    # MW-93, the reviewed case: the same number of records on both sides, one of them only in this browser.
    close_toast(destination)
    current = raw_pair(destination)
    swapped = copy.deepcopy(legacy)
    swapped['state']['entries'][4]['id'] = 'only-in-file'
    dialog = ledger_preview('synthetic-swapped.json', swapped)
    expect_comparison(dialog, (9, 31), (9, 31), 1, 'Pulihkan data')
    # "Cadangkan dulu" saves what this browser holds, not the file, and leaves the choice open.
    with destination.expect_download() as pending:
        dialog.get_by_role('button', name='Cadangkan dulu', exact=True).click()
    assert pending.value.suggested_filename.startswith('uangku-lengkap-')
    with TemporaryDirectory(prefix='uangku-full-qa-') as temp:
        path = Path(temp) / 'current.json'
        pending.value.save_as(path)
        saved = json.loads(path.read_bytes())
    assert semantic_document(saved['ledger']) == semantic_document(legacy)
    assert saved['categorySettings'] == settings
    expect(destination.locator('.toast')).to_contain_text('Cadangan lengkap diunduh')
    expect(dialog).to_be_visible()
    close_toast(destination)
    cancel(dialog, current)
    # The file this browser was just restored from has every record: the buttons stay as they were.
    dialog = ledger_preview('synthetic-legacy.json', legacy)
    expect_comparison(dialog, (9, 31), (9, 31), 0, 'Pulihkan data')
    cancel(dialog, current)

    # MW-93: a profile with only the sample data, and one whose stored data cannot be read. Neither has
    # records of the user's to count. The sample profile keeps the usual buttons; for unreadable data the
    # loss cannot be told and the restore would replace the only copy, so the backup is put forward.
    unreadable = (r'Catatan yang tersimpan di browser ini tidak dapat dibaca, jadi tidak bisa dibandingkan dengan file\. '
                  r'Cadangkan dulu: sesudah dipulihkan, data yang tersimpan sekarang tidak bisa diambil lagi\.')
    for stored, reason in [(None, r'Di browser ini hanya ada data contoh\.'), ({'app': 'uangku', 'version': 999}, unreadable)]:
        with synthetic_page(browser, url, width, stored, settings, route=route, verify=verify) as other_profile:
            before_other = raw_pair(other_profile)
            pick_backup(other_profile, 'synthetic-full.json', file_bytes)
            dialog = other_profile.get_by_role('dialog', name='Pulihkan cadangan lengkap?', exact=True)
            expect_no_comparison(dialog, reason, backup_forward=stored is not None)
            if stored is not None:
                # "Cadangkan dulu" hands over the unreadable text exactly as stored and changes nothing.
                with other_profile.expect_download() as pending:
                    dialog.get_by_role('button', name='Cadangkan dulu', exact=True).click()
                assert pending.value.suggested_filename.startswith('uangku-data-asli-')
                with TemporaryDirectory(prefix='uangku-full-qa-') as temp:
                    path = Path(temp) / 'raw.json'
                    pending.value.save_as(path)
                    assert json.loads(path.read_bytes()) == stored
                expect(dialog).to_be_visible()
                close_toast(other_profile)
                assert raw_pair(other_profile) == before_other
            dialog.get_by_role('button', name='Batal', exact=True).click()
            expect(other_profile.get_by_role('dialog')).to_have_count(0)
            assert raw_pair(other_profile) == before_other
    return {'downloads': 1, 'restored_wallets': 2, 'restored_entries': 2, 'restored_bank_facts': 2,
            'unused_category_restored': True, 'ordered_rules': 2, 'malformed_sections_rejected': 2,
            'preview_and_cancel_unchanged': True, 'stale_preview_preserved_peer_edit': True,
            'same_tab_refreshed_before_reload': True, 'legacy_preserved_category_settings': True,
            'restore_comparisons': {'full_file_missing_records': 9, 'bank_rows_matched_by_fingerprint': 2,
                                    'bank_row_without_record_in_file': 1, 'legacy_file_missing_records': 2,
                                    'equal_counts_one_only_in_browser': 1, 'identical_file': 0},
            'backup_first_saved_browser_ledger_and_kept_dialog': True,
            'sample_only_and_unreadable_profiles_not_compared': 2, 'unreadable_profile_backup_put_forward_and_raw_saved': True}


def category_suite_case(case):
    return round_trip(case.page, case.args.url, case.width)
