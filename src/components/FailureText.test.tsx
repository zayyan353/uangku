import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FailureText } from './FailureText';

describe('MW-88b FailureText', () => {
  it('shows the plain sentence and keeps the validator reason closed under "Detail teknis"', () => {
    expect(renderToStaticMarkup(<FailureText text="Metadata sumber tidak valid: Entry creation origin tidak ditemukan." />))
      .toBe('Tindakan ini ditolak oleh pemeriksaan data, jadi tidak ada yang disimpan atau diubah.<details class="failure-detail"><summary>Detail teknis</summary><span>Entry creation origin tidak ditemukan.</span></details>');
  });
  it('adds nothing to a text that already speaks to the user, or to a limit with its own sentence', () => {
    expect(renderToStaticMarkup(<FailureText text="Dompet belum dapat disimpan." />)).toBe('Dompet belum dapat disimpan.');
    expect(renderToStaticMarkup(<FailureText text="Metadata sumber tidak valid: Daftar dompet maksimal 100 dompet." />)).toBe('Jumlah dompet sudah mencapai batas 100, jadi dompet baru tidak disimpan.');
  });
});
