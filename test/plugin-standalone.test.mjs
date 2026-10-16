// The server entry loads with nothing installed around it. MulmoClaude's runtime-plugin loader
// import()s dist/index.js straight from its plugin cache (~/mulmoclaude/plugins/.cache/<name>/<version>/),
// with no node_modules there or above, so dist/index.js and dist/index.cjs must have no bare imports
// (gui-chat-protocol's core and Zod are bundled; only node: builtins would be allowed).
// Run `yarn build:plugin` first (CI does).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
if (!existsSync(join(root, "dist", "index.js"))) throw new Error("dist/ is missing: run `yarn build:plugin` first");

const dir = mkdtempSync(join(tmpdir(), "kentei-plugin-"));
cpSync(join(root, "dist"), join(dir, "dist"), { recursive: true });
copyFileSync(join(root, "package.json"), join(dir, "package.json"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

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

const fakeByPath = (files) => ({
  async read(p) {
    if (!(p in files)) throw new Error(`ENOENT: ${p}`);
    return files[p];
  },
});

// Both hosts' server processes are where the key lives: the plugin reads TYPESAFE_API_KEY from it.
async function withProcessKey(value, fn) {
  const saved = process.env.TYPESAFE_API_KEY;
  if (value === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = value;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = saved;
  }
}

const load = async (file) => {
  const path = join(dir, "dist", file);
  return file.endsWith(".cjs") ? createRequire(path)(path) : await import(pathToFileURL(path).href);
};

for (const file of ["index.js", "index.cjs"]) {
  test(`dist/${file} standalone, with no TYPESAFE_API_KEY: every action fails with MISSING_KEY_MESSAGE and no data`, async () => {
    const mod = await load(file);
    assert.match(mod.MISSING_KEY_MESSAGE, /^manageKenteiScript is unavailable: this host has no TYPESAFE_API_KEY/);
    const context = { files: { byPath: fakeByPath({ "quizzes/example.json": JSON.stringify(sample) }) } };
    for (const key of [undefined, ""]) {
      await withProcessKey(key, async () => {
        for (const args of [
          { action: "getGuide" },
          { action: "getSchema" },
          { action: "checkScript", script: structuredClone(sample) },
          { action: "present", script: structuredClone(sample) },
          { action: "present", path: "quizzes/example.json" },
        ]) {
          for (const r of [await mod.manageKenteiScript({}, args), await mod.pluginCore.execute(context, args)]) {
            assert.equal(r.message, mod.MISSING_KEY_MESSAGE, JSON.stringify(args));
            assert.equal(r.data, undefined, "no View");
          }
        }
        await assert.rejects(
          mod.manageKenteiScript({}, { kind: "grade", script: sample, questionId: sample.questions[0].id, answer: "x" }),
          (e) => e.message === mod.MISSING_KEY_MESSAGE,
        );
      });
    }
  });

  test(`dist/${file} loads standalone, in the legacy shape both hosts give a context to`, () =>
    withProcessKey("test-key", async () => {
      const mod = await load(file);
      assert.equal(mod.TOOL_DEFINITION.name, "manageKenteiScript");
      assert.equal(mod.default, undefined, "no definePlugin factory: hosts would call it without a context");
      // MulmoClaude's runtime loader: the export named after the tool, (context, args).
      const guide = await mod.manageKenteiScript({}, { action: "getGuide" });
      assert.match(guide.message, /KenteiScript/);
      const inline = await mod.manageKenteiScript({}, { action: "present", script: structuredClone(sample) });
      assert.equal(inline.data.script.meta.title, sample.meta.title);
      // MulmoTerminal: pluginCore.execute(context, args), with the host's files.byPath for `path`.
      const context = { files: { byPath: fakeByPath({ "quizzes/example.json": JSON.stringify(sample) }) } };
      const byPath = await mod.pluginCore.execute(context, { action: "present", path: "quizzes/example.json" });
      assert.equal(byPath.data.path, "quizzes/example.json");
      assert.equal(byPath.data.script.meta.title, sample.meta.title);
      const checked = await mod.pluginCore.execute(context, { action: "checkScript", path: "quizzes/example.json" });
      assert.match(checked.message, /is a valid KenteiScript/);
    }));
}
