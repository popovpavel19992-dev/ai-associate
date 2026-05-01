import type { Citation, DocChunk } from "@/server/services/case-strategy/types";

export interface TemplateOption {
  id: string;
  slug: string;
  name: string;
  description: string;
}

export interface ClassifyResult {
  templateId: string | null;
  confidence: number;
  reasoning: string;
}

export interface DrafterContext {
  chunks: DocChunk[];
  citedEntities: Citation[];
  fromRecommendationId: string;
  generatedAt: string;
}

export interface SuggestionResult {
  template: { id: string; slug: string; name: string } | null;
  confidence: number;
  suggestedTitle: string;
  citedEntities: Citation[];
  autoPulledChunks: DocChunk[];
  suggestedFromCache: boolean;
}
