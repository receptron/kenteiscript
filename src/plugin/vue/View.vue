<template>
  <div class="kentei" data-testid="present-kentei-view">
    <div v-if="script" class="wrap">
      <header>
        <div class="seal" aria-hidden="true">
          <span v-for="(line, i) in seal" :key="i">{{ line }}</span>
        </div>
        <div>
          <h1>{{ script.meta.title }}</h1>
          <p>{{ script.meta.subtitle }}</p>
        </div>
      </header>

      <section v-if="state.phase === 'start'" class="card" data-testid="kentei-start">
        <h2 v-if="script.meta.introHeading">{{ script.meta.introHeading }}</h2>
        <p class="lead">{{ script.meta.intro }}</p>
        <ul class="rules">
          <li v-for="(rule, i) in ruleLines" :key="i">{{ rule }}</li>
        </ul>
        <fieldset v-if="choiceGrade" class="chips">
          <legend>{{ script.meta.titleChoicePrompt || `${choiceGrade.grade} の称号の呼び方` }}</legend>
          <label v-for="choice in [...(choiceGrade.titleChoices ?? []), '']" :key="choice">
            <input v-model="state.titleChoice" type="radio" name="kentei-title" :value="choice || null" />
            <span>{{ choice || "指定しない" }}</span>
          </label>
        </fieldset>
        <p class="grader">{{ state.mode === "jev" ? "答えは一問ごとに判定モデル（JEV）が採点します。" : "答えは最後にまとめて AI が採点します。" }}</p>
        <button type="button" class="primary" data-testid="kentei-start-button" @click="start">始める</button>
      </section>

      <section v-else-if="state.phase !== 'done' && current" class="card" data-testid="kentei-question">
        <div class="progress" aria-hidden="true">
          <span v-for="(dot, i) in dots" :key="i" :class="dot" />
        </div>
        <div class="q-head">
          <span>第 {{ questionNumber }} 問 / {{ script.rules.questionsPerGame }}</span>
          <span v-if="state.phase === 'question' && timeLeft !== null" class="timer" :class="{ warn: timeLeft <= WARN_SECONDS }" role="timer" data-testid="kentei-timer">
            {{ timeLeft > 0 ? `残り ${timeLeft} 秒` : "時間切れ" }}
          </span>
          <span class="stars">{{ "★".repeat(current.level) }}<span class="off">{{ "★".repeat(Math.max(0, script.rules.maxLevel - current.level)) }}</span></span>
        </div>
        <p class="q-text" data-testid="kentei-question-text">{{ current.question }}</p>
        <p v-if="note" class="note">{{ note }}</p>

        <template v-if="state.phase === 'question'">
          <textarea
            v-model="state.draft"
            :rows="current.jev.type === 'Score' ? 6 : 2"
            :maxlength="MAX_ANSWER_CHARS"
            :disabled="grading || timedOut"
            placeholder="自分の言葉で答えてください"
            data-testid="kentei-answer"
            @keydown.enter.meta.prevent="submit(state.draft)"
            @keydown.enter.ctrl.prevent="submit(state.draft)"
          />
          <p v-if="error" class="error" role="alert">
            {{ error }}
            <button type="button" class="link" @click="continueUngraded">採点せずに続ける</button>
          </p>
          <div class="actions">
            <button type="button" class="secondary" :disabled="grading" @click="submit('')">わからない</button>
            <button type="button" class="primary" :disabled="grading" data-testid="kentei-submit" @click="submit(state.draft)">
              {{ grading ? "採点中…" : "答える" }}
            </button>
          </div>
        </template>

        <div v-else class="feedback" data-testid="kentei-feedback">
          <template v-if="lastRecord?.grade">
            <div class="verdict" :class="lastView.cls">
              <span class="mark">{{ lastView.mark }}</span>
              <span>{{ lastView.label }}</span>
              <span class="sub">+{{ formatPoints(lastRecord.grade.points) }} 点</span>
            </div>
          </template>
          <p v-else class="verdict plain">答えを記録しました。採点は最後に AI がまとめて行います。</p>
          <p class="explain">{{ current.explanation }}</p>
          <p v-if="nextNote" class="next-note">{{ nextNote }}</p>
          <div class="actions">
            <button type="button" class="primary" data-testid="kentei-next" @click="next">{{ last ? "結果を見る" : "次の問題へ" }}</button>
          </div>
        </div>
      </section>

      <section v-else-if="state.phase === 'done'" class="card" data-testid="kentei-result">
        <template v-if="totals.graded">
          <p class="r-label">判定</p>
          <p class="r-grade">{{ totals.grade.grade }}</p>
          <p class="r-title">{{ totals.title }}</p>
          <p class="r-score">{{ formatPoints(totals.points) }} 点（最高 {{ totals.max }} 点）</p>
        </template>
        <p v-else class="r-title">おつかれさまでした。採点は AI がこのあと行います。</p>
        <p class="sent" data-testid="kentei-sent">{{ state.sent ? "結果をチャットに送りました。" : "" }}</p>
        <button v-if="!state.sent" type="button" class="primary" @click="sendResults">結果をチャットに送る</button>
        <ol class="review">
          <li v-for="(h, i) in state.history" :key="h.id">
            <div class="row">
              <span>第 {{ i + 1 }} 問</span>
              <span class="stars">{{ "★".repeat(questionById(script, h.id)?.level ?? 0) }}</span>
              <span v-if="h.grade" :class="viewOf(h.grade, questionById(script, h.id)).cls">
                {{ viewOf(h.grade, questionById(script, h.id)).mark }} {{ viewOf(h.grade, questionById(script, h.id)).label }}
              </span>
            </div>
            <div class="q">{{ questionById(script, h.id)?.question }}</div>
            <div class="yours">あなたの答え：{{ h.answer || "（わからない）" }}</div>
            <p class="ex">{{ questionById(script, h.id)?.explanation }}</p>
          </li>
        </ol>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import type { ToolResult } from "gui-chat-protocol";
