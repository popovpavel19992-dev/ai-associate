// tests/unit/discovery-responses-service.test.ts

import { describe, it, expect } from "vitest";
import {
  submitResponses,
  validateResponseType,
  ResponseValidationError,
  getResponseSummary,
  markRequestResponsesReceived,
  listForRequest,
} from "@/server/services/discovery-responses/responses-service";

type Row = {
  id: string;
  requestId: string;
  questionIndex: number;
  responseType: string;
  responseText: string | null;
  objectionBasis: string | null;
  producedDocDescriptions: string[];
  responderName: string | null;
  responderEmail: string;
  respondedAt: Date;
};

function makeStubDb(opts: {
  request?: { requestType: string; questions: any[] };
  initialResponses?: Row[];
}) {
  const requestRow = opts.request;
  const responses: Row[] = [...(opts.initialResponses ?? [])];
  let nextId = 1;
  const reqUpdates: any[] = [];
  let selectMode: "request" | "responses" | "summary" = "request";

  const db: any = {
    select: (cols?: any) => ({
      from: (table: any) => {
        // Crude type detection via a marker on the schema export name
        // (just tracks call order — sufficient for this suite).
        const tableName = table?.[Symbol.toStringTag] ?? "";
        return {
          where: () => ({
            limit: async () => {
              if (selectMode === "request") {
                return requestRow ? [requestRow] : [];
              }
              return [];
            },
            orderBy: () => ({
              limit: async () => responses,
              then: (resolve: any, reject: any) =>
                Promise.resolve(responses).then(resolve, reject),
            }),
            then: (resolve: any, reject: any) => {
              return Promise.resolve(responses).then(resolve, reject);
            },
          }),
        };
      },
    }),
    insert: () => ({
      values: (v: any) => ({
        onConflictDoUpdate: ({ set }: any) => {
          const existing = responses.find(
            (r) =>
              r.requestId === v.requestId &&
              r.questionIndex === v.questionIndex &&
              r.responderEmail === v.responderEmail,
          );
          if (existing) {
            Object.assign(existing, set);
          } else {
            responses.push({
              id: `resp-${nextId++}`,
              ...v,
            });
          }
          return Promise.resolve();
        },
      }),
    }),
    update: () => ({
      set: (s: any) => ({
        where: () => {
          reqUpdates.push(s);
          return Promise.resolve();
        },
      }),
    }),
    __setSelectMode: (m: typeof selectMode) => (selectMode = m),
  };

  return { db, responses, reqUpdates };
}

describe("validateResponseType", () => {
  it("RFA accepts admit/deny/object/lack_of_knowledge", () => {
    expect(() => validateResponseType("rfa", "admit")).not.toThrow();
    expect(() => validateResponseType("rfa", "deny")).not.toThrow();
    expect(() => validateResponseType("rfa", "object")).not.toThrow();
    expect(() => validateResponseType("rfa", "lack_of_knowledge")).not.toThrow();
    expect(() => validateResponseType("rfa", "written_response")).toThrow(
      ResponseValidationError,
    );
    expect(() => validateResponseType("rfa", "produced_documents")).toThrow();
  });

  it("Interrogatory accepts written_response/object only", () => {
    expect(() => validateResponseType("interrogatories", "written_response")).not.toThrow();
    expect(() => validateResponseType("interrogatories", "object")).not.toThrow();
    expect(() => validateResponseType("interrogatories", "admit")).toThrow();
  });

  it("RFP accepts produced_documents/object only", () => {
    expect(() => validateResponseType("rfp", "produced_documents")).not.toThrow();
    expect(() => validateResponseType("rfp", "object")).not.toThrow();
    expect(() => validateResponseType("rfp", "deny")).toThrow();
  });
});

