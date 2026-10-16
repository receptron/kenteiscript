// The presentKentei plugin's core and server entry: the tool definition, execute, the game state
// the View keeps, the results message, and server-side grading (against a local stand-in for JEV).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import type { PluginRuntime } from "gui-chat-protocol";
import factory, {
  SAMPLE_SCRIPT,
  TOOL_DEFINITION,
  advance,
  executeKentei,
  gradeRequest,
  handleKentei,
  initialState,
  recordAnswer,
  resultsMessage,
  summary,
  toPlayState,
  type AnswerGrade,
  type PlayState,
  type KenteiData,
} from "../src/plugin/server.ts";

const clone = <T>(v: T): T => structuredClone(v);
const ml = JSON.parse(readFileSync(new URL("../quizzes/ml.json", import.meta.url).pathname, "utf8"));

test("TOOL_DEFINITION.parameters is the KenteiScript schema as a plain JSON Schema object", () => {
  const p = TOOL_DEFINITION.parameters!;
  assert.equal(TOOL_DEFINITION.name, "presentKentei");
  assert.equal(p.type, "object");
  assert.deepEqual(p.required, ["meta", "rules", "questions"]);
  const text = JSON.stringify(p);
  assert.ok(!text.includes("$schema") && !text.includes("propertyNames") && !text.includes("9007199254740991"));
  // Every property, at every depth, carries a description for the LLM.
  const missing: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.properties && typeof n.properties === "object") {
      for (const [key, child] of Object.entries(n.properties as Record<string, Record<string, unknown>>)) {
        if (typeof child.description !== "string") missing.push(`${path}.${key}`);
        walk(child, `${path}.${key}`);
      }
    }
    for (const key of ["items", "additionalProperties"]) walk(n[key], path + "[]");
    for (const key of ["oneOf", "anyOf"]) if (Array.isArray(n[key])) (n[key] as unknown[]).forEach((c) => walk(c, path));
  };
  walk(p, "");
  assert.deepEqual(missing, []);
  // The definition must be plain JSON: hosts send it over MCP as is.
  assert.deepEqual(JSON.parse(JSON.stringify(TOOL_DEFINITION)), TOOL_DEFINITION);
});

test("execute: a valid KenteiScript is shown, returning at once with instructions to wait", async () => {
  for (const script of [SAMPLE_SCRIPT, ml]) {
    const r = await executeKentei({}, clone(script));
    assert.ok(r.data, r.message);
    assert.equal(r.data.grading, "llm");
    assert.equal(r.data.script.meta.title, script.meta.title);
    assert.equal(r.jsonData?.questions, script.questions.length);
    assert.match(r.instructions ?? "", /next message/);
    assert.ok(!JSON.stringify(r.jsonData).includes("criteria"), "the LLM is not sent its own script back");
  }
});

test("maxPoints of the sample script follows its question pool, and its grades are all reachable", async () => {
  // Levels 1, 2, 2, 3 from ★2: all correct asks ★2, ★3, then ★3 has run out (★2, then ★1) = 8, not 2 + 3 + 3 + 3.
  const r = await executeKentei({}, clone(SAMPLE_SCRIPT));
  assert.match(r.jsonData!.levels, /max 8 points/);
  assert.ok(SAMPLE_SCRIPT.rules.grades.every((g) => g.min <= 8));
  assert.doesNotMatch(r.message, /cannot be earned/);
  const greedy = clone(SAMPLE_SCRIPT);
  greedy.rules.grades[0]!.min = 9;
  assert.match((await executeKentei({}, greedy)).message, /best answer every time reaches 8 points, so grade A cannot be earned/);
});

test("execute: an invalid KenteiScript returns every schema error and no data", async () => {
  const bad = clone(SAMPLE_SCRIPT) as Record<string, any>;
  bad.questions[0].explaination = "typo";
  delete bad.meta.intro;
  bad.rules.credit.Choice = { right: 1, wrong: 0 };
  const r = await executeKentei({}, bad);
  assert.equal(r.data, undefined);
  assert.match(r.message, /not a valid KenteiScript/);
  assert.match(r.message, /meta\.intro/);
  assert.match(r.message, /explaination/);
  assert.match(r.instructions ?? "", /call presentKentei again/);

  const cross = clone(SAMPLE_SCRIPT) as Record<string, any>;
  cross.rules.questionsPerGame = 9;
  cross.questions[1].id = cross.questions[0].id;
  const r2 = await executeKentei({}, cross);
  assert.equal(r2.data, undefined);
  assert.match(r2.message, /duplicate id L1-01/);
  assert.match(r2.message, /9 questions per game, but the script has only 4/);

  assert.equal((await executeKentei({}, "not an object")).data, undefined);
});

