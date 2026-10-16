import type { KenteiScript } from "../../kentei-script.ts";
import type { GradeType } from "../../game.ts";

/**
 * Who grades the answers: "jev" when the host's server has a TYPESAFE_API_KEY and the View can
 * reach the plugin's server part; "llm" when the View collects the answers ungraded and the LLM
 * grades them from the results message.
 */
export type GradingMode = "jev" | "llm";

/** What the View receives (ToolResult.data): the whole script, criteria included. */
export interface KenteiData {
  script: KenteiScript;
  grading: GradingMode;
}

/** What the LLM reads back (ToolResult.jsonData): a summary, not the script it just wrote. */
export interface KenteiJson {
  title: string;
  questions: number;
  questionsPerGame: number;
  levels: string;
  grading: GradingMode;
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
