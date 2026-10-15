// Grades the sample answers in quizzes/<quiz>.tests.json with JEV and checks each grade.
// Use it after editing criteria, to see that JEV still grades them the way you intend.
//
//   npm run test:grading [quiz]          (default quiz: sengoku; needs TYPESAFE_API_KEY in .env)
//
// Each test case: { "id": "<question id>", "answer": "...", "expect": "correct" | "close" | "wrong" | 0..3 }
import { existsSync, readFileSync } from "node:fs";
import { gradeAnswer, type Quiz } from "../src/grading.ts";

const root = new URL("..", import.meta.url).pathname;
if (existsSync(`${root}.env`)) process.loadEnvFile(`${root}.env`);
const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) throw new Error("Set TYPESAFE_API_KEY in .env");

const quizId = process.argv[2] || "sengoku";
const quiz = JSON.parse(readFileSync(`${root}quizzes/${quizId}.json`, "utf8")) as Quiz;
const testsFile = `${root}quizzes/${quizId}.tests.json`;
if (!existsSync(testsFile)) throw new Error(`No test cases: quizzes/${quizId}.tests.json`);
const cases = JSON.parse(readFileSync(testsFile, "utf8")) as { id: string; answer: string; expect: string | number }[];
const byId = new Map(quiz.questions.map((q) => [q.id, q]));

let passed = 0;
let tokens = 0;
const started = Date.now();
const results = await Promise.all(
  cases.map(async (c) => {
    const q = byId.get(c.id);
    if (!q) throw new Error(`Unknown question id in tests: ${c.id}`);
    return { c, r: await gradeAnswer(quiz, q, c.answer, { apiKey }) };
  }),
);
for (const { c, r } of results) {
  const ok = r.result === c.expect;
  passed += ok ? 1 : 0;
  tokens += r.inputTokens ?? 0;
  const probs = Object.entries(r.probabilities).map(([k, v]) => `${k}:${v.toFixed(2)}`).join(" ");
  console.log(`${ok ? "ok  " : "FAIL"} ${c.id} expect=${String(c.expect).padEnd(7)} got=${String(r.result).padEnd(7)} [${probs}]  ${c.answer.slice(0, 30)}`);
}
console.log(`\n${passed}/${cases.length} as expected · ${tokens} input tokens · ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exitCode = passed === cases.length ? 0 : 1;
