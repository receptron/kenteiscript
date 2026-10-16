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

/** A question as maxPoints needs it: its level, and whether it is graded as Choice or Score. */
export type ScoredQuestion = Pick<Question, "level"> & ({ jev: { type: GradeType } } | { written: boolean });

const gradeTypeOf = (q: ScoredQuestion): GradeType => ("jev" in q ? q.jev.type : q.written ? "Score" : "Choice");

/** The best credit an answer to a question of this type can earn, from rules.credit. */
function bestCredit(rules: Pick<Rules, "credit">, type: GradeType): number {
  const credits = type === "Choice" ? Object.values(rules.credit.Choice) : rules.credit.Score;
  return Math.max(0, ...credits);
}

/**
 * The points of an all-best-answers game: a replay in which every answer earns the best credit
 * rules.credit allows for its question's type, the level moves as that credit implies (levelStep),
 * and each question is the one pickQuestion would ask, made deterministic: an unused question at
 * the game's level, else from the nearest level that has one, preferring the higher level on a tie
 * and, within a level, the question worth more (then script order). Points come from the level of
 * the question actually asked, so a small script whose levels run out reaches less than its levels
 * alone suggest, and a script whose best credit is below 1 does not climb.
 *
 * This is what the result screen shows as the maximum and what the unreachable-grade warning uses.
 * It equals the true maximum for the sample quizzes, but it is not proven to be the maximum for
 * every script: a game that took a lower credit, or a random tie-break, could in rare pools reach
 * more. It runs in O(questions × questionsPerGame).
 */
export function maxPoints(
  rules: Pick<Rules, "questionsPerGame" | "startLevel" | "minLevel" | "maxLevel" | "credit">,
  questions: readonly ScoredQuestion[],
): number {
  const best = questions.map((q) => bestCredit(rules, gradeTypeOf(q)));
  const used = new Array<boolean>(questions.length).fill(false);
  let level = rules.startLevel;
  let total = 0;
  for (let step = 0; step < rules.questionsPerGame; step++) {
    let pick = -1;
    for (let i = 0; i < questions.length; i++) {
      if (used[i]) continue;
      if (pick < 0) {
        pick = i;
        continue;
      }
      const d = Math.abs(questions[i]!.level - level);
      const dp = Math.abs(questions[pick]!.level - level);
      const better =
        d < dp ||
        (d === dp && questions[i]!.level > questions[pick]!.level) ||
        (d === dp && questions[i]!.level === questions[pick]!.level && best[i]! > best[pick]!);
      if (better) pick = i;
    }
    if (pick < 0) break;
    used[pick] = true;
    total += pointsFor(questions[pick]!.level, best[pick]!);
    level = nextLevel(rules, level, best[pick]!);
  }
  return total;
}

/** Points as the player sees them: whole numbers as is, halves with one decimal. */
export function formatPoints(points: number): string {
  return points % 1 ? points.toFixed(1) : String(points);
}
