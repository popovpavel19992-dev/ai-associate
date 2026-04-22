// tests/integration/esignature-service.test.ts
import { describe, it, expect, vi } from "vitest";
import { EsignatureService } from "@/server/services/esignature/service";
import type { DropboxSignClient, SignatureRequestResult } from "@/server/services/esignature/dropbox-sign-client";
import signedFixture from "../fixtures/dropbox-sign/signed.json";
import allSignedFixture from "../fixtures/dropbox-sign/all-signed.json";
import declinedFixture from "../fixtures/dropbox-sign/declined.json";

function makeMockDb(existingOrgKey: string | null = "encrypted_key") {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; set: unknown }> = [];
  let selectCount = 0;
  const db: any = {
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        inserts.push({ table: t, values: v });
        return { returning: async () => [{ id: `row-${inserts.length}`, ...(Array.isArray(v) ? v[0] : (v as object)) }] };
      },
    }),
    update: (t: unknown) => ({
      set: (s: unknown) => ({
        where: () => { updates.push({ table: t, set: s }); return Promise.resolve(); },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            selectCount++;
            if (selectCount === 1) return [{ id: "case1", orgId: "org1", clientId: "client1" }];
            if (selectCount === 2) {
              return existingOrgKey
                ? [{ id: "org1", hellosignApiKeyEncrypted: existingOrgKey, hellosignSenderName: "Firm" }]
                : [{ id: "org1", hellosignApiKeyEncrypted: null, hellosignSenderName: null }];
            }
            if (selectCount === 3) return [{ id: "contact1", clientId: "client1", email: "jane@client.com", name: "Jane Client" }];
            if (selectCount === 4) return [{ id: "doc1", caseId: "case1", filename: "retainer.pdf", s3Key: "documents/doc1/retainer.pdf" }];
            return [];
          },
        }),
      }),
    }),
  };
  return { db, inserts, updates };
}

function makeMockClient(): DropboxSignClient {
  const sendFromTemplate = vi.fn(async (): Promise<SignatureRequestResult> => ({
    signatureRequestId: "sr_test_1",
    signatures: [{ signatureId: "sig_c", signerEmailAddress: "jane@client.com" }],
  }));
  const sendRaw = vi.fn(async (): Promise<SignatureRequestResult> => ({
    signatureRequestId: "sr_test_2",
    signatures: [{ signatureId: "sig_c2", signerEmailAddress: "jane@client.com" }],
  }));
  return {
    sendFromTemplate,
    sendRaw,
    getSignatureRequest: vi.fn(),
    cancel: vi.fn(),
    remind: vi.fn(),
    downloadFiles: vi.fn(),
    listTemplates: vi.fn(),
    testConnection: vi.fn(),
  } as any;
}

describe("EsignatureService.create", () => {
  it("template path calls sendFromTemplate + inserts rows", async () => {
    const { db, inserts } = makeMockDb();
    const client = makeMockClient();
    const svc = new EsignatureService({
      db,
      decryptKey: () => "plain_key",
      getPageCount: async () => 3,
      fetchS3: async () => Buffer.from("fake pdf"),
      buildClient: () => client,
    });
    const res = await svc.create({
      caseId: "case1",
      createdBy: "lawyer1",
      title: "Retainer",
      clientContactId: "contact1",
      lawyerEmail: "lawyer@firm.com",
      lawyerName: "L Lawyer",
      requiresCountersign: true,
      templateId: "tpl_xyz",
    });
    expect(res.hellosignRequestId).toBe("sr_test_1");
    expect((client.sendFromTemplate as any).mock.calls.length).toBe(1);
    const requestInsert = inserts.find((i) => {
      const v = i.values as Record<string, unknown>;
      return v && "hellosignRequestId" in v && "status" in v;
    });
    expect(requestInsert).toBeTruthy();
    expect((requestInsert!.values as any).status).toBe("sent");
    const signerInserts = inserts.filter((i) => {
      const v = i.values as any;
      const row = Array.isArray(v) ? v[0] : v;
      return row && "signerRole" in row;
    });
    expect(signerInserts.length).toBeGreaterThan(0);
  });

  it("raw-doc path calls sendRaw with page-count-derived form fields", async () => {
    const { db, inserts } = makeMockDb();
    const client = makeMockClient();
    const svc = new EsignatureService({
      db,
      decryptKey: () => "plain_key",
      getPageCount: async () => 5,
      fetchS3: async () => Buffer.from("pdf bytes"),
      buildClient: () => client,
    });
    await svc.create({
      caseId: "case1",
      createdBy: "lawyer1",
      title: "NDA",
      clientContactId: "contact1",
      lawyerEmail: "lawyer@firm.com",
      lawyerName: "L Lawyer",
      requiresCountersign: false,
      sourceDocumentId: "doc1",
    });
    expect((client.sendRaw as any).mock.calls.length).toBe(1);
    const call = (client.sendRaw as any).mock.calls[0][0];
    expect(call.formFields.length).toBeGreaterThan(0);
    expect(call.formFields[0].page).toBe(5);
  });

  it("throws if no API key configured", async () => {
    const { db } = makeMockDb(null);
    const svc = new EsignatureService({
      db,
      decryptKey: () => "",
      getPageCount: async () => 1,
      fetchS3: async () => Buffer.alloc(0),
      buildClient: () => makeMockClient(),
    });
    await expect(
      svc.create({
        caseId: "case1",
        createdBy: "l1",
        title: "X",
        clientContactId: "contact1",
        lawyerEmail: "l@f.com",
        lawyerName: "L",
        requiresCountersign: false,
        templateId: "t",
      }),
    ).rejects.toThrow(/not configured/i);
  });

  it("throws if neither template nor sourceDocument set", async () => {
    const { db } = makeMockDb();
    const svc = new EsignatureService({
      db,
      decryptKey: () => "k",
      getPageCount: async () => 1,
      fetchS3: async () => Buffer.alloc(0),
      buildClient: () => makeMockClient(),
    });
    await expect(
      svc.create({
        caseId: "case1",
        createdBy: "l1",
        title: "X",
        clientContactId: "contact1",
        lawyerEmail: "l@f.com",
        lawyerName: "L",
        requiresCountersign: false,
      }),
    ).rejects.toThrow(/templateId or sourceDocumentId/i);
  });
});

