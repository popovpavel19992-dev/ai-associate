# 2.4.5 Service Tracking — Design

**Phase:** 2.4.5 (Court Filing Prep → Service Tracking)
**Date:** 2026-04-24
**Status:** Spec — awaiting plan
**Milestone:** Fifth and final sub-phase of Phase 2.4. Builds on 2.4.1 deadlines, 2.4.3 package CoS renderer, 2.4.4 case_filings entity.

## 1. Goal

After submitting a filing (2.4.4), the lawyer records who was served and how (opposing counsel via CM/ECF NEF, pro se party via certified mail, co-defendant via email, etc.). The system:
- Maintains a case-level `case_parties` registry so party details are entered once and reused across filings
- Captures service records per (filing, party) with method / served_at / tracking reference / address snapshot
- Renders a filled "Certificate of Service" PDF that can be attached to the next filing's package (auto-included in 2.4.3 package build when services exist; standalone download available)
- Offers opt-in FRCP 6(d) "mail rule" — when service method is mail-like, proposes a +3-day shift on linked response deadlines
- Lives inside the existing 2.4.4 `FilingDetailModal` — no new case tab, no new notifications

No actual transmission. Vendor-API delivery (Lob, Resend, fax gateway) is explicit non-goal for v1.

## 2. Non-goals

- **Actual transmission** (Lob certified mail, Resend email, fax gateway) — 2.4.5b
- **NEF email auto-ingest** — auto-create CM/ECF services by parsing court confirmation emails — 2.4.5c
- **Proof-of-delivery image upload** (scanned green cards / signed receipts) — depends on AWS infra gap
- **Cross-case / org-wide party contacts registry** — use 2.1.5 `client_contacts` for firm-wide people; `case_parties` is intentionally case-scoped
- **Bulk party import** (CSV of opposing counsel) — 2.4.5c
- **Reminder notifications** ("serve Party X before deadline")
- **`service_recorded` notifications** to team — per-service noise; service is a lawyer's internal bookkeeping
- **Automatic service generation** when filing is created (some courts require explicit serve-list) — explicit per-party entry only
- **Multiple services of same (filing, party) pair** — UNIQUE constraint; use notes/edit to refine
- **Re-open closed filing for service edit** — follows 2.4.4 immutability rule on closed filings
- **Internationalization** — service labels English only

## 3. Key decisions

| # | Decision | Chosen | Alternatives rejected | Rationale |
|---|----------|--------|----------------------|-----------|
| 1 | Scope | **Record-only (no transmission)** | Full delivery via Resend/Lob; hybrid email-only | CM/ECF NEF already auto-serves registered counsel; vendor integration is multi-week work without proportional legal value; manual records cover 80% case |
| 2 | Parties source | **Case-level `case_parties` registry + checkbox picker + inline create** | Ad-hoc entry each service; reuse `client_contacts` | Opposing counsel repeats across filings on a case; client_contacts semantically represents firm's clients not opposing parties |
| 3 | Methods + tracking | **7 methods (cm_ecf_nef / email / mail / certified_mail / overnight / hand_delivery / fax) + `tracking_reference` nullable field** | 4 methods (basic); open enum + "other" | Federal practice uses these 7 routinely; certified + overnight require receipts; free-text breaks reports and filters |
| 4 | FRCP 6(d) mail rule integration | **Warning + opt-in modal at service creation; bulk +3 day shift on affected deadlines** | Auto-shift on service insert; manual-only | Auto-shift is magical and hard to undo when method changes; manual-only invites legal malpractice; opt-in surfaces the rule + lets lawyer decide |
| 5 | Certificate of Service PDF | **Both — package inline replacement + standalone `/api/filings/[id]/cos` endpoint** | Only package inline; only standalone | Default-correct + escape hatch for late-added services after package finalized |
| 6 | UI placement | **Inline "Parties served" section inside existing FilingDetailModal (2.4.4); no new tab; no notifications** | Dedicated Services case tab; `all_parties_served` milestone notification | Services are per-filing artifact; cross-filing services view is low-value until user feedback demands it (YAGNI) |
| 7 | Address/email snapshot | **Captured at service creation; party.email changes don't retroactively alter records** | Always dynamic (live-join) | Service is a historical claim — "I served Jane at this address on this date"; party record may update later without invalidating proof |
| 8 | Mail rule idempotency | **Deadline `shifted_reason` text field doubles as idempotency marker** | Separate applied-rules table | Free-text already exists on deadlines; "FRCP 6(d) mail rule" substring match prevents double-apply; cheap |
| 9 | Duplicate prevention | **UNIQUE `(filing_id, party_id)` — one row per party per filing** | Multiple entries allowed (re-service records) | Single record keeps CoS clean; updates/corrections via edit; re-service to same party for different filing is fine (different filing_id) |
| 10 | Party delete semantics | **FK restrict — block party delete if services reference it** | Cascade delete services; set null | Cascade loses historical proof; set null orphans record. Restrict forces lawyer to intentionally delete services first or keep party |

