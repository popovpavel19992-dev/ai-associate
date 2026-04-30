// Note: `documents.kind` does not exist in the schema yet. v1 eagerly embeds
// every successfully-extracted document (cost guard lives at the credits
// layer). If/when a `kind` column is added, reintroduce a STRATEGIC_DOC_KINDS
// filter here to skip irrelevant uploads (intake forms, billing attachments,
// etc.) and reduce embedding spend.

export const VOYAGE_MODEL = "voyage-law-2";
export const VOYAGE_DIM = 1024;
export const STRATEGY_REFRESH_COST = 10;
export const STRATEGY_CHAT_COST = 1;
export const STRATEGY_RATE_LIMIT_MINUTES = 5;
export const STRATEGY_INPUT_HASH_TTL_HOURS = 24;
export const CHUNK_MAX_TOKENS = 800; // Voyage law-2 max ~16k; we keep chunks small
export const CHUNK_OVERLAP_TOKENS = 100;
