// Shared by the setup and remote scripts: reads and updates .env, and builds the
// Cloudflare config. wrangler.jsonc stays generic (a placeholder D1 id, which is fine for
// local development); the real id lives in .env and goes into wrangler.remote.jsonc, a
// git-ignored copy that only the commands talking to Cloudflare use.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const root = new URL("..", import.meta.url).pathname;
const envFile = join(root, ".env");
const baseConfig = join(root, "wrangler.jsonc");
export const remoteConfig = join(root, "wrangler.remote.jsonc");

export const D1_ID_KEY = "CLOUDFLARE_D1_DATABASE_ID";

export function readEnv() {
  if (!existsSync(envFile)) throw new Error("No .env file. Copy .env.example to .env and set TYPESAFE_API_KEY.");
  const env = {};
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return env;
}

/** Sets KEY=value in .env, replacing an existing line or appending one. */
export function setEnv(key, value) {
  const text = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const line = `${key}=${value}`;
  const re = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
  writeFileSync(envFile, re.test(text) ? text.replace(re, line) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`);
}

export const readBaseConfig = () => readFileSync(baseConfig, "utf8");
export const dbName = () => readBaseConfig().match(/"database_name"\s*:\s*"([^"]+)"/)[1];

/** Writes wrangler.remote.jsonc: wrangler.jsonc with the D1 id from .env. */
export function writeRemoteConfig() {
  const id = readEnv()[D1_ID_KEY];
  if (!id) throw new Error(`${D1_ID_KEY} is not set in .env. Run \`yarn setup:cloudflare\` first.`);
  const header = "// Generated from wrangler.jsonc and .env by scripts/env.mjs. Do not edit; git-ignored.\n";
  writeFileSync(remoteConfig, header + readBaseConfig().replace(/("database_id"\s*:\s*")[^"]*(")/, `$1${id}$2`));
  return remoteConfig;
}

export const wrangler = (args, opts = {}) =>
  execFileSync("npx", ["wrangler", ...args], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"], ...opts });

/** Runs wrangler against Cloudflare with the generated config. */
export const wranglerRemote = (args, opts = {}) => wrangler([...args, "--config", writeRemoteConfig()], opts);
