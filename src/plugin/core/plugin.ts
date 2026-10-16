import type { FileOps, ToolContext, ToolPluginCore, ToolResult } from "gui-chat-protocol";
import { z } from "zod";
import { KenteiScript, parseKenteiScript } from "../../kentei-script.ts";
import { maxPoints } from "../../game.ts";
import { AUTHORING_GUIDE, authoringIssues } from "../../authoring.ts";
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
  const hasScript = args.script !== undefined;
  const hasPath = args.path !== undefined;
  if (hasScript && hasPath) return { error: text("Give `script` or `path`, not both.", "Call again with only one of them.") };
  if (!hasScript && !hasPath) return { error: text("Nothing to check: give the KenteiScript as `script`, or `path` to a KenteiScript .json file.", "Call again with `script` or `path`.") };

  let data: unknown;
  let path: string | undefined;
  if (hasPath) {
    if (typeof args.path !== "string" || !args.path.trim()) return { error: text("`path` must be a non-empty string: a KenteiScript .json file.") };
    path = args.path;
    const byPath = context.files?.byPath;
    if (!byPath) return { error: text("This host cannot read files: pass the KenteiScript itself as `script` instead of `path`.") };
    let source: string;
    try {
      source = await byPath.read(path);
    } catch (error) {
      return { error: text(`Could not read ${path}: ${errorText(error)}`, "Check the path (a .json file, relative to the project directory or absolute), or pass the script as `script`.") };
    }
    try {
      data = JSON.parse(source);
    } catch (error) {
      const where = jsonErrorWhere(source, error);
      return { error: text(`${path} is not valid JSON${where ? ` (${where})` : ""}: ${errorText(error)}`, `Fix the JSON in ${path} and call again with the same path.`) };
    }
  } else if (typeof args.script === "string") {
    try {
      data = JSON.parse(args.script);
    } catch (error) {
      const where = jsonErrorWhere(args.script, error);
      return { error: text(`\`script\` is a string but not valid JSON${where ? ` (${where})` : ""}: ${errorText(error)}`, "Pass the KenteiScript as a JSON object.") };
    }
  } else {
    data = args.script;
  }
  try {
    const script = parseKenteiScript(data, path ?? "The script");
    return path ? { script, path } : { script };
  } catch (error) {
    return { error: text(errorText(error), `Fix every problem listed above${path ? ` in ${path}` : " in the script"} and call again${path ? " with the same path" : ""}.`) };
  }
}

/** checkScript: the schema (already passed) plus the authoring rules, as warnings. */
function checkResult(script: KenteiScript, path: string | undefined): KenteiResult {
  const issues = authoringIssues(script, { minPerLevel: 1 });
  const { rules, questions } = script;
  const head =
    `${path ?? "The script"} is a valid KenteiScript: 「${script.meta.title}」, ${questions.length} questions, ${rules.questionsPerGame} per game, ` +
    `levels ${rules.minLevel}-${rules.maxLevel}; a game with the best answer every time reaches ${maxPoints(rules, questions)} points.`;
  if (!issues.length) return text(`${head}\nNo warnings.`, "Call present with the same script or path to show it.");
  return text(
    `${head}\n${issues.length} warning(s):\n${issues.map((i) => `- ${i.where}: ${i.message}`).join("\n")}`,
    `Fix every warning${path ? ` in ${path}` : ""}, check again, then present.`,
  );
}

/** present: show the quiz; return at once and let the results arrive as the next message. */
function presentResult(script: KenteiScript, path: string | undefined): KenteiResult {
  const { meta, rules, questions } = script;
  const max = maxPoints(rules, questions);
  const data: KenteiData = path ? { script, path } : { script };
  const jsonData: KenteiJson = {
    title: meta.title,
    questions: questions.length,
    questionsPerGame: rules.questionsPerGame,
    levels: `${rules.minLevel}-${rules.maxLevel}, starting at ${rules.startLevel}, max ${max} points`,
    ...(path ? { path } : {}),
  };
  // Shown anyway (the script is valid), but the LLM should know its top grades cannot be earned.
  const unreachable = rules.grades.filter((g) => g.min > max).map((g) => g.grade);
  const warning = unreachable.length
    ? ` Note: a game with the best answer every time reaches ${max} points, so grade${unreachable.length > 1 ? "s" : ""} ${unreachable.join(", ")} cannot be earned; lower the thresholds next time.`
    : "";
  return {
    toolName: TOOL_NAME,
    message: `KenteiScript 「${meta.title}」${path ? ` (from ${path})` : ""} is shown to the user: ${rules.questionsPerGame} of ${questions.length} questions; each answer is graded by JEV as it is given.${warning}`,
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
    return text(`Unknown action ${JSON.stringify(action ?? null)}: use one of ${ACTIONS.join(", ")}.`, "Start with getGuide.");
  }
  switch (action) {
    case "getGuide":
      return text(AUTHORING_GUIDE);
    case "getSchema":
      return text(JSON.stringify(kenteiJsonSchema()));
    case "checkScript":
    case "present": {
      const loaded = await loadScript(context, input);
      if ("error" in loaded) return action === "present" ? { ...loaded.error, message: `Nothing was shown. ${loaded.error.message}` } : loaded.error;
      return action === "checkScript" ? checkResult(loaded.script, loaded.path) : presentResult(loaded.script, loaded.path);
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
