// src/server/services/case-digest/ai-commentary.ts
//
// Phase 3.18 — Claude commentary for the daily digest.

import Anthropic from "@anthropic-ai/sdk";
import type { DigestPayload } from "./aggregator";

const MODEL = "claude-opus-4-7";

const SYSTEM_PROMPT =
  "You are a senior litigator's chief of staff writing a daily case digest. " +
  "In 2-3 short paragraphs, prioritize what the lawyer must address tomorrow. " +
  "Be specific (mention case names + deadlines). End with one motivating sentence. " +
  "Output plain text, no markdown.";

function serialize(payload: DigestPayload): string {
  const lines: string[] = [];
  lines.push(`Lawyer: ${payload.user.name}`);
  lines.push(`Date: ${payload.date}`);
  lines.push(`Total action items: ${payload.totalActionItems}`);
  lines.push("");
  if (payload.upcomingDeadlines.length > 0) {
    lines.push("Upcoming deadlines (next 7 days):");
    for (const d of payload.upcomingDeadlines) {
      lines.push(`- ${d.caseName}: ${d.title} due ${d.dueDate} (in ${d.daysUntil}d)`);
    }
    lines.push("");
  }
  if (payload.unreadClientMessages.length > 0) {
    lines.push(`Unread client messages: ${payload.unreadClientMessages.length}`);
    for (const m of payload.unreadClientMessages.slice(0, 3)) {
      lines.push(`- ${m.caseName}: "${m.preview}"`);
    }
    lines.push("");
  }
  if (payload.unreadEmailReplies.length > 0) {
    lines.push(`Unread email replies: ${payload.unreadEmailReplies.length}`);
    for (const r of payload.unreadEmailReplies.slice(0, 3)) {
      lines.push(`- ${r.caseName} (${r.from}): ${r.subject}`);
    }
    lines.push("");
  }
  if (payload.newIntakeSubmissions.length > 0) {
    lines.push(`New intake submissions: ${payload.newIntakeSubmissions.length}`);
    lines.push("");
  }
  if (payload.pendingSuggestedTimeEntries.count > 0) {
    lines.push(
      `Pending suggested time entries: ${payload.pendingSuggestedTimeEntries.count}` +
        (payload.pendingSuggestedTimeEntries.oldestSessionDate
          ? ` (oldest from ${payload.pendingSuggestedTimeEntries.oldestSessionDate})`
          : ""),
    );
    lines.push("");
  }
  if (payload.overdueDiscoveryResponses.length > 0) {
    lines.push("Overdue discovery responses:");
    for (const o of payload.overdueDiscoveryResponses) {
      lines.push(`- ${o.caseName}: ${o.setTitle} (${o.daysOverdue}d overdue)`);
    }
    lines.push("");
  }
  if (payload.todayStageChanges.length > 0) {
    lines.push("Stage changes today:");
    for (const s of payload.todayStageChanges) {
      lines.push(`- ${s.caseName} → ${s.toStage}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export async function generateCommentary(
  payload: DigestPayload,
  deps: { client?: Anthropic } = {},
): Promise<string> {
  if (!deps.client && !process.env.ANTHROPIC_API_KEY) {
    // Soft-fail: return a deterministic fallback so digest can still send.
    return fallbackCommentary(payload);
  }
  const client = deps.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const userPrompt =
    serialize(payload) +
    "\n\nWrite the digest commentary now. 2-3 short paragraphs, plain text, no markdown.";
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    return text.length > 0 ? text : fallbackCommentary(payload);
  } catch (err) {
    console.warn("[case-digest] AI commentary failed, using fallback", err);
    return fallbackCommentary(payload);
  }
}

function fallbackCommentary(payload: DigestPayload): string {
  const parts: string[] = [];
  parts.push(
    `You have ${payload.totalActionItems} item${payload.totalActionItems === 1 ? "" : "s"} on deck for ${payload.date}.`,
  );
  if (payload.upcomingDeadlines.length > 0) {
    const next = payload.upcomingDeadlines[0];
    parts.push(
      `Closest deadline: ${next.title} on ${next.caseName} in ${next.daysUntil} day${next.daysUntil === 1 ? "" : "s"}.`,
    );
  }
  parts.push("Take it one case at a time — you've got this.");
  return parts.join(" ");
}
