import type { Entry } from './finance';
import type { SourceDocument, SourceFact } from './sourceModel';

type BankWording = Pick<SourceFact, 'description' | 'fingerprintVersion'>;

/** Keep the statement format alongside its original wording, even for blank
 * memos and backups without a sourceKey alias on the financial entry. */
export function indexBankWording(data: SourceDocument, separator = ' '): Map<string, BankWording> {
  const facts = new Map(data.metadata?.facts.map(fact => [fact.id, fact]));
  const wording = new Map<string, BankWording>();
  for (const link of data.metadata?.links ?? []) {
    const source = link.source ? facts.get(link.source) : undefined;
    const destination = link.destination ? facts.get(link.destination) : undefined;
    const first = source ?? destination;
    if (!first) continue;
    if (source && destination) {
      wording.set(link.entryId, {
        description: source.description + separator + destination.description,
        fingerprintVersion: destination.fingerprintVersion === 'generic-v1' ? 'generic-v1' : source.fingerprintVersion,
      });
    } else {
      wording.set(link.entryId, first);
    }
  }
  return wording;
}

export function entryFingerprintVersion(entry: Entry, wording?: BankWording): SourceFact['fingerprintVersion'] | undefined {
  if (wording) return wording.fingerprintVersion;
  if (entry.sourceKey?.startsWith('generic:') || entry.toSourceKey?.startsWith('generic:')) return 'generic-v1';
  return undefined;
}
