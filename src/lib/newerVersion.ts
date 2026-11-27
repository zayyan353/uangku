export const newerVersionMessage = 'Data ini dibuat oleh Uangku versi lebih baru. Muat ulang halaman.';

export class NewerVersionError extends Error {
  constructor() { super(newerVersionMessage); }
}

/** Called on declared format versions from parsed JSON. Malformed markers go to the usual validator. */
export function rejectNewerVersion(value: unknown, supported: number): void {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > supported) throw new NewerVersionError();
}
