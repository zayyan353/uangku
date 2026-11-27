import { test } from '@fast-check/vitest';
import { expect } from 'vitest';
import { decodeSourceWire, encodeSourceWire } from './sourceCodec';
import { sourceDocumentArbitrary } from './testing/sourceDocumentArbitrary';

test.prop([sourceDocumentArbitrary])('source records survive compact encoding with and without a column default', data => {
  expect(decodeSourceWire(encodeSourceWire(data))).toEqual(data);

  // Notes start out identical. One exception moves the column out of the table defaults.
  const changed = structuredClone(data);
  changed.state.entries[0].note += ' (koreksi)';
  expect(decodeSourceWire(encodeSourceWire(changed))).toEqual(changed);
});