function makeMockDbForIngest(opts: {
  existingEventHash?: string;
  request?: { id: string; caseId: string; createdBy: string; title: string };
  signers?: Array<{ id: string; requestId: string; email: string; signerOrder: number; status: string }>;
}) {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; set: unknown; where: unknown }> = [];
  let selectCount = 0;
  const db: any = {
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        inserts.push({ table: t, values: v });
        return { returning: async () => [{ id: `row-${inserts.length}`, ...(Array.isArray(v) ? v[0] : (v as object)) }] };
      },
    }),
    update: (t: unknown) => ({
      set: (s: unknown) => ({
        where: (w: unknown) => { updates.push({ table: t, set: s, where: w }); return Promise.resolve(); },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            selectCount++;
            if (selectCount === 1) return opts.existingEventHash ? [{ id: "existing" }] : [];
            if (selectCount === 2) return opts.request ? [opts.request] : [];
            return [];
          },
          orderBy: async () => opts.signers ?? [],
        }),
      }),
    }),
  };
  return { db, inserts, updates };
}

describe("EsignatureService.ingestEvent", () => {
  const REQUEST = { id: "r1", caseId: "c1", createdBy: "l1", title: "Retainer" };
  const SIGNERS = [
    { id: "s1", requestId: "r1", email: "jane@client.com", signerOrder: 0, status: "awaiting_signature" },
    { id: "s2", requestId: "r1", email: "lawyer@firm.com", signerOrder: 1, status: "awaiting_turn" },
  ];

  it("duplicate event hash → no-op", async () => {
    const { db, inserts, updates } = makeMockDbForIngest({ existingEventHash: "dup" });
    const svc = new EsignatureService({
      db,
      decryptKey: () => "k",
      getPageCount: async () => 1,
      fetchS3: async () => Buffer.alloc(0),
      buildClient: () => makeMockClient(),
    });
    const result = await svc.ingestEvent(signedFixture as any);
    expect(result.status).toBe("duplicate");
    expect(inserts.length).toBe(0);
    expect(updates.length).toBe(0);
  });

  it("no parent request → no-op", async () => {
    const { db } = makeMockDbForIngest({});
    const svc = new EsignatureService({
      db,
      decryptKey: () => "k",
      getPageCount: async () => 1,
      fetchS3: async () => Buffer.alloc(0),
      buildClient: () => makeMockClient(),
    });
    const result = await svc.ingestEvent(signedFixture as any);
    expect(result.status).toBe("no-parent");
  });

  it("signed event marks client signed + flips lawyer to awaiting_signature", async () => {
    const { db, updates } = makeMockDbForIngest({ request: REQUEST, signers: SIGNERS });
    const svc = new EsignatureService({
      db,
      decryptKey: () => "k",
      getPageCount: async () => 1,
      fetchS3: async () => Buffer.alloc(0),
      buildClient: () => makeMockClient(),
    });
    const result = await svc.ingestEvent(signedFixture as any);
    expect(result.status).toBe("ok");
    expect(updates.length).toBeGreaterThanOrEqual(2);
  });

  it("declined event sets request status declined + captures reason", async () => {
    const { db, updates } = makeMockDbForIngest({ request: REQUEST, signers: SIGNERS });
    const svc = new EsignatureService({
      db,
      decryptKey: () => "k",
      getPageCount: async () => 1,
      fetchS3: async () => Buffer.alloc(0),
      buildClient: () => makeMockClient(),
    });
    const result = await svc.ingestEvent(declinedFixture as any);
    expect(result.status).toBe("ok");
    const reqUpdate = updates.find((u) => {
      const set = u.set as Record<string, unknown>;
      return set.status === "declined";
    });
    expect(reqUpdate).toBeTruthy();
    expect((reqUpdate!.set as any).declinedReason).toContain("accountant");
  });
});
