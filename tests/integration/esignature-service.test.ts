// tests/integration/esignature-service.test.ts
import { describe, it, expect, vi } from "vitest";
import { EsignatureService } from "@/server/services/esignature/service";
import type { DropboxSignClient, SignatureRequestResult } from "@/server/services/esignature/dropbox-sign-client";

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
