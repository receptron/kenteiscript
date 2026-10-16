// The host-neutral core of the manageKenteiScript plugin: the tool definition, execute, samples,
// and the pure game-state functions the View uses. No Vue, no server APIs.
export { TOOL_NAME, TOOL_DEFINITION, TOOL_DESCRIPTION, SYSTEM_PROMPT, ACTIONS, type Action } from "./definition.ts";
export { executeKentei, kenteiJsonSchema, pluginCore, type KenteiResult, type KenteiContext } from "./plugin.ts";
export { envFromProcess, hasJevKey, MISSING_KEY_MESSAGE, type GradeEnv } from "./env.ts";
export { AUTHORING_GUIDE, authoringIssues, INJECTION_GUARD, INJECTION_GUARD_EN, type AuthoringIssue } from "../../authoring.ts";
export { samples, SAMPLE_SCRIPT } from "./samples.ts";
export type { KenteiData, KenteiJson, GradeRequest, AnswerGrade } from "./types.ts";
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
export type { KenteiScript, Question, Grade, Rules } from "../../kentei-script.ts";
