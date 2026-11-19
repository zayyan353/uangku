import { describeFailure } from '../lib/failureText';

/** An error for the user: the plain sentence, and internal wording only under "Detail teknis". */
export function FailureText({ text }: { text: string }) {
  const { message, detail } = describeFailure(text);
  return <>{message}{detail && <details className="failure-detail"><summary>Detail teknis</summary><span>{detail}</span></details>}</>;
}