import { PLUGIN_RUNTIME_KEY } from "gui-chat-protocol/vue";
import type { KenteiScript, Question } from "../../kentei-script.ts";
import { formatPoints, levelStep } from "../../game.ts";
import type { AnswerGrade, GradingMode, KenteiData } from "../core/types.ts";
import { TOOL_NAME } from "../core/definition.ts";
import {
  MAX_ANSWER_CHARS,
  advance,
  initialState,
  isLastAnswer,
  normalizeAnswer,
  questionById,
  recordAnswer,
  summary,
  type PlayState,
} from "../core/play.ts";
import { toPlayState } from "../core/viewState.ts";
import { resultsMessage } from "../core/results.ts";

const props = defineProps<{
  selectedResult: ToolResult | null;
  sendTextMessage: (text?: string) => void;
}>();

const emit = defineEmits<{
  updateResult: [result: ToolResult];
}>();

// The host's plugin runtime, when it provides one: its dispatch reaches the plugin's server part,
// which grades with JEV. Injected rather than useRuntime(), which throws without a provider, so
// the View still works (grading by the LLM) in a host that has not wired the runtime.
const runtime = inject(PLUGIN_RUNTIME_KEY, null);

const script = ref<KenteiScript | null>(null);
const state = ref<PlayState>({
  phase: "start",
  mode: "llm",
  level: 1,
  currentId: null,
  history: [],
  draft: "",
  titleChoice: null,
  sent: false,
});
const grading = ref(false);
const error = ref("");
let restoring = false;
// Bumped whenever a different game takes over the View (another result, a restart), so a grading
// response that arrives afterwards is recognized as stale and dropped.
let generation = 0;

function isKenteiData(value: unknown): value is KenteiData {
  return typeof value === "object" && value !== null && "script" in value && typeof (value as { script: unknown }).script === "object";
}

function load(result: ToolResult): void {
  if (result.toolName && result.toolName !== TOOL_NAME) return;
  if (!isKenteiData(result.data)) return;
  restoring = true;
  generation++;
  const s = result.data.script;
  const mode: GradingMode = result.data.grading === "jev" && runtime ? "jev" : "llm";
  script.value = s;
  state.value = toPlayState(result.viewState, s) ?? initialState(s, mode);
  error.value = "";
  grading.value = false;
  restoring = false;
}

watch(
  () => props.selectedResult,
  (result, old) => {
    if (!result) return;
    if (old && script.value && old.uuid === result.uuid && old.data === result.data) return;
    load(result);
  },
  { immediate: true },
);

// Progress is saved with the result, so reopening the chat resumes the game.
watch(
  state,
  (value) => {
    if (restoring || !props.selectedResult) return;
    emit("updateResult", { ...props.selectedResult, viewState: JSON.parse(JSON.stringify(value)) as Record<string, unknown> });
  },
  { deep: true },
);

