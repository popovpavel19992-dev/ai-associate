import type { CASE_TYPES } from "./constants";

export type CaseType = (typeof CASE_TYPES)[number];

export const EVENT_TYPES = [
  "stage_changed",
  "document_added",
  "analysis_completed",
  "manual",
  "contract_linked",
  "draft_linked",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_CATEGORIES = [
  "filing",
  "research",
  "client_communication",
  "evidence",
  "court",
  "administrative",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export interface StageTemplate {
  slug: string;
  name: string;
  description: string;
  color: string;
  tasks: {
    title: string;
    description?: string;
    priority: TaskPriority;
    category: TaskCategory;
  }[];
}

export const STAGE_TEMPLATES: Record<CaseType, StageTemplate[]> = {
  personal_injury: [
    {
      slug: "intake",
      name: "Intake",
      description: "Initial consultation, case evaluation, retainer agreement",
      color: "#3B82F6",
      tasks: [
        { title: "Schedule initial consultation", priority: "high", category: "client_communication" },
        { title: "Evaluate case merits", priority: "high", category: "research" },
        { title: "Prepare retainer agreement", priority: "medium", category: "filing" },
      ],
    },
    {
      slug: "investigation",
      name: "Investigation",
      description: "Gather evidence, police reports, witness statements",
      color: "#8B5CF6",
      tasks: [
        { title: "Obtain police report", priority: "high", category: "evidence" },
        { title: "Identify and contact witnesses", priority: "high", category: "evidence" },
        { title: "Photograph accident scene", priority: "medium", category: "evidence" },
      ],
    },
    {
      slug: "medical-treatment",
      name: "Medical Treatment",
      description: "Track treatment, collect medical records, calculate expenses",
      color: "#EC4899",
      tasks: [
        { title: "Collect medical records", priority: "high", category: "evidence" },
        { title: "Schedule IME appointment", priority: "medium", category: "administrative" },
        { title: "Track treatment progress", priority: "medium", category: "administrative" },
        { title: "Calculate medical expenses", priority: "medium", category: "research" },
      ],
    },
    {
      slug: "demand-negotiation",
      name: "Demand & Negotiation",
      description: "Demand letter, insurance negotiation, settlement offers",
      color: "#F59E0B",
      tasks: [
        { title: "Draft demand letter", priority: "high", category: "filing" },
        { title: "Send demand to insurance", priority: "high", category: "client_communication" },
        { title: "Review settlement offers", priority: "high", category: "research" },
      ],
    },
    {
      slug: "litigation",
      name: "Litigation",
      description: "File complaint, discovery, depositions, motions",
      color: "#EF4444",
      tasks: [
        { title: "File complaint", priority: "urgent", category: "court" },
        { title: "Prepare discovery requests", priority: "high", category: "filing" },
        { title: "Schedule depositions", priority: "high", category: "court" },
      ],
    },
    {
      slug: "settlement-trial",
      name: "Settlement / Trial",
      description: "Final settlement or trial proceedings, verdict",
      color: "#10B981",
      tasks: [
        { title: "Prepare trial exhibits", priority: "urgent", category: "court" },
        { title: "Review final settlement offer", priority: "urgent", category: "research" },
      ],
    },
    {
      slug: "closed",
      name: "Closed",
      description: "Case resolved, final billing, file archival",
      color: "#6B7280",
      tasks: [
        { title: "Prepare final billing", priority: "medium", category: "administrative" },
        { title: "Archive case files", priority: "low", category: "administrative" },
      ],
    },
  ],
  family_law: [
    {
      slug: "intake",
      name: "Intake",
      description: "Consultation, gather family info, assess situation",
      color: "#3B82F6",
      tasks: [
        { title: "Conduct initial consultation", priority: "high", category: "client_communication" },
        { title: "Gather family information", priority: "high", category: "research" },
      ],
    },
    {
      slug: "filing",
      name: "Filing",
      description: "Prepare and file petition, serve opposing party",
      color: "#8B5CF6",
      tasks: [
        { title: "Prepare petition", priority: "high", category: "filing" },
        { title: "File with court", priority: "urgent", category: "court" },
        { title: "Arrange service of process", priority: "high", category: "court" },
      ],
    },
    {
      slug: "discovery",
      name: "Discovery",
      description: "Financial disclosure, asset investigation, depositions",
      color: "#EC4899",
      tasks: [
        { title: "Prepare financial disclosure", priority: "high", category: "filing" },
        { title: "Investigate assets", priority: "high", category: "research" },
      ],
    },
    {
      slug: "mediation",
      name: "Mediation",
      description: "Attempt mediation, negotiate agreements",
      color: "#F59E0B",
      tasks: [
        { title: "Schedule mediation session", priority: "high", category: "court" },
        { title: "Prepare mediation brief", priority: "high", category: "filing" },
      ],
    },
    {
      slug: "hearing-trial",
      name: "Hearing / Trial",
      description: "Court hearings, trial preparation, testimony",
      color: "#EF4444",
      tasks: [
        { title: "Prepare for hearing", priority: "urgent", category: "court" },
        { title: "Organize witness testimony", priority: "high", category: "evidence" },
      ],
    },
    {
      slug: "order-decree",
      name: "Order / Decree",
      description: "Final order, decree entry, enforcement setup",
      color: "#10B981",
      tasks: [
        { title: "Review final order", priority: "high", category: "filing" },
        { title: "Set up enforcement plan", priority: "medium", category: "administrative" },
      ],
    },
    {
      slug: "closed",
      name: "Closed",
      description: "Case finalized, compliance monitoring complete",
      color: "#6B7280",
      tasks: [
        { title: "Archive case files", priority: "low", category: "administrative" },
      ],
    },
  ],
  traffic_defense: [
    {
      slug: "intake",
      name: "Intake",
      description: "Review citation, assess options, enter plea",
      color: "#3B82F6",
      tasks: [
        { title: "Review citation details", priority: "high", category: "research" },
        { title: "Assess defense options", priority: "high", category: "research" },
      ],
    },
    {
      slug: "evidence-review",
      name: "Evidence Review",
      description: "Obtain dashcam/bodycam, review officer notes",
      color: "#8B5CF6",
      tasks: [
        { title: "Request dashcam/bodycam footage", priority: "high", category: "evidence" },
        { title: "Review officer notes", priority: "high", category: "evidence" },
      ],
    },
    {
      slug: "negotiation",
      name: "Negotiation",
      description: "Negotiate with prosecutor, plea bargain",
      color: "#F59E0B",
      tasks: [
        { title: "Contact prosecutor", priority: "high", category: "court" },
        { title: "Negotiate plea bargain", priority: "high", category: "court" },
      ],
    },
    {
      slug: "court-hearing",
      name: "Court Hearing",
      description: "Attend hearing, present defense",
      color: "#EF4444",
      tasks: [
        { title: "Prepare court appearance", priority: "urgent", category: "court" },
        { title: "Present defense arguments", priority: "urgent", category: "court" },
      ],
    },
    {
      slug: "closed",
      name: "Closed",
      description: "Case resolved, record updated",
      color: "#6B7280",
      tasks: [
        { title: "Update client records", priority: "low", category: "administrative" },
      ],
    },
  ],
  contract_dispute: [
    {
      slug: "intake",
      name: "Intake",
      description: "Review contract, identify breach, assess damages",
      color: "#3B82F6",
      tasks: [
        { title: "Review contract terms", priority: "high", category: "research" },
        { title: "Identify breach points", priority: "high", category: "research" },
        { title: "Assess potential damages", priority: "high", category: "research" },
      ],
    },
    {
      slug: "contract-analysis",
      name: "Contract Analysis",
      description: "Detailed clause analysis, legal research",
      color: "#8B5CF6",
      tasks: [
        { title: "Analyze key clauses", priority: "high", category: "research" },
        { title: "Research applicable law", priority: "high", category: "research" },
      ],
    },
    {
      slug: "demand-letter",
      name: "Demand Letter",
      description: "Draft and send demand letter",
      color: "#EC4899",
      tasks: [
        { title: "Draft demand letter", priority: "high", category: "filing" },
        { title: "Send to opposing party", priority: "high", category: "client_communication" },
      ],
    },
    {
      slug: "negotiation",
      name: "Negotiation",
      description: "Settlement discussions, mediation",
      color: "#F59E0B",
      tasks: [
        { title: "Initiate settlement discussions", priority: "high", category: "client_communication" },
        { title: "Evaluate settlement offers", priority: "high", category: "research" },
      ],
    },
    {
      slug: "litigation-arbitration",
      name: "Litigation / Arbitration",
      description: "File suit or initiate arbitration",
      color: "#EF4444",
      tasks: [
        { title: "File complaint or arbitration demand", priority: "urgent", category: "court" },
        { title: "Prepare discovery", priority: "high", category: "filing" },
      ],
    },
    {
      slug: "resolution",
      name: "Resolution",
      description: "Settlement agreement or judgment",
      color: "#10B981",
      tasks: [
        { title: "Finalize settlement agreement", priority: "high", category: "filing" },
      ],
    },
    {
      slug: "closed",
      name: "Closed",
      description: "Enforced, paid, archived",
      color: "#6B7280",
      tasks: [
        { title: "Archive case files", priority: "low", category: "administrative" },
      ],
    },
  ],
  criminal_defense: [
    {
      slug: "intake",
      name: "Intake",
      description: "Client interview, review charges, bail hearing",
      color: "#3B82F6",
      tasks: [
        { title: "Interview client", priority: "urgent", category: "client_communication" },
        { title: "Review charges", priority: "urgent", category: "research" },
        { title: "Attend bail hearing", priority: "urgent", category: "court" },
      ],
    },
    {
      slug: "investigation",
      name: "Investigation",
      description: "Gather evidence, interview witnesses, obtain reports",
      color: "#8B5CF6",
      tasks: [
        { title: "Gather evidence", priority: "high", category: "evidence" },
        { title: "Interview witnesses", priority: "high", category: "evidence" },
        { title: "Obtain police reports", priority: "high", category: "evidence" },
      ],
    },
    {
      slug: "arraignment",
      name: "Arraignment",
      description: "Formal charges, enter plea, set conditions",
      color: "#EC4899",
      tasks: [
        { title: "Prepare for arraignment", priority: "urgent", category: "court" },
        { title: "Enter plea", priority: "urgent", category: "court" },
      ],
    },
    {
      slug: "pre-trial",
      name: "Pre-Trial",
      description: "Motions, discovery, plea negotiations",
      color: "#F59E0B",
      tasks: [
        { title: "File pre-trial motions", priority: "high", category: "court" },
        { title: "Review prosecution discovery", priority: "high", category: "research" },
        { title: "Negotiate plea deal", priority: "high", category: "court" },
      ],
    },
    {
      slug: "trial",
      name: "Trial",
      description: "Jury selection, testimony, arguments, verdict",
      color: "#EF4444",
      tasks: [
        { title: "Prepare jury selection strategy", priority: "urgent", category: "court" },
        { title: "Prepare opening/closing statements", priority: "urgent", category: "court" },
      ],
    },
    {
      slug: "sentencing-acquittal",
      name: "Sentencing / Acquittal",
      description: "Sentencing hearing or acquittal proceedings",
      color: "#10B981",
      tasks: [
        { title: "Prepare sentencing memorandum", priority: "high", category: "filing" },
      ],
    },
    {
      slug: "closed",
      name: "Closed",
      description: "Case resolved, appeal window passed",
      color: "#6B7280",
      tasks: [
        { title: "Evaluate appeal options", priority: "medium", category: "research" },
        { title: "Archive case files", priority: "low", category: "administrative" },
      ],
    },
  ],
  employment_law: [
    {
      slug: "intake",
      name: "Intake",
      description: "Review employment situation, assess claims",
      color: "#3B82F6",
      tasks: [
        { title: "Review employment records", priority: "high", category: "research" },
        { title: "Assess potential claims", priority: "high", category: "research" },
      ],
    },
    {
      slug: "claim-assessment",
      name: "Claim Assessment",
      description: "Document violations, calculate damages",
      color: "#8B5CF6",
      tasks: [
        { title: "Document workplace violations", priority: "high", category: "evidence" },
        { title: "Calculate potential damages", priority: "high", category: "research" },
      ],
    },
    {
      slug: "agency-filing",
      name: "Agency Filing",
      description: "File with EEOC/state agency, await response",
      color: "#EC4899",
      tasks: [
        { title: "Prepare agency complaint", priority: "high", category: "filing" },
        { title: "File with EEOC/state agency", priority: "urgent", category: "court" },
      ],
    },
    {
      slug: "negotiation-mediation",
      name: "Negotiation / Mediation",
      description: "Severance negotiation, mediation",
      color: "#F59E0B",
      tasks: [
        { title: "Negotiate severance terms", priority: "high", category: "client_communication" },
        { title: "Prepare for mediation", priority: "high", category: "court" },
      ],
    },
    {
      slug: "litigation",
      name: "Litigation",
      description: "File lawsuit, discovery, depositions",
      color: "#EF4444",
      tasks: [
        { title: "File lawsuit", priority: "urgent", category: "court" },
        { title: "Conduct discovery", priority: "high", category: "filing" },
      ],
    },
    {
      slug: "resolution",
      name: "Resolution",
      description: "Settlement or verdict",
      color: "#10B981",
      tasks: [
        { title: "Finalize settlement agreement", priority: "high", category: "filing" },
      ],
    },
    {
      slug: "closed",
      name: "Closed",
      description: "Case resolved, compliance verified",
      color: "#6B7280",
      tasks: [
        { title: "Verify compliance with agreement", priority: "medium", category: "administrative" },
        { title: "Archive case files", priority: "low", category: "administrative" },
      ],
    },
  ],
  general: [
    {
      slug: "intake",
      name: "Intake",
      description: "Initial consultation, gather information",
      color: "#3B82F6",
      tasks: [
        { title: "Conduct initial consultation", priority: "high", category: "client_communication" },
        { title: "Gather relevant documents", priority: "high", category: "evidence" },
      ],
    },
    {
      slug: "research",
      name: "Research",
      description: "Legal research, document analysis",
      color: "#8B5CF6",
      tasks: [
        { title: "Research applicable law", priority: "high", category: "research" },
        { title: "Analyze key documents", priority: "high", category: "research" },
      ],
    },
    {
      slug: "active-work",
      name: "Active Work",
      description: "Primary legal work, client communication",
      color: "#F59E0B",
      tasks: [
        { title: "Execute primary legal strategy", priority: "high", category: "research" },
        { title: "Update client on progress", priority: "medium", category: "client_communication" },
      ],
    },
    {
      slug: "resolution",
      name: "Resolution",
      description: "Conclude matter, finalize documents",
      color: "#10B981",
      tasks: [
        { title: "Finalize resolution documents", priority: "high", category: "filing" },
      ],
    },
    {
      slug: "closed",
      name: "Closed",
      description: "Matter resolved, archived",
      color: "#6B7280",
      tasks: [
        { title: "Archive case files", priority: "low", category: "administrative" },
      ],
    },
  ],
};
