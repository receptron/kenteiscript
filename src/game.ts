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

/**
 * The best credit an answer of this type can earn for each way it moves the level (up, stay,
 * down), from rules.credit. Within one move a higher credit always earns more and leads to the
 * same next level, so these are the only answers worth trying.
 */
function bestAnswers(rules: Pick<Rules, "credit">, type: GradeType): { step: number; credit: number }[] {
  const credits = type === "Choice" ? Object.values(rules.credit.Choice) : rules.credit.Score;
  const best = new Map<number, number>();
  for (const c of credits) best.set(levelStep(c), Math.max(best.get(levelStep(c)) ?? 0, c));
  return [...best].map(([step, credit]) => ({ step, credit }));
}

/**
 * The most points a game of this script can reach. It replays games with the script's actual
 * questions and pickQuestion's rule (an unused question at the game's level, else one from the
 * nearest level that has one), and keeps the best total over every choice a game can take:
 *
 *   - the answer: for each level move (up, stay, down), the best credit that move allows for the
 *     question's type in rules.credit. Usually that is credit 1 every time, climbing one level per
 *     question; a script whose best Choice or Score credit is below 1 cannot climb on those
 *     questions, and earns at most level × that credit for them;
 *   - the pick, where pickQuestion picks at random: a tie between the levels above and below, and
 *     Choice vs Score within a level (which question of one level and type changes nothing).
 *
 * Points come from the level of the question actually asked, so a small script whose levels run
 * out reaches less than its levels alone suggest. The search is exhaustive, memoized on (step,
 * level, questions left per level and type), so the result is exact and deterministic.
 */
export function maxPoints(
  rules: Pick<Rules, "questionsPerGame" | "startLevel" | "minLevel" | "maxLevel" | "credit">,
  questions: readonly ScoredQuestion[],
): number {
  const kinds: { level: number; type: GradeType; answers: { step: number; credit: number }[]; left: number }[] = [];
  for (const q of questions) {
    const type = gradeTypeOf(q);
    const kind = kinds.find((k) => k.level === q.level && k.type === type);
    if (kind) kind.left++;
    else kinds.push({ level: q.level, type, answers: bestAnswers(rules, type), left: 1 });
  }
  const memo = new Map<string, number>();
  const best = (step: number, level: number): number => {
    if (step >= rules.questionsPerGame) return 0;
    const distance = kinds.map((k) => (k.left > 0 ? Math.abs(k.level - level) : Infinity));
    const nearest = Math.min(...distance);
    if (nearest === Infinity) return 0;
    const key = `${step}:${level}:${kinds.map((k) => k.left).join(",")}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let top = 0;
    kinds.forEach((k, i) => {
      if (distance[i] !== nearest) return;
      k.left--;
      for (const a of k.answers) {
        const next = Math.min(rules.maxLevel, Math.max(rules.minLevel, level + a.step));
        top = Math.max(top, pointsFor(k.level, a.credit) + best(step + 1, next));
      }
      k.left++;
    });
    memo.set(key, top);
    return top;
  };
  return best(0, rules.startLevel);
}

/** Points as the player sees them: whole numbers as is, halves with one decimal. */
export function formatPoints(points: number): string {
  return points % 1 ? points.toFixed(1) : String(points);
}
