// Picking the grade out of JEV's probabilities (src/jev-grade.ts), and gradeAnswer refusing a
// response that names none of the grades it asked for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gradeLabels, mostLikelyLabel } from "../src/jev-grade.ts";
import { gradeAnswer } from "../src/grading.ts";
import { parseKenteiScript } from "../src/kentei-script.ts";

const CHOICE = ["correct", "close", "wrong"];
const SCORE = ["0", "1", "2", "3"];

test("gradeLabels: Choice labels and Score levels from the criteria JEV is asked with", () => {
  assert.deepEqual(gradeLabels({ type: "Choice", criteria: { correct: "c", close: "n", wrong: "w" } }), CHOICE);
  assert.deepEqual(gradeLabels({ type: "Score", criteria: ["a", "b", "c", "d"] }), SCORE);
});

test("mostLikelyLabel: the most likely expected label", () => {
  assert.equal(mostLikelyLabel({ correct: 0.1, close: 0.7, wrong: 0.2 }, CHOICE), "close");
  assert.equal(mostLikelyLabel({ "0": 0.05, "1": 0.15, "2": 0.3, "3": 0.5 }, SCORE), "3");
  assert.equal(mostLikelyLabel({ wrong: 1 }, CHOICE), "wrong");
});

test("mostLikelyLabel: a tie goes to the first expected label, whatever the response's key order", () => {
  assert.equal(mostLikelyLabel({ close: 0.5, correct: 0.5 }, CHOICE), "correct");
  assert.equal(mostLikelyLabel({ correct: 0.5, close: 0.5 }, CHOICE), "correct");
  assert.equal(mostLikelyLabel({ "3": 0.5, "2": 0.5 }, SCORE), "2");
});

test("mostLikelyLabel: a less likely label JEV was not asked for is ignored", () => {
  assert.equal(mostLikelyLabel({ maybe: 0.1, wrong: 0.9 }, CHOICE), "wrong");
  assert.equal(mostLikelyLabel({ "4": 0.1, "1": 0.9 }, SCORE), "1");
});

test("mostLikelyLabel: undefined when a label JEV was not asked for is as likely as the grade", () => {
  assert.equal(mostLikelyLabel({ maybe: 0.9, wrong: 0.1 }, CHOICE), undefined);
  assert.equal(mostLikelyLabel({ Correct: 0.5, wrong: 0.5 }, CHOICE), undefined);
  assert.equal(mostLikelyLabel({ "4": 0.9, "1": 0.1 }, SCORE), undefined);
});

test("mostLikelyLabel: undefined when a probability is not a finite number", () => {
  assert.equal(mostLikelyLabel({ correct: "abc", wrong: 0.9 }, CHOICE), undefined);
  assert.equal(mostLikelyLabel({ correct: true, wrong: 0.5 }, CHOICE), undefined);
  assert.equal(mostLikelyLabel({ correct: null, wrong: 0.5 }, CHOICE), undefined);
  assert.equal(mostLikelyLabel({ correct: NaN, wrong: 0.5 }, CHOICE), undefined);
});

test("mostLikelyLabel: undefined when JEV gave none of the labels", () => {
  assert.equal(mostLikelyLabel({}, CHOICE), undefined);
  assert.equal(mostLikelyLabel({ maybe: 1 }, CHOICE), undefined);
  assert.equal(mostLikelyLabel({ correct: 1 }, []), undefined);
  assert.equal(mostLikelyLabel({ constructor: 1 }, ["constructor"]), "constructor");
});

const root = new URL("..", import.meta.url).pathname;
const quiz = parseKenteiScript(JSON.parse(readFileSync(join(root, "quizzes", "example.json"), "utf8")), "quizzes/example.json");
const choice = quiz.questions.find((q) => q.jev.type === "Choice");
const score = quiz.questions.find((q) => q.jev.type === "Score");

async function gradeWith(probabilities: Record<string, unknown>, type: "Choice" | "Score") {
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

test("gradeAnswer: a response with no usable grade is an error, not a grade", async () => {
  for (const type of ["Choice", "Score"] as const) {
    for (const probabilities of [{}, { maybe: 1 }, { maybe: 0.9, wrong: 0.1, "0": 0.1 }]) {
      await assert.rejects(gradeWith(probabilities, type), /^Error: JEV gave no usable grade/);
    }
  }
  await assert.rejects(gradeWith({ correct: "abc", close: 0, wrong: 0.9 }, "Choice"), /^Error: JEV gave no usable grade/);
});

test("gradeAnswer: grades from the expected labels when they outrank the rest", async () => {
  const c = await gradeWith({ maybe: 0.1, correct: 0.9 }, "Choice");
  assert.equal(c.result, "correct");
  const s = await gradeWith({ "9": 0.1, "2": 0.9 }, "Score");
  assert.equal(s.result, 2);
});
