// The grading environment, and the one check both the tool's actions and the View's grade dispatch
// make against it, so they can never disagree about whether this host can grade. KenteiScript in
// chat has no grading without JEV: without a key the tool fails rather than falling back to anything.

/** Where to grade: the key, and the optional model and endpoint overrides. */
export interface GradeEnv {
  apiKey?: string | undefined;
  model?: string | undefined;
  url?: string | undefined;
}

/**
 * The grading settings from the host process's environment: TYPESAFE_API_KEY, and the same
 * JEV_MODEL / JEV_URL overrides the MulmoKentei Worker reads (JEV_URL points tests at
 * scripts/mock-jev.mjs). Empty outside Node (no key, so every action fails).
 */
export function envFromProcess(): GradeEnv {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  return { apiKey: env.TYPESAFE_API_KEY || undefined, model: env.JEV_MODEL || undefined, url: env.JEV_URL || undefined };
}

/** Whether this environment can grade with JEV: a non-empty TYPESAFE_API_KEY. */
export const hasJevKey = (env: GradeEnv): env is GradeEnv & { apiKey: string } => typeof env.apiKey === "string" && env.apiKey.trim() !== "";

/** What every manageKenteiScript action, and the View's grade dispatch, answers when hasJevKey is false. */
export const MISSING_KEY_MESSAGE =
  "manageKenteiScript is unavailable: this host has no TYPESAFE_API_KEY, which KenteiScript needs to grade answers with JEV (TypeSafe's decision model). " +
  "Ask the user to set TYPESAFE_API_KEY in the host's environment (a key is available at https://typesafe.ai) and restart the host. " +
  "Do not run or grade the quiz yourself.";