## 4. Data model

### 4.1 `case_parties`

```sql
CREATE TABLE case_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  name text NOT NULL,
  role text NOT NULL,
  email text,
  address text,
  phone text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_parties_role_check CHECK (
    role IN ('opposing_counsel','co_defendant','co_plaintiff','pro_se','third_party','witness','other')
  )
);

CREATE INDEX case_parties_case_idx ON case_parties(case_id);
CREATE INDEX case_parties_org_name_idx ON case_parties(org_id, name);
```

### 4.2 `case_filing_services`

```sql
CREATE TABLE case_filing_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  filing_id uuid NOT NULL REFERENCES case_filings(id) ON DELETE cascade,
  party_id uuid NOT NULL REFERENCES case_parties(id) ON DELETE restrict,
  method text NOT NULL,
  served_at timestamptz NOT NULL,
  served_email text,
  served_address text,
  tracking_reference text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_filing_services_method_check CHECK (
    method IN ('cm_ecf_nef','email','mail','certified_mail','overnight','hand_delivery','fax')
  ),
  CONSTRAINT case_filing_services_unique_per_filing_party UNIQUE (filing_id, party_id)
);

CREATE INDEX case_filing_services_filing_idx ON case_filing_services(filing_id);
CREATE INDEX case_filing_services_party_idx ON case_filing_services(party_id);
```

## 5. Service API (tRPC)

### 5.1 `parties` router (`src/server/trpc/routers/parties.ts`)

- `listByCase({ caseId })` — `CaseParty[]`, ordered by `role` then `name`; access-checked via `assertCaseAccess`
- `create({ caseId, name, role, email?, address?, phone?, notes? })`
- `update({ partyId, name?, role?, email?, address?, phone?, notes? })`
- `delete({ partyId })` — FK restrict catches the services-exist case; return 409 with message "Party has N recorded services. Delete services first or keep the party."

### 5.2 `services` router (`src/server/trpc/routers/services.ts`)

- `listByFiling({ filingId })` — rows joined with party name + role for UI convenience. Access via filing's caseId.

- `listUnservedParties({ filingId })` — parties on the case NOT yet in services table for this filing (used by AddServiceModal dropdown filter)

- `create({ filingId, partyId, method, servedAt, trackingReference?, notes? })`:
  - Verify party.case_id === filing.case_id; else 400
  - Verify filing.status === 'submitted' (closed filings immutable); else 403
  - Snapshot `party.email` into `served_email`, `party.address` into `served_address`
  - Check UNIQUE; return 400 "Party already served for this filing" on conflict
  - Insert row
  - If `method IN ('mail','certified_mail')`:
    - Query `case_deadlines` joined through filing.motion_id → case_trigger_events → case_deadlines, filter status active (not dismissed), compute `+3 calendar days` proposals
    - Return `{ service, mailRuleApplicable: true, affectedDeadlines: Array<{ deadlineId, currentDue, proposedDue, title }> }`
  - Else: return `{ service, mailRuleApplicable: false, affectedDeadlines: [] }`

- `applyMailRule({ filingId })`:
  - Verify at least one service on filing has mail-like method (else 400 "No mail service on this filing")
  - For each linked deadline: check `shifted_reason` does not already contain "FRCP 6(d) mail rule" → skip if yes, else update `due_date += 3 days`, append `shifted_reason = (existing || '') + '; FRCP 6(d) mail rule'`
  - Return `{ shifted: number, skipped: number }`

- `update({ serviceId, method?, servedAt?, trackingReference?, notes? })` — no party change (delete + recreate if lawyer wants a different party); 403 if parent filing is closed

- `delete({ serviceId })` — 403 if parent filing is closed

