// Approximate token-bounded chunking. We use whitespace-split words as a
// proxy for tokens — within ±20% of true tokenizer count for English legal
// text, which is fine for an 800-token budget. If accuracy ever matters,
// swap for tiktoken; not needed for v1.
export interface ChunkOptions {
  maxTokens: number;
  overlapTokens: number;
}

export function chunkText(text: string, opts: ChunkOptions): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (words.length <= opts.maxTokens) return [words.join(" ")];

  const step = Math.max(1, opts.maxTokens - opts.overlapTokens);
  const chunks: string[] = [];
  for (let start = 0; start < words.length; start += step) {
    const slice = words.slice(start, start + opts.maxTokens);
    if (slice.length === 0) break;
    chunks.push(slice.join(" "));
    if (start + opts.maxTokens >= words.length) break;
  }
  return chunks;
}
