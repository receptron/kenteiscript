// The manageKenteiScript tool: its MCP / function-calling definition and the system prompt.
//
// One tool with an `action`, like manageJingleScript, so the definition stays small in the LLM's
// context: the format (getSchema) and the authoring guide (getGuide) are served on demand rather
// than inlined. getSchema is generated from the KenteiScript Zod schema (src/kentei-script.ts), so
// the format keeps one definition; the field descriptions it shows are the schema's `.describe()`s.
import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "manageKenteiScript";

export const ACTIONS = ["getGuide", "getSchema", "checkScript", "present"] as const;
export type Action = (typeof ACTIONS)[number];

export const TOOL_DESCRIPTION =
  "Quiz the user in the chat with a KenteiScript: they answer each question in their own words, each answer is graded against the criteria you write, " +
  "and the results come back as the user's next message. Call getGuide, write the script, and call present, all in one go without replying to the user in between; " +
  "present checks the script and shows it only when nothing needs fixing, so fix what it lists and call it again. " +
  "A long script can be written to a .json file and passed as `path` instead of `script`.";

export const TOOL_DEFINITION: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  prompt: `Use ${TOOL_NAME} to check what the user understands after you explain something, or to give a practice test. Start with its getGuide action.`,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [...ACTIONS],
        description:
          "What to do. The loop, in one turn: getGuide (how to write a KenteiScript that grades well, with a complete example) → write the script → present (checks it, then shows the quiz; wait for the results message) → if it lists problems, fix them and present again. checkScript is present's check without showing; getSchema is every field's details, rarely needed.",
      },
      script: {
        type: "object",
        description: "checkScript, present: the KenteiScript inline (format: getSchema). A JSON string is accepted too. Give `script` or `path`, not both.",
      },
      ignoreWording: {
        type: "boolean",
        description: "present: show the quiz although a question was flagged as asking to pick from options, when you have checked that it does not.",
      },
      path: {
        type: "string",
        description:
          "checkScript, present: path of a KenteiScript file (.json) to read instead of passing `script`, better for long scripts. Relative to the project directory, or absolute. Give `script` or `path`, not both.",
      },
    },
    required: ["action"],
  },
};

/** The system prompt: deliberately short; the guide is the getGuide action. */
export const SYSTEM_PROMPT = TOOL_DEFINITION.prompt!;
