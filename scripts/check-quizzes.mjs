// Checks every KenteiScript in quizzes/ and its sample answers. No server and no API key needed.
//   npm run check:quizzes
// First the Zod schema (src/kentei-script.ts): the format itself. Then the authoring rules from
// CLAUDE.md, which a valid KenteiScript can still break without any other test noticing.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KenteiTests, parseKenteiScript } from "../src/kentei-script.ts";
import { authoringIssues } from "../src/authoring.ts";

const dir = join(new URL("..", import.meta.url).pathname, "quizzes");
// A game can stay on one level for many questions, so the sample quizzes keep 10 per level.
// (The chat plugin's checkScript applies the same rules with 1.)
const MIN_PER_LEVEL = 10;

let problems = 0;
const fail = (where, msg) => {
  console.log(`FAIL ${where}: ${msg}`);
  problems++;
};

const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".tests.json")).sort();
for (const file of files) {
  const id = file.replace(/\.json$/, "");
  const before = problems;
  let quiz;
  try {
    quiz = parseKenteiScript(JSON.parse(readFileSync(join(dir, file), "utf8")), `quizzes/${file}`);
  } catch (e) {
    fail(id, e.message);
    continue;
  }
  const { questions } = quiz;

  // The authoring rules (src/authoring.ts): injection guard, questions per level, reachable grades.
  for (const issue of authoringIssues(quiz, { minPerLevel: MIN_PER_LEVEL })) fail(`${id} ${issue.where}`, issue.message);
  const perLevel = {};
  for (const q of questions) perLevel[q.level] = (perLevel[q.level] || 0) + 1;

  // Sample answers: every case names a real question and a grade that question can get.
  const testsFile = join(dir, `${id}.tests.json`);
  if (!existsSync(testsFile)) {
    fail(id, `no ${id}.tests.json with sample answers for npm run test:grading`);
  } else {
    const parsed = KenteiTests.safeParse(JSON.parse(readFileSync(testsFile, "utf8")));
    if (!parsed.success) {
      fail(`${id}.tests.json`, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    } else {
      const byId = new Map(questions.map((q) => [q.id, q]));
      parsed.data.forEach((t, i) => {
        const q = byId.get(t.id);
        const at = `${id}.tests.json #${i + 1}`;
        if (!q) return fail(at, `unknown question ${t.id}`);
        const ok = q.jev.type === "Choice"
          ? typeof t.expect === "string" && t.expect in q.jev.criteria
          : typeof t.expect === "number" && t.expect < q.jev.criteria.length;
        if (!ok) fail(at, `expect ${JSON.stringify(t.expect)} is not a grade ${t.id} (${q.jev.type}) can get`);
      });
    }
  }
  console.log(`${problems > before ? "    " : "ok  "} ${id}: ${questions.length} questions, per level ${JSON.stringify(perLevel)}`);
}

console.log(problems ? `\n${problems} problem(s)` : "\nall quizzes pass");
process.exitCode = problems ? 1 : 0;
