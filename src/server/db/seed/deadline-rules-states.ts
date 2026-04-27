// src/server/db/seed/deadline-rules-states.ts
// Phase 3.7 — multi-jurisdiction deadline rules for CA / TX / FL / NY.
// Seed rows are global (org_id = NULL). Idempotent on (jurisdiction, trigger_event, name).
// Statutes / sources cited inline. These are best-effort defaults — firms can clone + override
// in their own org. When a state-specific rule is absent the service layer falls back to FRCP.

import { db } from "../index";
import { deadlineRules } from "../schema/deadline-rules";
import { and, eq, isNull } from "drizzle-orm";

type StateRule = {
  triggerEvent: string;
  name: string;
  description: string;
  days: number;
  dayType: "calendar" | "court";
  citation: string;
};

const CA_RULES: StateRule[] = [
  // Pleadings & complaint
  { triggerEvent: "served_defendant", name: "Answer to Complaint Due", description: "Defendant must file answer or demurrer within 30 days of personal service of summons.", days: 30, dayType: "calendar", citation: "Cal. Civ. Proc. Code § 412.20(a)(3)" },
  { triggerEvent: "complaint_filed", name: "Serve Defendant Deadline", description: "Plaintiff must serve summons within 3 years of filing.", days: 1095, dayType: "calendar", citation: "Cal. Civ. Proc. Code § 583.210" },
  { triggerEvent: "served_defendant", name: "Demurrer Deadline", description: "Demurrer to complaint due within 30 days of service.", days: 30, dayType: "calendar", citation: "Cal. Civ. Proc. Code § 430.40(a)" },
  // Motions
  { triggerEvent: "motion_filed", name: "Opposition to Motion Due", description: "Opposition must be filed and served at least 9 court days before hearing.", days: -9, dayType: "court", citation: "Cal. Civ. Proc. Code § 1005(b)" },
  { triggerEvent: "motion_response_filed", name: "Reply Brief Due", description: "Reply must be filed and served at least 5 court days before hearing.", days: -5, dayType: "court", citation: "Cal. Civ. Proc. Code § 1005(b)" },
  { triggerEvent: "service_of_summary_judgment_motion", name: "Opposition to MSJ Due", description: "Opposition to MSJ due 14 days before hearing; MSJ must be served at least 81 days before hearing (105 if served by mail).", days: -14, dayType: "calendar", citation: "Cal. Civ. Proc. Code § 437c(b)(2)" },
  { triggerEvent: "service_of_msj_opposition", name: "Reply on MSJ Due", description: "Reply on MSJ due 5 days before hearing.", days: -5, dayType: "calendar", citation: "Cal. Civ. Proc. Code § 437c(b)(4)" },
  { triggerEvent: "service_of_motion_to_dismiss", name: "Response to Motion to Dismiss", description: "California uses demurrer; opposition due 9 court days before hearing.", days: -9, dayType: "court", citation: "Cal. Civ. Proc. Code § 1005(b)" },
  // Discovery
  { triggerEvent: "service_of_interrogatories", name: "Response to Interrogatories Due", description: "Responses due within 30 days of service (35 if served by mail).", days: 30, dayType: "calendar", citation: "Cal. Civ. Proc. Code § 2030.260(a)" },
  { triggerEvent: "service_of_rfp", name: "Response to Requests for Production Due", description: "Responses due within 30 days of service (35 if served by mail).", days: 30, dayType: "calendar", citation: "Cal. Civ. Proc. Code § 2031.260(a)" },
  { triggerEvent: "service_of_rfa", name: "Response to Requests for Admission Due", description: "Responses due within 30 days; matters deemed admitted if no response.", days: 30, dayType: "calendar", citation: "Cal. Civ. Proc. Code § 2033.250(a)" },
  { triggerEvent: "discovery_served", name: "Response to Written Discovery Due", description: "Generic written-discovery response window (CCP §§ 2030/2031/2033).", days: 30, dayType: "calendar", citation: "Cal. Civ. Proc. Code § 2030.260" },
  // Depositions
  { triggerEvent: "notice_of_deposition", name: "Minimum Deposition Notice Period", description: "Party deposition requires at least 10 calendar days' notice (plus 5 for mail service).", days: 10, dayType: "calendar", citation: "Cal. Civ. Proc. Code § 2025.270(a)" },
  // Experts
  { triggerEvent: "trial_scheduled", name: "Expert Witness Disclosure", description: "Simultaneous expert exchange 70 days before trial (or 50 days after demand, whichever is closer to trial).", days: -70, dayType: "calendar", citation: "Cal. Civ. Proc. Code § 2034.230(b)" },
  { triggerEvent: "expert_disclosure", name: "Supplemental Expert Disclosure", description: "Supplemental expert designation due 20 days after exchange.", days: 20, dayType: "calendar", citation: "Cal. Civ. Proc. Code § 2034.280(a)" },
  // Pretrial / trial
  { triggerEvent: "trial_scheduled", name: "Final Status / Trial Conference", description: "Final status conference typically held 1-3 weeks before trial; check local rules.", days: -14, dayType: "calendar", citation: "Cal. R. Ct. 3.722 (local variance)" },
  { triggerEvent: "trial_scheduled", name: "Motions in Limine Due", description: "Motions in limine generally due at the final status conference.", days: -14, dayType: "calendar", citation: "Cal. R. Ct. 3.1112" },
  { triggerEvent: "complaint_filed", name: "Jury Trial Fee Deposit", description: "Jury fees due no later than 365 days from filing or at first case management conference.", days: 365, dayType: "calendar", citation: "Cal. Civ. Proc. Code § 631(c)" },
  // Post-judgment / appeal
  { triggerEvent: "judgment_entered", name: "Notice of Appeal Deadline", description: "Civil notice of appeal due 60 days after notice of entry of judgment.", days: 60, dayType: "calendar", citation: "Cal. R. Ct. 8.104(a)" },
  { triggerEvent: "judgment_entered", name: "Motion for New Trial Deadline", description: "Motion for new trial must be served and filed within 15 days of notice of entry.", days: 15, dayType: "calendar", citation: "Cal. Civ. Proc. Code § 659(a)" },
  // Statutes of limitations
  { triggerEvent: "statute_of_limitations_contract", name: "SOL — Written Contract", description: "Action on a written contract: 4 years from breach.", days: 1460, dayType: "calendar", citation: "Cal. Civ. Proc. Code § 337(a)" },
  { triggerEvent: "statute_of_limitations_personal_injury", name: "SOL — Personal Injury", description: "Action for personal injury: 2 years from injury.", days: 730, dayType: "calendar", citation: "Cal. Civ. Proc. Code § 335.1" },
  { triggerEvent: "statute_of_limitations_employment_discrimination", name: "SOL — FEHA Employment Discrimination", description: "Civil action under FEHA: 1 year after right-to-sue (DFEH).", days: 365, dayType: "calendar", citation: "Cal. Gov. Code § 12965(c)(1)(C)" },
  { triggerEvent: "statute_of_limitations_property_damage", name: "SOL — Property Damage", description: "Action for injury to real or personal property: 3 years.", days: 1095, dayType: "calendar", citation: "Cal. Civ. Proc. Code § 338(b)–(c)" },
  { triggerEvent: "statute_of_limitations_fraud", name: "SOL — Fraud", description: "Fraud / mistake: 3 years from discovery.", days: 1095, dayType: "calendar", citation: "Cal. Civ. Proc. Code § 338(d)" },
];

