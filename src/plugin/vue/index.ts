// The manageKenteiScript plugin for Vue hosts (exported as "kenteiscript/plugin/vue"). Import
// "kenteiscript/plugin/style.css" too, or inject it where the host renders plugin views.
import type { ToolPlugin } from "gui-chat-protocol/vue";
import type { KenteiData, KenteiJson } from "../core/types.ts";
import { pluginCore } from "../core/plugin.ts";
import { samples } from "../core/samples.ts";
import { SYSTEM_PROMPT, TOOL_NAME } from "../core/definition.ts";
import View from "./View.vue";
import Preview from "./Preview.vue";

export { TOOL_NAME, SYSTEM_PROMPT };

export const plugin: ToolPlugin<KenteiData, KenteiJson, object> = {
  ...pluginCore,
  viewComponent: View,
  previewComponent: Preview,
  samples,
  systemPrompt: SYSTEM_PROMPT,
};

export type { KenteiData, KenteiJson, GradingMode, AnswerGrade, GradeRequest } from "../core/types.ts";
export { TOOL_DEFINITION, executeKentei, pluginCore } from "../core/plugin.ts";
export { samples } from "../core/samples.ts";
export { View, Preview };

export default { plugin };
