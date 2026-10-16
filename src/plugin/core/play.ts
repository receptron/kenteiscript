// The state of one game in the View, and the moves that change it. Pure functions over plain data,
// so the state can be saved as ToolResult.viewState and restored when the chat is reopened. The
// rules themselves (level moves, picking, grades) are src/game.ts, shared with MulmoKentei.
import type { KenteiScript, Question } from "../../kentei-script.ts";
import { gradeFor, maxPoints, nextLevel, pickQuestion, titleOf } from "../../game.ts";
import type { AnswerGrade, GradingMode } from "./types.ts";

export type Phase = "start" | "question" | "feedback" | "done";

export interface AnswerRecord {
  id: string;
  answer: string;
  /** The game's level when the question was asked (the question's own level can differ when that level ran out). */
  level: number;
  /** Absent when the answer was not graded (grading by the LLM). */
  grade?: AnswerGrade;
}

export interface PlayState {
  phase: Phase;
  mode: GradingMode;
  level: number;
  /** The question on screen (phase question / feedback). */
  currentId: string | null;
  history: AnswerRecord[];
  /** The unsent answer in the text box. */
  draft: string;
  /** The player's pick for a grade with titleChoices. */
  titleChoice: string | null;
  /** The results message has been sent to the LLM. */
  sent: boolean;
}

export const MAX_ANSWER_CHARS = 800;

export function initialState(script: KenteiScript, mode: GradingMode): PlayState {
  return { phase: "start", mode, level: script.rules.startLevel, currentId: null, history: [], draft: "", titleChoice: null, sent: false };
}

export const questionById = (script: KenteiScript, id: string | null): Question | undefined =>
  id === null ? undefined : script.questions.find((q) => q.id === id);

/**
 * The next question. Graded games adapt with the shared rules; ungraded ones cannot (there is no
 * grade to move the level by), so they ask the questions in the order the script lists them.
 */
export function nextQuestion(script: KenteiScript, state: PlayState, random: () => number = Math.random): Question | undefined {
  const used = state.history.map((h) => h.id);
  if (state.currentId) used.push(state.currentId);
  if (state.mode === "llm") return script.questions.find((q) => !used.includes(q.id));
  return pickQuestion(script.questions, used, state.level, random);
}

/** Shows the next question, or ends the game when it has asked questionsPerGame (or run out). */
export function advance(script: KenteiScript, state: PlayState, random?: () => number): PlayState {
  const base = { ...state, currentId: null, draft: "" };
  if (state.history.length >= script.rules.questionsPerGame) return { ...base, phase: "done" };
  const q = nextQuestion(script, base, random);
  return q ? { ...base, phase: "question", currentId: q.id } : { ...base, phase: "done" };
}

/** Records the answer to the current question, with its grade when there is one. */
export function recordAnswer(script: KenteiScript, state: PlayState, answer: string, grade?: AnswerGrade): PlayState {
  if (!state.currentId) return state;
  const asked = { id: state.currentId, answer, level: state.level };
  const record: AnswerRecord = grade ? { ...asked, grade } : asked;
  const level = grade ? nextLevel(script.rules, state.level, grade.credit) : state.level;
  return { ...state, phase: "feedback", level, history: [...state.history, record], draft: "" };
}

export const isLastAnswer = (script: KenteiScript, state: PlayState) => state.history.length >= script.rules.questionsPerGame;

/** Totals of a game: points from the graded answers, and whether every answer was graded. */
export function summary(script: KenteiScript, state: PlayState) {
  const points = state.history.reduce((sum, h) => sum + (h.grade?.points ?? 0), 0);
  const graded = state.history.length > 0 && state.history.every((h) => h.grade);
  const grade = gradeFor(script.rules.grades, points);
  return { points, max: maxPoints(script.rules, script.questions), graded, grade, title: titleOf(grade, state.titleChoice) };
}

/** Cuts an answer to what is graded: trimmed, at most MAX_ANSWER_CHARS. */
export const normalizeAnswer = (answer: string) => answer.trim().slice(0, MAX_ANSWER_CHARS);
