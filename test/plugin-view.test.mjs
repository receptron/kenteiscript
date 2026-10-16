// The manageKenteiScript View, as a host mounts it: the built dist/vue.js in a jsdom document, with a
// fake plugin runtime whose dispatch stands in for the server's JEV grading.
// Run `yarn build:plugin` first (CI does).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { JSDOM } from "jsdom";

const dist = new URL("../dist/vue.js", import.meta.url);
if (!existsSync(dist)) throw new Error("dist/vue.js is missing: run `yarn build:plugin` first");

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "Node", "Element", "HTMLElement", "SVGElement", "Event", "KeyboardEvent", "MutationObserver"]) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
}

const { createApp, h, nextTick, reactive } = await import("vue");
const { PLUGIN_RUNTIME_KEY } = await import("gui-chat-protocol/vue");
const { plugin, executeKentei: execute, MISSING_KEY_MESSAGE } = await import("../dist/vue.js");
const { SAMPLE_SCRIPT } = await import("../src/plugin/core/samples.ts");

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};

// The tool as a host with a TYPESAFE_API_KEY runs it (without one, present shows nothing at all).
const executeKentei = (context, args) => execute(context, args, { apiKey: "test-key" });

/** A runtime whose dispatch grades every answer correct, as the server would with a key. */
const correctRuntime = () => ({
  calls: [],
  async dispatch(args, parse) {
    this.calls.push(args);
    const q = args.script.questions.find((x) => x.id === args.questionId);
    const raw =
      q.jev.type === "Choice"
        ? { type: "Choice", result: "correct", probabilities: { correct: 0.9 }, credit: 1, points: q.level }
        : { type: "Score", result: 3, probabilities: { 3: 0.9 }, credit: 1, points: q.level };
    return parse ? parse(raw) : raw;
  },
});

/** Mounts a View for a result, with the runtime provided when one is given. */
function mountResult(selectedResult, { runtime = null, sendTextMessage = () => {}, onUpdateResult } = {}) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const errors = [];
  const app = createApp({ render: () => h(plugin.viewComponent, { selectedResult, sendTextMessage, onUpdateResult }) });
  if (runtime) app.provide(PLUGIN_RUNTIME_KEY, runtime);
  app.config.errorHandler = (e) => errors.push(e);
  app.mount(el);
  return { el, app, errors };
}

async function mount({ runtime, script = SAMPLE_SCRIPT, viewState }) {
  const result = await executeKentei({}, { action: "present", script: structuredClone(script) });
  const props = reactive({ selectedResult: { ...result, toolName: "manageKenteiScript", uuid: "u1", ...(viewState ? { viewState } : {}) } });
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
  return { el, $, click, type, sent, updates, app, props };
}

