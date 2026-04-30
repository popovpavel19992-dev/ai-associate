export type CitationKind = "document" | "deadline" | "filing" | "motion" | "message";

export interface Citation {
  kind: CitationKind;
  id: string;
  excerpt?: string;
}

export interface CaseDigest {
  caseId: string;
  caption: { plaintiff: string | null; defendant: string | null; courtName: string | null };
  upcomingDeadlines: Array<{ id: string; title: string; dueDate: string }>;
  recentFilings: Array<{ id: string; title: string; filedAt: string | null }>;
  recentMotions: Array<{ id: string; title: string; status: string }>;
  recentMessages: Array<{ id: string; from: string; preview: string; at: string }>;
  documents: Array<{ id: string; kind: string | null; title: string }>;
  recentActivity: string;
}

export interface DocChunk {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

export interface CollectedContext {
  digest: CaseDigest;
  chunks: DocChunk[];
  validIds: {
    documents: Set<string>;
    deadlines: Set<string>;
    filings: Set<string>;
    motions: Set<string>;
    messages: Set<string>;
  };
}
