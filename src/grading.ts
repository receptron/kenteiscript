// JEV grading. No Worker or Node APIs here: the Worker and the Node test scripts both
// import this file. The KenteiScript types are inferred from the Zod schema in kentei-script.ts.

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

/** Ask JEV to grade one answer against the question's criteria. */
export async function gradeAnswer(
  quiz: KenteiScript,
  q: Question,
  answer: string,
  opts: { apiKey: string; model?: string; url?: string },
): Promise<GradeResult> {
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
  // The most likely label (Choice) or level (Score) is the grade.
  const result = Object.keys(probs).reduce((a, b) => (probs[b] > probs[a] ? b : a));
  const credit = isChoice ? quiz.rules.credit.Choice[result] : quiz.rules.credit.Score[Number(result)];
  return {
    type: q.jev.type,
    result: isChoice ? result : Number(result),
    probabilities: probs,
    credit,
    points: credit * q.level,
    explanation: q.explanation,
    inputTokens: data.usage?.input_tokens ?? null,
  };
}

export const gradeFor = (quiz: KenteiScript, points: number) => quiz.rules.grades.find((g) => points >= g.min)!.grade;

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
