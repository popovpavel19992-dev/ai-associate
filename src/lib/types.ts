import type { AVAILABLE_SECTIONS } from "./constants";

export type Plan = "trial" | "solo" | "small_firm" | "firm_plus";
export type CaseStatus = "draft" | "processing" | "ready" | "failed";
export type DocumentStatus = "uploading" | "extracting" | "analyzing" | "ready" | "failed";
export type FileType = "pdf" | "docx" | "image";
export type SectionName = (typeof AVAILABLE_SECTIONS)[number];
