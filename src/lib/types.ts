import type { AVAILABLE_SECTIONS } from "./constants";

export type Plan = "trial" | "solo" | "small_firm" | "firm_plus";
export type CaseStatus = "draft" | "processing" | "ready" | "failed";
export type DocumentStatus = "uploading" | "extracting" | "analyzing" | "ready" | "failed";
export type FileType = "pdf" | "docx" | "image";
export type SectionName = (typeof AVAILABLE_SECTIONS)[number];

export type ContractStatus = "draft" | "uploading" | "extracting" | "analyzing" | "ready" | "failed";
export type ClauseType = "standard" | "unusual" | "favorable" | "unfavorable";
export type ClauseRiskLevel = "critical" | "warning" | "info" | "ok";
export type DiffType = "added" | "removed" | "modified" | "unchanged";
export type Impact = "positive" | "negative" | "neutral";
export type ComparisonStatus = "draft" | "processing" | "ready" | "failed";
export type ClauseSeverity = "critical" | "warning" | "info";
export type MissingClauseImportance = "critical" | "recommended" | "optional";
export type NegotiationPriority = "high" | "medium" | "low";
