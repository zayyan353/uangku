import { describe, expect, it } from 'vitest';
import { currencyFlagEmoji, monthOptions, nextMonth, priorMonth } from './monthOptions';

describe('month picker options', () => {
  it('steps across year boundaries', () => {
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(priorMonth('2026-01')).toBe('2025-12');
  });
  it('covers three years back to one year ahead, newest first', () => {
    const options = monthOptions('2026-11-11', '2026-11', []);
    expect(options[0].value).toBe('2027-11');
    expect(options.at(-1)!.value).toBe('2023-11');
    expect(options).toHaveLength(49);
    expect(options.find(option => option.value === '2026-11')!.label).toBe('November 2026');
  });
  it('widens for old or future entries and for the selected month, ignoring unreadable dates', () => {
    const options = monthOptions('2026-11-11', '2019-03', ['2021-05-01', '2028-02-10', 'tanggal?']);
    expect(options[0].value).toBe('2028-02');
    expect(options.at(-1)!.value).toBe('2019-03');
  });
});

describe('currencyFlagEmoji', () => {
  it('derives the flag from the country letters', () => {
    expect(currencyFlagEmoji('IDR')).toBe('🇮🇩');
    expect(currencyFlagEmoji('EUR')).toBe('🇪🇺');
    expect(currencyFlagEmoji('JPY')).toBe('🇯🇵');
  });
  it('has no flag for special codes', () => {
    expect(currencyFlagEmoji('XAF')).toBe('');
    expect(currencyFlagEmoji('??')).toBe('');
  });
});
