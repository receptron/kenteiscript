// The presentKentei plugin's server entry (dist/index.js, exported as "kenteiscript/plugin").
//
// The default export is a gui-chat-protocol `definePlugin` factory, the shape both hosts load:
// MulmoTerminal's plugins-registry and MulmoClaude's runtime-plugin loader call it with the
// plugin's runtime and dispatch to the method named after the tool. One handler serves two callers:
//
//   - the LLM's tool call, whose arguments are a KenteiScript: validated and shown (executeKentei),
//     with grading "jev" when this server has a TYPESAFE_API_KEY;
//   - the View's runtime.dispatch({ kind: "grade", ... }): one answer graded with JEV, here, so
//     the key never leaves the server.
//
// The named exports are the host-neutral core, for hosts that register the tool themselves.
import { definePlugin } from "gui-chat-protocol";
import { TOOL_DEFINITION } from "./core/definition.ts";
import { executeKentei } from "./core/plugin.ts";
import { envFromProcess, gradeRequest, isGradeRequest, type GradeEnv } from "./grade.ts";

export * from "./core/index.ts";
export { gradeRequest, isGradeRequest, envFromProcess, type GradeEnv } from "./grade.ts";

/** The tool handler, with the environment passed in (the factory reads it from the process). */
export async function handleKentei(args: unknown, env: GradeEnv): Promise<unknown> {
  if (isGradeRequest(args)) return gradeRequest(args, env);
  return executeKentei({}, args, env.apiKey ? "jev" : "llm");
}

export default definePlugin(({ log }) => ({
  TOOL_DEFINITION,
  async presentKentei(args: unknown) {
    try {
      return await handleKentei(args, envFromProcess());
    } catch (error) {
      log.warn("grading failed", { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },
}));
