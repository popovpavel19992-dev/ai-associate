import { createHash } from "node:crypto";
import type { QuestionSnapshot } from "@/server/db/schema/case-deposition-topic-branches";

export interface QuestionLike {
  id: string;
  text: string;
}

export function computeQuestionsHash(questions: QuestionLike[]): string {
  const sorted = [...questions].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const payload = sorted.map((q) => `${q.id}:${q.text}`).join("\n");
  return createHash("sha256").update(payload).digest("hex");
}

export function isStaleSnapshot(
  snapshot: QuestionSnapshot[],
  current: QuestionLike[],
): boolean {
  if (snapshot.length !== current.length) return true;
  const snapMap = new Map(snapshot.map((s) => [s.questionId, s.text]));
  for (const q of current) {
    if (snapMap.get(q.id) !== q.text) return true;
  }
  return false;
}
