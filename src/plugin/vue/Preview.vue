<template>
  <div class="kentei-preview" data-testid="present-kentei-preview">
    <div class="seal" aria-hidden="true">検定</div>
    <div class="body">
      <p class="title">{{ title }}</p>
      <p class="status">{{ status }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolResult } from "gui-chat-protocol";
import type { KenteiData } from "../core/types.ts";
import { toPlayState } from "../core/viewState.ts";
import { summary } from "../core/play.ts";
import { formatPoints } from "../../game.ts";

const props = defineProps<{ result: ToolResult }>();

const data = computed(() => {
  const d = props.result?.data as KenteiData | undefined;
  return d && typeof d === "object" && d.script ? d : null;
});
const state = computed(() => (data.value ? toPlayState(props.result.viewState, data.value.script) : null));
const title = computed(() => data.value?.script.meta.title ?? "検定");

const status = computed(() => {
  const d = data.value;
  if (!d) return "";
  const n = d.script.rules.questionsPerGame;
  const s = state.value;
  if (!s || s.phase === "start") return `全 ${n} 問`;
  if (s.phase !== "done") return `${s.history.length} / ${n} 問`;
  const t = summary(d.script, s);
  return `判定 ${t.grade.grade}（${formatPoints(t.points)} 点）`;
});
</script>

<style scoped>
.kentei-preview {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #d8ccb8;
  border-radius: 10px;
  background: #fbf7ef;
  color: #1f1a17;
  font: 14px/1.5 "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
}
.seal {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 6px;
  background: #b8322a;
  color: #fff;
  display: grid;
  place-items: center;
  font: 800 12px/1 "Hiragino Mincho ProN", "Yu Mincho", serif;
  transform: rotate(-4deg);
}
.body {
  min-width: 0;
}
.title {
  margin: 0;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status {
  margin: 0;
  font-size: 12px;
  color: #5c524a;
}
</style>