const seal = computed(() => script.value?.meta.seal ?? [script.value?.meta.title.slice(0, 2) ?? ""]);
const current = computed(() => (script.value ? questionById(script.value, state.value.currentId) : undefined));
const questionNumber = computed(() => state.value.history.length + (state.value.phase === "question" ? 1 : 0));
const lastRecord = computed(() => state.value.history[state.value.history.length - 1]);
const last = computed(() => (script.value ? isLastAnswer(script.value, state.value) : false));
const totals = computed(() => summary(script.value!, state.value));
const choiceGrade = computed(() => script.value?.rules.grades.find((g) => g.titleChoices));

// The start screen's rules, plus the time limit the same way the MulmoKentei page states it.
const ruleLines = computed(() => {
  const s = script.value;
  if (!s) return [];
  const limit = s.rules.timeLimitPerQuestion;
  return limit ? [...s.meta.rules, `1 問 ${limit} 秒。時間になると、そのとき書いてある答えで自動的に答えます。`] : s.meta.rules;
});

// Per-question time limit (rules.timeLimitPerQuestion, seconds), kept here in the view as on the
// MulmoKentei page: the countdown runs only while a question is open for an answer, stops while the
// answer is graded and while the feedback is shown, and at 0 submits what is in the answer box.
// The remaining time is not saved: reopening the chat on a question starts its countdown again.
const WARN_SECONDS = 10;
const timeLeft = ref<number | null>(null);
const timedOut = ref(false);
let timer: { deadline: number; tick: ReturnType<typeof setInterval> } | null = null;

function stopTimer(): number {
  const left = timer ? Math.max(0, timer.deadline - Date.now()) : 0;
  if (timer) clearInterval(timer.tick);
  timer = null;
  return left;
}

function startTimer(ms: number): void {
  stopTimer();
  const deadline = Date.now() + ms;
  const update = () => {
    const left = deadline - Date.now();
    timeLeft.value = Math.max(0, Math.ceil(left / 1000));
    if (left <= 0) {
      stopTimer();
      timedOut.value = true;
      void submit(state.value.draft);
    }
  };
  timer = { deadline, tick: setInterval(update, 200) };
  timeLeft.value = Math.ceil(ms / 1000);
}

