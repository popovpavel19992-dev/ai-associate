export type MotionType = "motion_to_dismiss" | "motion_for_summary_judgment" | "motion_to_compel";

export type SectionKey = "facts" | "argument" | "conclusion";

export type SkeletonSection =
  | { key: string; type: "merge"; required?: boolean }
  | { key: string; type: "static"; text: string }
  | { key: SectionKey; type: "ai"; heading: string };

export interface MotionSkeleton {
  sections: SkeletonSection[];
}

export interface Citation {
  memoId: string;
  snippet: string;
}

export interface MotionSectionContent {
  text: string;
  aiGenerated: boolean;
  citations: Citation[];
}

export type MotionSections = Partial<Record<SectionKey, MotionSectionContent>>;

export interface MotionCaption {
  court: string;
  district: string;
  plaintiff: string;
  defendant: string;
  caseNumber: string;
  documentTitle: string;
}

export interface AttachedMemo {
  id: string;
  title: string;
  content: string;
}
