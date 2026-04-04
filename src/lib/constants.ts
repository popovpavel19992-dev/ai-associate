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

export const PRACTICE_AREAS = [
  "personal_injury",
  "family_law",
  "criminal_defense",
  "traffic_defense",
  "contract_dispute",
  "employment_law",
  "real_estate",
  "immigration",
  "bankruptcy",
  "intellectual_property",
  "corporate",
  "other",
] as const;

export const PRACTICE_AREA_LABELS: Record<string, string> = {
  personal_injury: "Personal Injury",
  family_law: "Family Law",
  criminal_defense: "Criminal Defense",
  traffic_defense: "Traffic Defense",
  contract_dispute: "Contract Disputes",
  employment_law: "Employment Law",
  real_estate: "Real Estate",
  immigration: "Immigration",
  bankruptcy: "Bankruptcy",
  intellectual_property: "Intellectual Property",
  corporate: "Corporate Law",
  other: "Other",
};

export const CASE_TYPES = [
  "personal_injury",
  "family_law",
  "traffic_defense",
  "contract_dispute",
  "criminal_defense",
  "employment_law",
  "general",
] as const;

export const CASE_TYPE_LABELS: Record<string, string> = {
  personal_injury: "Personal Injury",
  family_law: "Family Law",
  traffic_defense: "Traffic Defense",
  contract_dispute: "Contract Dispute",
  criminal_defense: "Criminal Defense",
  employment_law: "Employment Law",
  general: "General",
};

export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
] as const;

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

export const CONTRACT_TYPES = [
  "employment_agreement",
  "nda_confidentiality",
  "service_agreement",
  "lease_rental",
  "settlement_agreement",
  "purchase_sale",
  "partnership_operating",
  "independent_contractor",
  "non_compete",
  "loan_promissory",
  "generic",
] as const;

export const CONTRACT_TYPE_LABELS: Record<string, string> = {
  employment_agreement: "Employment Agreement",
  nda_confidentiality: "NDA / Confidentiality",
  service_agreement: "Service Agreement",
  lease_rental: "Lease / Rental",
  settlement_agreement: "Settlement Agreement",
  purchase_sale: "Purchase / Sale Agreement",
  partnership_operating: "Partnership / Operating Agreement",
  independent_contractor: "Independent Contractor Agreement",
  non_compete: "Non-Compete / Non-Solicitation",
  loan_promissory: "Loan / Promissory Note",
  generic: "Generic Contract",
};

export const CONTRACT_ANALYSIS_SECTIONS = [
  "executive_summary",
  "key_terms",
  "obligations",
  "risk_assessment",
  "red_flags",
  "clauses",
  "missing_clauses",
  "negotiation_points",
  "governing_law",
  "defined_terms",
] as const;

export const CONTRACT_SECTION_LABELS: Record<string, string> = {
  executive_summary: "Executive Summary",
  key_terms: "Key Terms",
  obligations: "Obligations & Deadlines",
  risk_assessment: "Risk Assessment",
  red_flags: "Red Flags",
  clauses: "Clause-by-Clause",
  missing_clauses: "Missing Clauses",
  negotiation_points: "Negotiation Points",
  governing_law: "Governing Law",
  defined_terms: "Defined Terms",
};

export const CONTRACT_REVIEW_CREDITS = 2;
export const COMPARISON_DIFF_CREDITS = 1;