test("the server entry is a definePlugin factory whose handler grades with JEV only when the host has a key", async () => {
  const runtime = { log: { debug() {}, info() {}, warn() {}, error() {} } } as unknown as PluginRuntime;
  const loaded = factory(runtime);
  assert.equal(loaded.TOOL_DEFINITION.name, "presentKentei");
  assert.equal(typeof loaded.presentKentei, "function");
  const withKey = (await handleKentei(clone(SAMPLE_SCRIPT), { apiKey: "k" })) as { data: KenteiData };
  assert.equal(withKey.data.grading, "jev");
  const without = (await handleKentei(clone(SAMPLE_SCRIPT), {})) as { data: KenteiData };
  assert.equal(without.data.grading, "llm");
  await assert.rejects(handleKentei({ kind: "grade", script: SAMPLE_SCRIPT, questionId: "L1-01", answer: "葉緑体" }, {}), /no TYPESAFE_API_KEY/);
});

// A local stand-in for the JEV API that answers with the probabilities a test asks for.
async function fakeJev(probabilities: (body: any) => Record<string, number>) {
  const seen: any[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      seen.push({ auth: req.headers.authorization, body });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ answers: { grade: { probabilities: probabilities(body) } } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/systemone`;
  return { url, seen, close: () => new Promise((r) => server.close(r)) };
}

test("gradeRequest grades one answer on the server with the host's key", async () => {
  const choice: Record<string, number> = { correct: 0.9, close: 0.07, wrong: 0.03 };
  const score: Record<string, number> = { 0: 0.1, 1: 0.2, 2: 0.6, 3: 0.1 };
  const jev = await fakeJev((b) => (b.questions.grade.type === "choice" ? choice : score));
  try {
    const env = { apiKey: "test-key", url: jev.url };
    const g = await gradeRequest({ kind: "grade", script: SAMPLE_SCRIPT, questionId: "L2-01", answer: "  酸素  " }, env);
    assert.deepEqual(g, { type: "Choice", result: "correct", probabilities: { correct: 0.9, close: 0.07, wrong: 0.03 }, credit: 1, points: 2 });
    const s = await gradeRequest({ kind: "grade", script: SAMPLE_SCRIPT, questionId: "L3-01", answer: "" }, env);
    assert.equal(s.result, 2);
    assert.equal(s.points, 1.5);
    assert.equal(jev.seen[0].auth, "Bearer test-key");
    assert.equal(jev.seen[0].body.state.answer, "酸素");
    assert.equal(jev.seen[1].body.state.answer, "（無回答）");
    assert.ok(jev.seen[0].body.questions.grade.criteria.correct, "the criteria go to JEV from the server");
    await assert.rejects(gradeRequest({ kind: "grade", script: SAMPLE_SCRIPT, questionId: "nope", answer: "x" }, env), /No question nope/);
    await assert.rejects(gradeRequest({ kind: "grade", script: { meta: {} }, questionId: "L1-01", answer: "x" }, env), /not a valid KenteiScript/);
  } finally {
    await jev.close();
  }
});

const grade = (type: "Choice" | "Score", result: string | number, credit: number, level: number, p = 0.8): AnswerGrade => ({
  type,
  result,
  credit,
  points: credit * level,
  probabilities: { [String(result)]: p },
});

test("a graded game adapts the level, ends after questionsPerGame, and reports every grade with its probability", () => {
  const script = clone(SAMPLE_SCRIPT);
  let s = advance(script, initialState(script, "jev"), () => 0);
  assert.equal(s.phase, "question");
  assert.equal(s.currentId, "L2-01");
  s = recordAnswer(script, s, "酸素", grade("Choice", "correct", 1, 2, 0.95));
  assert.equal(s.phase, "feedback");
  assert.equal(s.level, 3);
  s = advance(script, s, () => 0);
  assert.equal(s.currentId, "L3-01");
  s = recordAnswer(script, s, "光がないから\n呼吸だけになる", grade("Score", 2, 0.5, 3, 0.71));
  assert.equal(s.level, 3);
  s = advance(script, s, () => 0); // level 3 has run out: the nearest level, 2
  assert.equal(s.currentId, "L2-02");
  s = recordAnswer(script, s, "", grade("Choice", "wrong", 0, 2, 0.99));
  assert.equal(s.level, 2);
  s = advance(script, s, () => 0);
  assert.equal(s.currentId, "L1-01");
  s = recordAnswer(script, s, "葉緑素", grade("Choice", "wrong", 0, 1, 0.6));
  s = advance(script, s);
  assert.equal(s.phase, "done");

  const t = summary(script, s);
  assert.equal(t.points, 3.5);
  assert.equal(t.grade.grade, "C");
  assert.equal(t.max, 8);
  const msg = resultsMessage(script, s);
  assert.equal(msg.split("\n")[0], "**光合成ミニ検定 — result: C 「これから芽が出る人」 (3.5 / 8 points)**");
  assert.match(msg, /- Q1 \[L2-01\] ★2 「光合成でつくられる気体は何ですか？」 — answer: 「酸素」 — correct \(0\.95\)/);
  assert.match(msg, /- Q2 \[L3-01\] ★3 .* — answer: 「光がないから 呼吸だけになる」 — 2\/3 \(0\.71\)/);
  assert.match(msg, /- Q3 \[L2-02\] .* — answer: \(no answer\) — wrong \(0\.99\)/);
  assert.equal(msg.split("\n").filter((l) => l.startsWith("- ")).length, 4, "a newline in an answer cannot add a line");
});

test("an ungraded game asks in script order and asks the LLM to grade", () => {
  const script = clone(SAMPLE_SCRIPT);
  let s = initialState(script, "llm");
  const asked: string[] = [];
  for (;;) {
    s = advance(script, s);
    if (s.phase === "done") break;
    asked.push(s.currentId!);
    s = recordAnswer(script, s, `答え ${asked.length}`);
  }
  assert.deepEqual(asked, ["L1-01", "L2-01", "L2-02", "L3-01"]);
  assert.equal(s.level, script.rules.startLevel);
  const msg = resultsMessage(script, s);
  assert.match(msg, /^\*\*光合成ミニ検定 — answers to grade\*\*/);
  assert.match(msg, /rules\.grades/);
  assert.match(msg, /- Q4 \[L3-01\] ★3 .* — answer: 「答え 4」 — not graded/);
});

test("viewState round-trips through JSON and drops what does not fit the script", () => {
  const script = clone(SAMPLE_SCRIPT);
  let s = advance(script, initialState(script, "jev"), () => 0);
  s = recordAnswer(script, s, "酸素", grade("Choice", "correct", 1, 2));
  const saved = JSON.parse(JSON.stringify(s));
  assert.deepEqual(toPlayState(saved, script), s);
  assert.equal(toPlayState(undefined, script), null);
  assert.equal(toPlayState({ phase: "question", mode: "jev", currentId: "gone" }, script), null);
  const odd = toPlayState({ ...saved, level: 99, history: [...saved.history, { id: "gone", answer: "x" }, saved.history[0]] }, script);
  assert.equal(odd?.level, script.rules.startLevel);
  assert.equal(odd?.history.length, 1);
});

test("the ungraded results tell the LLM which title reading the player picked", () => {
  const script = clone(SAMPLE_SCRIPT);
  script.rules.grades[0] = { ...script.rules.grades[0]!, titleChoices: ["光合成博士", "光合成名人"] };
  let s: PlayState = { ...initialState(script, "llm"), titleChoice: "光合成名人" };
  s = advance(script, s);
  s = recordAnswer(script, s, "葉緑体");
  const msg = resultsMessage(script, s);
  assert.match(msg, /title reading.*「光合成名人」/);
  // Without titleChoices in the script, nothing is said.
  assert.doesNotMatch(resultsMessage(clone(SAMPLE_SCRIPT), { ...s, titleChoice: null }), /title reading/);
});