const TX_RULES: StateRule[] = [
  // Pleadings
  { triggerEvent: "served_defendant", name: "Answer Due (Monday Rule)", description: "Defendant's answer due by 10:00 a.m. on the Monday following 20 days after service.", days: 20, dayType: "calendar", citation: "Tex. R. Civ. P. 99(b)" },
  { triggerEvent: "complaint_filed", name: "Citation Issuance", description: "Plaintiff should request issuance of citation contemporaneously with petition filing.", days: 0, dayType: "calendar", citation: "Tex. R. Civ. P. 99(a)" },
  { triggerEvent: "served_defendant", name: "Special Appearance Deadline", description: "Special appearance must be filed before any other plea, pleading, or motion.", days: 20, dayType: "calendar", citation: "Tex. R. Civ. P. 120a(1)" },
  // Motions
  { triggerEvent: "motion_filed", name: "Response to Motion Due", description: "Response to motion due at least 3 days before hearing (TRCP 21).", days: -3, dayType: "calendar", citation: "Tex. R. Civ. P. 21(b)" },
  { triggerEvent: "service_of_summary_judgment_motion", name: "Response to MSJ Due", description: "Response to MSJ due 7 days before hearing; MSJ must be filed and served at least 21 days before hearing.", days: -7, dayType: "calendar", citation: "Tex. R. Civ. P. 166a(c)" },
  { triggerEvent: "service_of_msj_opposition", name: "Reply on MSJ", description: "No specific TRCP deadline; courts typically allow until day before hearing.", days: -1, dayType: "calendar", citation: "Tex. R. Civ. P. 166a (local variance)" },
  { triggerEvent: "service_of_motion_to_dismiss", name: "Response to TRCP 91a Motion to Dismiss", description: "Response to TRCP 91a motion due at least 7 days before hearing; movant must file at least 21 days before hearing.", days: -7, dayType: "calendar", citation: "Tex. R. Civ. P. 91a.4" },
  // Discovery
  { triggerEvent: "service_of_interrogatories", name: "Response to Interrogatories Due", description: "Responses due within 30 days of service (50 if served before defendant's answer).", days: 30, dayType: "calendar", citation: "Tex. R. Civ. P. 197.2(a)" },
  { triggerEvent: "service_of_rfp", name: "Response to Requests for Production Due", description: "Responses due within 30 days of service (50 if served before answer).", days: 30, dayType: "calendar", citation: "Tex. R. Civ. P. 196.2(a)" },
  { triggerEvent: "service_of_rfa", name: "Response to Requests for Admission Due", description: "Responses due within 30 days; admissions deemed admitted if no response.", days: 30, dayType: "calendar", citation: "Tex. R. Civ. P. 198.2(a)" },
  { triggerEvent: "discovery_served", name: "Response to Written Discovery", description: "Generic 30-day discovery response window.", days: 30, dayType: "calendar", citation: "Tex. R. Civ. P. 196/197/198" },
  // Depositions
  { triggerEvent: "notice_of_deposition", name: "Minimum Deposition Notice Period", description: "Reasonable notice required; 'a reasonable time' generally interpreted as at least 5 calendar days.", days: 5, dayType: "calendar", citation: "Tex. R. Civ. P. 199.2(a)" },
  // Experts
  { triggerEvent: "trial_scheduled", name: "Expert Designation (Party with Burden)", description: "Party seeking affirmative relief must designate experts at least 90 days before end of discovery period.", days: -90, dayType: "calendar", citation: "Tex. R. Civ. P. 195.2(a)" },
  { triggerEvent: "trial_scheduled", name: "Expert Designation (Other Parties)", description: "Other parties must designate experts at least 60 days before end of discovery period.", days: -60, dayType: "calendar", citation: "Tex. R. Civ. P. 195.2(b)" },
  // Pretrial / trial
  { triggerEvent: "trial_scheduled", name: "Motions in Limine Hearing", description: "Motions in limine generally heard at pretrial conference; check court order.", days: -7, dayType: "calendar", citation: "Tex. R. Civ. P. 166" },
  { triggerEvent: "complaint_filed", name: "Jury Demand & Fee", description: "Jury demand must be filed a reasonable time before date set for trial, but not less than 30 days in advance.", days: -30, dayType: "calendar", citation: "Tex. R. Civ. P. 216" },
  // Post-judgment / appeal
  { triggerEvent: "judgment_entered", name: "Notice of Appeal Deadline", description: "Notice of appeal due within 30 days of judgment (90 if motion for new trial filed).", days: 30, dayType: "calendar", citation: "Tex. R. App. P. 26.1(a)" },
  { triggerEvent: "judgment_entered", name: "Motion for New Trial Deadline", description: "Motion for new trial must be filed within 30 days of judgment.", days: 30, dayType: "calendar", citation: "Tex. R. Civ. P. 329b(a)" },
  // SOL
  { triggerEvent: "statute_of_limitations_contract", name: "SOL — Written Contract / Debt", description: "Action on written contract: 4 years from accrual.", days: 1460, dayType: "calendar", citation: "Tex. Civ. Prac. & Rem. Code § 16.004(a)(3)" },
  { triggerEvent: "statute_of_limitations_personal_injury", name: "SOL — Personal Injury", description: "Action for personal injury: 2 years from injury.", days: 730, dayType: "calendar", citation: "Tex. Civ. Prac. & Rem. Code § 16.003(a)" },
  { triggerEvent: "statute_of_limitations_employment_discrimination", name: "SOL — TCHRA Employment Discrimination", description: "Charge with TWC must be filed within 180 days; civil suit within 60 days of right-to-sue + 2-year limit.", days: 180, dayType: "calendar", citation: "Tex. Lab. Code § 21.202" },
  { triggerEvent: "statute_of_limitations_property_damage", name: "SOL — Property Damage", description: "Action for property damage: 2 years.", days: 730, dayType: "calendar", citation: "Tex. Civ. Prac. & Rem. Code § 16.003(a)" },
  { triggerEvent: "statute_of_limitations_fraud", name: "SOL — Fraud", description: "Action for fraud: 4 years from discovery.", days: 1460, dayType: "calendar", citation: "Tex. Civ. Prac. & Rem. Code § 16.004(a)(4)" },
];

