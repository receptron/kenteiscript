// MulmoKentei Worker: serves the quiz API, grades answers with JEV, and keeps
// games and results in D1. The page is served from public/ as static assets.
import { gradeAnswer, gradeFor, publicQuiz } from "./grading.ts";
import type { KenteiScript } from "./kentei-script.ts";
import { quizzes } from "./quizzes.gen.ts"; // every KenteiScript in quizzes/, bundled by scripts/gen-quizzes.mjs

interface Env {
  DB: D1Database;
  TYPESAFE_API_KEY: string;
  QUIZ?: string; // default quiz id (file name in quizzes/ without .json)
  JEV_MODEL?: string;
  JEV_URL?: string; // unset in production; CI points it at scripts/mock-jev.mjs
}

const MAX_ANSWER_CHARS = 800; // longer answers are cut before grading
const GAME_TTL_MS = 3 * 60 * 60 * 1000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const quizIds = Object.keys(quizzes);

function resolveQuizId(env: Env, requested: string | null): string | null {
  const id = requested || env.QUIZ || quizIds[0];
  return id && id in quizzes ? id : null;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    return text.length > 16384 ? {} : (JSON.parse(text || "{}") as Record<string, unknown>);
  } catch {
    return {};
  }
}

async function startGame(env: Env, quizId: string) {
  const id = crypto.randomUUID().replaceAll("-", "");
  const now = Date.now();
  const cutoff = now - GAME_TTL_MS;
  // Expired games are swept here, so no scheduled job is needed.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM answers WHERE game_id IN (SELECT id FROM games WHERE started < ?)").bind(cutoff),
    env.DB.prepare("DELETE FROM games WHERE started < ?").bind(cutoff),
    env.DB.prepare("INSERT INTO games (id, quiz, started) VALUES (?, ?, ?)").bind(id, quizId, now),
  ]);
  return json(200, { gameId: id });
}

async function grade(env: Env, body: Record<string, unknown>) {
  const gameId = String(body.gameId ?? "");
  const qid = String(body.id ?? "");
  const game = await env.DB.prepare(
    "SELECT quiz, started, (SELECT COUNT(*) FROM answers WHERE game_id = ?1) AS n, " +
      "(SELECT COUNT(*) FROM answers WHERE game_id = ?1 AND qid = ?2) AS done FROM games WHERE id = ?1",
  )
    .bind(gameId, qid)
    .first<{ quiz: string; started: number; n: number; done: number }>();
  if (!game || Date.now() - game.started > GAME_TTL_MS || !(game.quiz in quizzes)) {
    return json(400, { error: "挑戦の期限が切れました。最初からやり直してください" });
  }
  const quiz: KenteiScript = quizzes[game.quiz];
  const q = quiz.questions.find((x) => x.id === qid);
  if (!q) return json(400, { error: "unknown question" });
  if (game.done || game.n >= quiz.rules.questionsPerGame) return json(400, { error: "この問題はもう採点済みです" });

  const answer = String(body.answer ?? "").trim().slice(0, MAX_ANSWER_CHARS) || "（無回答）";
  let result;
  try {
    result = await gradeAnswer(quiz, q, answer, { apiKey: env.TYPESAFE_API_KEY, model: env.JEV_MODEL, url: env.JEV_URL });
  } catch (e) {
    console.error(e);
    return json(502, { error: "採点に失敗しました" });
  }
  // The primary key rejects a second grade of the same question sent in parallel.
  const saved = await env.DB.prepare("INSERT OR IGNORE INTO answers (game_id, qid, points) VALUES (?, ?, ?)")
    .bind(gameId, q.id, result.points)
    .run();
  if (!saved.meta.changes) return json(400, { error: "この問題はもう採点済みです" });
  return json(200, result);
}

async function finishGame(env: Env, body: Record<string, unknown>) {
  const gameId = String(body.gameId ?? "");
  const row = await env.DB.prepare(
    "SELECT g.quiz AS quiz, COUNT(a.qid) AS n, COALESCE(SUM(a.points), 0) AS points " +
      "FROM games g LEFT JOIN answers a ON a.game_id = g.id WHERE g.id = ? GROUP BY g.id",
  )
    .bind(gameId)
    .first<{ quiz: string; n: number; points: number }>();
  const quiz = row && quizzes[row.quiz];
  if (!row || !quiz || row.n < quiz.rules.questionsPerGame) {
    return json(400, { error: "この挑戦はまだ終わっていないか、期限が切れています" });
  }
  const points = row.points;
  const grade = gradeFor(quiz, points);
  const time = new Date().toISOString().slice(0, 19);
  const [inserted] = await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO plays (game_id, quiz, time, points, grade) VALUES (?, ?, ?, ?, ?)").bind(
      gameId, row.quiz, time, points, grade,
    ),
    env.DB.prepare("DELETE FROM answers WHERE game_id = ?").bind(gameId),
    env.DB.prepare("DELETE FROM games WHERE id = ?").bind(gameId),
  ]);
  if (!inserted.meta.changes) return json(400, { error: "この挑戦はもう記録済みです" });

  const [counts, ranks] = await env.DB.batch([
    env.DB.prepare("SELECT grade, COUNT(*) AS n FROM plays WHERE quiz = ? GROUP BY grade").bind(row.quiz),
    env.DB.prepare(
      "SELECT COUNT(*) AS total, SUM(points > ?1) AS above, SUM(points < ?1) AS below FROM plays WHERE quiz = ?2",
    ).bind(points, row.quiz),
  ]);
  const byGrade: Record<string, number> = Object.fromEntries(quiz.rules.grades.map((g) => [g.grade, 0]));
  for (const r of counts.results as { grade: string; n: number }[]) byGrade[r.grade] = r.n;
  // above / below count other players strictly higher / lower, so ties don't skew the rank.
  const r = ranks.results[0] as { total: number; above: number; below: number };
  return json(200, {
    points,
    grade,
    stats: { counts: byGrade, total: r.total, above: r.above ?? 0, below: r.below ?? 0 },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/quizzes") {
      // The quizzes offered on the start screen, default first. meta.hidden leaves one out
      // of the list; it can still be opened with ?quiz=<id>.
      const first = resolveQuizId(env, null);
      const list = quizIds
        .filter((id) => !quizzes[id].meta.hidden)
        .sort((a, b) => Number(b === first) - Number(a === first))
        .map((id) => ({ id, title: quizzes[id].meta.title ?? id, subtitle: quizzes[id].meta.subtitle ?? "" }));
      return json(200, { default: first, quizzes: list });
    }
    if (request.method === "GET" && url.pathname === "/api/quiz") {
      const id = resolveQuizId(env, url.searchParams.get("quiz"));
      return id ? json(200, publicQuiz(id, quizzes[id])) : json(404, { error: "quiz not found", available: quizIds });
    }
    if (request.method === "POST") {
      if (url.pathname === "/api/start") {
        const id = resolveQuizId(env, url.searchParams.get("quiz"));
        return id ? startGame(env, id) : json(404, { error: "quiz not found" });
      }
      if (url.pathname === "/api/grade") return grade(env, await readBody(request));
      if (url.pathname === "/api/finish") return finishGame(env, await readBody(request));
    }
    return json(404, { error: "not found" });
  },
} satisfies ExportedHandler<Env>;
