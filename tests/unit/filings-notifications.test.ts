import { describe, it, expect, vi } from "vitest";
import { notifyFilingSubmitted } from "@/server/services/filings/notification-hooks";

describe("notifyFilingSubmitted", () => {
  it("fires one event per case member except the submitter", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const inngest = { send };

    await notifyFilingSubmitted(
      inngest,
      {
        filingId: "f1",
        caseId: "c1",
        orgId: "o1",
        caseName: "Acme v. Widget",
        submitterId: "u-submitter",
        submitterName: "Jane",
        court: "S.D.N.Y.",
        confirmationNumber: "12345",
      },
      ["u-submitter", "u-teammate-1", "u-teammate-2"],
    );

    expect(send).toHaveBeenCalledTimes(2);
    const recipients = send.mock.calls.map((c) => c[0].data.userId);
    expect(recipients).toEqual(expect.arrayContaining(["u-teammate-1", "u-teammate-2"]));
    expect(recipients).not.toContain("u-submitter");
    expect(send.mock.calls[0][0].data.type).toBe("filing_submitted");
    expect(send.mock.calls[0][0].name).toBe("notification/send");
  });

  it("no-ops when only the submitter is on the case", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await notifyFilingSubmitted(
      { send },
      {
        filingId: "f1",
        caseId: "c1",
        orgId: "o1",
        caseName: "X",
        submitterId: "u1",
        submitterName: "U",
        court: "S.D.N.Y.",
        confirmationNumber: "1",
      },
      ["u1"],
    );
    expect(send).not.toHaveBeenCalled();
  });
});
