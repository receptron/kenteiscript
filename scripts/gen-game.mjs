// Generates public/game.js, the MulmoKentei page's copy of the game rules, from src/game.ts.
// The page is plain JS with no build step, so it loads this file as an ES module; the Worker and
// the chat plugin import src/game.ts itself. One source, so every runtime plays by the same rules.
// Runs before `wrangler dev` and `wrangler deploy` (see "build" in wrangler.jsonc).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const root = new URL("..", import.meta.url).pathname;
const source = readFileSync(join(root, "src", "game.ts"), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
  fileName: "game.ts",
});
const text = `// Generated from src/game.ts by scripts/gen-game.mjs. Do not edit.\n${outputText}`;
// Write only on change, like gen-quizzes.mjs.
const out = join(root, "public", "game.js");
if (!existsSync(out) || readFileSync(out, "utf8") !== text) writeFileSync(out, text);
console.log("game rules: public/game.js");
