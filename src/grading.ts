// JEV grading. No Worker or Node APIs here: the Worker and the Node test scripts both
// import this file. The KenteiScript types are inferred from the Zod schema in kentei-script.ts.

import { creditFor, gradeFor as gradeOf, pointsFor } from "./game.ts";
import { gradeLabels, mostLikelyLabel } from "./jev-grade.ts";
import type { KenteiScript, Question } from "./kentei-script.ts";

export type GradeResult = {
  type: "Choice" | "Score";
  result: string | number;
  probabilities: Record<string, number>;
  credit: number;
  points: number;
  explanation: string;
  inputTokens: number | null;
};

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_MODEL = "jev-latest";

/**
 * The grade of a blank answer, without asking JEV: the lowest Choice label (by credit) or Score
 * level 0. JEV, asked about an empty answer, has graded it correct.
 */
export function noAnswerGrade(quiz: KenteiScript, q: Question): GradeResult {
  const isChoice = q.jev.type === "Choice";
  const labels = gradeLabels(q.jev);
  const result = isChoice ? labels.reduce((a, b) => (creditFor(quiz.rules, "Choice", b) < creditFor(quiz.rules, "Choice", a) ? b : a)) : "0";
  const credit = creditFor(quiz.rules, q.jev.type, result);
  return {
    type: q.jev.type,
    result: isChoice ? result : 0,
    probabilities: Object.fromEntries(labels.map((l) => [l, l === result ? 1 : 0])),
    credit,
    points: pointsFor(q.level, credit),
    explanation: q.explanation,
    inputTokens: 0,
  };
}

/** Ask JEV to grade one answer against the question's criteria. A blank answer is not sent (noAnswerGrade). */
export async function gradeAnswer(
  quiz: KenteiScript,
  q: Question,
  answer: string,
  opts: { apiKey: string; model?: string | undefined; url?: string | undefined },
): Promise<GradeResult> {
  if (!answer.trim()) return noAnswerGrade(quiz, q);
  const isChoice = q.jev.type === "Choice";
  const res = await fetch(opts.url || JEV_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      state: { question: q.question, answer },
      model: opts.model || DEFAULT_MODEL,
      questions: {
        grade: { type: isChoice ? "choice" : "score", instructions: q.jev.instructions, criteria: q.jev.criteria },
      },
    }),
  });
  if (!res.ok) throw new Error(`JEV ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    answers: { grade: { probabilities: Record<string, number> } };
    usage?: { input_tokens: number };
  };
  const probs = data.answers.grade.probabilities;
  // The most likely label (Choice) or level (Score) that JEV was asked for is the grade.
  const labels = gradeLabels(q.jev);
  const result = mostLikelyLabel(probs, labels);
  if (result === undefined) throw new Error(`JEV gave no usable grade of ${labels.join(", ")}: ${JSON.stringify(probs).slice(0, 200)}`);
  const credit = creditFor(quiz.rules, q.jev.type, result);
  return {
    type: q.jev.type,
    result: isChoice ? result : Number(result),
    probabilities: probs,
    credit,
    points: pointsFor(q.level, credit),
    explanation: q.explanation,
    inputTokens: data.usage?.input_tokens ?? null,
  };
}

export const gradeFor = (quiz: KenteiScript, points: number) => gradeOf(quiz.rules.grades, points).grade;

/** The quiz as the browser sees it: no criteria, answers or explanations. */
export function publicQuiz(id: string, quiz: KenteiScript) {
  return {
    id,
    meta: quiz.meta,
    rules: quiz.rules,
    questions: quiz.questions.map((q) => ({
      id: q.id,
      level: q.level,
      question: q.question,
      open: q.open ?? false,
      written: q.jev.type === "Score",
    })),
  };
}