const FL_RULES: StateRule[] = [
  // Pleadings
  { triggerEvent: "served_defendant", name: "Answer to Complaint Due", description: "Defendant must serve answer within 20 days of service of process.", days: 20, dayType: "calendar", citation: "Fla. R. Civ. P. 1.140(a)(1)" },
  { triggerEvent: "complaint_filed", name: "Service of Process Deadline", description: "Plaintiff must serve initial process within 120 days of filing.", days: 120, dayType: "calendar", citation: "Fla. R. Civ. P. 1.070(j)" },
  { triggerEvent: "served_defendant", name: "Motion to Dismiss Filing Window", description: "Motion to dismiss may be filed in lieu of answer within 20 days.", days: 20, dayType: "calendar", citation: "Fla. R. Civ. P. 1.140(b)" },
  // Motions
  { triggerEvent: "motion_filed", name: "Response to Motion Due", description: "Generally responses due 5 days before hearing; check local administrative orders.", days: -5, dayType: "calendar", citation: "Fla. R. Jud. Admin. 2.516" },
  { triggerEvent: "service_of_summary_judgment_motion", name: "Opposition to MSJ Due", description: "Opposition due at least 40 days after service of motion (FRCP-aligned 2021 amendment); movant must serve at least 40 days before hearing.", days: 40, dayType: "calendar", citation: "Fla. R. Civ. P. 1.510(c)(1)" },
  { triggerEvent: "service_of_msj_opposition", name: "Reply on MSJ", description: "Reply due at least 20 days before hearing.", days: -20, dayType: "calendar", citation: "Fla. R. Civ. P. 1.510(c)(2)" },
  { triggerEvent: "service_of_motion_to_dismiss", name: "Response to Motion to Dismiss", description: "Response due 5 days before hearing under generic motion practice.", days: -5, dayType: "calendar", citation: "Fla. R. Jud. Admin. 2.516" },
  // Discovery
  { triggerEvent: "service_of_interrogatories", name: "Response to Interrogatories Due", description: "Responses due within 30 days of service; if served with summons, 45 days.", days: 30, dayType: "calendar", citation: "Fla. R. Civ. P. 1.340(a)" },
  { triggerEvent: "service_of_rfp", name: "Response to Requests for Production Due", description: "Responses due within 30 days of service.", days: 30, dayType: "calendar", citation: "Fla. R. Civ. P. 1.350(b)" },
  { triggerEvent: "service_of_rfa", name: "Response to Requests for Admission Due", description: "Responses due within 30 days; matters deemed admitted if no response.", days: 30, dayType: "calendar", citation: "Fla. R. Civ. P. 1.370(a)" },
  { triggerEvent: "discovery_served", name: "Response to Written Discovery", description: "Generic 30-day discovery response window.", days: 30, dayType: "calendar", citation: "Fla. R. Civ. P. 1.340/1.350/1.370" },
  // Depositions
  { triggerEvent: "notice_of_deposition", name: "Minimum Deposition Notice Period", description: "Reasonable notice required; 'reasonable' interpreted as at least a few days; statewide practice generally uses 7 days.", days: 7, dayType: "calendar", citation: "Fla. R. Civ. P. 1.310(b)(1)" },
  // Experts / pretrial
  { triggerEvent: "trial_scheduled", name: "Expert Disclosure", description: "Expert disclosures governed by case management order; commonly 90 days before trial.", days: -90, dayType: "calendar", citation: "Fla. R. Civ. P. 1.280(b)(5)" },
  { triggerEvent: "trial_scheduled", name: "Pretrial Conference", description: "Pretrial conference per local case management order; commonly 30 days before trial.", days: -30, dayType: "calendar", citation: "Fla. R. Civ. P. 1.200" },
  { triggerEvent: "trial_scheduled", name: "Motions in Limine", description: "Generally heard at pretrial conference per case management order.", days: -14, dayType: "calendar", citation: "Fla. R. Civ. P. 1.200" },
  // Post-judgment / appeal
  { triggerEvent: "judgment_entered", name: "Notice of Appeal Deadline", description: "Notice of appeal must be filed within 30 days of rendition of order.", days: 30, dayType: "calendar", citation: "Fla. R. App. P. 9.110(b)" },
  { triggerEvent: "judgment_entered", name: "Motion for Rehearing", description: "Motion for rehearing must be served within 15 days of judgment.", days: 15, dayType: "calendar", citation: "Fla. R. Civ. P. 1.530(b)" },
  // SOL
  { triggerEvent: "statute_of_limitations_contract", name: "SOL — Written Contract", description: "Action on a written contract: 5 years from breach.", days: 1825, dayType: "calendar", citation: "Fla. Stat. § 95.11(2)(b)" },
  { triggerEvent: "statute_of_limitations_personal_injury", name: "SOL — Personal Injury (Negligence)", description: "Negligence action: 2 years from accrual (effective Mar. 24, 2023).", days: 730, dayType: "calendar", citation: "Fla. Stat. § 95.11(4)(a) (2023 amend.)" },
  { triggerEvent: "statute_of_limitations_employment_discrimination", name: "SOL — Florida Civil Rights Act", description: "Charge must be filed with FCHR within 365 days; civil suit within 1 year of FCHR determination.", days: 365, dayType: "calendar", citation: "Fla. Stat. § 760.11" },
  { triggerEvent: "statute_of_limitations_property_damage", name: "SOL — Property Damage", description: "Action for damage to property founded on negligence: 2 years (post-2023). Otherwise statutory: 4 years.", days: 1460, dayType: "calendar", citation: "Fla. Stat. § 95.11(3)" },
  { triggerEvent: "statute_of_limitations_fraud", name: "SOL — Fraud", description: "Action for fraud: 4 years from discovery, max 12 years.", days: 1460, dayType: "calendar", citation: "Fla. Stat. § 95.11(3)(j)" },
];

