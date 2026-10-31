/** Interpretation of the bank's operation wording, separate from merchant
 * categories and financial postings. No wallet ownership or pairing is inferred.
 */
export type BankDescriptionKind = 'atm-withdrawal' | 'atm-deposit' | 'transfer-fee'
  | 'bank-transfer' | 'cashback' | 'online-purchase' | 'card-purchase' | 'atm-refund' | 'none';

export interface BankDescriptionInterpretation {
  kind: BankDescriptionKind;
  label: string;
  warning: string;
  category?: string;
  /** The financial type still needs a decision; this is not a posting command. */
  pending: boolean;
}

export interface BankDescriptionContext { signedAmount?: number }

/** Policy normalization only. Never use this to rewrite historical fingerprints. */
export function normalizeBankDescription(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase('tr-TR').replace(/ı/g, 'i')
    .replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

const contains = (value: string, phrase: string): boolean => (` ${value} `).includes(` ${phrase} `);
function confirmedBankDirection(text: string, kind: BankDescriptionKind, amount?: number): boolean {
  if (!Number.isSafeInteger(amount) || amount === 0) return false;
  if (['iade','iadesi','refund','reversal','iptal','iptali'].some(phrase => contains(text,phrase))) return false;
  if (contains(text,'pos alisveris') || contains(text,'pos harcama')) return false;
  const withdrawal=contains(text,'atm para cekme');
  const deposit=contains(text,'atm yatan') || contains(text,'yurtici atm p y') || contains(text,'atm para yatirma');
  if (withdrawal && deposit) return false;
  return kind === 'atm-withdrawal' ? amount! < 0 : kind === 'atm-deposit' ? amount! > 0 : kind === 'bank-transfer';
}

export function interpretBankDescription(description: string, context: BankDescriptionContext = {}): BankDescriptionInterpretation {
  const text = normalizeBankDescription(description);
  if (contains(text, 'prepaid') && Number.isSafeInteger(context.signedAmount) && context.signedAmount! > 0) {
    return { kind: 'cashback', label: 'Cashback prepaid', category: 'Cashback', pending: false,
      warning: 'Uang masuk PREPAID dicatat sebagai Cashback sesuai pemetaanmu.' };
  }
  if (contains(text, 'prepaid iade') || contains(text, 'prepaid iadesi')) {
    return { kind: 'cashback', label: 'Cashback prepaid', category: 'Cashback', pending: true,
      warning: 'Keterangan PREPAID ditemukan. Pemetaan Cashback masuk memerlukan nominal kredit positif.' };
  }
  // The explicit bank phrase is evidence of returning a failed ATM operation,
  // not a cash deposit or general earnings. Arbitrary IADE remains unresolved.
  if (contains(text, 'tam atm sorunlu islem iadesi')) {
    const conflict = ['havale', 'eft', 'fast', 'transfer', 'virman', 'pos alisveris', 'pos harcama',
      'atm para cekme', 'atm yatan', 'atm para yatirma', 'yurtici atm p y', 'reversal', 'iptal', 'iptali']
      .some(phrase => contains(text, phrase));
    const confirmed = Number.isSafeInteger(context.signedAmount) && context.signedAmount! > 0 && !conflict;
    return { kind: 'atm-refund', label: 'Pengembalian transaksi ATM bermasalah', category: 'Pengembalian dana', pending: !confirmed,
      warning: confirmed ? 'Bank mengembalikan dana dari transaksi ATM bermasalah. Dicatat sebagai pemasukan pengembalian dana, bukan setor tunai atau penghasilan baru.'
        : 'Keterangan pengembalian transaksi ATM bermasalah ditemukan. Periksa nominal kredit positif dan keterangan yang bertentangan sebelum mengonfirmasi.' };
  }
  if (contains(text, 'atm para cekme')) {
    const confirmed=confirmedBankDirection(text,'atm-withdrawal',context.signedAmount);
    return { kind: 'atm-withdrawal', label: 'Tarik tunai ATM', category: 'Tarik tunai', pending: !confirmed,
      warning: confirmed ? 'Tarik tunai ATM dikenali. Pengurangan saldo rekening dicatat sebagai pengeluaran kategori Tarik tunai. Cash tidak dibukukan.'
        : 'Tarik tunai ATM dikenali. Periksa arah nominal debit atau keterangan pembatalan sebelum mengonfirmasi pengeluaran.' };
  }
  if (contains(text, 'atm yatan') || contains(text, 'yurtici atm p y') || contains(text, 'atm para yatirma')) {
    const confirmed=confirmedBankDirection(text,'atm-deposit',context.signedAmount);
    return { kind: 'atm-deposit', label: 'Setor tunai ATM', category: 'Setor tunai', pending: !confirmed,
      warning: confirmed ? 'Setor tunai ATM dikenali. Penambahan saldo rekening dicatat sebagai pemasukan kategori Setor tunai. Cash tidak dibukukan.'
        : 'Setor tunai ATM dikenali. Periksa arah nominal kredit atau keterangan pembatalan sebelum mengonfirmasi pemasukan.' };
  }

  const purchase = contains(text, 'pos alisveris') || contains(text, 'pos harcama');
  const bankRail = ['havale', 'eft', 'fast', 'transfer', 'virman'].some(phrase => contains(text, phrase));
  // An operation suffix identifies a fee even if the preceding text names a
  // transfer. POS merchant names containing rail words are not bank operations.
  const feeSuffix = ['bsmv tahsilati', 'komisyonu tahsilati', 'komisyon tahsilati']
    .some(phrase => contains(text, phrase));
  if (!purchase && bankRail && feeSuffix) {
    return { kind: 'transfer-fee', label: 'Biaya transfer bank', category: 'Biaya bank', pending: false,
      warning: 'Keterangan menunjukkan komisi atau pajak layanan transfer. Ini biaya terpisah, bukan pokok transfer.' };
  }
  if (contains(text, 'sanal pos alisveris')) {
    return { kind: 'online-purchase', label: 'Belanja online', category: 'Belanja online', pending: false,
      warning: 'Gunakan kategori merchant yang lebih spesifik bila tersedia; Belanja online hanya kategori cadangan.' };
  }
  if (purchase) {
    const reversed = ['iade', 'iadesi', 'refund', 'reversal', 'iptal', 'iptali'].some(phrase => contains(text, phrase));
    const atmOperation = ['atm para cekme', 'atm yatan', 'atm para yatirma', 'yurtici atm p y'].some(phrase => contains(text, phrase));
    const confirmed = Number.isSafeInteger(context.signedAmount) && context.signedAmount! < 0 && !reversed && !atmOperation;
    return { kind: 'card-purchase', label: 'Pembayaran kartu', category: 'Belanja', pending: !confirmed,
      warning: confirmed ? 'Pembayaran melalui kartu dikenali. Belanja adalah kategori umum; barang atau tujuan pembelian belum diketahui bila merchant tidak cocok dengan aturan.'
        : 'Keterangan pembayaran kartu ditemukan. Periksa arah debit atau keterangan pengembalian sebelum mengonfirmasi.' };
  }
  if (!purchase && bankRail) {
    const confirmed=confirmedBankDirection(text,'bank-transfer',context.signedAmount);
    return { kind: 'bank-transfer', label: 'Transfer bank', category: 'Transfer', pending: !confirmed,
      warning: confirmed ? 'Transfer bank dikenali. Hanya perubahan saldo rekening ini dicatat; bukan pemasukan atau pengeluaran dan tanpa membuat rekening penerima.'
        : 'Transfer bank dikenali. Periksa nominal atau keterangan pembatalan sebelum mengonfirmasi perpindahan rekening.' };
  }
  return { kind: 'none', label: '', warning: '', pending: false };
}

/** User-approved bank-only semantics: ATM debit is expense and ATM credit is
 * income. Transfer principal remains a signed movement for this account only. */
export function confirmedBankEntryType(description: string, signedAmount: number): 'movement' | 'income' | 'expense' | undefined {
  if (!Number.isSafeInteger(signedAmount) || signedAmount === 0) return undefined;
  const operation = interpretBankDescription(description,{signedAmount});
  if (operation.kind === 'cashback' && signedAmount > 0) return 'income';
  if (operation.kind === 'atm-refund') return !operation.pending && signedAmount > 0 ? 'income' : undefined;
  if (operation.kind === 'card-purchase') return !operation.pending && signedAmount < 0 ? 'expense' : undefined;
  const text = normalizeBankDescription(description);
  if (['iade','iadesi','refund','reversal','iptal','iptali'].some(phrase => contains(text,phrase))) return undefined;
  if (operation.kind === 'transfer-fee') return signedAmount < 0 ? 'expense' : undefined;
  if (!confirmedBankDirection(text,operation.kind,signedAmount)) return undefined;
  return operation.kind === 'atm-withdrawal' ? 'expense' : operation.kind === 'atm-deposit' ? 'income' : operation.kind === 'bank-transfer' ? 'movement' : undefined;
}
