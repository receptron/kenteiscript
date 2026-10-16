// End-to-end check of a running server: the quiz is served without its criteria, the
// cheating guards hold, and a full game is graded, recorded and charted.
//
//   yarn dev        (in another terminal)
//   yarn test [baseUrl] [quiz]      default http://localhost:8787
//
// A full game makes questionsPerGame JEV calls and records one result, so point it at a
// deployed site only if you are happy to add a test result to its chart.
import { nextLevel, pickQuestion } from "../src/game.ts";

const base = (process.argv[2] || "http://localhost:8787").replace(/\/$/, "");
const quizQs = process.argv[3] ? `?quiz=${encodeURIComponent(process.argv[3])}` : "";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const post = async (path, body) => {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

let page;
try {
  page = await fetch(`${base}/`);
} catch {
  console.error(`No server at ${base}. Start one with \`yarn dev\` in another terminal, or pass its URL.`);
  process.exit(1);
}
check(page.ok, "page is served", `HTTP ${page.status}`);
const gameJs = await fetch(`${base}/game.js`);
check(gameJs.ok && /export function pickQuestion/.test(await gameJs.text()), "the page's game rules are served", `HTTP ${gameJs.status}`);

const quizRes = await fetch(`${base}/api/quiz${quizQs}`);
const quiz = await quizRes.json();
check(quizRes.ok && quiz.questions?.length > 0, "quiz loads", `${quiz.id}: ${quiz.questions?.length} questions`);
const raw = JSON.stringify(quiz);
check(!/"(jev|instructions|criteria|explanation)"/.test(raw), "criteria, answers and explanations are not sent to the browser");
check((await fetch(`${base}/api/quiz?quiz=__nope__`)).status === 404, "unknown quiz is a 404");

const listRes = await fetch(`${base}/api/quizzes`);
const list = await listRes.json();
const listed = list.quizzes?.map((q) => q.id) ?? [];
check(listRes.ok && listed[0] === list.default, "quiz list starts with the default quiz", listed.join(", "));
check(!/"(jev|instructions|criteria|explanation|questions)"/.test(JSON.stringify(list)), "quiz list carries titles only");
const loads = await Promise.all(listed.map((id) => fetch(`${base}/api/quiz?quiz=${encodeURIComponent(id)}`)));
check(
  loads.every((r) => r.ok),
  "every listed quiz loads",
);

check((await post("/api/grade", { gameId: "nope", id: quiz.questions[0].id, answer: "x" })).status === 400, "grading without a game is refused");

const { body: start } = await post(`/api/start${quizQs}`);
const gameId = start.gameId;
check(typeof gameId === "string", "game starts");
check((await post("/api/finish", { gameId })).status === 400, "finishing an unfinished game is refused");

// Play a full game: walk the levels with the page's rules (src/game.ts), answering "わからない".
const rules = quiz.rules;
let level = rules.startLevel;
let total = 0;
const used = new Set();
for (let i = 0; i < rules.questionsPerGame; i++) {
  const q = pickQuestion(quiz.questions, used, level, () => 0);
  used.add(q.id);
  const r = await post("/api/grade", { gameId, id: q.id, answer: i === 0 ? "" : "わからない" });
  if (r.status !== 200) {
    check(false, `grade ${q.id}`, JSON.stringify(r.body));
    break;
  }
  total += r.body.points;
  if (i === 0) {
    check(r.body.points === 0, "an empty answer earns no points", `${r.body.type} → ${r.body.result}`);
    const again = await post("/api/grade", { gameId, id: q.id, answer: "もう一度" });
    check(again.status === 400, "the same question cannot be graded twice");
  }
  level = nextLevel(rules, level, r.body.credit);
}
const done = await post("/api/finish", { gameId });
check(done.status === 200, "a finished game is recorded", `grade ${done.body.grade}, ${done.body.points} points`);
check(done.body.points === total, "recorded points are the server's own total", `${done.body.points} vs ${total}`);
check(done.body.stats?.total >= 1 && done.body.stats.counts?.[done.body.grade] >= 1, "chart stats include this game", `${done.body.stats?.total} plays`);
check((await post("/api/finish", { gameId })).status === 400, "a game cannot be recorded twice");

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exitCode = failures ? 1 : 0;
