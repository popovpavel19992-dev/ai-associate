// src/server/services/email-outreach/classify.ts

export type ReplyKind = "human" | "auto_reply";

export interface ClassifyInput {
  headers: Record<string, string | undefined>;
  subject: string;
}

const AUTO_SUBJECT = /^(Out of Office|Automatic Reply|Auto[- ]?reply|I am (?:currently )?out of)/i;
const BOUNCE_SUBJECT = /^(Mail Delivery Failure|Undeliverable|Delivery Status Notification|Returned mail)/i;
const MAILER_DAEMON = /^(mailer-daemon|postmaster)@/i;
const BULK_PRECEDENCE = new Set(["bulk", "list", "junk", "auto_reply"]);

function headerLower(headers: Record<string, string | undefined>, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want) return v;
  }
  return undefined;
}

export function classifyReplyKind(input: ClassifyInput): ReplyKind {
  const autoSub = headerLower(input.headers, "auto-submitted");
  if (autoSub && autoSub.toLowerCase() !== "no") return "auto_reply";

  const precedence = headerLower(input.headers, "precedence");
  if (precedence && BULK_PRECEDENCE.has(precedence.toLowerCase())) return "auto_reply";

  const autoreply = headerLower(input.headers, "x-autoreply");
  if (autoreply && autoreply.toLowerCase() !== "no" && autoreply !== "") return "auto_reply";

  if (AUTO_SUBJECT.test(input.subject)) return "auto_reply";

  return "human";
}

export interface BounceInput {
  from: string;
  subject: string;
  headers: Record<string, string | undefined>;
}

export function isBounce(input: BounceInput): boolean {
  if (BOUNCE_SUBJECT.test(input.subject) && MAILER_DAEMON.test(input.from)) return true;
  if (BOUNCE_SUBJECT.test(input.subject)) return true;
  return false;
}
