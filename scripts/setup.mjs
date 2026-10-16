// One-time setup.
//   yarn setup               local: writes .dev.vars from .env and creates the local D1 tables
//   yarn setup:cloudflare    Cloudflare: creates the D1 database (if needed), records its id in
//                               .env, creates the tables, deploys, and uploads the API key
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { D1_ID_KEY, dbName, readEnv, root, setEnv, wrangler, wranglerRemote } from "./env.mjs";

const remote = process.argv.includes("--remote");
const env = readEnv();
if (!env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY is empty in .env");
const name = dbName();

if (!remote) {
  writeFileSync(join(root, ".dev.vars"), `TYPESAFE_API_KEY=${env.TYPESAFE_API_KEY}\n`);
  console.log("wrote .dev.vars (git-ignored)");
  wrangler(["d1", "execute", name, "--local", "--file", "schema.sql"], { stdio: ["pipe", "ignore", "inherit"] });
  console.log(`local D1 "${name}" is ready. Start the app with: yarn dev`);
  process.exit(0);
}

// 1. Find or create the D1 database and record its id in .env.
const list = JSON.parse(wrangler(["d1", "list", "--json"]));
let db = list.find((d) => d.name === name);
if (!db) {
  console.log(`creating D1 database "${name}"…`);
  wrangler(["d1", "create", name], { stdio: ["pipe", "ignore", "inherit"] });
  db = JSON.parse(wrangler(["d1", "list", "--json"])).find((d) => d.name === name);
}
setEnv(D1_ID_KEY, db.uuid);
console.log(`D1 "${name}" = ${db.uuid} (saved in .env as ${D1_ID_KEY})`);

// 2. Tables, 3. the Worker itself, 4. the secret (the Worker must exist before a secret can be added).
wranglerRemote(["d1", "execute", name, "--remote", "--file", "schema.sql", "-y"], { stdio: ["pipe", "ignore", "inherit"] });
console.log("tables created");
wranglerRemote(["deploy"], { stdio: "inherit" });
wranglerRemote(["secret", "put", "TYPESAFE_API_KEY"], { input: env.TYPESAFE_API_KEY, stdio: ["pipe", "ignore", "inherit"] });
console.log("TYPESAFE_API_KEY uploaded as a Worker secret. From now on, deploy with: yarn deploy");
