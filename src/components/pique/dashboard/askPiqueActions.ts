"use server";

import { requireUser } from "@/components/pique/drawer/actions";
import { askPique, type AskPiqueStep, type AskPiqueTurn } from "@/lib/ai/askPique";

export interface AskPiqueChatResult {
  answer: string;
  steps: AskPiqueStep[];
  error?: string;
}

export async function askPiqueAction(question: string, history: AskPiqueTurn[]): Promise<AskPiqueChatResult> {
  const { supabase, user } = await requireUser();

  const result = await askPique(supabase, question, history);

  await supabase.from("ask_log").insert({
    user_id: user.id,
    question,
    queries: result.steps.map((s) => s.sql),
    row_counts: result.steps.map((s) => s.rowCount ?? null),
    tool_call_count: result.toolCallCount,
    total_tokens: result.totalTokens,
    duration_ms: result.durationMs,
    error: result.error ?? null,
  });

  return { answer: result.answer, steps: result.steps, error: result.error };
}
