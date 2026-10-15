// One-time setup.
//   npm run setup               local: writes .dev.vars from .env and creates the local D1 tables
//   npm run setup:cloudflare    Cloudflare: creates the D1 database (if needed), records its id in
//                               wrangler.jsonc, creates the tables, deploys, and uploads the API key
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const remote = process.argv.includes("--remote");
const wranglerFile = join(root, "wrangler.jsonc");

const wrangler = (args, opts = {}) =>
  execFileSync("npx", ["wrangler", ...args], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"], ...opts });

function readEnv() {
  const file = join(root, ".env");
  if (!existsSync(file)) throw new Error("No .env file. Copy .env.example to .env and set TYPESAFE_API_KEY.");
  const env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  if (!env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY is empty in .env");
  return env;
}

const config = readFileSync(wranglerFile, "utf8");
const dbName = config.match(/"database_name"\s*:\s*"([^"]+)"/)[1];
const env = readEnv();

if (!remote) {
  writeFileSync(join(root, ".dev.vars"), `TYPESAFE_API_KEY=${env.TYPESAFE_API_KEY}\n`);
  console.log("wrote .dev.vars (git-ignored)");
  wrangler(["d1", "execute", dbName, "--local", "--file", "schema.sql"], { stdio: ["pipe", "ignore", "inherit"] });
  console.log(`local D1 "${dbName}" is ready. Start the app with: npm run dev`);
  process.exit(0);
}

// 1. Find or create the D1 database and write its id into wrangler.jsonc.
const list = JSON.parse(wrangler(["d1", "list", "--json"]));
let db = list.find((d) => d.name === dbName);
if (!db) {
  console.log(`creating D1 database "${dbName}"…`);
  wrangler(["d1", "create", dbName], { stdio: ["pipe", "ignore", "inherit"] });
  db = JSON.parse(wrangler(["d1", "list", "--json"])).find((d) => d.name === dbName);
}
const id = db.uuid;
writeFileSync(wranglerFile, config.replace(/("database_id"\s*:\s*")[^"]*(")/, `$1${id}$2`));
console.log(`D1 "${dbName}" = ${id} (saved in wrangler.jsonc)`);

// 2. Tables, 3. the Worker itself, 4. the secret (the Worker must exist before a secret can be added).
wrangler(["d1", "execute", dbName, "--remote", "--file", "schema.sql", "-y"], { stdio: ["pipe", "ignore", "inherit"] });
console.log("tables created");
wrangler(["deploy"], { stdio: "inherit" });
wrangler(["secret", "put", "TYPESAFE_API_KEY"], { input: env.TYPESAFE_API_KEY, stdio: ["pipe", "ignore", "inherit"] });
console.log("TYPESAFE_API_KEY uploaded as a Worker secret. From now on, deploy with: npm run deploy");