watch(
  () => [state.value.phase, state.value.currentId, script.value?.rules.timeLimitPerQuestion] as const,
  ([phase, , limit]) => {
    timedOut.value = false;
    if (phase === "question" && limit) startTimer(limit * 1000);
    else {
      stopTimer();
      timeLeft.value = null;
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  stopTimer();
});

const note = computed(() => {
  const q = current.value;
  if (!q || q.jev.type !== "Score") return "";
  return q.open
    ? "正解のない問題です。どの答えを選ぶかではなく、根拠を挙げて筋道立てて考えているかで評価します。"
    : "正解は一つではありません。理由や背景を、自分の言葉で説明してください。";
});

const SCORE_LABELS = ["的外れ", "もう一歩", "よく考えた", "お見事"];
const CHOICE_VIEW: Record<string, { mark: string; label: string; cls: string }> = {
  correct: { mark: "◯", label: "正解", cls: "good" },
  close: { mark: "△", label: "惜しい", cls: "mid" },
  wrong: { mark: "✕", label: "不正解", cls: "bad" },
};

// A Score grade is shown out of the question's own rubric (criteria.length − 1 is the top level);
// the four words for the levels apply only to the usual four-level rubric.
function viewOf(g: AnswerGrade, q: Question | undefined): { mark: string; label: string; cls: string } {
  const cls = g.credit >= 1 ? "good" : g.credit >= 0.5 ? "mid" : "bad";
  if (g.type === "Choice") return CHOICE_VIEW[String(g.result)] ?? { mark: cls === "good" ? "◯" : cls === "mid" ? "△" : "✕", label: String(g.result), cls };
  const level = Number(g.result);
  const levels = q?.jev.type === "Score" ? q.jev.criteria.length : SCORE_LABELS.length;
  const word = levels === SCORE_LABELS.length ? SCORE_LABELS[level] : undefined;
  return { mark: "★".repeat(level) || "―", label: `評価 ${level} / ${levels - 1}${word ? ` 「${word}」` : ""}`, cls };
}

const lastView = computed(() =>
  lastRecord.value?.grade && script.value ? viewOf(lastRecord.value.grade, questionById(script.value, lastRecord.value.id)) : { mark: "", label: "", cls: "" },
);

const dots = computed(() =>
  Array.from({ length: script.value?.rules.questionsPerGame ?? 0 }, (_, i) => {
    const h = state.value.history[i];
    if (h) return h.grade ? `r-${viewOf(h.grade, undefined).cls}` : "r-plain";
    return i === state.value.history.length ? "now" : "";
  }),
);

const nextNote = computed(() => {
  const g = lastRecord.value?.grade;
  if (!g || last.value || state.value.mode !== "jev") return "";
  // The same wording as the MulmoKentei page.
  const before = lastRecord.value?.level ?? state.value.level;
  if (state.value.level > before) return "次は難しくなります。";
  if (state.value.level < before) return "次は易しくなります。";
  return levelStep(g.credit) > 0 ? "最高難度のまま続きます。" : "次も同じ難しさです。";
});

function start(): void {
  if (!script.value) return;
  generation++;
  state.value = advance(script.value, { ...state.value, phase: "start", history: [], level: script.value.rules.startLevel, sent: false });
}

async function submit(raw: string): Promise<void> {
  const s = script.value;
  const q = current.value;
  if (!s || !q || grading.value || state.value.phase !== "question") return;
  const answer = normalizeAnswer(raw);
  error.value = "";
  const left = stopTimer();
  if (state.value.mode === "llm" || !runtime) {
    state.value = recordAnswer(s, state.value, answer);
    return;
  }
  grading.value = true;
  // The game and question this answer belongs to. Anything may happen while JEV grades it (the
  // host selects another result, the View is reused for another game), so the response is applied
  // only if this is still the game and the question on screen.
  const asked = generation;
  const stillAsked = () => asked === generation && script.value === s && state.value.phase === "question" && state.value.currentId === q.id;
  try {
    const grade = await runtime.dispatch({ kind: "grade", script: s, questionId: q.id, answer }, parseGrade);
    if (stillAsked()) state.value = recordAnswer(s, state.value, answer, grade);
  } catch (e) {
    if (!stillAsked()) return;
    error.value = `採点できませんでした（${e instanceof Error ? e.message : String(e)}）。もう一度「答える」を押してください。`;
    // After time is up the answer stays as it was sent; otherwise the countdown carries on.
    if (!timedOut.value && s.rules.timeLimitPerQuestion) startTimer(left);
  } finally {
    // A newer game has its own state (load() resets grading); leave it alone.
    if (asked === generation) grading.value = false;
  }
}

function parseGrade(raw: unknown): AnswerGrade {
  const g = raw as Partial<AnswerGrade> | null;
  if (!g || (g.type !== "Choice" && g.type !== "Score") || typeof g.credit !== "number" || typeof g.points !== "number") {
    throw new Error("unexpected grading response");
  }
  return { type: g.type, result: g.result ?? "", probabilities: g.probabilities ?? {}, credit: g.credit, points: g.points };
}

// After a grading failure the player can go on without JEV; the remaining answers then go to the
// LLM ungraded, in the script's order.
function continueUngraded(): void {
  state.value = { ...state.value, mode: "llm" };
  error.value = "";
  void submit(state.value.draft);
}

function next(): void {
  if (!script.value) return;
  state.value = advance(script.value, state.value);
  if (state.value.phase === "done") sendResults();
}

function sendResults(): void {
  if (!script.value || state.value.sent) return;
  props.sendTextMessage(resultsMessage(script.value, state.value));
  state.value = { ...state.value, sent: true };
}
</script>

<style scoped>
.kentei {
  --paper: #fbf7ef;
  --bg: #f4ede0;
  --ink: #1f1a17;
  --ink-soft: #5c524a;
  --line: #d8ccb8;
  --accent: #b8322a;
  --accent-ink: #ffffff;
  --good: #2f6b45;
  --mid: #a26a12;
  --bad: #8d2a24;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.75 "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
}
.kentei *,
.kentei *::before,
.kentei *::after {
  box-sizing: border-box;
}
.wrap {
  max-width: 680px;
  margin: 0 auto;
  padding: 24px 16px 40px;
}
header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
}
.seal {
  flex: none;
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-ink);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font: 800 14px/1.05 "Hiragino Mincho ProN", "Yu Mincho", serif;
  letter-spacing: 0.05em;
  transform: rotate(-4deg);
}
h1 {
  font: 800 24px/1.25 "Hiragino Mincho ProN", "Yu Mincho", serif;
  margin: 0;
  letter-spacing: 0.06em;
}
header p {
  margin: 0;
  color: var(--ink-soft);
  font-size: 13px;
}
.card {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(60, 40, 20, 0.08), 0 8px 24px rgba(60, 40, 20, 0.08);
  padding: 24px;
}
h2 {
  font: 700 20px/1.4 "Hiragino Mincho ProN", "Yu Mincho", serif;
  margin: 0 0 10px;
}
.lead,
.grader {
  color: var(--ink-soft);
  margin: 0 0 16px;
}
.rules {
  margin: 0 0 18px;
  padding-left: 1.2em;
  color: var(--ink-soft);
}
.chips {
  border: 0;
  padding: 0;
  margin: 0 0 16px;
}
.chips legend {
  font-size: 13px;
  color: var(--ink-soft);
  margin-bottom: 6px;
}
.chips label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-right: 12px;
}
button {
  font: inherit;
  border-radius: 10px;
  padding: 10px 22px;
  cursor: pointer;
  border: 1px solid var(--line);
}
button:disabled {
  opacity: 0.6;
  cursor: default;
}
.primary {
  background: var(--accent);
  color: var(--accent-ink);
  border-color: var(--accent);
  font-weight: 700;
}
.secondary {
  background: transparent;
  color: var(--ink-soft);
}
.link {
  background: none;
  border: 0;
  padding: 0 4px;
  color: var(--accent);
  text-decoration: underline;
}
.progress {
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
}
.progress span {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: var(--line);
}
.progress .now {
  background: var(--ink-soft);
}
.progress .r-good {
  background: var(--good);
}
.progress .r-mid {
  background: var(--mid);
}
.progress .r-bad {
  background: var(--bad);
}
.progress .r-plain {
  background: var(--ink);
}
.q-head {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--ink-soft);
}
.timer {
  font-variant-numeric: tabular-nums;
}
.timer.warn {
  color: var(--bad);
  font-weight: 700;
}
.stars {
  color: var(--accent);
  letter-spacing: 0.1em;
}
.stars .off {
  color: var(--line);
}
.q-text {
  font: 700 18px/1.6 "Hiragino Mincho ProN", "Yu Mincho", serif;
  margin: 8px 0 12px;
  white-space: pre-wrap;
}
.note {
  font-size: 13px;
  color: var(--ink-soft);
  margin: 0 0 12px;
}
textarea {
  width: 100%;
  font: inherit;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
  color: var(--ink);
  resize: vertical;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}
