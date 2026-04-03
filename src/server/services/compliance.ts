import { BANNED_WORDS, APPROVED_PHRASES } from "@/lib/constants";

interface StateComplianceConfig {
  disclaimer: string;
  disclosureRequirements: string[];
  supervisionRules: string;
  confidentialityNotes: string;
}

const STATE_COMPLIANCE: Record<string, StateComplianceConfig> = {
  CA: {
    disclaimer: "This AI-generated analysis is not legal advice. California Business and Professions Code Section 6125 restricts the practice of law to licensed attorneys. No attorney-client relationship is formed through use of this tool.",
    disclosureRequirements: ["Must disclose AI-assisted nature of analysis to clients", "California Rules of Professional Conduct Rule 1.1 requires competent representation"],
    supervisionRules: "AI output must be reviewed by a licensed California attorney before use in any legal proceeding.",
    confidentialityNotes: "California Evidence Code Section 954 protects attorney-client communications. Do not share AI outputs containing privileged information.",
  },
  NY: {
    disclaimer: "This AI-generated analysis is not legal advice. New York Judiciary Law Section 478 prohibits unauthorized practice of law. No attorney-client relationship is formed through use of this tool.",
    disclosureRequirements: ["NY Rules of Professional Conduct Rule 1.1 requires competence", "Must disclose AI use when material to client matter"],
    supervisionRules: "AI output must be reviewed by a licensed New York attorney before use in any legal proceeding.",
    confidentialityNotes: "CPLR Section 4503 protects attorney-client privilege. Ensure AI outputs with privileged information are properly safeguarded.",
  },
  FL: {
    disclaimer: "This AI-generated analysis is not legal advice. Florida Bar Rules Chapter 4 governs attorney conduct. No attorney-client relationship is formed through use of this tool.",
    disclosureRequirements: ["Florida Rules of Professional Conduct Rule 4-1.1 requires competence", "Must ensure AI analysis accuracy before reliance"],
    supervisionRules: "AI output must be reviewed by a licensed Florida attorney before use in any legal proceeding.",
    confidentialityNotes: "Florida Evidence Code Section 90.502 protects attorney-client communications.",
  },
  TX: {
    disclaimer: "This AI-generated analysis is not legal advice. Texas Government Code Section 81.101 defines the practice of law. No attorney-client relationship is formed through use of this tool.",
    disclosureRequirements: ["Texas Disciplinary Rules of Professional Conduct Rule 1.01 requires competence", "Must verify AI analysis independently"],
    supervisionRules: "AI output must be reviewed by a licensed Texas attorney before use in any legal proceeding.",
    confidentialityNotes: "Texas Rules of Evidence Rule 503 protects attorney-client privilege.",
  },
  IL: {
    disclaimer: "This AI-generated analysis is not legal advice. 705 ILCS 205/1 governs the practice of law in Illinois. No attorney-client relationship is formed through use of this tool.",
    disclosureRequirements: ["Illinois Rules of Professional Conduct Rule 1.1 requires competence"],
    supervisionRules: "AI output must be reviewed by a licensed Illinois attorney before use in any legal proceeding.",
    confidentialityNotes: "735 ILCS 5/8-803 protects attorney-client communications.",
  },
  PA: {
    disclaimer: "This AI-generated analysis is not legal advice. 42 Pa.C.S. Section 2524 governs unauthorized practice of law. No attorney-client relationship is formed through use of this tool.",
    disclosureRequirements: ["Pennsylvania Rules of Professional Conduct Rule 1.1 requires competence"],
    supervisionRules: "AI output must be reviewed by a licensed Pennsylvania attorney before use in any legal proceeding.",
    confidentialityNotes: "42 Pa.C.S. Section 5928 protects attorney-client privilege.",
  },
  OH: {
    disclaimer: "This AI-generated analysis is not legal advice. Ohio Revised Code Section 4705.01 governs the practice of law. No attorney-client relationship is formed through use of this tool.",
    disclosureRequirements: ["Ohio Rules of Professional Conduct Rule 1.1 requires competence"],
    supervisionRules: "AI output must be reviewed by a licensed Ohio attorney before use in any legal proceeding.",
    confidentialityNotes: "Ohio Revised Code Section 2317.02(A) protects attorney-client privilege.",
  },
  GA: {
    disclaimer: "This AI-generated analysis is not legal advice. O.C.G.A. Section 15-19-50 governs the practice of law in Georgia. No attorney-client relationship is formed through use of this tool.",
    disclosureRequirements: ["Georgia Rules of Professional Conduct Rule 1.1 requires competence"],
    supervisionRules: "AI output must be reviewed by a licensed Georgia attorney before use in any legal proceeding.",
    confidentialityNotes: "O.C.G.A. Section 24-5-501 protects attorney-client communications.",
  },
  NC: {
    disclaimer: "This AI-generated analysis is not legal advice. N.C. Gen. Stat. Section 84-4 governs the practice of law. No attorney-client relationship is formed through use of this tool.",
    disclosureRequirements: ["North Carolina Rules of Professional Conduct Rule 1.1 requires competence"],
    supervisionRules: "AI output must be reviewed by a licensed North Carolina attorney before use in any legal proceeding.",
    confidentialityNotes: "N.C. Gen. Stat. Section 8-53.3 protects attorney-client privilege.",
  },
  NJ: {
    disclaimer: "This AI-generated analysis is not legal advice. N.J.S.A. 2A:170-78 governs unauthorized practice of law. No attorney-client relationship is formed through use of this tool.",
    disclosureRequirements: ["New Jersey Rules of Professional Conduct Rule 1.1 requires competence"],
    supervisionRules: "AI output must be reviewed by a licensed New Jersey attorney before use in any legal proceeding.",
    confidentialityNotes: "N.J.S.A. 2A:84A-20 protects attorney-client communications.",
  },
};

