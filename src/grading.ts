// Quiz types and JEV grading. No Worker or Node APIs here: the Worker and the
// Node test scripts both import this file.

export type ChoiceJev = { type: "Choice"; instructions: string; criteria: Record<string, string> };
export type ScoreJev = { type: "Score"; instructions: string; criteria: string[] };

export type Question = {
  id: string;
  level: number;
  question: string;
  open?: boolean;
  jev: ChoiceJev | ScoreJev;
  explanation: string;
};

export type Grade = { grade: string; min: number; title: string; titleChoices?: string[] };

export type Rules = {
  questionsPerGame: number;
  startLevel: number;
  minLevel: number;
  maxLevel: number;
  credit: { Choice: Record<string, number>; Score: number[] };
  grades: Grade[];
};

export type Quiz = {
  meta: Record<string, unknown>;
  rules: Rules;
  questions: Question[];
};

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
  quiz: Quiz,
  q: Question,
  answer: string,
  opts: { apiKey: string; model?: string },
): Promise<GradeResult> {
  const isChoice = q.jev.type === "Choice";
  const res = await fetch(JEV_URL, {
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

export const gradeFor = (quiz: Quiz, points: number) => quiz.rules.grades.find((g) => points >= g.min)!.grade;

/** The quiz as the browser sees it: no criteria, answers or explanations. */
export function publicQuiz(id: string, quiz: Quiz) {
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
