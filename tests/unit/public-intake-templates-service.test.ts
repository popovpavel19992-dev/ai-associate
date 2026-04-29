// tests/unit/public-intake-templates-service.test.ts
import { describe, it, expect } from "vitest";
import { PublicIntakeTemplatesService, slugify } from "@/server/services/public-intake/templates-service";

type Op = { kind: string; values?: any; set?: any };

function makeDb(opts: {
  selectQueue: any[][];
  insertReturning?: any;
  uniqueViolation?: boolean;
}) {
  const queue = [...opts.selectQueue];
  const ops: Op[] = [];

  const db: any = {
    select: (_cols?: any) => ({
      from: (_t: any) => {
        const rows = queue.shift() ?? [];
        const chain: any = {
          where: (_w: any) => chain,
          innerJoin: (_t2: any, _on: any) => chain,
          orderBy: (..._x: any[]) => Promise.resolve(rows),
          limit: (_n: number) => Promise.resolve(rows),
          then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
        };
        return chain;
      },
    }),
    insert: (_t: any) => ({
      values: (v: any) => {
        ops.push({ kind: "insert", values: v });
        if (opts.uniqueViolation) {
          const e: any = new Error("dup");
          e.code = "23505";
          throw e;
        }
        return { returning: () => Promise.resolve([opts.insertReturning ?? { id: "tpl-1", ...v }]) };
      },
    }),
    update: (_t: any) => ({
      set: (s: any) => ({
        where: (_w: any) => {
          ops.push({ kind: "update", set: s });
          return Promise.resolve();
        },
      }),
    }),
    delete: (_t: any) => ({
      where: (_w: any) => {
        ops.push({ kind: "delete" });
        return Promise.resolve();
      },
    }),
  };
  return { db, ops };
}

describe("slugify", () => {
  it("produces URL-safe slugs", () => {
    expect(slugify("Family Law Intake")).toBe("family-law-intake");
    expect(slugify("  Multi   spaces!  ")).toBe("multi-spaces");
    expect(slugify("Mañana — wills & trusts")).toBe("ma-ana-wills-trusts");
  });
});

describe("PublicIntakeTemplatesService", () => {
  it("createTemplate inserts after slug uniqueness check", async () => {
    const { db, ops } = makeDb({
      selectQueue: [
        [], // existing slug check returns empty
      ],
      insertReturning: { id: "tpl-1", slug: "family-law", name: "Family Law" },
    });
    const svc = new PublicIntakeTemplatesService({ db });
    const out = await svc.createTemplate({
      orgId: "org-1",
      createdBy: "user-1",
      name: "Family Law",
    });
    expect(out.id).toBe("tpl-1");
    expect(ops.find((o) => o.kind === "insert")).toBeTruthy();
  });

  it("createTemplate rejects duplicate slug for same org", async () => {
    const { db } = makeDb({
      selectQueue: [
        [{ id: "tpl-existing" }],
      ],
    });
    const svc = new PublicIntakeTemplatesService({ db });
    await expect(
      svc.createTemplate({ orgId: "org-1", createdBy: "user-1", name: "Family Law" }),
    ).rejects.toThrow(/already in use/i);
  });

  it("deleteTemplate blocks when there are submissions", async () => {
    const { db } = makeDb({
      selectQueue: [
        [{ id: "tpl-1", orgId: "org-1" }], // getTemplate
        [{ count: 3 }], // submission count
      ],
    });
    const svc = new PublicIntakeTemplatesService({ db });
    await expect(svc.deleteTemplate({ templateId: "tpl-1", orgId: "org-1" })).rejects.toThrow(/cannot delete/i);
  });

  it("deleteTemplate succeeds when no submissions exist", async () => {
    const { db, ops } = makeDb({
      selectQueue: [
        [{ id: "tpl-1", orgId: "org-1" }],
        [{ count: 0 }],
      ],
    });
    const svc = new PublicIntakeTemplatesService({ db });
    const out = await svc.deleteTemplate({ templateId: "tpl-1", orgId: "org-1" });
    expect(out.ok).toBe(true);
    expect(ops.find((o) => o.kind === "delete")).toBeTruthy();
  });

  it("getBySlug returns null when template inactive", async () => {
    const { db } = makeDb({
      selectQueue: [
        [{ template: { id: "t", isActive: false }, orgName: "Acme" }],
      ],
    });
    const svc = new PublicIntakeTemplatesService({ db });
    const out = await svc.getBySlug("acme", "intake");
    expect(out).toBeNull();
  });

  it("getBySlug returns the row when active", async () => {
    const { db } = makeDb({
      selectQueue: [
        [{ template: { id: "t", isActive: true, name: "Intake" }, orgName: "Acme" }],
      ],
    });
    const svc = new PublicIntakeTemplatesService({ db });
    const out = await svc.getBySlug("acme", "intake");
    expect(out?.template.id).toBe("t");
  });
});
