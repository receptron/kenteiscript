import type { FileOps, ToolContext, ToolPluginCore, ToolResult } from "gui-chat-protocol";
import { z } from "zod";
import { KenteiScript, parseKenteiScript } from "../../kentei-script.ts";
import { maxPoints } from "../../game.ts";
import { AUTHORING_GUIDE, authoringIssues, type AuthoringIssue } from "../../authoring.ts";
import { ACTIONS, TOOL_DEFINITION, TOOL_NAME, type Action } from "./definition.ts";
import type { KenteiData, KenteiJson } from "./types.ts";
import { envFromProcess, hasJevKey, MISSING_KEY_MESSAGE, type GradeEnv } from "./env.ts";

export type KenteiResult = ToolResult<KenteiData, KenteiJson>;

/** What a host may hand execute beyond the protocol's ToolContext: file access by path, as for
 *  presentDocument. The host decides what a path may reach and what a relative one means. */
export interface KenteiContext extends ToolContext {
  files?: { byPath?: FileOps | undefined } | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (message: string, instructions?: string): KenteiResult => (instructions ? { toolName: TOOL_NAME, message, instructions } : { toolName: TOOL_NAME, message });
/**
 * A step of the authoring loop (getGuide → write → present, fixing what it lists): instructions the
 * LLM must act on in this same turn. instructionsRequired asks a host that gives a model another turn
 * only for instructions (MulmoChat) to give it one, so the loop does not stop after reading the guide.
 */
const KEEP_GOING = "Do not reply to the user yet.";
const step = (message: string, instructions: string): KenteiResult => ({ toolName: TOOL_NAME, message, instructions: `${instructions} ${KEEP_GOING}`, instructionsRequired: true });
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Remove what the LLM does not need from the generated schema: `propertyNames: { type: "string" }`
// (object keys are strings anyway) and the Number.MAX_SAFE_INTEGER bound Zod puts on every integer.
function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!isRecord(node)) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "propertyNames") continue;
    if (key === "maximum" && value === Number.MAX_SAFE_INTEGER) continue;
    out[key] = clean(value);
  }
  return out;
}

/** The KenteiScript JSON Schema (getSchema), with the schema's LLM-facing descriptions. */
export function kenteiJsonSchema(): Record<string, unknown> {
  return clean(z.toJSONSchema(KenteiScript, { io: "input" })) as Record<string, unknown>;
}

/**
 * The one slip LLMs make often enough to forgive: `explanation` written inside `jev` rather than
 * beside it. Moved up when the question has none of its own; anything else stays for the schema
 * to report. Returns a copy; the input is not changed.
 */
function repairExplanations(data: unknown): unknown {
  if (!isRecord(data) || !Array.isArray(data.questions)) return data;
  return {
    ...data,
    questions: data.questions.map((q) => {
      if (!isRecord(q) || q.explanation !== undefined || !isRecord(q.jev) || typeof q.jev.explanation !== "string") return q;
      const { explanation, ...jev } = q.jev;
      return { ...q, jev, explanation };
    }),
  };
}

/** "line 3, column 7" for a JSON.parse error, when the engine reports a position. */
function jsonErrorWhere(source: string, error: unknown): string {
  const message = errorText(error);
  const lineCol = /line (\d+) column (\d+)/.exec(message);
  if (lineCol) return `line ${lineCol[1]}, column ${lineCol[2]}`;
  const at = /position (\d+)/.exec(message);
  if (!at) return "";
  const before = source.slice(0, Number(at[1])).split("\n");
  return `line ${before.length}, column ${before[before.length - 1]!.length + 1}`;
}

type Loaded = { script: KenteiScript; path?: string } | { error: KenteiResult };

/**
 * The script of a checkScript / present call: `script` inline (an object, or a JSON string), or
 * `path` read through the host's files.byPath. Every failure comes back as text for the LLM, saying
 * what to fix (the file, when it used `path`).
 */
