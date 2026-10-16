// Picking the grade out of JEV's probabilities (src/jev-grade.ts), and gradeAnswer refusing a
// response that names none of the grades it asked for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gradeLabels, mostLikelyLabel } from "../src/jev-grade.ts";
import { gradeAnswer } from "../src/grading.ts";
import { defaultCredit } from "../src/game.ts";
import { parseKenteiScript } from "../src/kentei-script.ts";

const CHOICE = ["correct", "close", "wrong"];
const SCORE = ["0", "1", "2", "3"];

test("gradeLabels: Choice labels and Score levels from rules.credit", () => {
  assert.deepEqual(gradeLabels({ credit: defaultCredit() }, "Choice"), CHOICE);
  assert.deepEqual(gradeLabels({ credit: defaultCredit() }, "Score"), SCORE);
});

test("mostLikelyLabel: the most likely expected label", () => {
  assert.equal(mostLikelyLabel({ correct: 0.1, close: 0.7, wrong: 0.2 }, CHOICE), "close");
  assert.equal(mostLikelyLabel({ "0": 0.05, "1": 0.15, "2": 0.3, "3": 0.5 }, SCORE), "3");
  assert.equal(mostLikelyLabel({ wrong: 1 }, CHOICE), "wrong");
});

test("mostLikelyLabel: a tie goes to the first label in the response", () => {
  assert.equal(mostLikelyLabel({ close: 0.5, correct: 0.5 }, CHOICE), "close");
  assert.equal(mostLikelyLabel({ correct: 0.5, close: 0.5 }, CHOICE), "correct");
});

test("mostLikelyLabel: a label JEV was not asked for is never the grade", () => {
  assert.equal(mostLikelyLabel({ maybe: 0.9, wrong: 0.1 }, CHOICE), "wrong");
  assert.equal(mostLikelyLabel({ "4": 0.9, "1": 0.1 }, SCORE), "1");
});

test("mostLikelyLabel: undefined when JEV gave none of the labels", () => {
  assert.equal(mostLikelyLabel({}, CHOICE), undefined);
  assert.equal(mostLikelyLabel({ maybe: 1 }, CHOICE), undefined);
  assert.equal(mostLikelyLabel({ correct: 1 }, []), undefined);
});

const root = new URL("..", import.meta.url).pathname;
const quiz = parseKenteiScript(JSON.parse(readFileSync(join(root, "quizzes", "example.json"), "utf8")), "quizzes/example.json");
const choice = quiz.questions.find((q) => q.jev.type === "Choice");
const score = quiz.questions.find((q) => q.jev.type === "Score");

async function gradeWith(probabilities: Record<string, number>, type: "Choice" | "Score") {
  const q = type === "Choice" ? choice : score;
  assert.ok(q, `example.json has a ${type} question`);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ answers: { grade: { probabilities } } }));
  try {
    return await gradeAnswer(quiz, q, "an answer", { apiKey: "test" });
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("gradeAnswer: an empty or unknown-only response is an error, not a grade", async () => {
  for (const type of ["Choice", "Score"] as const) {
    await assert.rejects(gradeWith({}, type), /^Error: JEV gave none of the grades/);
    await assert.rejects(gradeWith({ maybe: 1 }, type), /^Error: JEV gave none of the grades/);
  }
});

test("gradeAnswer: grades from the expected labels only", async () => {
  const c = await gradeWith({ maybe: 0.9, correct: 0.1 }, "Choice");
  assert.equal(c.result, "correct");
  const s = await gradeWith({ "9": 0.9, "2": 0.1 }, "Score");
  assert.equal(s.result, 2);
});
