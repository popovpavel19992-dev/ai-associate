// Subset of `documents.kind` values worth eager-embedding for strategy RAG.
// Anything outside this list embeds lazily on demand. Reconcile with the
// actual documents.kind enum during integration; if a value here doesn't
// exist in the enum it'll just never match — defensive.
export const STRATEGIC_DOC_KINDS: readonly string[] = [
  "pleading",
  "motion",
  "discovery_request",
  "discovery_response",
  "deposition_prep",
  "deposition_transcript",
  "settlement_offer",
  "demand_letter",
  "client_communication",
  "court_order",
  "filing",
  "research_memo",
  "expert_report",
  "exhibit",
] as const;

export const VOYAGE_MODEL = "voyage-law-2";
export const VOYAGE_DIM = 1024;
export const STRATEGY_REFRESH_COST = 10;
export const STRATEGY_CHAT_COST = 1;
export const STRATEGY_RATE_LIMIT_MINUTES = 5;
export const STRATEGY_INPUT_HASH_TTL_HOURS = 24;
export const CHUNK_MAX_TOKENS = 800; // Voyage law-2 max ~16k; we keep chunks small
export const CHUNK_OVERLAP_TOKENS = 100;