async function loadScript(context: KenteiContext, args: Record<string, unknown>): Promise<Loaded> {
  // An empty value is a parameter the LLM filled in without meaning to use ("path": "" beside a script).
  const given = (value: unknown) => value !== undefined && value !== null && value !== "";
  const hasScript = given(args.script);
  const hasPath = given(args.path);
  if (hasScript && hasPath) return { error: step("Give `script` or `path`, not both.", `Call again with only one of them.`) };
  if (!hasScript && !hasPath) return { error: step("Nothing to check: give the KenteiScript as `script`, or `path` to a KenteiScript .json file.", `Call again with \`script\` or \`path\`.`) };

  let data: unknown;
  let path: string | undefined;
  if (hasPath) {
    if (typeof args.path !== "string" || !args.path.trim()) return { error: step("`path` must be a non-empty string: a KenteiScript .json file.", `Call again with a .json path, or the script as \`script\`.`) };
    path = args.path;
    const byPath = context.files?.byPath;
    if (!byPath) return { error: step("This host cannot read files: pass the KenteiScript itself as `script` instead of `path`.", `Call again with the whole script as \`script\`.`) };
    let source: string;
    try {
      source = await byPath.read(path);
    } catch (error) {
      return { error: step(`Could not read ${path}: ${errorText(error)}`, "Check the path (a .json file, relative to the project directory or absolute), or pass the script as `script`.") };
    }
    try {
      data = JSON.parse(source);
    } catch (error) {
      const where = jsonErrorWhere(source, error);
      return { error: step(`${path} is not valid JSON${where ? ` (${where})` : ""}: ${errorText(error)}`, `Fix the JSON in ${path} and call again with the same path.`) };
    }
  } else if (typeof args.script === "string") {
    try {
      data = JSON.parse(args.script);
    } catch (error) {
      const where = jsonErrorWhere(args.script, error);
      return { error: step(`\`script\` is a string but not valid JSON${where ? ` (${where})` : ""}: ${errorText(error)}`, "Pass the KenteiScript as a JSON object.") };
    }
  } else {
    data = args.script;
  }
  try {
    const script = parseKenteiScript(repairExplanations(data), path ?? "The script");
    return path ? { script, path } : { script };
  } catch (error) {
    // A fix resent inline has dropped questions that had nothing wrong with them: say to keep them.
    const n = isRecord(data) && Array.isArray(data.questions) ? data.questions.length : 0;
    const whole = n ? ` with the whole script: all ${n} questions, changing only what is listed` : " with the whole script";
    return { error: step(errorText(error), `Fix every problem listed above${path ? ` in ${path}` : " in the script"} and call again${path ? " with the same path" : whole}.`) };
  }
}

const summary = (script: KenteiScript, path: string | undefined) =>
  `${path ?? "The script"} is a valid KenteiScript: 「${script.meta.title}」, ${script.questions.length} questions, ${script.rules.questionsPerGame} per game, ` +
  `levels ${script.rules.minLevel}-${script.rules.maxLevel}; a game with the best answer every time reaches ${maxPoints(script.rules, script.questions)} points.`;
const listIssues = (issues: AuthoringIssue[]) => `${issues.length} problem(s) to fix:\n${issues.map((i) => `- ${i.where}: ${i.message}`).join("\n")}`;

/** checkScript: the schema (already passed) plus the authoring rules: what present would refuse. */
function checkResult(script: KenteiScript, path: string | undefined): KenteiResult {
  const issues = authoringIssues(script, { minPerLevel: 1 });
  if (!issues.length) return step(`${summary(script, path)}\nNothing to fix.`, `Call present with the same ${path ? "path" : "script"} now to show it.`);
  return step(`${summary(script, path)}\n${listIssues(issues)}`, `Fix every problem${path ? ` in ${path}` : ""} and call present${path ? " with the same path" : ` with the whole script: all ${script.questions.length} questions, changing only what is listed`}.`);
}

/**
 * present: check the script as checkScript does and, unless a blocking problem needs fixing, show
 * the quiz, returning at once and letting the results arrive as the next message. Refusing on a
 * blocking problem (an option-picking question, a missing injection guard) costs one call; showing
 * it would cost a quiz that cannot be answered or graded as written. The other problems are
 * reported with the shown quiz.
 */
