// A stand-in for the JEV API, so the end-to-end test runs without an API key (CI, forks).
// It grades every answer as the lowest grade: "wrong" for Choice, level 0 for Score.
//
//   node scripts/mock-jev.mjs [port]          default 8788
//   yarn wrangler dev --var JEV_URL:http://127.0.0.1:8788/v1/systemone
//
// It checks the request has the shape the real API expects, and answers 400 otherwise, so a
// change that breaks the request still fails the test.
import { createServer } from "node:http";
import { gradeLabels } from "../src/jev-grade.ts";

const port = Number(process.argv[2] || 8788);

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const reply = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (req.method !== "POST" || req.url !== "/v1/systemone") return reply(404, { error: "not found" });
    if (!/^Bearer \S+/.test(req.headers.authorization || "")) return reply(401, { error: "missing API key" });
    let q;
    try {
      const data = JSON.parse(body);
      q = data.questions?.grade;
      if (typeof data.state?.question !== "string" || typeof data.state?.answer !== "string") throw 0;
      if (!q || !q.instructions || !["choice", "score"].includes(q.type)) throw 0;
    } catch {
      return reply(400, { error: "bad request" });
    }
    const labels = gradeLabels({ type: q.type === "choice" ? "Choice" : "Score", criteria: q.criteria });
    const lowest = q.type === "choice" ? "wrong" : "0";
    const probabilities = Object.fromEntries(labels.map((l) => [l, l === lowest ? 1 : 0]));
    reply(200, { answers: { grade: { probabilities } }, usage: { input_tokens: Math.ceil(body.length / 4) } });
  });
}).listen(port, "127.0.0.1", () => console.log(`mock JEV on http://127.0.0.1:${port}/v1/systemone`));
