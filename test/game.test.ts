// The shared game rules (src/game.ts), and the page's copy of them (public/game.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as game from "../src/game.ts";
import type { KenteiScript } from "../src/kentei-script.ts";

const root = new URL("..", import.meta.url).pathname;
const quizzes: [string, KenteiScript][] = readdirSync(join(root, "quizzes"))
  .filter((f) => f.endsWith(".json") && !f.endsWith(".tests.json"))
  .map((f) => [f, JSON.parse(readFileSync(join(root, "quizzes", f), "utf8")) as KenteiScript]);

const rules = { minLevel: 1, maxLevel: 5, startLevel: 3, questionsPerGame: 10 };

test("levelStep: full credit up, at least half stays, less down", () => {
  assert.equal(game.levelStep(1), 1);
  assert.equal(game.levelStep(0.5), 0);
  assert.equal(game.levelStep(0.75), 0);
  assert.equal(game.levelStep(0.49), -1);
  assert.equal(game.levelStep(0), -1);
});

// The page used to move by label (correct / close, Score 3 / 2). Moving by credit must give the
// same moves for every KenteiScript in quizzes/, so MulmoKentei plays exactly as before.
test("levelStep by credit matches the page's old label rule for every quiz", () => {
  const oldMove = (type: string, result: string | number) =>
    type === "Choice" ? (result === "correct" ? 1 : result === "close" ? 0 : -1) : Number(result) === 3 ? 1 : Number(result) === 2 ? 0 : -1;
  for (const [file, quiz] of quizzes) {
    for (const label of Object.keys(quiz.rules.credit.Choice)) {
      assert.equal(game.levelStep(game.creditFor(quiz.rules, "Choice", label)), oldMove("Choice", label), `${file} Choice ${label}`);
    }
    quiz.rules.credit.Score.forEach((_, level) => {
      assert.equal(game.levelStep(game.creditFor(quiz.rules, "Score", level)), oldMove("Score", level), `${file} Score ${level}`);
    });
  }
});

test("nextLevel stays within minLevel..maxLevel", () => {
  assert.equal(game.nextLevel(rules, 3, 1), 4);
  assert.equal(game.nextLevel(rules, 5, 1), 5);
  assert.equal(game.nextLevel(rules, 1, 0), 1);
  assert.equal(game.nextLevel(rules, 3, 0.5), 3);
});

test("creditFor and pointsFor", () => {
  const r = { credit: { Choice: { correct: 1, close: 0.5, wrong: 0 }, Score: [0, 0, 0.5, 1] } };
  assert.equal(game.creditFor(r, "Choice", "close"), 0.5);
  assert.equal(game.creditFor(r, "Score", 3), 1);
  assert.equal(game.creditFor(r, "Score", "2"), 0.5);
  assert.equal(game.creditFor(r, "Choice", "nonsense"), 0);
  assert.equal(game.pointsFor(4, 0.5), 2);
});

test("pickQuestion: an unused question at the level, else the nearest level", () => {
  const qs = [
    { id: "a", level: 1 },
    { id: "b", level: 3 },
    { id: "c", level: 3 },
    { id: "d", level: 5 },
  ];
  assert.equal(game.pickQuestion(qs, [], 3, () => 0)?.id, "b");
  assert.equal(game.pickQuestion(qs, [], 3, () => 0.99)?.id, "c");
  assert.equal(game.pickQuestion(qs, new Set(["b", "c"]), 3, () => 0)?.id, "a"); // 1 and 5 are both 2 away: random picks from both
  assert.equal(game.pickQuestion(qs, new Set(["b", "c"]), 3, () => 0.99)?.id, "d");
  assert.equal(game.pickQuestion(qs, ["b", "c", "d"], 4, () => 0.5)?.id, "a");
  assert.equal(game.pickQuestion(qs, ["a", "b", "c", "d"], 3), undefined);
});

test("gradeFor, titleOf, maxPoints", () => {
  const grades = [
    { grade: "A", min: 10, title: "名人", titleChoices: ["歴女", "歴男"] },
    { grade: "B", min: 5, title: "達人" },
    { grade: "C", min: 0, title: "見習い" },
  ];
  assert.equal(game.gradeFor(grades, 12).grade, "A");
  assert.equal(game.gradeFor(grades, 5).grade, "B");
  assert.equal(game.gradeFor(grades, 4.5).grade, "C");
  assert.equal(game.titleOf(grades[0]!, "歴女"), "歴女");
  assert.equal(game.titleOf(grades[0]!, null), "名人");
  assert.equal(game.titleOf(grades[0]!, "勝手な称号"), "名人");
  assert.equal(game.titleOf(grades[1]!, "歴女"), "達人");
  // The page used to show 3 + 4 + 5 × (n − 2), right only for start 3 / max 5.
  assert.equal(game.maxPoints(rules), 47);
  assert.equal(game.maxPoints({ questionsPerGame: 5, startLevel: 2, maxLevel: 3 }), 14);
  assert.equal(game.formatPoints(2.5), "2.5");
  assert.equal(game.formatPoints(3), "3");
});

test("public/game.js is src/game.ts with the types stripped", async () => {
  execFileSync(process.execPath, [join(root, "scripts", "gen-game.mjs")], { stdio: "ignore" });
  const page = await import(join(root, "public", "game.js"));
  assert.deepEqual(Object.keys(page).sort(), Object.keys(game).sort());
  const qs = [
    { id: "a", level: 2 },
    { id: "b", level: 4 },
  ];
  assert.equal(page.pickQuestion(qs, new Set(["a"]), 1, () => 0).id, game.pickQuestion(qs, new Set(["a"]), 1, () => 0)?.id);
  for (const c of [0, 0.25, 0.5, 1]) assert.equal(page.nextLevel(rules, 3, c), game.nextLevel(rules, 3, c));
  assert.equal(page.maxPoints(rules), game.maxPoints(rules));
});
