// tests/integration/email-outreach-service.test.ts
import { describe, it, expect } from "vitest";
import { EmailOutreachService } from "@/server/services/email-outreach/service";
import { substituteVariables, renderEmail } from "@/server/services/email-outreach/render";

function makeMockDb() {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; set: unknown }> = [];
  const deletes: Array<{ table: unknown }> = [];
  const selectQueue: unknown[][] = [];
  let idCounter = 0;
  const nextId = () => `row-${++idCounter}`;
  const db = {
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        inserts.push({ table: t, values: v });
        const row = { id: nextId(), ...(v as Record<string, unknown>) };
        return { returning: async () => [row] };
      },
    }),
    update: (t: unknown) => ({
      set: (s: unknown) => {
        updates.push({ table: t, set: s });
        return { where: () => Promise.resolve() };
      },
    }),
    delete: (t: unknown) => ({
      where: () => { deletes.push({ table: t }); return Promise.resolve(); },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectQueue.shift() ?? [],
          orderBy: async () => selectQueue.shift() ?? [],
        }),
        orderBy: async () => selectQueue.shift() ?? [],
      }),
    }),
    enqueue: (rows: unknown[]) => selectQueue.push(rows),
  } as any;
  return { db, inserts, updates, deletes };
}

describe("EmailOutreachService.createTemplate", () => {
  it("inserts template with trimmed name + createdBy", async () => {
    const { db, inserts } = makeMockDb();
    const svc = new EmailOutreachService({ db });
    const { templateId } = await svc.createTemplate({
      orgId: "o1",
      name: "  Intake Welcome  ",
      subject: "Welcome {{client_name}}",
      bodyMarkdown: "Hi {{client_first_name}},",
      createdBy: "u1",
    });
    expect(templateId).toBeTruthy();
    const v = inserts[0].values as Record<string, unknown>;
    expect(v.name).toBe("Intake Welcome");
    expect(v.orgId).toBe("o1");
    expect(v.createdBy).toBe("u1");
  });

  it("rejects empty name", async () => {
    const { db } = makeMockDb();
    const svc = new EmailOutreachService({ db });
    await expect(svc.createTemplate({
      orgId: "o1", name: "   ", subject: "s", bodyMarkdown: "b", createdBy: "u1",
    })).rejects.toThrow(/Name required/);
  });
});

describe("substituteVariables", () => {
  it("replaces known tokens", () => {
    expect(substituteVariables("Hi {{name}}!", { name: "Jane" })).toBe("Hi Jane!");
  });
  it("leaves unknown tokens literal", () => {
    expect(substituteVariables("Hello {{unknown}}", { name: "J" })).toBe("Hello {{unknown}}");
  });
  it("handles multiple substitutions", () => {
    expect(substituteVariables("{{a}} and {{b}}", { a: "1", b: "2" })).toBe("1 and 2");
  });
});

describe("renderEmail", () => {
  it("substitutes + renders markdown + sanitizes", () => {
    const out = renderEmail({
      subject: "Re: {{case_name}}",
      bodyMarkdown: "Hi **{{client_name}}**, see [portal]({{portal_url}}).",
      variables: {
        case_name: "Doe v. Smith",
        client_name: "John",
        portal_url: "https://example.com/p/1",
      },
    });
    expect(out.subject).toBe("Re: Doe v. Smith");
    expect(out.bodyHtml).toContain("<strong>John</strong>");
    expect(out.bodyHtml).toContain('href="https://example.com/p/1"');
  });
  it("strips script tags", () => {
    const out = renderEmail({
      subject: "x",
      bodyMarkdown: "<script>alert(1)</script>hello",
      variables: {},
    });
    expect(out.bodyHtml).not.toContain("<script>");
    expect(out.bodyHtml).toContain("hello");
  });
});
