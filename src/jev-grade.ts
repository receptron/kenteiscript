// Picking the grade out of JEV's probabilities. No Worker or Node APIs, like grading.ts.
import type { GradeType } from "./game.ts";
import type { Rules } from "./kentei-script.ts";

/** The grades an answer can get: the Choice labels of rules.credit, or the Score levels as strings. */
export function gradeLabels(rules: Pick<Rules, "credit">, type: GradeType): string[] {
  return type === "Choice" ? Object.keys(rules.credit.Choice) : rules.credit.Score.map((_, i) => String(i));
}

/**
 * The most likely of `labels` in JEV's probabilities, or undefined when JEV gave none of them.
 * A label JEV was not asked for is never the grade. A tie goes to the first in `probabilities`.
 */
export function mostLikelyLabel(probabilities: Record<string, number>, labels: readonly string[]): string | undefined {
  return Object.keys(probabilities)
    .filter((label) => labels.includes(label))
    .reduce<string | undefined>((best, label) => (best === undefined || (probabilities[label] ?? 0) > (probabilities[best] ?? 0) ? label : best), undefined);
}
