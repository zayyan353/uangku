import { describeFailure } from '../lib/failureText';

/**
 * An error for the user: the plain sentence, and internal wording only under "Detail teknis".
 * One element, so a box that lays its children out in a row keeps the detail under the sentence.
 */
export function FailureText({ text }: { text: string }) {
  const { message, detail } = describeFailure(text);
  return <span className="failure-text">{message}{detail && <details className="failure-detail"><summary>Detail teknis</summary><span>{detail}</span></details>}</span>;
}
