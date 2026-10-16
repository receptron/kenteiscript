// The rules of a KenteiScript game: how the level moves, what an answer is worth, which question
// comes next, and which grade and title a total earns. Pure functions with no Worker, Node, DOM or
// Zod dependency, shared by everything that plays a KenteiScript:
//
//   - the MulmoKentei Worker (src/grading.ts uses gradeFor),
//   - the MulmoKentei page, which loads a copy built from this file (public/game.js, written by
//     scripts/gen-game.mjs before every `wrangler dev` / deploy),
//   - the chat plugin's View (src/plugin/vue/View.vue).
//
// Keep it erasable TypeScript (types only, no enums or namespaces): the page's copy is this file
// with the types stripped, and the Node tests import it directly.
import type { Grade, Question, Rules } from "./kentei-script.ts";

/** The kind of grade an answer got: a Choice label or a Score level. */
export type GradeType = "Choice" | "Score";

/** The credit a graded answer earns, from rules.credit. An unknown label or level earns 0. */
export function creditFor(rules: Pick<Rules, "credit">, type: GradeType, result: string | number): number {
  const credit = type === "Choice" ? rules.credit.Choice[String(result)] : rules.credit.Score[Number(result)];
  return typeof credit === "number" ? credit : 0;
}

/** Points for an answer: level × credit. */
export function pointsFor(level: number, credit: number): number {
  return level * credit;
}

/**
 * How the next question's level moves after an answer with this credit: full credit (1) moves up,
 * at least half credit keeps the level, anything less moves down. With the usual credits that is
 * correct / close / wrong for Choice and levels 3 / 2 / 0-1 for Score.
 */
export function levelStep(credit: number): -1 | 0 | 1 {
  if (credit >= 1) return 1;
  if (credit >= 0.5) return 0;
  return -1;
}

/** The level after an answer, kept within rules.minLevel..rules.maxLevel. */
export function nextLevel(rules: Pick<Rules, "minLevel" | "maxLevel">, level: number, credit: number): number {
  return Math.min(rules.maxLevel, Math.max(rules.minLevel, level + levelStep(credit)));
}

/**
 * A random unused question at this level; if the level has run out, a random one from the nearest
 * level that still has one. Undefined when every question has been used.
 */
export function pickQuestion<Q extends Pick<Question, "id" | "level">>(
  questions: readonly Q[],
  used: ReadonlySet<string> | readonly string[],
  level: number,
  random: () => number = Math.random,
): Q | undefined {
  const isUsed = (id: string) => ("has" in used ? used.has(id) : used.includes(id));
  const unused = questions.filter((q) => !isUsed(q.id));
  if (!unused.length) return undefined;
  const distance = (q: Q) => Math.abs(q.level - level);
  const nearest = Math.min(...unused.map(distance));
  const pool = unused.filter((q) => distance(q) === nearest);
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/** The grade a total earns: the first in rules.grades (highest first) whose min it reaches. */
export function gradeFor<G extends Pick<Grade, "min">>(grades: readonly G[], points: number): G {
  return grades.find((g) => points >= g.min) ?? grades[grades.length - 1]!;
}

/** The title shown for a grade: the player's pick when the grade has titleChoices, else its title. */
export function titleOf(grade: Pick<Grade, "title" | "titleChoices">, choice?: string | null): string {
  return grade.titleChoices && choice && grade.titleChoices.includes(choice) ? choice : grade.title;
}

/**
 * The most points a game can reach: every answer earns full credit, so the level climbs one step
 * per question from startLevel and stays at maxLevel.
 */
export function maxPoints(rules: Pick<Rules, "questionsPerGame" | "startLevel" | "maxLevel">): number {
  let total = 0;
  for (let i = 0; i < rules.questionsPerGame; i++) total += Math.min(rules.maxLevel, rules.startLevel + i);
  return total;
}

/** Points as the player sees them: whole numbers as is, halves with one decimal. */
export function formatPoints(points: number): string {
  return points % 1 ? points.toFixed(1) : String(points);
}