.error {
  color: var(--bad);
  font-size: 13px;
  margin: 8px 0 0;
}
.verdict {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-weight: 700;
  font-size: 18px;
}
.verdict .mark {
  font-size: 28px;
}
.verdict .sub {
  font-weight: 500;
  font-size: 14px;
  color: var(--ink-soft);
}
.verdict.plain {
  font-size: 15px;
  font-weight: 500;
}
.good {
  color: var(--good);
}
.mid {
  color: var(--mid);
}
.bad {
  color: var(--bad);
}
.explain {
  margin: 10px 0 0;
  padding: 10px 12px;
  border-left: 3px solid var(--line);
  background: var(--bg);
  border-radius: 0 8px 8px 0;
}
.next-note {
  font-size: 13px;
  color: var(--ink-soft);
  margin: 8px 0 0;
}
.r-label {
  margin: 0;
  color: var(--ink-soft);
  font-size: 13px;
  text-align: center;
}
.r-grade {
  margin: 0;
  text-align: center;
  font: 800 56px/1.1 "Hiragino Mincho ProN", "Yu Mincho", serif;
  color: var(--accent);
}
.r-title {
  margin: 4px 0;
  text-align: center;
  font: 700 18px/1.5 "Hiragino Mincho ProN", "Yu Mincho", serif;
}
.r-score {
  margin: 0;
  text-align: center;
  color: var(--ink-soft);
}
.sent {
  text-align: center;
  font-size: 13px;
  color: var(--good);
  min-height: 1.5em;
}
.review {
  list-style: none;
  padding: 0;
  margin: 18px 0 0;
}
.review li {
  border-top: 1px solid var(--line);
  padding: 12px 0;
}
.review .row {
  display: flex;
  gap: 10px;
  font-size: 13px;
  color: var(--ink-soft);
}
.review .q {
  font-weight: 700;
  margin-top: 4px;
}
.review .yours {
  font-size: 14px;
}
.review .ex {
  font-size: 13px;
  color: var(--ink-soft);
  margin: 4px 0 0;
}
@media (max-width: 520px) {
  .card {
    padding: 18px;
  }
}
</style>