describe("submitResponses", () => {
  it("inserts new responses for valid RFA submission", async () => {
    const { db, responses } = makeStubDb({
      request: { requestType: "rfa", questions: [{ text: "q1" }, { text: "q2" }] },
    });
    const { saved } = await submitResponses(db, {
      requestId: "r1",
      tokenId: "t1",
      responderEmail: "opp@x.com",
      responses: [
        { questionIndex: 0, responseType: "admit" },
        { questionIndex: 1, responseType: "deny" },
      ],
    });
    expect(saved).toBe(2);
    expect(responses).toHaveLength(2);
    expect(responses[0].responseType).toBe("admit");
  });

  it("upserts on resubmit (same email + question_index)", async () => {
    const { db, responses } = makeStubDb({
      request: { requestType: "rfa", questions: [{ text: "q1" }] },
    });
    await submitResponses(db, {
      requestId: "r1",
      tokenId: null,
      responderEmail: "opp@x.com",
      responses: [{ questionIndex: 0, responseType: "admit" }],
    });
    await submitResponses(db, {
      requestId: "r1",
      tokenId: null,
      responderEmail: "opp@x.com",
      responses: [{ questionIndex: 0, responseType: "deny" }],
    });
    expect(responses).toHaveLength(1);
    expect(responses[0].responseType).toBe("deny");
  });

  it("rejects mismatched response_type for request_type", async () => {
    const { db } = makeStubDb({
      request: { requestType: "rfa", questions: [{ text: "q1" }] },
    });
    await expect(
      submitResponses(db, {
        requestId: "r1",
        tokenId: null,
        responderEmail: "opp@x.com",
        responses: [{ questionIndex: 0, responseType: "produced_documents" }],
      }),
    ).rejects.toThrow(ResponseValidationError);
  });

  it("rejects object without objection_basis", async () => {
    const { db } = makeStubDb({
      request: { requestType: "interrogatories", questions: [{ text: "q1" }] },
    });
    await expect(
      submitResponses(db, {
        requestId: "r1",
        tokenId: null,
        responderEmail: "opp@x.com",
        responses: [{ questionIndex: 0, responseType: "object" }],
      }),
    ).rejects.toThrow(/objection_basis/i);
  });

  it("rejects produced_documents without descriptions", async () => {
    const { db } = makeStubDb({
      request: { requestType: "rfp", questions: [{ text: "q1" }] },
    });
    await expect(
      submitResponses(db, {
        requestId: "r1",
        tokenId: null,
        responderEmail: "opp@x.com",
        responses: [{ questionIndex: 0, responseType: "produced_documents" }],
      }),
    ).rejects.toThrow(/document description/i);
  });

  it("rejects out-of-range question_index", async () => {
    const { db } = makeStubDb({
      request: { requestType: "rfa", questions: [{ text: "q1" }] },
    });
    await expect(
      submitResponses(db, {
        requestId: "r1",
        tokenId: null,
        responderEmail: "opp@x.com",
        responses: [{ questionIndex: 5, responseType: "admit" }],
      }),
    ).rejects.toThrow(/out of range/i);
  });

  it("rejects missing email", async () => {
    const { db } = makeStubDb({
      request: { requestType: "rfa", questions: [{ text: "q1" }] },
    });
    await expect(
      submitResponses(db, {
        requestId: "r1",
        tokenId: null,
        responderEmail: "not-an-email",
        responses: [{ questionIndex: 0, responseType: "admit" }],
      }),
    ).rejects.toThrow(/responder email/i);
  });
});

describe("getResponseSummary", () => {
  it("counts by type and tracks distinct question coverage", async () => {
    const seed: Row[] = [
      {
        id: "1",
        requestId: "r1",
        questionIndex: 0,
        responseType: "admit",
        responseText: null,
        objectionBasis: null,
        producedDocDescriptions: [],
        responderName: null,
        responderEmail: "a@x.com",
        respondedAt: new Date(),
      },
      {
        id: "2",
        requestId: "r1",
        questionIndex: 1,
        responseType: "deny",
        responseText: null,
        objectionBasis: null,
        producedDocDescriptions: [],
        responderName: null,
        responderEmail: "a@x.com",
        respondedAt: new Date(),
      },
      {
        id: "3",
        requestId: "r1",
        questionIndex: 2,
        responseType: "object",
        responseText: null,
        objectionBasis: "vague",
        producedDocDescriptions: [],
        responderName: null,
        responderEmail: "a@x.com",
        respondedAt: new Date(),
      },
    ];
    const { db } = makeStubDb({ initialResponses: seed });
    db.__setSelectMode("responses");
    const out = await getResponseSummary(db, "r1");
    expect(out.totalResponses).toBe(3);
    expect(out.questionCoverage).toBe(3);
    expect(out.byType.admit).toBe(1);
    expect(out.byType.deny).toBe(1);
    expect(out.byType.object).toBe(1);
  });
});

describe("markRequestResponsesReceived", () => {
  it("emits an update with status='responses_received'", async () => {
    const { db, reqUpdates } = makeStubDb({});
    await markRequestResponsesReceived(db, "r1");
    expect(reqUpdates).toHaveLength(1);
    expect(reqUpdates[0].status).toBe("responses_received");
  });
});

describe("listForRequest", () => {
  it("returns the response array (ordered by service)", async () => {
    const seed: Row[] = [
      {
        id: "1",
        requestId: "r1",
        questionIndex: 0,
        responseType: "admit",
        responseText: null,
        objectionBasis: null,
        producedDocDescriptions: [],
        responderName: null,
        responderEmail: "a@x.com",
        respondedAt: new Date(),
      },
    ];
    const { db } = makeStubDb({ initialResponses: seed });
    const out = await listForRequest(db, "r1");
    expect(out).toHaveLength(1);
  });
});
