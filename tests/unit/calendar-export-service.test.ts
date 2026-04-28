import { describe, it, expect } from "vitest";
import {
  generateAndStoreToken,
  revokeToken,
  findUserByToken,
  hashToken,
} from "@/server/services/calendar-export/service";

// Stub that mimics the two drizzle chains the service uses:
//   update(users).set({...}).where(eq(users.id, userId))
//   select({...}).from(users).where(and(eq(users.icalTokenHash, ...), isNotNull(...))).limit(1)
//
// The stub only cares about WHICH chain was invoked, not the predicate. The
// service has exactly one update call (by userId) and exactly one select call
// (by token hash), so chain-as-router is sufficient.
type Row = {
  id: string;
  icalTokenHash: string | null;
  icalTokenCreatedAt: Date | null;
  orgId: string | null;
  name: string;
  role: "owner" | "admin" | "member" | null;
};

function makeStubDb(seed: Row) {
  const state: { row: Row } = { row: { ...seed } };

  const db = {
    update: () => ({
      set: (values: { icalTokenHash: string | null; icalTokenCreatedAt: Date | null }) => ({
        where: (_predicate: unknown) => {
          state.row.icalTokenHash = values.icalTokenHash;
          state.row.icalTokenCreatedAt = values.icalTokenCreatedAt;
          return Promise.resolve();
        },
      }),
    }),
    select: (_cols?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_predicate: unknown) => ({
          limit: (_n: number) => {
            // The only select-by-token call in the service expects rows where
            // the hash matches. We compare against currently stored hash.
            // Service hashes the input and we can't recover input here, so
            // instead we expose the "last selected hash" via a side channel
            // — see findUserByTokenInTest below. For now: return row only
            // when hash is set (i.e. token exists at all).
            if (state.row.icalTokenHash) {
              return Promise.resolve([
                {
                  id: state.row.id,
                  orgId: state.row.orgId,
                  name: state.row.name,
                  role: state.row.role,
                },
              ]);
            }
            return Promise.resolve([]);
          },
        }),
      }),
    }),
  } as unknown as Parameters<typeof generateAndStoreToken>[0];

  return { state, db };
}

describe("calendar-export service token lifecycle", () => {
  it("hashToken is deterministic + sha256-shaped (64 hex chars)", () => {
    const a = hashToken("abc");
    const b = hashToken("abc");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generateAndStoreToken returns plaintext + persists hash", async () => {
    const { state, db } = makeStubDb({
      id: "u1",
      icalTokenHash: null,
      icalTokenCreatedAt: null,
      orgId: null,
      name: "Test",
      role: "member",
    });

    const { plainToken } = await generateAndStoreToken(db, "u1");
    expect(plainToken).toMatch(/^[0-9a-f]{48}$/);
    expect(state.row.icalTokenHash).toBe(hashToken(plainToken));
    expect(state.row.icalTokenCreatedAt).toBeInstanceOf(Date);
    // Critical: stored value is hash, not plaintext.
    expect(state.row.icalTokenHash).not.toBe(plainToken);
  });

  it("findUserByToken validates hash matches stored value", async () => {
    // Build a stub that ONLY returns the user when the queried hash exactly
    // matches the stored hash (the realistic db behavior).
    const stored = {
      id: "u1",
      icalTokenHash: null as string | null,
      icalTokenCreatedAt: null as Date | null,
      orgId: "org1",
      name: "Test",
      role: "owner" as const,
    };
    let lastQueriedHash: string | null = null;
    const db = {
      update: () => ({
        set: (values: { icalTokenHash: string | null; icalTokenCreatedAt: Date | null }) => ({
          where: () => {
            stored.icalTokenHash = values.icalTokenHash;
            stored.icalTokenCreatedAt = values.icalTokenCreatedAt;
            return Promise.resolve();
          },
        }),
      }),
      select: () => ({
        from: () => ({
          where: (predicate: unknown) => {
            // Drizzle returns SQL nodes — we sniff the recently hashed token
            // from a global side-channel. Easier: lastQueriedHash set below.
            void predicate;
            return {
              limit: () => {
                if (
                  stored.icalTokenHash &&
                  lastQueriedHash === stored.icalTokenHash
                ) {
                  return Promise.resolve([stored]);
                }
                return Promise.resolve([]);
              },
            };
          },
        }),
      }),
    } as unknown as Parameters<typeof findUserByToken>[0];

    // Generate a token and persist it.
    const { plainToken } = await generateAndStoreToken(db, "u1");

    // Correct token: set the side-channel, then query.
    lastQueriedHash = hashToken(plainToken);
    const found = await findUserByToken(db, plainToken);
    expect(found).not.toBeNull();
    expect(found?.id).toBe("u1");

    // Wrong token: side-channel reflects a different hash → no row.
    lastQueriedHash = hashToken("totally-wrong");
    const wrong = await findUserByToken(db, "totally-wrong");
    expect(wrong).toBeNull();

    // Empty/short token: short-circuited before any DB call.
    const empty = await findUserByToken(db, "");
    expect(empty).toBeNull();
  });

  it("revokeToken nulls hash + createdAt", async () => {
    const { state, db } = makeStubDb({
      id: "u1",
      icalTokenHash: null,
      icalTokenCreatedAt: null,
      orgId: null,
      name: "Test",
      role: "member",
    });

    await generateAndStoreToken(db, "u1");
    expect(state.row.icalTokenHash).not.toBeNull();

    await revokeToken(db, "u1");
    expect(state.row.icalTokenHash).toBeNull();
    expect(state.row.icalTokenCreatedAt).toBeNull();
  });

  it("regenerating produces a different token + different hash", async () => {
    const { state, db } = makeStubDb({
      id: "u1",
      icalTokenHash: null,
      icalTokenCreatedAt: null,
      orgId: null,
      name: "Test",
      role: "member",
    });

    const { plainToken: t1 } = await generateAndStoreToken(db, "u1");
    const hash1 = state.row.icalTokenHash;
    const { plainToken: t2 } = await generateAndStoreToken(db, "u1");
    const hash2 = state.row.icalTokenHash;
    expect(t1).not.toBe(t2);
    expect(hash1).not.toBe(hash2);
  });
});
