// ToolResult.viewState is typed Record<string, unknown> by the protocol and comes back from the
// host as whatever was stored (an older version, another host), so it is rebuilt here against the
// script rather than asserted: anything that does not fit is dropped, and a blob that does not fit
// at all restarts the game.
import type { KenteiScript } from "../../kentei-script.ts";
import type { AnswerGrade, GradingMode } from "./types.ts";
import type { AnswerRecord, Phase, PlayState } from "./play.ts";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const PHASES: readonly Phase[] = ["start", "question", "feedback", "done"];

function toGrade(value: unknown): AnswerGrade | undefined {
  if (!isRecord(value)) return undefined;
  const { type, result, probabilities, credit, points } = value;
  if (type !== "Choice" && type !== "Score") return undefined;
  if (typeof result !== "string" && typeof result !== "number") return undefined;
  if (typeof credit !== "number" || typeof points !== "number" || !isRecord(probabilities)) return undefined;
  const probs = Object.fromEntries(Object.entries(probabilities).filter((e): e is [string, number] => typeof e[1] === "number"));
  return { type, result, probabilities: probs, credit, points };
}

/** Rebuilds a saved PlayState for this script, or null when there is none to restore. */
export function toPlayState(value: unknown, script: KenteiScript): PlayState | null {
  if (!isRecord(value)) return null;
  const ids = new Set(script.questions.map((q) => q.id));
  const phase = PHASES.find((p) => p === value.phase);
  const mode: GradingMode | undefined = value.mode === "jev" || value.mode === "llm" ? value.mode : undefined;
  if (!phase || !mode) return null;
  const { minLevel, maxLevel, startLevel } = script.rules;
  const level = typeof value.level === "number" && value.level >= minLevel && value.level <= maxLevel ? value.level : startLevel;
  const history: AnswerRecord[] = [];
  for (const item of Array.isArray(value.history) ? value.history : []) {
    if (!isRecord(item) || typeof item.id !== "string" || !ids.has(item.id) || typeof item.answer !== "string") continue;
    if (history.some((h) => h.id === item.id)) continue;
    const grade = toGrade(item.grade);
    const asked = { id: item.id, answer: item.answer, level: typeof item.level === "number" ? item.level : startLevel };
    history.push(grade ? { ...asked, grade } : asked);
  }
  const currentId = typeof value.currentId === "string" && ids.has(value.currentId) ? value.currentId : null;
  // A question or feedback screen without its question cannot be shown; start that step again.
  if ((phase === "question" || phase === "feedback") && !currentId) return null;
  return {
    phase,
    mode,
    level,
    currentId,
    history,
    draft: typeof value.draft === "string" ? value.draft : "",
    titleChoice: typeof value.titleChoice === "string" ? value.titleChoice : null,
    sent: value.sent === true,
  };
}
