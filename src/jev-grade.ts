// Picking the grade out of JEV's probabilities. No Worker or Node APIs, like grading.ts.
// scripts/mock-jev.mjs imports it too, so the mock answers with the labels the grader expects.

/** The part of a question's `jev` that JEV is asked to grade against. */
export type JevCriteria = { type: "Choice"; criteria: Record<string, string> } | { type: "Score"; criteria: readonly string[] };

/** The grades JEV was asked for: the Choice labels of the criteria, or the Score levels as strings. */
export function gradeLabels(jev: JevCriteria): string[] {
  return jev.type === "Choice" ? Object.keys(jev.criteria) : jev.criteria.map((_, i) => String(i));
}

/**
 * The most likely of `labels` in JEV's probabilities, or undefined when the response cannot be
 * trusted as a grade: a probability that is not a finite number, none of `labels`, or a label JEV
 * was not asked for that is at least as likely as every expected one. An unexpected label less
 * likely than the grade is ignored. A tie between expected labels goes to the first in `labels`.
 */
export function mostLikelyLabel(probabilities: Record<string, unknown>, labels: readonly string[]): string | undefined {
  const values = Object.values(probabilities);
  if (!values.every((p) => typeof p === "number" && Number.isFinite(p))) return undefined;
  const probs = probabilities as Record<string, number>;
  let best: string | undefined;
  for (const label of labels) {
    if (Object.hasOwn(probs, label) && (best === undefined || probs[label]! > probs[best]!)) best = label;
  }
  if (best === undefined) return undefined;
  const top = probs[best]!;
  return Object.keys(probs).some((label) => !labels.includes(label) && probs[label]! >= top) ? undefined : best;
}
