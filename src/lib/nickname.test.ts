import { describe, expect, it } from 'vitest';
import { greeting, nicknameInitial, NICKNAME_MAX, sanitizeNickname } from './nickname';

describe('nickname preference', () => {
  it('trims, collapses spaces and rejects non-text', () => {
    expect(sanitizeNickname('  Budi   Santoso \n')).toBe('Budi Santoso');
    expect(sanitizeNickname(null)).toBe('');
    expect(sanitizeNickname(12)).toBe('');
  });
  it('cuts long names by character, not by code unit', () => {
    const long = '😀'.repeat(NICKNAME_MAX + 5);
    expect([...sanitizeNickname(long)]).toHaveLength(NICKNAME_MAX);
    expect(sanitizeNickname('a'.repeat(23) + ' b')).toBe('a'.repeat(23));
  });
  it('greets neutrally without a name', () => {
    expect(greeting('')).toBe('Halo.');
    expect(greeting('Budi')).toBe('Halo, Budi.');
    expect(nicknameInitial('')).toBe('U');
    expect(nicknameInitial('budi')).toBe('B');
  });
});
