// The presentKentei View, as a host mounts it: the built dist/vue.js in a jsdom document, with a
// fake plugin runtime whose dispatch stands in for the server's JEV grading.
// Run `npm run build:plugin` first (CI does).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { JSDOM } from "jsdom";

const dist = new URL("../dist/vue.js", import.meta.url);
if (!existsSync(dist)) throw new Error("dist/vue.js is missing: run `npm run build:plugin` first");

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "Node", "Element", "HTMLElement", "SVGElement", "Event", "KeyboardEvent", "MutationObserver"]) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
}

const { createApp, h, nextTick, reactive } = await import("vue");
const { PLUGIN_RUNTIME_KEY } = await import("gui-chat-protocol/vue");
const { plugin, executeKentei } = await import("../dist/vue.js");
const { SAMPLE_SCRIPT } = await import("../src/plugin/core/samples.ts");

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};

async function mount({ grading, runtime }) {
  const result = await executeKentei({}, structuredClone(SAMPLE_SCRIPT));
  const props = reactive({ selectedResult: { ...result, data: { ...result.data, grading }, toolName: "presentKentei", uuid: "u1" } });
  const sent = [];
  const updates = [];
  const el = document.createElement("div");
  document.body.appendChild(el);
  const app = createApp({
    render: () =>
      h(plugin.viewComponent, {
        selectedResult: props.selectedResult,
        sendTextMessage: (text) => sent.push(text),
        onUpdateResult: (r) => {
          updates.push(r);
          props.selectedResult = r;
        },
      }),
  });
  if (runtime) app.provide(PLUGIN_RUNTIME_KEY, runtime);
  app.mount(el);
  await flush();
  const $ = (id) => el.querySelector(`[data-testid="${id}"]`);
  const click = async (id) => {
    $(id).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await flush();
  };
  const type = async (text) => {
    const ta = $("kentei-answer");
    ta.value = text;
    ta.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await flush();
  };
  return { el, $, click, type, sent, updates, app };
}

test("with a runtime and a key: each answer is graded through dispatch, and the result goes to the chat", async () => {
  const calls = [];
  const runtime = {
    async dispatch(args, parse) {
      calls.push(args);
      const q = args.script.questions.find((x) => x.id === args.questionId);
      const raw = q.jev.type === "Choice"
        ? { type: "Choice", result: "correct", probabilities: { correct: 0.93, close: 0.05, wrong: 0.02 }, credit: 1, points: q.level }
        : { type: "Score", result: 2, probabilities: { 0: 0.05, 1: 0.1, 2: 0.7, 3: 0.15 }, credit: 0.5, points: q.level * 0.5 };
      return parse ? parse(raw) : raw;
    },
  };
  const v = await mount({ grading: "jev", runtime });
  assert.ok(v.$("kentei-start"), "starts on the intro screen");
  assert.match(v.el.textContent, /光合成ミニ検定/);
  assert.match(v.el.textContent, /判定モデル（JEV）/);
  await v.click("kentei-start-button");

  for (let i = 0; i < SAMPLE_SCRIPT.rules.questionsPerGame; i++) {
    const text = v.$("kentei-question-text").textContent;
    const q = SAMPLE_SCRIPT.questions.find((x) => x.question === text);
    assert.ok(q, `question on screen: ${text}`);
    // The criteria are never on screen before the answer is graded.
    for (const c of Object.values(q.jev.criteria)) assert.ok(!v.el.textContent.includes(c), "criteria hidden");
    assert.ok(!v.el.textContent.includes(q.explanation), "explanation hidden before grading");
    await v.type(`答え${i + 1}`);
    await v.click("kentei-submit");
    assert.ok(v.$("kentei-feedback"), "feedback after grading");
    assert.ok(v.el.textContent.includes(q.explanation), "explanation shown after grading");
    await v.click("kentei-next");
  }

  assert.equal(calls.length, 4);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["answer", "kind", "questionId", "script"]);
  assert.equal(calls[0].kind, "grade");
  assert.equal(calls[0].answer, "答え1");
  assert.ok(v.$("kentei-result"));
  assert.equal(v.sent.length, 1, "the results are sent once");
  assert.match(v.sent[0], /^\*\*光合成ミニ検定 — result: [ABC] /);
  assert.match(v.sent[0], /— correct \(0\.93\)/);
  assert.match(v.$("kentei-sent").textContent, /送りました/);
  // Progress is saved with the result, so reopening resumes (here: on the result screen).
  const last = v.updates.at(-1);
  assert.equal(last.viewState.phase, "done");
  assert.equal(last.viewState.sent, true);
  assert.equal(last.viewState.history.length, 4);
  v.app.unmount();
});

test("without a key: answers are collected ungraded and sent for the LLM to grade", async () => {
  const v = await mount({ grading: "llm", runtime: null });
  assert.match(v.el.textContent, /AI が採点/);
  await v.click("kentei-start-button");
  for (let i = 0; i < 4; i++) {
    await v.type(i === 1 ? "" : `答え${i + 1}`);
    await v.click("kentei-submit");
    assert.match(v.$("kentei-feedback").textContent, /記録しました/);
    await v.click("kentei-next");
  }
  assert.equal(v.sent.length, 1);
  assert.match(v.sent[0], /answers to grade/);
  assert.equal((v.sent[0].match(/— not graded/g) ?? []).length, 4);
  v.app.unmount();
});

test("reopening restores a game in progress from viewState", async () => {
  const v = await mount({ grading: "llm", runtime: null });
  await v.click("kentei-start-button");
  await v.type("葉緑体");
  await v.click("kentei-submit");
  await v.click("kentei-next");
  await v.type("下書き");
  const saved = v.updates.at(-1);
  v.app.unmount();

  const el = document.createElement("div");
  document.body.appendChild(el);
  const app = createApp({ render: () => h(plugin.viewComponent, { selectedResult: saved, sendTextMessage() {} }) });
  app.mount(el);
  await flush();
  assert.equal(el.querySelector('[data-testid="kentei-question-text"]').textContent, SAMPLE_SCRIPT.questions[1].question);
  assert.equal(el.querySelector('[data-testid="kentei-answer"]').value, "下書き");
  assert.match(el.textContent, /第 2 問/);
  app.unmount();
});

test("rules.timeLimitPerQuestion: the View counts down and submits what is in the box at 0", async () => {
  const script = structuredClone(SAMPLE_SCRIPT);
  script.rules.timeLimitPerQuestion = 1;
  const result = await executeKentei({}, script);
  const el = document.createElement("div");
  document.body.appendChild(el);
  let current = { ...result, toolName: "presentKentei", uuid: "t1" };
  const app = createApp({ render: () => h(plugin.viewComponent, { selectedResult: current, sendTextMessage() {}, onUpdateResult: (r) => (current = r) }) });
  app.mount(el);
  await flush();
  assert.match(el.textContent, /1 問 1 秒/);
  el.querySelector('[data-testid="kentei-start-button"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await flush();
  assert.match(el.querySelector('[data-testid="kentei-timer"]').textContent, /残り 1 秒/);
  const ta = el.querySelector('[data-testid="kentei-answer"]');
  ta.value = "時間切れの答え";
  ta.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1400));
  await flush();
  assert.ok(el.querySelector('[data-testid="kentei-feedback"]'), "submitted at 0");
  assert.equal(current.viewState.history[0].answer, "時間切れの答え");
  assert.equal(el.querySelector('[data-testid="kentei-timer"]'), null, "no countdown on the feedback screen");
  app.unmount();
});
