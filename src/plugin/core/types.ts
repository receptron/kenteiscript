import type { KenteiScript } from "../../kentei-script.ts";
import type { GradeType } from "../../game.ts";

/** What the View receives (ToolResult.data): the whole script, criteria included. */
export interface KenteiData {
  script: KenteiScript;
  /** The file the script was read from, when the tool was called with `path`. */
  path?: string | undefined;
}

/** What the LLM reads back (ToolResult.jsonData): a summary, not the script it just wrote. */
export interface KenteiJson {
  title: string;
  questions: number;
  questionsPerGame: number;
  levels: string;
  path?: string | undefined;
}

/** The View's request to the plugin's server part (runtime.dispatch). */
export interface GradeRequest {
  kind: "grade";
  script: KenteiScript;
  questionId: string;
  answer: string;
}

/** The server's answer to a GradeRequest: one graded answer. */
export interface AnswerGrade {
  type: GradeType;
  /** A Choice label or a Score level. */
  result: string | number;
  /** The probability of every label or level, from JEV. */
  probabilities: Record<string, number>;
  credit: number;
  points: number;
}
