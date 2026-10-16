// The server entry loads with nothing installed around it. MulmoClaude's runtime-plugin loader
// import()s dist/index.js straight from its plugin cache (~/mulmoclaude/plugins/.cache/<name>/<version>/),
// with no node_modules there or above, so dist/index.js and dist/index.cjs must have no bare imports
// (gui-chat-protocol's core and Zod are bundled; only node: builtins would be allowed).
// Run `npm run build:plugin` first (CI does).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
if (!existsSync(join(root, "dist", "index.js"))) throw new Error("dist/ is missing: run `npm run build:plugin` first");

const dir = mkdtempSync(join(tmpdir(), "kentei-plugin-"));
cpSync(join(root, "dist"), join(dir, "dist"), { recursive: true });
copyFileSync(join(root, "package.json"), join(dir, "package.json"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const runtime = { log: { debug() {}, info() {}, warn() {}, error() {} } };
const sample = JSON.parse(readFileSync(join(root, "quizzes", "example.json"), "utf8"));

test("the copy has nothing to resolve packages from", () => {
  const require = createRequire(join(dir, "dist", "index.cjs"));
  assert.throws(() => require.resolve("gui-chat-protocol"), /Cannot find module/);
  assert.throws(() => require.resolve("zod"), /Cannot find module/);
});

test("dist/index.* and the chunks they load have no bare imports", () => {
  const server = readdirSync(join(dir, "dist")).filter((f) => /\.(c?js)$/.test(f) && !f.startsWith("vue."));
  for (const f of server) {
    const text = readFileSync(join(dir, "dist", f), "utf8");
    const specifiers = [...text.matchAll(/(?:from\s*|import\(\s*|require\(\s*)["']([^"']+)["']/g)].map((m) => m[1]);
    const bare = specifiers.filter((s) => !s.startsWith("./") && !s.startsWith("../") && !s.startsWith("node:"));
    assert.deepEqual(bare, [], f);
  }
});

for (const file of ["index.js", "index.cjs"]) {
  test(`dist/${file} loads standalone and its factory runs`, async () => {
    const path = join(dir, "dist", file);
    const mod = file.endsWith(".cjs") ? createRequire(path)(path) : await import(pathToFileURL(path).href);
    assert.equal(typeof mod.default, "function", "default export is the definePlugin factory");
    assert.equal(mod.TOOL_DEFINITION.name, "presentKentei");
    const plugin = mod.default(runtime);
    assert.equal(plugin.TOOL_DEFINITION.name, "presentKentei");
    const result = await plugin.presentKentei(structuredClone(sample));
    assert.ok(result.data, result.message);
    assert.equal(result.data.script.meta.title, sample.meta.title);
  });
}
