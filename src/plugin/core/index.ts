// The host-neutral core of the presentKentei plugin: the tool definition, execute, samples, and
// the pure game-state functions the View uses. No Vue, no server APIs.
export { TOOL_NAME, TOOL_DEFINITION, TOOL_DESCRIPTION, SYSTEM_PROMPT, kenteiParameters } from "./definition.ts";
export { executeKentei, pluginCore, type KenteiResult } from "./plugin.ts";
export { samples, SAMPLE_SCRIPT } from "./samples.ts";
export type { GradingMode, KenteiData, KenteiJson, GradeRequest, AnswerGrade } from "./types.ts";
export {
  initialState,
  advance,
  recordAnswer,
  nextQuestion,
  questionById,
  isLastAnswer,
  summary,
  normalizeAnswer,
  MAX_ANSWER_CHARS,
  type PlayState,
  type AnswerRecord,
  type Phase,
} from "./play.ts";
export { toPlayState } from "./viewState.ts";
export { resultsMessage, describeGrade } from "./results.ts";