test("with a runtime and a key: each answer is graded through dispatch, and the result goes to the chat", async () => {
  const calls = [];
  const runtime = {
    async dispatch(args, parse) {
      calls.push(args);
      const q = args.script.questions.find((x) => x.id === args.questionId);
      const raw =
        q.jev.type === "Choice"
          ? { type: "Choice", result: "correct", probabilities: { correct: 0.93, close: 0.05, wrong: 0.02 }, credit: 1, points: q.level }
          : { type: "Score", result: 2, probabilities: { 0: 0.05, 1: 0.1, 2: 0.7, 3: 0.15 }, credit: 0.5, points: q.level * 0.5 };
      return parse ? parse(raw) : raw;
    },
  };
  const v = await mount({ runtime });
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

test("without a key on the server: the grade dispatch is refused, the View says so and does not go on", async () => {
  const calls = [];
  // What a host's dispatch rejects with when the plugin's server part throws MISSING_KEY_MESSAGE.
  const runtime = {
    dispatch: async (args) => {
      calls.push(args);
      throw new Error(MISSING_KEY_MESSAGE);
    },
  };
  const v = await mount({ runtime });
  await v.click("kentei-start-button");
  const question = v.$("kentei-question-text").textContent;
  for (let i = 0; i < 2; i++) {
    await v.type("酸素");
    await v.click("kentei-submit");
    assert.match(v.$("kentei-error").textContent, /採点の設定がありません（TYPESAFE_API_KEY）/);
    assert.equal(v.$("kentei-feedback"), null, "no feedback without a grade");
    assert.equal(v.$("kentei-question-text").textContent, question, "still on the same question");
    assert.ok(!v.el.textContent.includes("採点せずに"), "no way to go on ungraded");
  }
  assert.equal(calls.length, 2);
  assert.ok(
    v.updates.every((u) => u.viewState.history.length === 0),
    "nothing recorded",
  );
  assert.equal(v.sent.length, 0, "nothing sent to the chat");
  v.app.unmount();
});

test("in a host with no plugin runtime the View cannot grade: it says so and does not start", async () => {
  const v = await mount({ runtime: null });
  assert.match(v.$("kentei-no-grading").textContent, /採点できません/);
  assert.equal(v.$("kentei-start-button").disabled, true);
  await v.click("kentei-start-button");
  assert.ok(v.$("kentei-start"), "still on the start screen");
  assert.equal(v.$("kentei-question"), null);
  v.app.unmount();
});

test("a viewState saved by the removed LLM-grading fallback opens as a fresh game, without errors", async () => {
  const viewState = {
    phase: "question",
    mode: "llm",
    level: 3,
    currentId: "L2-01",
    history: [{ id: "L1-01", answer: "葉緑体", level: 3 }],
    draft: "x",
    titleChoice: null,
    sent: false,
  };
  const v = await mount({ runtime: correctRuntime(), viewState });
  assert.ok(v.$("kentei-start"), "back on the start screen");
  await v.click("kentei-start-button");
  await v.type("酸素");
  await v.click("kentei-submit");
  assert.ok(v.$("kentei-feedback"), "the new game is graded by JEV");
  assert.equal(v.updates.at(-1).viewState.history.length, 1);
  assert.ok(v.updates.at(-1).viewState.history[0].grade);
  assert.ok(!("mode" in v.updates.at(-1).viewState));
  v.app.unmount();
});

test("reopening restores a game in progress from viewState", async () => {
  const v = await mount({ runtime: correctRuntime() });
  await v.click("kentei-start-button");
  await v.type("葉緑体");
  await v.click("kentei-submit");
  await v.click("kentei-next");
  await v.type("下書き");
  const saved = v.updates.at(-1);
  v.app.unmount();

  const { el, app } = mountResult(saved, { runtime: correctRuntime() });
  await flush();
  const q = SAMPLE_SCRIPT.questions.find((x) => x.id === saved.viewState.currentId);
  assert.equal(el.querySelector('[data-testid="kentei-question-text"]').textContent, q.question);
  assert.equal(el.querySelector('[data-testid="kentei-answer"]').value, "下書き");
  assert.match(el.textContent, /第 2 問/);
  app.unmount();
});

test("rules.timeLimitPerQuestion: the View counts down and submits what is in the box at 0", async () => {
  const script = structuredClone(SAMPLE_SCRIPT);
  script.rules.timeLimitPerQuestion = 1;
  const result = await executeKentei({}, { action: "present", script: script });
  const el = document.createElement("div");
  document.body.appendChild(el);
  let current = { ...result, toolName: "manageKenteiScript", uuid: "t1" };
  const app = createApp({ render: () => h(plugin.viewComponent, { selectedResult: current, sendTextMessage() {}, onUpdateResult: (r) => (current = r) }) });
  app.provide(PLUGIN_RUNTIME_KEY, correctRuntime());
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

test("a grading response that arrives after another game took over the View is dropped", async () => {
  let resolve;
  const runtime = {
    dispatch(args, parse) {
      return new Promise((r) => {
        resolve = () => r(parse({ type: "Choice", result: "correct", probabilities: { correct: 0.9 }, credit: 1, points: 2 }));
      });
    },
  };
  const v = await mount({ runtime });
  await v.click("kentei-start-button");
  await v.type("酸素");
  await v.click("kentei-submit");
  assert.match(v.$("kentei-submit").textContent, /採点中/);

  // The host selects another manageKenteiScript result while JEV is still grading.
  const other = structuredClone(SAMPLE_SCRIPT);
  other.meta.title = "別の検定";
  const next = await executeKentei({}, { action: "present", script: other });
  v.props.selectedResult = { ...next, toolName: "manageKenteiScript", uuid: "u2" };
  await flush();
  assert.match(v.el.textContent, /別の検定/);
  await v.click("kentei-start-button");
  const updatesBefore = v.updates.length;

  resolve();
  await flush();
  assert.ok(v.$("kentei-question"), "the new game is still on its first question");
  assert.equal(v.$("kentei-feedback"), null);
  assert.match(v.$("kentei-submit").textContent, /答える/, "the new game is not left in 採点中");
  assert.ok(
    v.updates.slice(updatesBefore).every((u) => u.viewState.history.length === 0),
    "the old grade is not recorded",
  );
  v.app.unmount();
});

test("a Score grade is shown out of the question's own rubric", async () => {
  const script = structuredClone(SAMPLE_SCRIPT);
  script.rules.credit.Score = [0, 0.5, 1];
  script.questions = script.questions.filter((q) => q.jev.type === "Score");
  script.questions[0].jev.criteria = ["無回答", "一部", "十分"];
  script.rules.questionsPerGame = 1;
  script.rules.minLevel = script.rules.startLevel = script.rules.maxLevel = script.questions[0].level;
  script.rules.grades = [{ grade: "A", min: 0, title: "ok" }];
  const runtime = { dispatch: async (args, parse) => parse({ type: "Score", result: 1, probabilities: { 0: 0.1, 1: 0.8, 2: 0.1 }, credit: 0.5, points: 1.5 }) };
  const v = await mount({ runtime, script });
  await v.click("kentei-start-button");
  await v.type("呼吸");
  await v.click("kentei-submit");
  const fb = v.$("kentei-feedback").textContent;
  assert.match(fb, /評価 1 \/ 2/);
  assert.doesNotMatch(fb, /もう一歩|\/ 3/, "the four-level words are not used for a three-level rubric");
  await v.click("kentei-next");
  assert.match(v.$("kentei-result").textContent, /評価 1 \/ 2/);
  assert.match(v.sent[0], /— 1\/2 \(0\.80\)/);
  v.app.unmount();
});

test("sendTextMessage returning false (no terminal took it) leaves the results unsent, with a resend button", async () => {
  // A host that refuses the first attempt, like MulmoTerminal with no terminal open.
  let accept = false;
  const tries = [];
  const el = document.createElement("div");
  document.body.appendChild(el);
  const result = await executeKentei({}, { action: "present", script: structuredClone(SAMPLE_SCRIPT) });
  let current = { ...result, toolName: "manageKenteiScript", uuid: "s1" };
  const app = createApp({
    render: () =>
      h(plugin.viewComponent, {
        selectedResult: current,
        sendTextMessage: (text) => {
          tries.push(text);
          return accept ? undefined : false;
        },
        onUpdateResult: (r) => (current = r),
      }),
  });
  app.provide(PLUGIN_RUNTIME_KEY, correctRuntime());
  app.mount(el);
  await flush();
  const $ = (id) => el.querySelector(`[data-testid="${id}"]`);
  const click = async (id) => {
    $(id).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await flush();
  };
  await click("kentei-start-button");
  for (let i = 0; i < 4; i++) {
    await click("kentei-submit");
    await click("kentei-next");
  }
  assert.equal(tries.length, 1, "sent automatically at the end");
  assert.ok($("kentei-result"));
  assert.equal($("kentei-sent").textContent, "", "no success text");
  assert.ok($("kentei-send-failed"), "the failure is shown");
  assert.ok($("kentei-send"), "the resend button stays");
  assert.equal(current.viewState.sent, false, "sent: true is not saved");

  accept = true; // a void host (undefined) counts as delivered
  await click("kentei-send");
  assert.equal(tries.length, 2);
  assert.equal(tries[1], tries[0], "the same results are sent again");
  assert.match(tries[1], /— result: /);
  assert.match($("kentei-sent").textContent, /送りました/);
  assert.equal($("kentei-send"), null);
  assert.equal($("kentei-send-failed"), null);
  assert.equal(current.viewState.sent, true);
  app.unmount();
});

test("an async sendTextMessage is awaited: Promise<false> or a rejection leaves the results unsent; Promise<true> sends", async () => {
  // A host like MulmoChat, whose sendTextMessage is async and resolves to false when the session is gone.
  const tries = [];
  let settle;
  const el = document.createElement("div");
  document.body.appendChild(el);
  const result = await executeKentei({}, { action: "present", script: structuredClone(SAMPLE_SCRIPT) });
  let current = { ...result, toolName: "manageKenteiScript", uuid: "s-async" };
  const app = createApp({
    render: () =>
      h(plugin.viewComponent, {
        selectedResult: current,
        sendTextMessage: (text) => {
          tries.push(text);
          return new Promise((resolve, reject) => (settle = { resolve, reject }));
        },
        onUpdateResult: (r) => (current = r),
      }),
  });
  app.provide(PLUGIN_RUNTIME_KEY, correctRuntime());
  app.mount(el);
  await flush();
  const $ = (id) => el.querySelector(`[data-testid="${id}"]`);
  const click = async (id) => {
    $(id).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await flush();
  };
  await click("kentei-start-button");
  for (let i = 0; i < 4; i++) {
    await click("kentei-submit");
    await click("kentei-next");
  }
  assert.equal(tries.length, 1, "sent automatically at the end");
  assert.equal($("kentei-sent").textContent, "", "not reported as sent while the Promise is pending");
  assert.equal($("kentei-send").disabled, true, "the button waits for the pending send");
  await click("kentei-send");
  assert.equal(tries.length, 1, "no second send while one is in flight");

  settle.resolve(false);
  await flush();
  assert.equal($("kentei-sent").textContent, "", "Promise<false> is not delivered");
  assert.ok($("kentei-send-failed"), "the failure is shown");
  assert.equal($("kentei-send").disabled, false, "the resend button is usable again");
  assert.equal(current.viewState.sent, false);

  await click("kentei-send");
  assert.equal(tries.length, 2);
  settle.reject(new Error("socket closed"));
  await flush();
  assert.ok($("kentei-send-failed"), "a rejected Promise is not delivered either");
  assert.equal(current.viewState.sent, false);

  await click("kentei-send");
  assert.equal(tries.length, 3);
  assert.equal(tries[2], tries[0], "the same results are sent again");
  settle.resolve(true);
  await flush();
  assert.match($("kentei-sent").textContent, /送りました/);
  assert.equal($("kentei-send"), null);
  assert.equal($("kentei-send-failed"), null);
  assert.equal(current.viewState.sent, true);
  app.unmount();
});

test("clearing selectedResult while a send is pending: the late result does not mark the old game as sent", async () => {
  let settle;
  const el = document.createElement("div");
  document.body.appendChild(el);
  const result = await executeKentei({}, { action: "present", script: structuredClone(SAMPLE_SCRIPT) });
  const host = reactive({ current: { ...result, toolName: "manageKenteiScript", uuid: "s-clear" } });
  const app = createApp({
    render: () =>
      h(plugin.viewComponent, {
        selectedResult: host.current,
        sendTextMessage: () => new Promise((resolve) => (settle = resolve)),
        onUpdateResult: (r) => (host.current = r),
      }),
  });
  app.provide(PLUGIN_RUNTIME_KEY, correctRuntime());
  app.mount(el);
  await flush();
  const $ = (id) => el.querySelector(`[data-testid="${id}"]`);
  const click = async (id) => {
    $(id).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await flush();
  };
  await click("kentei-start-button");
  for (let i = 0; i < 4; i++) {
    await click("kentei-submit");
    await click("kentei-next");
  }
  assert.equal($("kentei-sent").textContent, "", "the automatic send is pending");
  host.current = null; // the host clears the selection but keeps the View mounted
  await flush();
  settle(true);
  await flush();
  assert.equal($("kentei-sent").textContent, "", "the late result did not mark the detached game as sent");
  app.unmount();
});

test("unmounting while a grade is pending stops everything: no timer restart, no second paid grade", async () => {
  const script = structuredClone(SAMPLE_SCRIPT);
  script.rules.timeLimitPerQuestion = 1;
  let reject;
  let calls = 0;
  const runtime = {
    dispatch() {
      calls++;
      return new Promise((_, r) => (reject = r));
    },
  };
  const v = await mount({ runtime, script });
  await v.click("kentei-start-button");
  await v.type("酸素");
  await v.click("kentei-submit");
  assert.equal(calls, 1);
  v.app.unmount();
  reject(new Error("network"));
  await new Promise((r) => setTimeout(r, 1500)); // longer than the 1-second limit
  await flush();
  assert.equal(calls, 1, "a closed View sends no more grading requests");
});

test("a saved game reopened in a host with no runtime stays where it was and records nothing", async () => {
  const v = await mount({ runtime: correctRuntime() });
  await v.click("kentei-start-button");
  await v.type("酸素");
  await v.click("kentei-submit");
  await v.click("kentei-next");
  const saved = v.updates.at(-1);
  v.app.unmount();

  // Same result, no runtime this time (e.g. a host without the plugin runtime).
  let current = saved;
  const sent = [];
  const { el, app, errors } = mountResult(saved, { sendTextMessage: (t) => sent.push(t), onUpdateResult: (r) => (current = r) });
  await flush();
  el.querySelector('[data-testid="kentei-submit"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await flush();
  assert.deepEqual(errors.map(String), []);
  assert.match(el.querySelector('[data-testid="kentei-error"]').textContent, /採点できません/);
  assert.equal(el.querySelector('[data-testid="kentei-feedback"]'), null);
  assert.equal(current.viewState.history.length, 1, "nothing recorded without a grade");
  assert.equal(sent.length, 0);
  app.unmount();
});

test("reopening a saved timed quiz on a question restores it and starts the countdown", async () => {
  const script = structuredClone(SAMPLE_SCRIPT);
  script.rules.timeLimitPerQuestion = 30;
  const first = await mount({ runtime: correctRuntime(), script });
  await first.click("kentei-start-button");
  await first.type("下書き");
  const saved = first.updates.at(-1);
  assert.equal(saved.viewState.phase, "question");
  first.app.unmount();

  const { el, app, errors } = mountResult(saved, { runtime: correctRuntime() });
  await flush();
  assert.deepEqual(errors.map(String), []);
  assert.ok(el.querySelector('[data-testid="kentei-question"]'), "the question is back");
  assert.equal(el.querySelector('[data-testid="kentei-answer"]').value, "下書き");
  assert.match(el.querySelector('[data-testid="kentei-timer"]')?.textContent ?? "", /残り 30 秒/);
  app.unmount();
});

test("after a failed grade the player can only retry: 答える again grades the answer", async () => {
  let fail = true;
  const ok = correctRuntime();
  const runtime = {
    calls: 0,
    async dispatch(args, parse) {
      this.calls++;
      if (fail) throw new Error("JEV down");
      return ok.dispatch(args, parse);
    },
  };
  const v = await mount({ runtime });
  await v.click("kentei-start-button");
  await v.type("酸素");
  await v.click("kentei-submit");
  assert.match(v.$("kentei-error").textContent, /採点できませんでした（JEV down）。もう一度「答える」を押してください。/);
  assert.ok(![...v.el.querySelectorAll("button")].some((b) => b.textContent.includes("採点せず")), "no button to go on ungraded");
  assert.equal(v.$("kentei-feedback"), null);
  assert.equal(v.$("kentei-answer").value, "酸素", "the answer stays in the box");
  fail = false;
  await v.click("kentei-submit");
  assert.equal(runtime.calls, 2);
  assert.ok(v.$("kentei-feedback"), "graded on retry");
  assert.equal(v.$("kentei-error"), null);
  const last = v.updates.at(-1).viewState;
  assert.equal(last.history.length, 1);
  assert.equal(last.history[0].answer, "酸素");
  assert.ok(last.history[0].grade);
  v.app.unmount();
});

test("two quiz cards with titleChoices on one page keep separate title choices", async () => {
  const script = structuredClone(SAMPLE_SCRIPT);
  script.rules.grades[0] = { ...script.rules.grades[0], titleChoices: ["光合成博士", "光合成名人"] };
  const a = await mount({ runtime: correctRuntime(), script });
  const b = await mount({ runtime: correctRuntime(), script });
  const radios = (v) => [...v.el.querySelectorAll('input[type="radio"]')];
  assert.notEqual(radios(a)[0].name, radios(b)[0].name, "each card has its own radio group");
  const pick = async (v, label) => {
    const input = radios(v).find((r) => r.parentElement.textContent.includes(label));
    input.checked = true;
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await flush();
  };
  await pick(a, "光合成博士");
  await pick(b, "光合成名人");
  assert.ok(radios(a).find((r) => r.parentElement.textContent.includes("光合成博士")).checked, "card A keeps its choice");
  assert.equal(a.updates.at(-1).viewState.titleChoice, "光合成博士");
  assert.equal(b.updates.at(-1).viewState.titleChoice, "光合成名人");
  a.app.unmount();
  b.app.unmount();
});
