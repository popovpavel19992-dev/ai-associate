// src/server/services/document-templates/merge-renderer.ts
//
// Phase 3.12 — merge tag rendering for document templates.
//
// Body templates use `{{key}}` syntax. Keys are flat strings (no dotted
// lookup); a key like `client.name` is just a literal map key.
//
// Type-aware formatting:
//   - currency  -> value is integer cents, formatted "$1,234.56"
//   - date      -> value is ISO date "YYYY-MM-DD", formatted "April 29, 2026"
//   - other     -> value is rendered as-is
//
// Missing-key behavior:
//   - default ("placeholder") replaces with `[MISSING: key]` so the gap is
//     visible in the rendered PDF and won't silently ship blank
//   - "leave" preserves the `{{key}}` so it can be filled later

import type { VariableDef } from "@/server/db/schema/document-templates";

export interface RenderContext {
  values: Record<string, string>;
  variables?: VariableDef[];
  missing?: "placeholder" | "leave";
}

const TAG_RE = /\{\{\s*([a-zA-Z0-9_.\-]+)\s*\}\}/g;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatCurrencyCents(centsInput: string | number): string {
  const cents = typeof centsInput === "number" ? centsInput : Number(centsInput);
  if (!Number.isFinite(cents)) return String(centsInput);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const dollarsFormatted = dollars.toLocaleString("en-US");
  const formatted = `$${dollarsFormatted}.${remainder.toString().padStart(2, "0")}`;
  return negative ? `-${formatted}` : formatted;
}

export function formatDateLong(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month >= 1 && month <= 12) {
      return MONTHS[month - 1] + " " + day + ", " + year;
    }
  }
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear();
  }
  return value;
}

function formatValue(raw: string, varDef: VariableDef | undefined): string {
  if (!varDef) return raw;
  switch (varDef.type) {
    case "currency":
      return formatCurrencyCents(raw);
    case "date":
      return formatDateLong(raw);
    default:
      return raw;
  }
}

export function renderBody(template: string, context: RenderContext): string {
  const missingMode = context.missing ?? "placeholder";
  const varByKey = new Map<string, VariableDef>();
  for (const v of context.variables ?? []) varByKey.set(v.key, v);

  return template.replace(TAG_RE, (_match, key: string) => {
    const raw = context.values[key];
    if (raw === undefined || raw === null || raw === "") {
      return missingMode === "leave" ? "{{" + key + "}}" : "[MISSING: " + key + "]";
    }
    return formatValue(raw, varByKey.get(key));
  });
}

export function extractMergeTags(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(template)) !== null) {
    const key = m[1];
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

export interface AutoFillScope {
  client?: {
    displayName?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
  } | null;
  case?: {
    name?: string | null;
    caseNumber?: string | null;
    description?: string | null;
    opposingParty?: string | null;
  } | null;
  firm?: {
    name?: string | null;
    address?: string | null;
    attorneyName?: string | null;
    barNumber?: string | null;
  } | null;
}

function joinAddress(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join("\n");
}

export function autoFillFromContext(
  variables: VariableDef[],
  scope: AutoFillScope,
): Record<string, string> {
  const today = new Date();
  const pad2 = (n: number): string => (n < 10 ? "0" + n : "" + n);
  const todayIso =
    today.getFullYear() + "-" + pad2(today.getMonth() + 1) + "-" + pad2(today.getDate());

  const clientAddress = scope.client
    ? joinAddress([
        scope.client.addressLine1,
        scope.client.addressLine2,
        // Format: "City, ST ZIP" — comma after city, space between state and zip.
        (() => {
          const cityPart = scope.client.city && String(scope.client.city).trim()
            ? String(scope.client.city).trim()
            : "";
          const stateZip = [scope.client.state, scope.client.zipCode]
            .filter((p): p is string => Boolean(p && String(p).trim()))
            .map((p) => String(p).trim())
            .join(" ");
          if (cityPart && stateZip) return cityPart + ", " + stateZip;
          return cityPart || stateZip;
        })(),
      ])
    : "";

  const sources: Record<string, string | undefined> = {
    "client.name": scope.client?.displayName ?? undefined,
    "client.address": clientAddress || undefined,
    "case.name": scope.case?.name ?? undefined,
    "case.number": scope.case?.caseNumber ?? undefined,
    "case.description": scope.case?.description ?? undefined,
    "matter.description": scope.case?.description ?? undefined,
    "opposing.name": scope.case?.opposingParty ?? undefined,
    "firm.name": scope.firm?.name ?? undefined,
    "firm.address": scope.firm?.address ?? undefined,
    "firm.attorney_name": scope.firm?.attorneyName ?? undefined,
    "firm.bar_number": scope.firm?.barNumber ?? undefined,
    "agreement.date": todayIso,
  };

  const out: Record<string, string> = {};
  for (const v of variables) {
    const candidate = sources[v.key];
    if (candidate !== undefined && candidate !== null && String(candidate).length > 0) {
      out[v.key] = String(candidate);
    } else if (v.defaultValue !== undefined && v.defaultValue !== null && v.defaultValue !== "") {
      out[v.key] = v.defaultValue;
    }
  }
  return out;
}
