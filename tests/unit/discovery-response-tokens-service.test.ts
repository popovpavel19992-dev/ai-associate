// tests/unit/discovery-response-tokens-service.test.ts

import { describe, it, expect } from "vitest";
import {
  generateToken,
  findByToken,
  hashToken,
  revokeToken,
  recordAccess,
} from "@/server/services/discovery-responses/tokens-service";

type Row = {
  id: string;
  requestId: string;
  opposingPartyEmail: string;
  opposingPartyName: string | null;
  tokenHash: string;
  generatedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastAccessedAt: Date | null;
};

function makeStubDb() {
  const rows: Row[] = [];
  let nextId = 1;
  let lastSelectKey: any = null;

  const db: any = {
    insert: () => ({
      values: (v: any) => ({
        returning: async () => {
          const row: Row = {
            id: `tok-${nextId++}`,
            requestId: v.requestId,
            opposingPartyEmail: v.opposingPartyEmail,
            opposingPartyName: v.opposingPartyName ?? null,
            tokenHash: v.tokenHash,
            generatedAt: v.generatedAt ?? new Date(),
            expiresAt: v.expiresAt,
            revokedAt: null,
            lastAccessedAt: null,
          };
          rows.push(row);
          return [{ id: row.id }];
        },
      }),
    }),
    update: () => ({
      set: (s: any) => ({
        where: () => {
          // The most recent select carries the row id we want to update;
          // for tests we update whichever row matches the stored fields.
          for (const r of rows) {
            if (
              lastSelectKey &&
              "byId" in lastSelectKey &&
              lastSelectKey.byId === r.id
            ) {
              Object.assign(r, s);
            }
          }
          return Promise.resolve();
        },
      }),
    }),
    select: (cols?: any) => ({
      from: () => ({
        where: (predicate: any) => {
          // We don't introspect drizzle predicates here; the test sets
          // `lastSelectKey` via the helper functions below to steer us.
          void predicate;
          return {
            limit: async () => {
              if (lastSelectKey?.byHash) {
                return rows.filter(
                  (r) =>
                    r.tokenHash === lastSelectKey.byHash &&
                    r.revokedAt === null,
                );
              }
              if (lastSelectKey?.byRequestEmail) {
                const { req, email } = lastSelectKey.byRequestEmail;
                return rows
                  .filter((r) => r.requestId === req && r.opposingPartyEmail === email)
                  .map((r) => ({ id: r.id }));
              }
              return [];
            },
          };
        },
      }),
    }),
  };

  return { db, rows, setLastSelect: (k: any) => (lastSelectKey = k) };
}

describe("discovery-responses tokens-service", () => {
  it("hashToken is deterministic and 64 hex chars", () => {
    const a = hashToken("hello");
    const b = hashToken("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generateToken returns 48-char plaintext + persists hash + expiresAt", async () => {
    const { db, rows, setLastSelect } = makeStubDb();
    setLastSelect({ byRequestEmail: { req: "r1", email: "a@b.com" } });
    const result = await generateToken(db, {
      requestId: "r1",
      opposingEmail: "a@b.com",
      opposingName: "A B",
      expiresInDays: 30,
      now: new Date("2026-04-24T00:00:00Z"),
    });
    expect(result.plainToken).toMatch(/^[0-9a-f]{48}$/);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(result.plainToken));
    expect(rows[0].tokenHash).not.toBe(result.plainToken);
    const expectedExpiry = new Date("2026-05-24T00:00:00Z");
    expect(rows[0].expiresAt.getTime()).toBe(expectedExpiry.getTime());
  });

  it("findByToken resolves valid + rejects revoked + rejects expired", async () => {
    const { db, rows, setLastSelect } = makeStubDb();
    setLastSelect({ byRequestEmail: { req: "r1", email: "a@b.com" } });
    const { plainToken } = await generateToken(db, {
      requestId: "r1",
      opposingEmail: "a@b.com",
      now: new Date("2026-04-24T00:00:00Z"),
      expiresInDays: 1,
    });

    setLastSelect({ byHash: hashToken(plainToken) });
    const found = await findByToken(db, plainToken, {
      now: new Date("2026-04-24T12:00:00Z"),
    });
    expect(found?.requestId).toBe("r1");

    // Expired
    setLastSelect({ byHash: hashToken(plainToken) });
    const expired = await findByToken(db, plainToken, {
      now: new Date("2026-05-01T00:00:00Z"),
    });
    expect(expired).toBeNull();

    // Revoked
    rows[0].revokedAt = new Date();
    setLastSelect({ byHash: hashToken(plainToken) });
    const revoked = await findByToken(db, plainToken, {
      now: new Date("2026-04-24T12:00:00Z"),
    });
    expect(revoked).toBeNull();

    // Empty/short
    expect(await findByToken(db, "")).toBeNull();
    expect(await findByToken(db, "abc")).toBeNull();
  });

  it("revokeToken sets revokedAt", async () => {
    const { db, rows, setLastSelect } = makeStubDb();
    setLastSelect({ byRequestEmail: { req: "r1", email: "a@b.com" } });
    await generateToken(db, {
      requestId: "r1",
      opposingEmail: "a@b.com",
    });
    const id = rows[0].id;
    setLastSelect({ byId: id });
    await revokeToken(db, id);
    expect(rows[0].revokedAt).toBeInstanceOf(Date);
  });

  it("recordAccess updates lastAccessedAt", async () => {
    const { db, rows, setLastSelect } = makeStubDb();
    setLastSelect({ byRequestEmail: { req: "r1", email: "a@b.com" } });
    await generateToken(db, { requestId: "r1", opposingEmail: "a@b.com" });
    const id = rows[0].id;
    setLastSelect({ byId: id });
    const at = new Date("2026-04-25T00:00:00Z");
    await recordAccess(db, id, at);
    expect(rows[0].lastAccessedAt?.getTime()).toBe(at.getTime());
  });
});
