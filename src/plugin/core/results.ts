// The results message the View sends to the LLM with sendTextMessage, as the user's next message.
import type { KenteiScript, Question } from "../../kentei-script.ts";
import { formatPoints } from "../../game.ts";
import type { AnswerGrade } from "./types.ts";
import { questionById, summary, type PlayState } from "./play.ts";

// Text from the script or the player, on one line: a newline could otherwise open a new bullet
// (or a fake "result" line) in the markdown the LLM reads.
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** A grade as the LLM reads it: the label or level/top, and the probability JEV gave it. */
export function describeGrade(q: Question, grade: AnswerGrade): string {
  const label = q.jev.type === "Score" ? `${grade.result}/${q.jev.criteria.length - 1}` : String(grade.result);
  const p = grade.probabilities[String(grade.result)];
  return typeof p === "number" ? `${label} (${p.toFixed(2)})` : label;
}

export function resultsMessage(script: KenteiScript, state: PlayState): string {
  const { points, max, graded, grade, title } = summary(script, state);
  const name = oneLine(script.meta.title);
  const lines = state.history.map((h, i) => {
    const q = questionById(script, h.id);
    if (!q) return `- Q${i + 1} [${h.id}]`;
    const answer = h.answer ? `「${oneLine(h.answer)}」` : "(no answer)";
    const head = `- Q${i + 1} [${q.id}] ★${q.level} 「${oneLine(q.question)}」 — answer: ${answer}`;
    return h.grade ? `${head} — ${describeGrade(q, h.grade)}` : `${head} — not graded`;
  });
  if (graded) {
    return [`**${name} — result: ${grade.grade} 「${oneLine(title)}」 (${formatPoints(points)} / ${max} points)**`, "", ...lines].join("\n");
  }
  const some = state.history.some((h) => h.grade);
  return [
    `**${name} — answers to grade${some ? " (partly graded by JEV)" : ""}**`,
    "",
    "Grade each answer marked \"not graded\" against the criteria of that question in the KenteiScript (ids in brackets) and rules.credit, " +
      "then total level × credit over all answers and give the grade and title from rules.grades. Explain each grade briefly.",
    "",
    ...lines,
  ].join("\n");
}
