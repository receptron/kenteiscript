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

const usualCredit = { Choice: { correct: 1, close: 0.5, wrong: 0 }, Score: [0, 0, 0.5, 1] };
const rules = { minLevel: 1, maxLevel: 5, startLevel: 3, questionsPerGame: 10, credit: usualCredit };

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
  assert.equal(game.formatPoints(2.5), "2.5");
  assert.equal(game.formatPoints(3), "3");
});

const levels = (...ls: number[]) => ls.map((level) => ({ level, written: false }));

test("maxPoints replays an all-correct game with the script's own questions", () => {
  // Enough questions at every level: the level climbs 3, 4, 5, 5, …
  assert.equal(game.maxPoints(rules, levels(...Array(10).fill(3), ...Array(10).fill(4), ...Array(10).fill(5))), 47);
  // The ★5s run out after two: the rest come from ★4, the nearest level left.
  assert.equal(game.maxPoints(rules, levels(...Array(10).fill(3), ...Array(10).fill(4), 5, 5)), 3 + 4 + 5 + 5 + 4 * 6);
  // Fewer questions than questionsPerGame: the game ends when they run out.
  assert.equal(game.maxPoints(rules, levels(3, 4)), 7);
  // A tie (★2 and ★4 equally near ★3): both branches are tried. With two questions both orders
  // give 6; with one, the better branch (★4) is kept.
  const tie = { questionsPerGame: 2, startLevel: 3, minLevel: 1, maxLevel: 3, credit: usualCredit };
  assert.equal(game.maxPoints(tie, levels(2, 4)), 6);
  assert.equal(game.maxPoints({ ...tie, questionsPerGame: 1 }, levels(2, 4)), 4);
});

test("maxPoints uses the best credit rules.credit allows, and the level move that credit implies", () => {
  // Choice tops out at 0.5, which keeps the level: three ★1 answers at 0.5 each, never climbing.
  const half = { questionsPerGame: 3, startLevel: 1, minLevel: 1, maxLevel: 3, credit: { Choice: { correct: 0.5, wrong: 0 }, Score: [0, 1] } };
  assert.equal(game.maxPoints(half, levels(1, 1, 1, 2, 2, 2, 3, 3, 3)), 1.5);
  // Choice and Score can differ: a ★1 Choice at credit 1 climbs to ★2, where Score tops out at 0.5.
  const mixed = { questionsPerGame: 2, startLevel: 1, minLevel: 1, maxLevel: 2, credit: { Choice: { correct: 1, wrong: 0 }, Score: [0, 0.5] } };
  assert.equal(game.maxPoints(mixed, [{ level: 1, written: false }, { level: 2, written: true }]), 1 + 1);
  // The page's public questions say `written`; a KenteiScript's say jev.type. Both work.
  assert.equal(game.maxPoints(mixed, [{ level: 1, jev: { type: "Choice" } }, { level: 2, jev: { type: "Score" } }]), 2);
  // A Score ladder whose top is 0.75 (stay): five ★2 questions at 1.5 each.
  const ladder = { questionsPerGame: 5, startLevel: 2, minLevel: 1, maxLevel: 3, credit: { Choice: { correct: 1, wrong: 0 }, Score: [0, 0.25, 0.75] } };
  const written = (...ls: number[]) => ls.map((level) => ({ level, written: true }));
  assert.equal(game.maxPoints(ladder, written(1, 2, 2, 2, 2, 2, 3, 3)), 7.5);
});

// The result screen used to show 3 + 4 + 5 × (n − 2). For the real quizzes nothing changes but
// example, where that formula assumed start 3 / max 5.
test("maxPoints of the quizzes in quizzes/", () => {
  const got = Object.fromEntries(quizzes.map(([f, q]) => [f, game.maxPoints(q.rules, q.questions)]));
  assert.deepEqual(got, { "example.json": 14, "ml.json": 47, "nihongo.json": 47, "sengoku.json": 47 });
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
  for (const [, q] of quizzes) assert.equal(page.maxPoints(q.rules, q.questions), game.maxPoints(q.rules, q.questions));
});
