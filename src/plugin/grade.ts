// Server-side grading for the manageKenteiScript View. The JEV key must never reach the browser, so the
// View sends { kind: "grade", script, questionId, answer } through the host's plugin dispatch, and
// this runs on the host's server with the key from the host's environment.
import { parseKenteiScript } from "../kentei-script.ts";
import { gradeAnswer } from "../grading.ts";
import { MAX_ANSWER_CHARS } from "./core/play.ts";
import type { AnswerGrade, GradeRequest } from "./core/types.ts";
import { hasJevKey, MISSING_KEY_MESSAGE, type GradeEnv } from "./core/env.ts";

export { envFromProcess, type GradeEnv } from "./core/env.ts";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A dispatch call from the View, as opposed to a tool call carrying a KenteiScript (which has no `kind`). */
export const isGradeRequest = (args: unknown): args is GradeRequest => isRecord(args) && args.kind === "grade";

/** Grades one answer with JEV. Throws with a readable message when it cannot (MISSING_KEY_MESSAGE without a key). */
export async function gradeRequest(args: unknown, env: GradeEnv): Promise<AnswerGrade> {
  if (!isRecord(args) || args.kind !== "grade") throw new Error('expected { kind: "grade", script, questionId, answer }');
  // The same check, and the same message, as every tool action (executeKentei).
  if (!hasJevKey(env)) throw new Error(MISSING_KEY_MESSAGE);
  const { questionId, answer } = args;
  if (typeof questionId !== "string" || typeof answer !== "string") throw new Error("questionId and answer must be strings");
  const script = parseKenteiScript(args.script, "The script");
  const q = script.questions.find((x) => x.id === questionId);
  if (!q) throw new Error(`No question ${questionId} in the script`);
  const text = answer.trim().slice(0, MAX_ANSWER_CHARS);
  const g = await gradeAnswer(script, q, text, { apiKey: env.apiKey, model: env.model, url: env.url });
  return { type: g.type, result: g.result, probabilities: g.probabilities, credit: g.credit, points: g.points };
}