function presentResult(script: KenteiScript, path: string | undefined, ignoreWording: boolean): KenteiResult {
  const issues = authoringIssues(script, { minPerLevel: 1 });
  const blocking = issues.filter((i) => i.blocking && !(ignoreWording && i.overridable));
  if (blocking.length) {
    const override = blocking.some((i) => i.overridable)
      ? ' If a flagged question really does not ask the player to pick from options (the check is a heuristic), call present again with "ignoreWording": true.'
      : "";
    return step(
      `Nothing was shown. ${summary(script, path)}\n${listIssues(issues)}`,
      `Fix every problem${path ? ` in ${path}` : ""} and call present again${path ? " with the same path" : ` with the whole script: all ${script.questions.length} questions, changing only what is listed`}.${override}`,
    );
  }
  const { meta, rules, questions } = script;
  const max = maxPoints(rules, questions);
  // Shown anyway, but the LLM should know (next time) what it did not get right.
  const notes = issues.length ? ` Not fixed, shown anyway: ${issues.map((i) => `${i.where}: ${i.message}`).join("; ")}.` : "";
  const data: KenteiData = path ? { script, path } : { script };
  const jsonData: KenteiJson = {
    title: meta.title,
    questions: questions.length,
    questionsPerGame: rules.questionsPerGame,
    levels: `${rules.minLevel}-${rules.maxLevel}, starting at ${rules.startLevel}, max ${max} points`,
    ...(path ? { path } : {}),
  };
  return {
    toolName: TOOL_NAME,
    message: `KenteiScript 「${meta.title}」${path ? ` (from ${path})` : ""} is shown to the user: ${rules.questionsPerGame} of ${questions.length} questions; each answer is graded by JEV as it is given.${notes}`,
    title: meta.title,
    data,
    jsonData,
    instructions:
      "The quiz is shown to the user. Do not ask the questions yourself and do not reveal the answers. Wait: their results will arrive as your next message.",
  };
}

/**
 * The failure every action returns without a key. gui-chat-protocol's ToolResult has no error flag,
 * so the failure is the message itself (it starts "manageKenteiScript is unavailable"), with
 * instructions to stop and no `data`, so the host renders no card.
 */
const missingKey = (): KenteiResult => text(MISSING_KEY_MESSAGE, "Stop here: tell the user what to set, and do not call manageKenteiScript again until they say the host has the key.");

const isAction = (value: unknown): value is Action => typeof value === "string" && (ACTIONS as readonly string[]).includes(value);

/**
 * The manageKenteiScript actions. getGuide and getSchema answer with text; checkScript validates a
 * script (inline or by `path`, read through the host's `context.files.byPath`; the plugin has no
 * file access of its own) without showing anything; present validates it and returns at once with
 * the View's data, the user's results arriving later as a message. Only present renders a card.
 *
 * Grading needs JEV, so every action first checks `env` (the same GradeEnv the View's grade dispatch
 * grades with; the server entry passes the host's) and, without a TYPESAFE_API_KEY, fails with
 * MISSING_KEY_MESSAGE and no `data`, so no View is shown and the LLM is told to stop.
 */
export async function executeKentei(context: KenteiContext, args: unknown, env: GradeEnv): Promise<KenteiResult> {
  if (!hasJevKey(env)) return missingKey();
  const input = isRecord(args) ? args : {};
  const action = input.action;
  if (!isAction(action)) {
    return step(`Unknown action ${JSON.stringify(action ?? null)}: use one of ${ACTIONS.join(", ")}.`, `Start with getGuide.`);
  }
  switch (action) {
    case "getGuide":
      return step(AUTHORING_GUIDE, `Now write the KenteiScript and call present with it, in this same turn.`);
    case "getSchema":
      return step(JSON.stringify(kenteiJsonSchema()), `Now write the KenteiScript and call present with it, in this same turn.`);
    case "checkScript":
    case "present": {
      const loaded = await loadScript(context, input);
      if ("error" in loaded) return action === "present" ? { ...loaded.error, message: `Nothing was shown. ${loaded.error.message}` } : loaded.error;
      return action === "checkScript" ? checkResult(loaded.script, loaded.path) : presentResult(loaded.script, loaded.path, input.ignoreWording === true);
    }
  }
}

export const pluginCore: ToolPluginCore<KenteiData, KenteiJson, object> = {
  toolDefinition: TOOL_DEFINITION,
  // The same source as the server entry: the process environment (empty in a browser, so it fails there).
  execute: (context, args) => executeKentei(context as KenteiContext, args, envFromProcess()),
  generatingMessage: "Preparing the quiz...",
  isEnabled: () => true,
};

export { TOOL_NAME, TOOL_DEFINITION };