### 5.3 Register both routers in `src/server/trpc/root.ts`

```ts
import { partiesRouter } from "./routers/parties";
import { servicesRouter } from "./routers/services";
// ...
parties: partiesRouter,
services: servicesRouter,
```

## 6. CoS PDF renderer

### 6.1 Modify `src/server/services/packages/renderers/certificate-of-service.tsx`

Extend prop type:

```ts
interface ServiceEntry {
  partyName: string;
  partyRole: string;
  method: string;
  servedAt: string; // ISO
  servedEmail?: string | null;
  servedAddress?: string | null;
  trackingReference?: string | null;
}

interface CoSProps {
  caption: CoverSheetData;
  signer: SignerInfo;
  services?: ServiceEntry[];
}
```

Behavior:
- If `services` is undefined or empty: render existing generic "served via CM/ECF" boilerplate (unchanged for 2.4.3 backwards compat)
- Else: render "On the date signed above, I served the foregoing on the following:" then bullet list:
  - `{partyName} ({roleLabel}) — via {methodLabel} at {servedEmail || servedAddress || 'record'}{trackingRef ? `; tracking: ${trackingRef}` : ''} on {servedAtLocale}`

Method/role label maps:
```ts
const METHOD_LABELS = {
  cm_ecf_nef: "CM/ECF (Notice of Electronic Filing)",
  email: "email",
  mail: "first-class mail",
  certified_mail: "certified mail, return receipt requested",
  overnight: "overnight courier",
  hand_delivery: "hand delivery",
  fax: "fax",
};
const ROLE_LABELS = {
  opposing_counsel: "Opposing Counsel",
  co_defendant: "Co-Defendant",
  co_plaintiff: "Co-Plaintiff",
  pro_se: "Pro Se Party",
  third_party: "Third Party",
  witness: "Witness",
  other: "Party",
};
```

### 6.2 Modify `src/server/services/packages/build.ts`

In the orchestrator, before rendering the CoS component:
- If `pkg.motionId`: query `case_filings` where `motion_id = pkg.motion_id AND status = 'submitted'`; for each filing, join services + parties; aggregate service entries across filings (usually 1 filing per motion)
- Pass `services` array (empty if none) to `CertificateOfService` component

### 6.3 Standalone API route

`src/app/api/filings/[filingId]/cos/route.ts`:
- GET handler with Clerk auth + case access (match `/api/motions/[id]/docx` pattern)
- Loads filing, caption (from filing.motion → motion.caption or from filing.case), signer (filing.submittedBy → user.name), services + parties
- Renders CoS via `renderToBuffer` + returns PDF with `Content-Disposition: attachment; filename="{court-safe}-CoS-{date}.pdf"`
- 400 if filing has zero services

## 7. UI

### 7.1 FilingDetailModal expansion (`src/components/cases/filings/filing-detail-modal.tsx`)

Add new section between the existing `<dl>` fields and action buttons:

```tsx
<section>
  <header className="flex items-center justify-between">
    <h3>Parties served ({services.length})</h3>
    {!isClosed && (
      <button onClick={() => setAddOpen(true)}>+ Add service</button>
    )}
  </header>
  {services.length === 0 && <p>No parties recorded. Add service entries to generate a Certificate of Service.</p>}
  <ul>
    {services.map(s => (
      <li>
        {s.partyName} ({ROLE_LABELS[s.partyRole]}) · {METHOD_LABELS[s.method]}
         · {new Date(s.servedAt).toLocaleDateString()}
         {s.trackingReference && ` · #${s.trackingReference}`}
        {!isClosed && (<>
          <button onClick={editService}>Edit</button>
          <button onClick={deleteService}>×</button>
        </>)}
      </li>
    ))}
  </ul>
  {services.length > 0 && (
    <a href={`/api/filings/${filingId}/cos`}>Download Certificate of Service</a>
  )}
