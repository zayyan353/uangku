"""Browser round-trip of a generated full backup across two isolated profiles."""
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit
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
    context = browser.new_context(
        viewport={'width': width, 'height': 844 if width < 600 else 900},
        is_mobile=width < 600, has_touch=width < 600, accept_downloads=True,
        timezone_id='Europe/Istanbul', service_workers='block',
        storage_state={'cookies': [], 'origins': [{
            'origin': f'{parts.scheme}://{parts.netloc}',
            'localStorage': [
                {'name': FINANCE, 'value': json.dumps(ledger)},
                {'name': CATEGORIES, 'value': json.dumps(settings)},
            ],
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

    # A legacy finance-only backup replaces the ledger and preserves the current personal rules.
    saved_categories = raw_pair(destination)[1]
    legacy = json.loads(dest_before[0])
    pick_backup(destination, 'synthetic-legacy.json', json.dumps(legacy).encode())
    dialog = destination.get_by_role('dialog', name='Pulihkan cadangan?', exact=True)
    expect(dialog).to_contain_text('Pengaturan kategori dan aturan pribadi tetap dipakai')
    dialog.get_by_role('button', name='Pulihkan data', exact=True).click()
    expect(dialog).to_have_count(0)
    expect(destination.locator('.toast')).to_contain_text('Cadangan berhasil dipulihkan')
    assert stored_document(destination) == semantic_document(legacy)
    assert raw_pair(destination)[1] == saved_categories
    return {'downloads': 1, 'restored_wallets': 2, 'restored_entries': 2, 'restored_bank_facts': 2,
            'unused_category_restored': True, 'ordered_rules': 2, 'malformed_sections_rejected': 2,
            'preview_and_cancel_unchanged': True, 'stale_preview_preserved_peer_edit': True,
            'same_tab_refreshed_before_reload': True, 'legacy_preserved_category_settings': True}


def category_suite_case(case):
    return round_trip(case.page, case.args.url, case.width)
