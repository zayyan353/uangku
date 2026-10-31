"""Portable browser-test setup and an independent reader for persisted fixtures.

This reader is deliberately test-only. The application remains responsible for
validating every financial field and metadata reference before writing.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import hashlib
import os
from pathlib import Path
import sys
import urllib.request

PROJECT = Path(__file__).resolve().parents[1]
FIXED_TIME = datetime(2026, 10, 31, 12, tzinfo=timezone.utc)


def install_playwright_path():
    candidates = [os.environ.get('UANGKU_PLAYWRIGHT_PATH'),
                  PROJECT.parent / 'work' / 'recovery' / 'browser-deps',
                  PROJECT.parent / 'browser-deps']
    for value in candidates:
        if value and Path(value).is_dir():
            sys.path.insert(0, str(value))
            return


def launch_browser(playwright):
    executable = os.environ.get('CHROMIUM_PATH')
    if not executable and os.name == 'nt':
        for candidate in [r'C:\Program Files\Google\Chrome\Application\chrome.exe',
                          r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe']:
            if Path(candidate).is_file():
                executable = candidate
                break
    options = {'headless': True, 'args': ['--no-sandbox']}
    if executable:
        options['executable_path'] = executable
    return playwright.chromium.launch(**options)


def new_page(context):
    page = context.new_page()
    page.clock.install(time=FIXED_TIME)
    return page


# Field kinds are an independent description of the documented tuple format.
_SCHEMAS = {
    'wallets': 'id:s name:s currency:s kind:s openingBalance:n',
    'entries': 'id:s date:s type:s walletId:wallets amount:n category:s note:s toWalletId:wallets toAmount:n rate:n fee:n sourceKey:s toSourceKey:s importBatch:s',
    'facts': 'id:s walletId:wallets currency:s postedOn:s signedAmount:n balanceAfter:n description:s reference:s fingerprintVersion:s fingerprint:s',
    'links': 'entryId:entries source:facts destination:facts postingDates:o pairing:o',
    'statements': 'id:s walletId:wallets currency:s periodStart:s periodEnd:s openingBalance:n closingBalance:n rowIds:afacts',
    'annotations': 'sourceId:facts category:s note:s confirmedType:s importBatch:s',
    'overrides': 'entryId:entries reason:s at:s',
    'dispositions': 'sourceId:facts kind:s reason:s at:s',
    'baselines': 'id:s walletId:wallets boundary:o origin:s status:s',
    'completions': 'statementId:statements baselineId:baselines sourceIds:afacts at:s',
    'creationOrigins': 'entryId:entries origin:s',
    'transfers': 'entryId:entries sourceDate:s destinationDate:s pairing:o decision:o',
    'unpairings': 'id:s sourceEntryId:s destinationEntryId:s sourceWalletId:wallets destinationWalletId:wallets sourceDate:s destinationDate:s principal:n toAmount:n rate:n fee:n reason:s at:s groupNote:s pairing:o source:facts destination:facts groupOrigin:s groupDecision:o',
    'deletedTransfers': 'entry:o context:o link:o override:o origin:s reason:s at:s',
    'baselineDecisions': 'baselineId:baselines reason:s at:s',
    'walletArchives': 'walletId:wallets at:s',
    'currencies': 'code:s',
}
SCHEMAS = {table: dict(field.split(':') for field in fields.split())
           for table, fields in _SCHEMAS.items()}


def semantic_document(value):
    if value is None or value.get('version') == 1:
        return value
    if value.get('version') == 3:
        assert value['app'] == 'uangku' and value['state']['version'] == 1
        # The wire version gates signed bank movements; the logical document
        # keeps version1 just as the application's in-memory source model does.
        return {**value, 'version': 1}
    assert value['app'] == 'uangku' and value['version'] == 2
    assert value['codec'] in ['table-tuples-v1', 'table-tuples-v2', 'table-tuples-v3', 'table-tuples-v4', 'table-tuples-v5', 'table-tuples-v6']
    assert value['codec'] in ['table-tuples-v5','table-tuples-v6'] or 'walletArchives' not in value['t'], 'Archive table requires codec v5'
    assert value['codec'] == 'table-tuples-v6' or 'currencies' not in value['t'], 'Currency settings require codec v6'
    dictionary = value['d']
    arrays = {}
    for name, table in value['t'].items():
        assert name in SCHEMAS, f'Unknown source table {name}'
        fields = table['k']
        assert len(fields) == len(set(fields)) and set(fields) <= set(SCHEMAS[name])
        rows = []
        for packed in table['r']:
            mask, *cells = packed
            assert isinstance(mask, int) and 0 <= mask < 2 ** len(fields)
            row = dict(table['d'])
            position = 0
            for bit, field in enumerate(fields):
                if mask & (1 << bit):
                    row[field] = cells[position]
                    position += 1
            assert position == len(cells)
            for field, cell in list(row.items()):
                if SCHEMAS[name][field] == 's' and type(cell) is int:
                    row[field] = dictionary[cell]
            rows.append(row)
        arrays[name] = rows
    for name, rows in arrays.items():
        for row in rows:
            for field, cell in list(row.items()):
                kind = SCHEMAS[name][field]
                if kind in ['wallets', 'entries', 'facts', 'statements', 'baselines']:
                    row[field] = arrays[kind][cell]['id']
                elif kind == 'afacts':
                    row[field] = [arrays['facts'][index]['id'] for index in cell]
    metadata = {'policy': value['policy'], **{name: rows for name, rows in arrays.items()
                                            if name not in ['wallets', 'entries']}}
    return {'app': 'uangku', 'version': 1, 'demo': value['demo'],
            'state': {'version': 1, 'wallets': arrays['wallets'], 'entries': arrays['entries']},
            'metadata': metadata}


def wait_not_saving(page):
    page.wait_for_function("""() => !document.querySelector('[data-testid=save-status]')
        ?.textContent.includes('Sedang menyimpan')""", timeout=60_000)


def stored_document(page, key='uangku:v1'):
    wait_not_saving(page)
    return semantic_document(page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', key))


def read_document(path):
    return semantic_document(json.loads(Path(path).read_text(encoding='utf-8')))


def assert_production_url(url):
    """Fail closed if a stale preview or Vite development server was selected."""
    expected = hashlib.sha256((PROJECT / 'dist' / 'index.html').read_bytes()).hexdigest()
    with urllib.request.urlopen(url, timeout=10) as response:
        actual = hashlib.sha256(response.read()).hexdigest()
    assert actual == expected, 'Test URL must serve this checkout\'s current dist/index.html'
    return expected
