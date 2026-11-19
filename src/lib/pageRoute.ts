/**
 * The page a URL names. Routes live in the hash so the single-file build needs no server rules,
 * and the Ringkasan page keeps the plain address.
 */
export type RoutePage = 'overview' | 'wallets' | 'transactions' | 'import';

const HASHES: Readonly<Record<RoutePage, string>> = { overview: '', wallets: '#/dompet', transactions: '#/transaksi', import: '#/impor' };

/** '' for Ringkasan, otherwise '#/dompet', '#/transaksi' or '#/impor'. */
export function hashForPage(page: RoutePage): string {
  return HASHES[page];
}

/** An empty, bare ('#', '#/') or unknown hash is Ringkasan: a mistyped address still opens the app. */
export function pageFromHash(hash: string): RoutePage {
  const found = (Object.keys(HASHES) as RoutePage[]).find(page => HASHES[page] !== '' && HASHES[page] === hash);
  return found ?? 'overview';
}
