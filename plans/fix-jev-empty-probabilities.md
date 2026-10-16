# gradeAnswer: empty or unknown JEV probabilities (#14)

- `src/jev-grade.ts` (pure): `gradeLabels(rules, type)` — the labels a grade can take;
  `mostLikelyLabel(probabilities, labels)` — the most likely expected label, or undefined.
- `gradeAnswer` throws `JEV gave none of the grades …` when `mostLikelyLabel` is undefined.
  The Worker and the plugin already turn a thrown error into a failed answer, not a recorded one.
- `noAnswerGrade` uses `gradeLabels` for the same labels; its own reduce is out of scope (its
  input is the KenteiScript, not JEV).
- Verified: the old reduce, copied into a harness, and `mostLikelyLabel` agree on every generated
  response whose labels are all expected; tests in `test/jev-grade.test.ts` go red when the old
  reduce is put back.

## After review

- `gradeLabels(q.jev)` takes the labels from the criteria JEV is asked with, not `rules.credit`;
  `scripts/mock-jev.mjs` imports it, so the mock answers with the same labels.
- `mostLikelyLabel` walks `labels`, so a tie goes to the first expected label (lowest Score
  level) whatever JEV's key order. It refuses (undefined) a response with a non-finite
  probability, or with an unexpected label at least as likely as the best expected one.
- `noAnswerGrade`'s reduce stays: the schema requires at least one Choice label.
