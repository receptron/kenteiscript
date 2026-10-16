-- MulmoKentei D1 schema. Applied by `yarn setup` (local) and `yarn setup:cloudflare` (remote).
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  quiz TEXT NOT NULL,
  started INTEGER NOT NULL            -- unix ms
);

-- One row per graded answer. The primary key stops a question being graded twice in one game.
CREATE TABLE IF NOT EXISTS answers (
  game_id TEXT NOT NULL,
  qid TEXT NOT NULL,
  points REAL NOT NULL,
  PRIMARY KEY (game_id, qid)
);

-- One row per finished game; the results chart reads this, per quiz.
CREATE TABLE IF NOT EXISTS plays (
  game_id TEXT PRIMARY KEY,
  quiz TEXT NOT NULL,
  time TEXT NOT NULL,
  points REAL NOT NULL,
  grade TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS plays_quiz_points ON plays (quiz, points);
