// tests/unit/document-templates-merge-renderer.test.ts
//
// Phase 3.12 — merge tag renderer + auto-fill unit tests.

import { describe, it, expect } from "vitest";
import {
  renderBody,
  extractMergeTags,
  formatCurrencyCents,
  formatDateLong,
  autoFillFromContext,
} from "@/server/services/document-templates/merge-renderer";
import type { VariableDef } from "@/server/db/schema/document-templates";

describe("3.12 merge renderer — renderBody", () => {
  it("replaces all known {{key}} tags", () => {
    const body = "Hello {{client.name}}, dated {{agreement.date}}.";
    const out = renderBody(body, {
      values: { "client.name": "Acme Corp", "agreement.date": "2026-04-29" },
      variables: [
        { key: "client.name", label: "Client", type: "text", required: true },
        { key: "agreement.date", label: "Date", type: "date", required: true },
      ],
    });
    expect(out).toBe("Hello Acme Corp, dated April 29, 2026.");
  });

  it("default missing-key behavior is [MISSING: key]", () => {
    const out = renderBody("Hello {{client.name}}, fee {{fee.amount}}.", {
      values: { "client.name": "Acme" },
    });
    expect(out).toBe("Hello Acme, fee [MISSING: fee.amount].");
  });

  it("missing=leave preserves the {{key}} tag for later filling", () => {
    const out = renderBody("Hello {{client.name}}, fee {{fee.amount}}.", {
      values: { "client.name": "Acme" },
      missing: "leave",
    });
    expect(out).toBe("Hello Acme, fee {{fee.amount}}.");
  });

  it("formats currency-typed variables from cents to $X,XXX.YY", () => {
    const out = renderBody("Retainer: {{fee.amount}}.", {
      values: { "fee.amount": "1234567" },
      variables: [{ key: "fee.amount", label: "Fee", type: "currency", required: true }],
    });
    expect(out).toBe("Retainer: $12,345.67.");
  });

  it("formats date-typed variables in long format", () => {
    const out = renderBody("Date: {{d}}.", {
      values: { d: "2026-01-05" },
      variables: [{ key: "d", label: "D", type: "date", required: true }],
    });
    expect(out).toBe("Date: January 5, 2026.");
  });

  it("treats text-typed variables as raw values", () => {
    const out = renderBody("Hi {{c}}.", {
      values: { c: "$42 (literal)" },
      variables: [{ key: "c", label: "C", type: "text", required: true }],
    });
    expect(out).toBe("Hi $42 (literal).");
  });

  it("repeats values across multiple occurrences of the same tag", () => {
    const out = renderBody("{{x}} and {{x}} again", { values: { x: "OK" } });
    expect(out).toBe("OK and OK again");
  });

  it("tolerates whitespace inside braces", () => {
    const out = renderBody("Hi {{ name }}.", { values: { name: "Sam" } });
    expect(out).toBe("Hi Sam.");
  });
});

describe("3.12 merge renderer — extractMergeTags", () => {
  it("returns the unique set of tag keys in first-occurrence order", () => {
    const body = "{{a}} {{b}} {{a}} {{c.d}} {{ b }}";
    expect(extractMergeTags(body)).toEqual(["a", "b", "c.d"]);
  });

  it("returns empty array when no tags present", () => {
    expect(extractMergeTags("plain text only")).toEqual([]);
  });

  it("does not match malformed tags", () => {
    expect(extractMergeTags("{ x } {{}} {{!nope}}")).toEqual([]);
  });
});

describe("3.12 merge renderer — formatters", () => {
  it("currency: zero, small, negative, large", () => {
    expect(formatCurrencyCents(0)).toBe("$0.00");
    expect(formatCurrencyCents(7)).toBe("$0.07");
    expect(formatCurrencyCents("99")).toBe("$0.99");
    expect(formatCurrencyCents(100)).toBe("$1.00");
    expect(formatCurrencyCents(123456)).toBe("$1,234.56");
    expect(formatCurrencyCents(-2500)).toBe("-$25.00");
    expect(formatCurrencyCents(100000000)).toBe("$1,000,000.00");
  });

  it("date: ISO YYYY-MM-DD parses without timezone drift", () => {
    expect(formatDateLong("2026-04-29")).toBe("April 29, 2026");
    expect(formatDateLong("2026-12-01")).toBe("December 1, 2026");
    expect(formatDateLong("2026-01-31")).toBe("January 31, 2026");
  });

  it("date: passes through unparseable inputs", () => {
    expect(formatDateLong("not-a-date")).toBe("not-a-date");
  });
});

describe("3.12 merge renderer — autoFillFromContext", () => {
  const VARS: VariableDef[] = [
    { key: "client.name", label: "Client", type: "text", required: true },
    { key: "client.address", label: "Addr", type: "textarea", required: false },
    { key: "firm.name", label: "Firm", type: "text", required: true },
    { key: "firm.attorney_name", label: "Attorney", type: "text", required: true },
    { key: "matter.description", label: "Matter", type: "textarea", required: false },
    { key: "agreement.date", label: "Date", type: "date", required: true },
    { key: "fee.contingency_percent", label: "Pct", type: "number", required: true, defaultValue: "33" },
    { key: "unmappable.thing", label: "X", type: "text", required: false },
  ];

  it("fills client/firm/case fields where available", () => {
    const out = autoFillFromContext(VARS, {
      client: {
        displayName: "Acme Corp",
        addressLine1: "100 Main St",
        addressLine2: null,
        city: "New York",
        state: "NY",
        zipCode: "10001",
      },
      case: { name: "Acme v. Roadrunner", description: "Breach of contract", caseNumber: "123", opposingParty: "RR" },
      firm: { name: "Smith & Doe LLP", attorneyName: "Jane Esq.", address: null, barNumber: null },
    });
    expect(out["client.name"]).toBe("Acme Corp");
    expect(out["client.address"]).toBe("100 Main St\nNew York, NY 10001");
    expect(out["firm.name"]).toBe("Smith & Doe LLP");
    expect(out["firm.attorney_name"]).toBe("Jane Esq.");
    expect(out["matter.description"]).toBe("Breach of contract");
    expect(out["agreement.date"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out["fee.contingency_percent"]).toBe("33"); // from defaultValue
    expect("unmappable.thing" in out).toBe(false);
  });

  it("does not fabricate values when scope has nothing", () => {
    const out = autoFillFromContext(
      [{ key: "client.name", label: "Client", type: "text", required: true }],
      {},
    );
    expect("client.name" in out).toBe(false);
  });
});