</section>
```

Query: `trpc.services.listByFiling({ filingId })`. Delete / edit mutations wired identically to pattern from 2.4.4 FilingDetailModal.

### 7.2 AddServiceModal (new, `src/components/cases/filings/add-service-modal.tsx`)

Fields:
- **Party:** dropdown of `services.listUnservedParties({ filingId })`. Format: "{name} — {roleLabel}". Below dropdown: "Don't see the party? [+ New party]" button → opens inline party creation form (name/role/email/address/phone) without dismissing the outer modal; on save, refetch `listUnservedParties` and auto-select the new party
- **Method:** select, 7 options with human labels
- **Served at:** datetime-local default now
- **Tracking reference:** text input, visible only when method in `['certified_mail','overnight','fax']`
- **Notes:** textarea

On submit:
- `services.create` → if response `mailRuleApplicable && affectedDeadlines.length > 0`: close this modal, open `ApplyMailRuleModal` with deadline preview
- Else: close modal, refetch services list

### 7.3 ApplyMailRuleModal (new, `src/components/cases/filings/apply-mail-rule-modal.tsx`)

Shown after creating a mail/certified_mail service:
- Header: "Service by mail adds 3 days to response deadlines (FRCP 6(d))"
- List:
  - `{deadline.title}: {currentDue} → {proposedDue}` per affected deadline
- Buttons: "Apply +3 days" (calls `services.applyMailRule`) / "Skip for now"

On apply: toast "Shifted N deadlines" + invalidate `deadlines.listByCase` query so FilingDetailModal / DeadlinesTab reflect changes.

### 7.4 Case parties management — lightweight

Inside FilingDetailModal (or on case page — TBD), expose a small "Case parties" gear icon that opens a `PartiesManagerModal` listing all case parties with inline edit/delete. Used for pre-registration and cleanup. Reuses `parties` router procedures.

Decision: place it as a small button **at the top of the "Parties served" section** in FilingDetailModal labeled "Manage case parties" — discoverable where lawyers need it most. No case-detail-page entry to avoid tab sprawl.

### 7.5 No changes to 2.4.4 firm-level /filings page

Services visible only inside the detail modal. Future enhancement: optional "served: 3/5" column on firm-page table (deferred per YAGNI).

## 8. Guardrails / errors

- **Delete party with services:** FK restrict → 409 "Party has N recorded services..."
- **Create duplicate service:** UNIQUE → 400 "Party already served for this filing"
- **Mail rule double-apply:** `shifted_reason` substring check → 400 "Mail rule already applied to deadline X"
- **Create service on closed filing:** 403 "Closed filings are immutable"
- **Service update changing partyId:** disallowed in API — delete + recreate
- **Mail rule with zero affected deadlines:** create returns `mailRuleApplicable: true, affectedDeadlines: []` — UI doesn't show modal
- **Case mismatch:** `create` rejects if `party.case_id !== filing.case_id` → 400
- **CoS API for filing with zero services:** 400 "No services recorded"

## 9. Testing

**Unit:**
- CoS renderer: empty services → generic boilerplate; N services → bullet list with correct labels (snapshot)
- Mail rule date calculator: +3 calendar days preserving time, respects end-of-month edges
- `shifted_reason` idempotency substring check
- Party role / method label maps coverage

**Integration (tRPC):**
- Full happy path: create party → create service → verify snapshot of email/address → delete service → verify party unaffected
- Party delete with service → 409
- Duplicate service → 400
- Create mail service → response includes mailRuleApplicable + affectedDeadlines
- applyMailRule shifts deadlines by 3 days; second call no-ops (or reports skipped=N)
- Create/edit/delete on closed filing → 403
- Case mismatch → 400

**E2E smoke:**
- Route reachability: `/api/filings/{id}/cos` returns status < 500
- FilingDetailModal "+ Add service" → modal → submit flow renders

## 10. Migration / rollout

1. Migration `0025_service_tracking.sql`: both tables + indexes + check constraints
2. Drizzle schemas
3. tRPC routers (parties + services)
4. CoS renderer expansion + build.ts hook
5. Standalone CoS API route
6. UI: FilingDetailModal section + AddServiceModal + ApplyMailRuleModal + PartiesManagerModal
7. E2E + full suite
8. PR + manual UAT + merge

Feature is additive — no flag needed. Existing 2.4.3 package CoS behavior preserved (generic fallback when no services).

## 11. Dependencies

- New: none
- Reuse: 2.4.4 `case_filings` + FilingDetailModal; 2.4.3 CoS renderer + build.ts + pdf-lib merge; 2.4.1 `case_deadlines` table + deadlines service; Sonner (global Toaster); react-pdf

## 12. Open questions

None blocking. Vendor transmission, NEF auto-ingest, image proof-of-delivery, cross-case party registry, bulk import, and service notifications are explicit non-goals tracked for 2.4.5b/5c.