const DEFAULT_COMPLIANCE: StateComplianceConfig = {
  disclaimer: "This AI-generated analysis is not legal advice. No attorney-client relationship is formed through use of this tool. All output must be independently verified by a licensed attorney.",
  disclosureRequirements: ["Must disclose AI-assisted nature of analysis when material to client matter"],
  supervisionRules: "AI output must be reviewed by a licensed attorney before use in any legal proceeding.",
  confidentialityNotes: "Ensure AI outputs containing privileged information are properly safeguarded under applicable privilege rules.",
};

export function scanForBannedWords(text: string): string[] {
  const lowerText = text.toLowerCase();
  return BANNED_WORDS.filter((word) => lowerText.includes(word.toLowerCase()));
}

export function shouldRegenerate(text: string): boolean {
  return scanForBannedWords(text).length >= 3;
}

export function getStateDisclaimer(state: string): string {
  return (STATE_COMPLIANCE[state] ?? DEFAULT_COMPLIANCE).disclaimer;
}

export function getReportDisclaimer(): string {
  return "IMPORTANT: This report was generated by artificial intelligence and is intended for informational purposes only. It does not constitute legal advice, legal opinion, or legal representation. The contents have not been reviewed or verified by a licensed attorney unless otherwise noted. Users are solely responsible for independently verifying all information and analysis before relying on it for any legal purpose.";
}

export function getComplianceRules(state: string): StateComplianceConfig {
  return STATE_COMPLIANCE[state] ?? DEFAULT_COMPLIANCE;
}

export function resolveJurisdiction(
  caseRecord: { jurisdictionOverride: string | null },
  user: { state: string | null },
): string | null {
  return caseRecord.jurisdictionOverride ?? user.state ?? null;
}

export function getCompliancePromptInstructions(state: string | null): string {
  const rules = state ? getComplianceRules(state) : DEFAULT_COMPLIANCE;
  const approvedList = APPROVED_PHRASES.map((p) => `"${p}"`).join(", ");
  const bannedList = BANNED_WORDS.map((w) => `"${w}"`).join(", ");

  return [
    "COMPLIANCE RULES (STRICT):",
    `- NEVER use these words/phrases: ${bannedList}`,
    `- PREFER these phrases instead: ${approvedList}`,
    "- Do NOT provide legal advice or recommendations",
    "- Present analysis as observations, not directives",
    `- Supervision: ${rules.supervisionRules}`,
    rules.disclosureRequirements.map((r) => `- ${r}`).join("\n"),
  ].join("\n");
}
