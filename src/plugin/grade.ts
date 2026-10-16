// Server-side grading for the presentKentei View. The JEV key must never reach the browser, so the
// View sends { kind: "grade", script, questionId, answer } through the host's plugin dispatch, and
// this runs on the host's server with the key from the host's environment.
import { parseKenteiScript } from "../kentei-script.ts";
import { gradeAnswer } from "../grading.ts";
import { MAX_ANSWER_CHARS } from "./core/play.ts";
import type { AnswerGrade, GradeRequest } from "./core/types.ts";

/** Where to grade: the key, and the optional model and endpoint overrides. */
export interface GradeEnv {
  apiKey?: string | undefined;
  model?: string | undefined;
  url?: string | undefined;
}

/**
 * The grading settings from the host process's environment: TYPESAFE_API_KEY, and the same
 * JEV_MODEL / JEV_URL overrides the MulmoKentei Worker reads (JEV_URL points tests at
 * scripts/mock-jev.mjs). Empty outside Node.
 */
export function envFromProcess(): GradeEnv {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  return { apiKey: env.TYPESAFE_API_KEY || undefined, model: env.JEV_MODEL || undefined, url: env.JEV_URL || undefined };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A dispatch call from the View, as opposed to a tool call carrying a KenteiScript (which has no `kind`). */
export const isGradeRequest = (args: unknown): args is GradeRequest => isRecord(args) && args.kind === "grade";

/** Grades one answer with JEV. Throws with a readable message when it cannot. */
export async function gradeRequest(args: unknown, env: GradeEnv): Promise<AnswerGrade> {
  if (!isRecord(args) || args.kind !== "grade") throw new Error('expected { kind: "grade", script, questionId, answer }');
  if (!env.apiKey) throw new Error("This host has no TYPESAFE_API_KEY, so answers cannot be graded here");
  const { questionId, answer } = args;
  if (typeof questionId !== "string" || typeof answer !== "string") throw new Error("questionId and answer must be strings");
  const script = parseKenteiScript(args.script, "The script");
  const q = script.questions.find((x) => x.id === questionId);
  if (!q) throw new Error(`No question ${questionId} in the script`);
  const text = answer.trim().slice(0, MAX_ANSWER_CHARS) || "（無回答）";
  const g = await gradeAnswer(script, q, text, { apiKey: env.apiKey, model: env.model, url: env.url });
  return { type: g.type, result: g.result, probabilities: g.probabilities, credit: g.credit, points: g.points };
}
