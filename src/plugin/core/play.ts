// The state of one game in the View, and the moves that change it. Pure functions over plain data,
// so the state can be saved as ToolResult.viewState and restored when the chat is reopened. The
// rules themselves (level moves, picking, grades) are src/game.ts, shared with MulmoKentei.
import type { KenteiScript, Question } from "../../kentei-script.ts";
import { gradeFor, maxPoints, nextLevel, pickQuestion, titleOf } from "../../game.ts";
import type { AnswerGrade } from "./types.ts";

export type Phase = "start" | "question" | "feedback" | "done";

export interface AnswerRecord {
  id: string;
  answer: string;
  /** The game's level when the question was asked (the question's own level can differ when that level ran out). */
  level: number;
  /** JEV's grade: every answer is graded before it is recorded. */
  grade: AnswerGrade;
}

export interface PlayState {
  phase: Phase;
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

export function initialState(script: KenteiScript): PlayState {
  return { phase: "start", level: script.rules.startLevel, currentId: null, history: [], draft: "", titleChoice: null, sent: false };
}

export const questionById = (script: KenteiScript, id: string | null): Question | undefined =>
  id === null ? undefined : script.questions.find((q) => q.id === id);

/** The next question, picked by the shared rules at the game's current level. */
export function nextQuestion(script: KenteiScript, state: PlayState, random: () => number = Math.random): Question | undefined {
  const used = state.history.map((h) => h.id);
  if (state.currentId) used.push(state.currentId);
  return pickQuestion(script.questions, used, state.level, random);
}

/** Shows the next question, or ends the game when it has asked questionsPerGame (or run out). */
export function advance(script: KenteiScript, state: PlayState, random?: () => number): PlayState {
  const base = { ...state, currentId: null, draft: "" };
  if (state.history.length >= script.rules.questionsPerGame) return { ...base, phase: "done" };
  const q = nextQuestion(script, base, random);
  return q ? { ...base, phase: "question", currentId: q.id } : { ...base, phase: "done" };
}

/** Records the answer to the current question with its grade, and moves the level by it. */
export function recordAnswer(script: KenteiScript, state: PlayState, answer: string, grade: AnswerGrade): PlayState {
  if (!state.currentId) return state;
  const record: AnswerRecord = { id: state.currentId, answer, level: state.level, grade };
  const level = nextLevel(script.rules, state.level, grade.credit);
  return { ...state, phase: "feedback", level, history: [...state.history, record], draft: "" };
}

export const isLastAnswer = (script: KenteiScript, state: PlayState) => state.history.length >= script.rules.questionsPerGame;

/** Totals of a game: the points, the maximum, and the grade and title they earn. */
export function summary(script: KenteiScript, state: PlayState) {
  const points = state.history.reduce((sum, h) => sum + h.grade.points, 0);
  const grade = gradeFor(script.rules.grades, points);
  return { points, max: maxPoints(script.rules, script.questions), grade, title: titleOf(grade, state.titleChoice) };
}

/** Cuts an answer to what is graded: trimmed, at most MAX_ANSWER_CHARS. */
export const normalizeAnswer = (answer: string) => answer.trim().slice(0, MAX_ANSWER_CHARS);
