// src/server/services/case-digest/compose.ts
//
// Phase 3.18 — Compose the digest email (subject, HTML, plain text).
// Table-based layout for max email-client compatibility, inline styles only.

import type { DigestPayload } from "./aggregator";

const QUIET_THRESHOLD = 3;

function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}${path}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function composeSubject(payload: DigestPayload): string {
  const n = payload.totalActionItems;
  if (n <= QUIET_THRESHOLD) {
    return `Quiet day — ${n} item${n === 1 ? "" : "s"} on your case digest`;
  }
  return `Your case digest — ${n} items need attention`;
}

export function composeDigestEmail(
  payload: DigestPayload,
  aiCommentary: string,
): { subject: string; html: string; text: string } {
  const subject = composeSubject(payload);
  const html = renderHtml(payload, aiCommentary);
  const text = renderText(payload, aiCommentary);
  return { subject, html, text };
}

function renderSection(title: string, rows: string[]): string {
  if (rows.length === 0) return "";
  return `
  <tr><td style="padding:16px 24px 8px;font-size:14px;font-weight:600;color:#18181b;border-top:1px solid #e4e4e7;">${escapeHtml(title)}</td></tr>
  ${rows
    .map(
      (r) =>
        `<tr><td style="padding:6px 24px;font-size:14px;color:#3f3f46;line-height:1.5;">${r}</td></tr>`,
    )
    .join("\n")}`;
}

function renderHtml(payload: DigestPayload, ai: string): string {
  const dlRows = payload.upcomingDeadlines.map(
    (d) =>
      `<strong>${escapeHtml(d.caseName)}</strong> — ${escapeHtml(d.title)} <span style="color:${d.daysUntil <= 2 ? "#dc2626" : "#a16207"};font-weight:600;">due in ${d.daysUntil}d (${escapeHtml(d.dueDate)})</span>`,
  );
  const msgRows = payload.unreadClientMessages.map(
    (m) => `<strong>${escapeHtml(m.caseName)}</strong>: "${escapeHtml(m.preview)}"`,
  );
  const replyRows = payload.unreadEmailReplies.map(
    (r) =>
      `<strong>${escapeHtml(r.caseName)}</strong> — ${escapeHtml(r.from)}: ${escapeHtml(r.subject)}`,
  );
  const intakeRows = payload.newIntakeSubmissions.map(
    (i) =>
      `New submission${i.submitterName ? ` from <strong>${escapeHtml(i.submitterName)}</strong>` : ""} (${escapeHtml(new Date(i.submittedAt).toLocaleString())})`,
  );
  const otherRows: string[] = [];
  if (payload.pendingSuggestedTimeEntries.count > 0) {
    otherRows.push(
      `<strong>${payload.pendingSuggestedTimeEntries.count}</strong> suggested time entr${payload.pendingSuggestedTimeEntries.count === 1 ? "y" : "ies"} pending review`,
    );
  }
  for (const o of payload.overdueDiscoveryResponses) {
    otherRows.push(
      `<strong>${escapeHtml(o.caseName)}</strong> — overdue discovery: ${escapeHtml(o.setTitle)} (${o.daysOverdue}d)`,
    );
  }
  for (const s of payload.todayStageChanges) {
    otherRows.push(`<strong>${escapeHtml(s.caseName)}</strong> moved to <em>${escapeHtml(s.toStage)}</em>`);
  }

  const aiHtml = escapeHtml(ai)
    .split(/\n\n+/)
    .map((p) => `<p style="margin:0 0 12px;">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;margin:32px 0;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7;">
        <tr><td style="padding:24px 24px 8px;font-size:18px;font-weight:700;color:#18181b;">ClearTerms — Daily Digest</td></tr>
        <tr><td style="padding:0 24px 16px;font-size:14px;color:#71717a;">Hi ${escapeHtml(payload.user.name)} — here's your snapshot for ${escapeHtml(payload.date)}.</td></tr>
        <tr><td style="padding:0 24px 16px;">
          <div style="background:#f4f4f5;border-left:3px solid #18181b;padding:16px;border-radius:4px;font-size:14px;color:#27272a;line-height:1.6;">${aiHtml}</div>
        </td></tr>
        ${renderSection("Upcoming deadlines (next 7 days)", dlRows)}
        ${renderSection("Awaiting your response", [...msgRows, ...replyRows])}
        ${renderSection("New intake submissions", intakeRows)}
        ${renderSection("Other items", otherRows)}
        <tr><td style="padding:24px;border-top:1px solid #e4e4e7;font-size:12px;color:#a1a1aa;line-height:1.6;">
          <a href="${appUrl("/settings/notifications")}" style="color:#3f3f46;">Configure digest preferences</a> ·
          <a href="${appUrl("/settings/digest-history")}" style="color:#3f3f46;">View digest history</a> ·
          <a href="${appUrl("/settings/notifications")}" style="color:#3f3f46;">Unsubscribe from this frequency</a>
          <br><br>
          This is an automated digest from ClearTerms. AI commentary is not legal advice.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function renderText(payload: DigestPayload, ai: string): string {
  const lines: string[] = [];
  lines.push(`ClearTerms Daily Digest — ${payload.date}`);
  lines.push(`Hi ${payload.user.name},`);
  lines.push("");
  lines.push(ai);
  lines.push("");
  if (payload.upcomingDeadlines.length > 0) {
    lines.push("UPCOMING DEADLINES");
    for (const d of payload.upcomingDeadlines) {
      lines.push(`- ${d.caseName}: ${d.title} (due in ${d.daysUntil}d, ${d.dueDate})`);
    }
    lines.push("");
  }
  if (payload.unreadClientMessages.length > 0) {
    lines.push("UNREAD CLIENT MESSAGES");
    for (const m of payload.unreadClientMessages) {
      lines.push(`- ${m.caseName}: ${m.preview}`);
    }
    lines.push("");
  }
  if (payload.unreadEmailReplies.length > 0) {
    lines.push("UNREAD EMAIL REPLIES");
    for (const r of payload.unreadEmailReplies) {
      lines.push(`- ${r.caseName} from ${r.from}: ${r.subject}`);
    }
    lines.push("");
  }
  if (payload.newIntakeSubmissions.length > 0) {
    lines.push(`NEW INTAKE SUBMISSIONS: ${payload.newIntakeSubmissions.length}`);
    lines.push("");
  }
  if (payload.pendingSuggestedTimeEntries.count > 0) {
    lines.push(`PENDING TIME ENTRIES: ${payload.pendingSuggestedTimeEntries.count}`);
  }
  if (payload.overdueDiscoveryResponses.length > 0) {
    lines.push("OVERDUE DISCOVERY:");
    for (const o of payload.overdueDiscoveryResponses) {
      lines.push(`- ${o.caseName}: ${o.setTitle} (${o.daysOverdue}d overdue)`);
    }
  }
  if (payload.todayStageChanges.length > 0) {
    lines.push("STAGE CHANGES TODAY:");
    for (const s of payload.todayStageChanges) {
      lines.push(`- ${s.caseName} → ${s.toStage}`);
    }
  }
  lines.push("");
  lines.push(`Manage preferences: ${appUrl("/settings/notifications")}`);
  return lines.join("\n");
}
