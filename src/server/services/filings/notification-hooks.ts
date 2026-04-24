import type { NotificationSendEvent } from "@/lib/notification-types";

export interface InngestLike {
  send: (event: { name: string; data: NotificationSendEvent }) => Promise<unknown>;
}

export interface FilingSubmittedHookArgs {
  filingId: string;
  caseId: string;
  orgId: string;
  caseName: string;
  submitterId: string;
  submitterName: string;
  court: string;
  confirmationNumber: string;
}

export async function notifyFilingSubmitted(
  inngest: InngestLike,
  args: FilingSubmittedHookArgs,
  memberUserIds: string[],
): Promise<void> {
  const recipients = memberUserIds.filter((id) => id !== args.submitterId);
  if (recipients.length === 0) return;

  const title = "Filing submitted";
  const body = args.caseName
    ? `${args.submitterName} submitted a filing to ${args.court} on ${args.caseName} (#${args.confirmationNumber})`
    : `${args.submitterName} submitted a filing to ${args.court} (#${args.confirmationNumber})`;

  await Promise.all(
    recipients.map((userId) =>
      inngest.send({
        name: "notification/send",
        data: {
          userId,
          orgId: args.orgId,
          type: "filing_submitted",
          title,
          body,
          caseId: args.caseId,
          actionUrl: `/cases/${args.caseId}?tab=filings&highlight=${args.filingId}`,
          metadata: {
            caseId: args.caseId,
            filingId: args.filingId,
            court: args.court,
            confirmationNumber: args.confirmationNumber,
            submitterName: args.submitterName,
          },
        },
      }),
    ),
  );
}
