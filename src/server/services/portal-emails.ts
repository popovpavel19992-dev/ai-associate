import { sendEmail } from "./email";

const PORTAL_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function sendPortalInviteEmail(to: string, displayName: string, orgName: string) {
  await sendEmail({
    to,
    subject: `You've been invited to ${orgName}'s Client Portal`,
    html: `
      <h1>Welcome, ${displayName}!</h1>
      <p>Your attorney has invited you to their client portal where you can view your cases, documents, and invoices.</p>
      <a href="${PORTAL_URL}/portal/login?email=${encodeURIComponent(to)}" style="display:inline-block;padding:12px 24px;background:#7c83ff;color:#fff;text-decoration:none;border-radius:6px;">Access Portal</a>
    `,
  });
}

export async function sendPortalCodeEmail(to: string, code: string) {
  await sendEmail({
    to,
    subject: `Your ClearTerms verification code: ${code}`,
    html: `
      <h1>Your verification code</h1>
      <p style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;padding:16px;">${code}</p>
      <p>This code expires in 15 minutes.</p>
      <p>If you didn't request this code, you can safely ignore this email.</p>
    `,
  });
}
