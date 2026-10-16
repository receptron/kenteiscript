// KenteiScript: the JSON format of a quiz (quizzes/<id>.json), defined as a Zod schema.
//
// The schema is the single definition of the format. The TypeScript types the Worker uses are
// inferred from it, and scripts/gen-quizzes.mjs validates every quiz with it before each
// `wrangler dev` / deploy, so a malformed KenteiScript fails the build instead of a game.
//
// The Worker imports only the types (`import type`), so Zod is not bundled into it.
import { z } from "zod";

const text = z.string().trim().min(1);

// Objects are strict: an unknown key is almost always a typo ("explaination"), and a typo in an
// optional field would otherwise be silently ignored.

export const ChoiceJev = z.strictObject({
  type: z.literal("Choice"),
  instructions: text,
  /** One description per label; the labels must match rules.credit.Choice. */
  criteria: z.record(z.string(), text),
});

export const ScoreJev = z.strictObject({
  type: z.literal("Score"),
  instructions: text,
  /** What each level means, lowest first; as many levels as rules.credit.Score has. */
  criteria: z.array(text).min(2),
});

export const Question = z.strictObject({
  /** Unique within the quiz. Convention: L<level>-<nn>. */
  id: z.string().regex(/^[A-Za-z0-9_-]+$/, "use letters, digits, - and _ only"),
  level: z.int().min(1),
  question: text,
  /** No single right answer; changes the hint shown to the player. Score questions only. */
  open: z.boolean().optional(),
  jev: z.discriminatedUnion("type", [ChoiceJev, ScoreJev]),
  /** Shown after the answer is graded, never before. */
  explanation: text,
});

export const Grade = z.strictObject({
  grade: text,
  /** Lowest total points for this grade. */
  min: z.number().min(0),
  title: text,
  /** Lets the player pick how the title reads (e.g. 歴女 / 歴男). */
  titleChoices: z.array(text).min(2).optional(),
});

export const Rules = z.strictObject({
  questionsPerGame: z.int().min(1),
  startLevel: z.int().min(1),
  minLevel: z.int().min(1),
  maxLevel: z.int().min(1),
  credit: z.strictObject({
    /** Credit per Choice label; 1 moves the player up a level, 0.5 keeps the level, 0 moves down. */
    Choice: z.record(z.string(), z.number().min(0).max(1)),
    /** Credit per Score level, lowest first. */
    Score: z.array(z.number().min(0).max(1)).min(2),
  }),
  /** Highest first. A game's points are the sum of level × credit. */
  grades: z.array(Grade).min(1),
  /**
   * Seconds for each question, optional; no limit when absent. There is no limit for the whole
   * game. The runtime's view keeps it: it counts down while a question is shown, pauses while the
   * answer is graded and the feedback is shown, and at 0 submits what is in the answer box (empty
   * means no answer). The server does not enforce it.
   */
  timeLimitPerQuestion: z.int().positive().optional(),
  // Notes for authors; not read by the app.
  next: z.record(z.string(), z.string()).optional(),
  points: z.string().optional(),
});

export const Meta = z.strictObject({
  title: text,
  subtitle: text,
  /** The stamp in the header, one string per line. */
  seal: z.array(z.string()).min(1).optional(),
  introHeading: z.string().optional(),
  intro: text,
  /** Bullet list on the start screen. */
  rules: z.array(text).min(1),
  /** Label for the titleChoices chooser. */
  titleChoicePrompt: z.string().optional(),
  /** Leave the quiz off the start screen's tabs; /?quiz=<id> still opens it. */
  hidden: z.boolean().optional(),
});

export const KenteiScript = z
  .strictObject({
    meta: Meta,
    rules: Rules,
    questions: z.array(Question).min(1),
    /** Notes for authors; not read by the app. */
    notes: z.array(z.string()).optional(),
  })
  .superRefine((quiz, ctx) => {
    const { rules } = quiz;
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });

    if (!(rules.minLevel <= rules.startLevel && rules.startLevel <= rules.maxLevel)) {
      issue(["rules", "startLevel"], "must be between minLevel and maxLevel");
    }
    rules.grades.forEach((g, i) => {
      if (i && g.min >= rules.grades[i - 1].min) issue(["rules", "grades", i, "min"], "grades must be highest first, with decreasing min");
    });
    if (rules.grades.at(-1)?.min !== 0) issue(["rules", "grades"], "the last grade must have min 0, so every score gets a grade");

    const labels = Object.keys(rules.credit.Choice).sort().join(", ");
    const seen = new Set<string>();
    quiz.questions.forEach((q, i) => {
      const at = (...p: (string | number)[]) => ["questions", i, ...p];
      if (seen.has(q.id)) issue(at("id"), `duplicate id ${q.id}`);
      seen.add(q.id);
      if (q.level < rules.minLevel || q.level > rules.maxLevel) {
        issue(at("level"), `${q.id}: level ${q.level} is outside ${rules.minLevel}..${rules.maxLevel}`);
      }
      if (q.jev.type === "Choice") {
        const got = Object.keys(q.jev.criteria).sort().join(", ");
        if (got !== labels) issue(at("jev", "criteria"), `${q.id}: Choice labels must be ${labels} (rules.credit.Choice), got ${got}`);
      } else {
        if (q.jev.criteria.length !== rules.credit.Score.length) {
          issue(at("jev", "criteria"), `${q.id}: needs ${rules.credit.Score.length} levels (rules.credit.Score), got ${q.jev.criteria.length}`);
        }
      }
      if (q.open && q.jev.type !== "Score") issue(at("open"), `${q.id}: open questions must be Score`);
    });
  });

export type KenteiScript = z.infer<typeof KenteiScript>;
export type Question = z.infer<typeof Question>;
export type Grade = z.infer<typeof Grade>;
export type Rules = z.infer<typeof Rules>;

/** Sample answers for `npm run test:grading` (quizzes/<id>.tests.json). */
export const KenteiTests = z.array(
  z.strictObject({
    id: z.string(),
    answer: z.string(),
    /** A Choice label, or a Score level. */
    expect: z.union([z.string(), z.int().min(0)]),
  }),
);
export type KenteiTests = z.infer<typeof KenteiTests>;

/** Validates a parsed KenteiScript; throws one readable error listing every problem. */
export function parseKenteiScript(data: unknown, name: string): KenteiScript {
  const result = KenteiScript.safeParse(data);
  if (result.success) return result.data;
  const lines = result.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`${name} is not a valid KenteiScript:\n${lines.join("\n")}`);
}
