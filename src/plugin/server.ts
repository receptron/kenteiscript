// The manageKenteiScript plugin's server entry (dist/index.js, exported as "kenteiscript/plugin").
//
// It has the "legacy" gui-chat-protocol shape, TOOL_DEFINITION plus an executor that takes
// (context, args), because both hosts pass a ToolContext only to that shape: MulmoTerminal's
// plugins-registry gives `pluginCore.execute` its `context.files.byPath` (what makes `path` work),
// and MulmoClaude's runtime loader calls the export named after the tool, `manageKenteiScript`. A
// `definePlugin` factory, which both hosts prefer when it is the default export, is called with
// the arguments only, so it could never read a file by path. One executor serves two callers:
//
//   - the LLM's tool call, one of the actions (getGuide, getSchema, checkScript, present; a script
//     inline or by `path`, read through context.files.byPath), with grading "jev" on present when
//     this server has a TYPESAFE_API_KEY;
//   - the View's runtime.dispatch({ kind: "grade", ... }): one answer graded with JEV, here, so
//     the key never leaves the server.
//
// No bare imports at runtime: MulmoClaude loads this file from its plugin cache with no
// node_modules around it (test/plugin-standalone.test.mjs).
import type { ToolPluginCore } from "gui-chat-protocol";
import { executeKentei, pluginCore as corePluginCore, type KenteiContext } from "./core/plugin.ts";
import type { KenteiData, KenteiJson } from "./core/types.ts";
import { envFromProcess, gradeRequest, isGradeRequest, type GradeEnv } from "./grade.ts";

export * from "./core/index.ts";
export { gradeRequest, isGradeRequest, envFromProcess, type GradeEnv } from "./grade.ts";

/** The executor, with the grading environment passed in (manageKenteiScript reads it from the process). */
export async function handleKentei(args: unknown, env: GradeEnv, context: KenteiContext = {}): Promise<unknown> {
  if (isGradeRequest(args)) return gradeRequest(args, env);
  return executeKentei(context, args, env.apiKey ? "jev" : "llm");
}

/** The tool's executor, named after the tool (MulmoClaude's runtime loader looks it up by name). */
export async function manageKenteiScript(context: KenteiContext | undefined, args: unknown): Promise<unknown> {
  return handleKentei(args, envFromProcess(), context ?? {});
}

/** The core with the server executor (MulmoTerminal's registry runs `pluginCore.execute`). */
export const pluginCore = {
  ...corePluginCore,
  execute: (context, args) => manageKenteiScript(context, args),
} as ToolPluginCore<KenteiData, KenteiJson, object>;