const NY_RULES: StateRule[] = [
  // Pleadings
  { triggerEvent: "served_defendant", name: "Answer Due (Personal Service)", description: "Defendant must serve answer within 20 days when summons personally served on defendant in NY.", days: 20, dayType: "calendar", citation: "N.Y. C.P.L.R. § 3012(a)" },
  { triggerEvent: "served_defendant", name: "Answer Due (Mail / Other Service)", description: "Defendant must serve answer within 30 days when service made by mail or other non-personal means.", days: 30, dayType: "calendar", citation: "N.Y. C.P.L.R. § 3012(c)" },
  { triggerEvent: "complaint_filed", name: "Service of Summons Deadline", description: "Service must be made within 120 days of filing.", days: 120, dayType: "calendar", citation: "N.Y. C.P.L.R. § 306-b" },
  // Motions
  { triggerEvent: "motion_filed", name: "Answering Affidavit Due", description: "Answering affidavits served at least 7 days before motion return date (or 2 days when motion served at least 16 days before).", days: -7, dayType: "calendar", citation: "N.Y. C.P.L.R. § 2214(b)" },
  { triggerEvent: "motion_response_filed", name: "Reply Affidavit Due", description: "Reply affidavits served at least 1 day before return date.", days: -1, dayType: "calendar", citation: "N.Y. C.P.L.R. § 2214(b)" },
  { triggerEvent: "service_of_summary_judgment_motion", name: "Opposition to MSJ Due", description: "MSJ opposition under CPLR 2214(b) timing; 7 days before return date.", days: -7, dayType: "calendar", citation: "N.Y. C.P.L.R. § 3212; § 2214(b)" },
  { triggerEvent: "service_of_msj_opposition", name: "Reply on MSJ", description: "Reply affidavit due 1 day before return date.", days: -1, dayType: "calendar", citation: "N.Y. C.P.L.R. § 2214(b)" },
  { triggerEvent: "service_of_motion_to_dismiss", name: "Response to CPLR 3211 Motion", description: "Response served at least 7 days before return date per CPLR 2214(b).", days: -7, dayType: "calendar", citation: "N.Y. C.P.L.R. § 3211; § 2214(b)" },
  // Discovery
  { triggerEvent: "service_of_interrogatories", name: "Response to Interrogatories Due", description: "Responses due within 20 days of service.", days: 20, dayType: "calendar", citation: "N.Y. C.P.L.R. § 3133(a)" },
  { triggerEvent: "service_of_rfp", name: "Response to Notice for Discovery & Inspection", description: "Responses due within 20 days of service.", days: 20, dayType: "calendar", citation: "N.Y. C.P.L.R. § 3120(2)" },
  { triggerEvent: "service_of_rfa", name: "Response to Notice to Admit", description: "Response due within 20 days; matters deemed admitted if no response.", days: 20, dayType: "calendar", citation: "N.Y. C.P.L.R. § 3123(a)" },
  { triggerEvent: "discovery_served", name: "Response to Disclosure Demand", description: "Generic 20-day discovery response window per CPLR.", days: 20, dayType: "calendar", citation: "N.Y. C.P.L.R. art. 31" },
  // Depositions
  { triggerEvent: "notice_of_deposition", name: "Minimum Deposition Notice Period", description: "At least 20 days' notice required for examination before trial.", days: 20, dayType: "calendar", citation: "N.Y. C.P.L.R. § 3107" },
  // Experts / pretrial
  { triggerEvent: "trial_scheduled", name: "CPLR 3101(d) Expert Disclosure", description: "Expert disclosure required upon request; reasonable time before trial; commercial parts often require 60 days.", days: -60, dayType: "calendar", citation: "N.Y. C.P.L.R. § 3101(d)(1)(i)" },
  { triggerEvent: "trial_scheduled", name: "Pretrial Conference", description: "Pretrial conference per Uniform Rule 202.26; typically 30 days before trial.", days: -30, dayType: "calendar", citation: "22 NYCRR § 202.26" },
  { triggerEvent: "complaint_filed", name: "Note of Issue / Certificate of Readiness", description: "Note of issue required to place on trial calendar; typically filed at end of discovery.", days: 365, dayType: "calendar", citation: "22 NYCRR § 202.21" },
  // Post-judgment / appeal
  { triggerEvent: "judgment_entered", name: "Notice of Appeal Deadline", description: "Notice of appeal must be filed within 30 days of service of judgment with notice of entry.", days: 30, dayType: "calendar", citation: "N.Y. C.P.L.R. § 5513(a)" },
  { triggerEvent: "judgment_entered", name: "Post-Trial Motion Deadline", description: "Motion to set aside verdict / for new trial: within 15 days of verdict.", days: 15, dayType: "calendar", citation: "N.Y. C.P.L.R. § 4405" },
  // SOL
  { triggerEvent: "statute_of_limitations_contract", name: "SOL — Contract", description: "Action on contract: 6 years from breach.", days: 2190, dayType: "calendar", citation: "N.Y. C.P.L.R. § 213(2)" },
  { triggerEvent: "statute_of_limitations_personal_injury", name: "SOL — Personal Injury", description: "Personal injury action: 3 years from injury.", days: 1095, dayType: "calendar", citation: "N.Y. C.P.L.R. § 214(5)" },
  { triggerEvent: "statute_of_limitations_employment_discrimination", name: "SOL — NYSHRL Employment Discrimination", description: "NYSHRL civil action: 3 years; NYC HRL: 3 years; SDHR administrative complaint: 1 year (3 for sexual harassment).", days: 1095, dayType: "calendar", citation: "N.Y. Exec. Law § 297(9); CPLR 214(2)" },
  { triggerEvent: "statute_of_limitations_property_damage", name: "SOL — Property Damage", description: "Action for injury to property: 3 years.", days: 1095, dayType: "calendar", citation: "N.Y. C.P.L.R. § 214(4)" },
  { triggerEvent: "statute_of_limitations_fraud", name: "SOL — Fraud", description: "Fraud: 6 years from accrual or 2 years from discovery, whichever is longer.", days: 2190, dayType: "calendar", citation: "N.Y. C.P.L.R. § 213(8)" },
];

