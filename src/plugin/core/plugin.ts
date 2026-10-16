import type { ToolContext, ToolPluginCore, ToolResult } from "gui-chat-protocol";
import { parseKenteiScript } from "../../kentei-script.ts";
import { maxPoints } from "../../game.ts";
import { TOOL_DEFINITION, TOOL_NAME } from "./definition.ts";
import type { GradingMode, KenteiData, KenteiJson } from "./types.ts";

export type KenteiResult = ToolResult<KenteiData, KenteiJson>;

/**
 * Validates the KenteiScript and returns at once: the View shows the quiz, and the user's results
 * reach the LLM later as a message. A script the schema rejects comes back with every schema
 * error, so the LLM can fix it and call again.
 *
 * `grading` is decided by the caller: this core is host-neutral and cannot see a server's
 * environment, so on its own it leaves grading to the LLM. The server entry (src/plugin/server.ts)
 * passes "jev" when the host has a TYPESAFE_API_KEY.
 */
export async function executeKentei(_context: ToolContext, args: unknown, grading: GradingMode = "llm"): Promise<KenteiResult> {
  let script;
  try {
    script = parseKenteiScript(args, "This script");
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      instructions: "The quiz was not shown. Fix every problem listed above in the KenteiScript and call presentKentei again with the whole script.",
    };
  }
  const { meta, rules, questions } = script;
  const max = maxPoints(rules, questions);
  const data: KenteiData = { script, grading };
  const jsonData: KenteiJson = {
    title: meta.title,
    questions: questions.length,
    questionsPerGame: rules.questionsPerGame,
    levels: `${rules.minLevel}-${rules.maxLevel}, starting at ${rules.startLevel}, max ${max} points`,
    grading,
  };
  const grader = grading === "jev" ? "each answer is graded by JEV as it is given" : "the answers come back ungraded, for you to grade";
  // Shown anyway (the script is valid), but the LLM should know its top grades cannot be earned.
  const unreachable = rules.grades.filter((g) => g.min > max).map((g) => g.grade);
  const warning = unreachable.length
    ? ` Note: a game can reach at most ${max} points, so grade${unreachable.length > 1 ? "s" : ""} ${unreachable.join(", ")} cannot be earned; lower the thresholds next time.`
    : "";
  return {
    message: `KenteiScript 「${meta.title}」 is shown to the user: ${rules.questionsPerGame} of ${questions.length} questions; ${grader}.${warning}`,
    title: meta.title,
    data,
    jsonData,
    instructions:
      "The quiz is shown to the user. Do not ask the questions yourself and do not reveal the answers. Wait: their results will arrive as your next message.",
  };
}

export const pluginCore: ToolPluginCore<KenteiData, KenteiJson, object> = {
  toolDefinition: TOOL_DEFINITION,
  execute: (context, args) => executeKentei(context, args),
  generatingMessage: "Preparing the quiz...",
  isEnabled: () => true,
};

export { TOOL_NAME, TOOL_DEFINITION };
