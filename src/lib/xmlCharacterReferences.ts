import type { EntityDecoderOptions } from 'fast-xml-parser';

/** The caller supplies the decimal or hex digits of an XML character reference. */
export function decodeXmlCharacterReference(digits: string, radix: 10 | 16): string | undefined {
  const code = Number.parseInt(digits, radix);
  if (code === 0x9 || code === 0xa || code === 0xd ||
      (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff)) return String.fromCodePoint(code);
  return undefined;
}

const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };

function rejectEntities(): never {
  throw new Error('Struktur XML berisi referensi karakter atau entitas yang tidak didukung.');
}

/** Decode once at the XML text/attribute boundary. An escaped ampersand or
 * CDATA may intentionally spell out a reference as part of the cell value. */
export const xlsxEntityDecoder: EntityDecoderOptions = {
  decode(text) {
    if (!text.includes('&')) return text;
    return text.replace(/&(?:amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-fA-F]+));|&/g, (reference, decimal, hex) => {
      if (decimal !== undefined) return decodeXmlCharacterReference(decimal, 10) ?? rejectEntities();
      if (hex !== undefined) return decodeXmlCharacterReference(hex, 16) ?? rejectEntities();
      return named[reference] ?? rejectEntities();
    });
  },
  setExternalEntities: rejectEntities,
  addInputEntities: rejectEntities,
  reset() { /* No mutable entity definitions. */ },
  setXmlVersion(version) { if (version !== 1.0) rejectEntities(); },
};
