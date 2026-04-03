export const PLAN_LIMITS = {
  trial: { credits: 3, maxDocsPerCase: 3, chatMessagesPerCase: 10 },
  solo: { credits: 50, maxDocsPerCase: 10, chatMessagesPerCase: 50 },
  small_firm: { credits: 200, maxDocsPerCase: 15, chatMessagesPerCase: Infinity },
  firm_plus: { credits: Infinity, maxDocsPerCase: 25, chatMessagesPerCase: Infinity },
} as const;

export const AVAILABLE_SECTIONS = [
  "timeline", "key_facts", "parties", "legal_arguments",
  "weak_points", "risk_assessment", "evidence_inventory",
  "applicable_laws", "deposition_questions", "obligations",
] as const;

export const SECTION_LABELS: Record<string, string> = {
  timeline: "Timeline",
  key_facts: "Key Facts",
  parties: "Parties & Roles",
  legal_arguments: "Legal Arguments",
  weak_points: "Weak Points & Vulnerabilities",
  risk_assessment: "Risk Assessment",
  evidence_inventory: "Evidence Inventory",
  applicable_laws: "Applicable Laws/Statutes",
  deposition_questions: "Suggested Deposition Questions",
  obligations: "Obligations & Deadlines",
};

export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const MAX_PAGES_PER_DOC = 50;
export const CASE_BRIEF_FREE_DOCS = 5;
export const CHAT_RATE_LIMIT_PER_HOUR = 30;
export const PIPELINE_CONCURRENCY = 5;
export const REALTIME_POLL_INTERVAL_MS = 10_000;
export const HYBRID_PDF_MIN_CHARS_PER_PAGE = 100;

export const AUTO_DELETE_DAYS = {
  trial: 30,
  solo: 60,
  small_firm: 90,
  firm_plus: 90,
} as const;

export const BANNED_WORDS = [
  "should", "recommend", "advise", "must", "legal advice", "your rights",
];

export const APPROVED_PHRASES = [
  "analysis indicates", "consider", "this clause means",
  "note that", "typically in similar cases",
];