const ALL_STATE_RULES: Array<{ jurisdiction: "CA" | "TX" | "FL" | "NY"; rules: StateRule[] }> = [
  { jurisdiction: "CA", rules: CA_RULES },
  { jurisdiction: "TX", rules: TX_RULES },
  { jurisdiction: "FL", rules: FL_RULES },
  { jurisdiction: "NY", rules: NY_RULES },
];

export async function seedStateDeadlineRules(): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const { jurisdiction, rules } of ALL_STATE_RULES) {
    for (const r of rules) {
      const existing = await db
        .select({ id: deadlineRules.id })
        .from(deadlineRules)
        .where(
          and(
            isNull(deadlineRules.orgId),
            eq(deadlineRules.jurisdiction, jurisdiction),
            eq(deadlineRules.triggerEvent, r.triggerEvent),
            eq(deadlineRules.name, r.name),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      await db.insert(deadlineRules).values({
        orgId: null,
        triggerEvent: r.triggerEvent,
        name: r.name,
        description: r.description,
        days: r.days,
        dayType: r.dayType,
        shiftIfHoliday: true,
        defaultReminders: [7, 3, 1],
        jurisdiction,
        citation: r.citation,
        active: true,
      });
      inserted++;
    }
  }

  return { inserted, skipped };
}

export const STATE_RULE_COUNTS = {
  CA: CA_RULES.length,
  TX: TX_RULES.length,
  FL: FL_RULES.length,
  NY: NY_RULES.length,
} as const;
