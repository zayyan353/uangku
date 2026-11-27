import { fc, test } from '@fast-check/vitest';
import { expect } from 'vitest';
import { parseMoney } from './finance';
import { formatMoneyInput } from './moneyFormatting';

const safeMinorUnits = fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER });

test.prop([safeMinorUnits])('editable amounts round-trip at each supported currency precision', minor => {
  for (const currency of ['JPY', 'TRY', 'KWD', 'CLF'] as const) {
    expect(parseMoney(formatMoneyInput(minor, currency), currency)).toBe(minor);
  }
});
