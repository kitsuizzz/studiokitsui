import type { ChatMessage, Conversation } from "../types";

/** Reload recovery: a build that was in-flight when the app closed is orphaned. */
export function recoverConversations(list: Conversation[]): Conversation[] {
  return list.map((c) => ({
    ...c,
    messages: c.messages.map((m) => {
      if (m.role === "assistant" && m.buildPending && !m.studioId && !m.studioFailed && !m.awaitingBuild) {
        return { ...m, building: false, studioFailed: "truncated" as const };
      }
      if (m.role === "assistant" && m.editPending && !m.studioFailed) {
        return { ...m, building: false, studioFailed: "truncated" as const };
      }
      if (m.role === "assistant" && m.building) {
        return { ...m, building: false, review: undefined };
      }
      if (m.role === "assistant" && m.review) {
        return { ...m, review: undefined };
      }
      if (m.role === "assistant" && (m.critic?.status === "reviewing" || m.critic?.status === "refining")) {
        return { ...m, critic: { status: "skipped" as const } };
      }
      return m;
    }),
  }));
}

/** The builder streams progress fences without re-emitting the plan; merge the
    latest active/done/pct into the plan the planner published. */
export function mergeProgressPlan(
  plan: ChatMessage["plan"] | null,
  progress: { active: number | null; done: number | null; pct: number | null } | null,
  last: ChatMessage["plan"]
): ChatMessage["plan"] {
  if (plan) return plan;
  if (!progress || !last) return last;
  const active = Math.min(progress.active ?? last.active, last.todos.length);
  const done = Math.min(progress.done ?? last.done, last.todos.length);
  const pct = progress.pct ?? last.pct;
  if (active === last.active && done === last.done && pct === last.pct) return last;
  return { ...last, active, done, pct };
}
