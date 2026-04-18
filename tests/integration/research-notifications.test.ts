// tests/integration/research-notifications.test.ts
//
// Verifies Task 25: research events fire notification/send Inngest events.

import { describe, it, expect, vi } from "vitest";
import type { db as realDb } from "@/server/db";
import { BookmarkService } from "@/server/services/research/bookmark-service";
import { ResearchSessionService } from "@/server/services/research/session-service";
import {
  makeBookmarkCaseLinkHook,
  notifyResearchSessionLinked,
} from "@/server/services/research/notification-hooks";
import { NOTIFICATION_TYPES } from "@/lib/notification-types";

const ID = {
  user: "22222222-2222-4222-a222-222222222222",
  opinion: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  bookmark: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
  case: "dddddddd-dddd-4ddd-addd-dddddddddddd",
  session: "eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee",
  org: "ffffffff-ffff-4fff-afff-ffffffffffff",
};

type SelectResponse = unknown[];

function makeMockDb() {
  const selectQueue: SelectResponse[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeSelectChain = (): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (v: SelectResponse) => void, reject: (e: Error) => void) => {
        const v = selectQueue.shift();
        if (v === undefined) {
          reject(new Error("mock db: select queue exhausted"));
          return;
        }
        resolve(v);
      },
    };
    return chain;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeInsertChain = (call: { values?: unknown }): any => ({
    values: (v: unknown) => {
      call.values = v;
      return makeInsertChain(call);
    },
    onConflictDoUpdate: () => makeInsertChain(call),
    returning: async () => [
      { id: ID.bookmark, createdAt: new Date(), ...((call.values ?? {}) as object) },
    ],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeUpdateChain = (call: { set?: unknown }): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      set: (s: unknown) => {
        call.set = s;
        return chain;
      },
      where: () => chain,
      returning: async () => [
        {
          id: ID.session,
          userId: ID.user,
          title: "My Research",
          caseId: ID.case,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...((call.set ?? {}) as object),
        },
      ],
      then: (resolve: () => void) => resolve(),
    };
    return chain;
  };

  const db = {
    select: () => makeSelectChain(),
    insert: () => {
      const call: { values?: unknown } = {};
      return makeInsertChain(call);
    },
    update: () => {
      const call: { set?: unknown } = {};
      return makeUpdateChain(call);
    },
    delete: () => ({ where: () => ({ then: (r: () => void) => r() }) }),
  };

  return {
    db: db as unknown as typeof realDb,
    enqueueSelect: (rows: SelectResponse) => selectQueue.push(rows),
  };
}

describe("NOTIFICATION_TYPES", () => {
  it("includes the two research types", () => {
    expect(NOTIFICATION_TYPES).toContain("research_bookmark_added");
    expect(NOTIFICATION_TYPES).toContain("research_session_linked");
  });
});

describe("makeBookmarkCaseLinkHook", () => {
  it("fires notification/send with correct shape when bookmark is created with caseId", async () => {
    const { db, enqueueSelect } = makeMockDb();
    // Hook will look up the case name
    enqueueSelect([{ name: "Smith v. Jones", orgId: ID.org }]);

    const mockInngest = { send: vi.fn().mockResolvedValue(undefined) };
    const hook = makeBookmarkCaseLinkHook(mockInngest, db);
    const svc = new BookmarkService({ db, onCaseLink: hook });

    await svc.create({ userId: ID.user, opinionId: ID.opinion, caseId: ID.case });

    expect(mockInngest.send).toHaveBeenCalledTimes(1);
    const arg = mockInngest.send.mock.calls[0]![0];
    expect(arg.name).toBe("notification/send");
    expect(arg.data.type).toBe("research_bookmark_added");
    expect(arg.data.userId).toBe(ID.user);
    expect(arg.data.caseId).toBe(ID.case);
    expect(arg.data.orgId).toBe(ID.org);
    expect(arg.data.actionUrl).toBe(`/cases/${ID.case}`);
    expect(arg.data.metadata).toEqual({
      caseName: "Smith v. Jones",
      citation: "",
      opinionId: ID.opinion,
    });
  });

  it("does NOT fire when bookmark created without caseId", async () => {
    const { db } = makeMockDb();
    const mockInngest = { send: vi.fn().mockResolvedValue(undefined) };
    const hook = makeBookmarkCaseLinkHook(mockInngest, db);
    const svc = new BookmarkService({ db, onCaseLink: hook });

    await svc.create({ userId: ID.user, opinionId: ID.opinion });

    expect(mockInngest.send).not.toHaveBeenCalled();
  });
});

describe("ResearchSessionService.linkToCase", () => {
  it("fires onCaseLink hook with sessionId/caseId/userId/sessionTitle when caseId non-null", async () => {
    const { db, enqueueSelect } = makeMockDb();
    // assertOwnership lookup
    enqueueSelect([{ userId: ID.user }]);

    const onCaseLink = vi.fn();
    const svc = new ResearchSessionService({ db, onCaseLink });

    await svc.linkToCase({ sessionId: ID.session, userId: ID.user, caseId: ID.case });

    expect(onCaseLink).toHaveBeenCalledTimes(1);
    expect(onCaseLink).toHaveBeenCalledWith({
      sessionId: ID.session,
      caseId: ID.case,
      userId: ID.user,
      sessionTitle: "My Research",
    });
  });

  it("does NOT fire onCaseLink hook when caseId is null", async () => {
    const { db, enqueueSelect } = makeMockDb();
    enqueueSelect([{ userId: ID.user }]);

    const onCaseLink = vi.fn();
    const svc = new ResearchSessionService({ db, onCaseLink });

    await svc.linkToCase({ sessionId: ID.session, userId: ID.user, caseId: null });

    expect(onCaseLink).not.toHaveBeenCalled();
  });
});

describe("notifyResearchSessionLinked", () => {
  it("sends notification/send with research_session_linked shape", async () => {
    const { db, enqueueSelect } = makeMockDb();
    enqueueSelect([{ name: "Doe v. Roe", orgId: ID.org }]);

    const mockInngest = { send: vi.fn().mockResolvedValue(undefined) };
    await notifyResearchSessionLinked(
      mockInngest,
      { sessionId: ID.session, caseId: ID.case, userId: ID.user, sessionTitle: "Contract research" },
      db,
    );

    expect(mockInngest.send).toHaveBeenCalledTimes(1);
    const arg = mockInngest.send.mock.calls[0]![0];
    expect(arg.name).toBe("notification/send");
    expect(arg.data.type).toBe("research_session_linked");
    expect(arg.data.userId).toBe(ID.user);
    expect(arg.data.caseId).toBe(ID.case);
    expect(arg.data.metadata).toEqual({
      caseName: "Doe v. Roe",
      sessionTitle: "Contract research",
      sessionId: ID.session,
    });
  });
});
