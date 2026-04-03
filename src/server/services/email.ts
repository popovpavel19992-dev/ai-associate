import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = "ClearTerms <notifications@clearterms.ai>";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailOptions) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set, skipping email:", subject);
    return;
  }

  await resend.emails.send({
    from: FROM,
    to,
    subject,
    html,
  });
}

export async function sendWelcomeEmail(to: string, name: string) {
  await sendEmail({
    to,
    subject: "Welcome to ClearTerms",
    html: emailLayout(`
      <h1>Welcome, ${escapeHtml(name)}!</h1>
      <p>You're all set to start analyzing legal documents with AI.</p>
      <p>Your trial includes <strong>3 free analysis credits</strong> — upload your first case to get started.</p>
      <a href="${appUrl("/dashboard")}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;">Go to Dashboard</a>
    `),
  });
}

export async function sendCaseReadyEmail(
  to: string,
  caseName: string,
  caseId: string,
) {
  await sendEmail({
    to,
    subject: `Analysis Complete: ${caseName}`,
    html: emailLayout(`
      <h1>Your case analysis is ready</h1>
      <p>The analysis for <strong>${escapeHtml(caseName)}</strong> has been completed.</p>
      <a href="${appUrl(`/cases/${caseId}`)}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;">View Report</a>
    `),
  });
}

export async function sendDocumentFailedEmail(
  to: string,
  caseName: string,
  filename: string,
  caseId: string,
) {
  await sendEmail({
    to,
    subject: `Document Processing Failed: ${filename}`,
    html: emailLayout(`
      <h1>Document processing failed</h1>
      <p>We were unable to process <strong>${escapeHtml(filename)}</strong> in case <strong>${escapeHtml(caseName)}</strong>.</p>
      <p>This may be due to an unsupported format, a corrupted file, or a scanned document with unreadable text. Please try re-uploading or using a different file format.</p>
      <a href="${appUrl(`/cases/${caseId}`)}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;">View Case</a>
    `),
  });
}

export async function sendCreditsLowEmail(
  to: string,
  used: number,
  limit: number,
) {
  await sendEmail({
    to,
    subject: "Credits Running Low",
    html: emailLayout(`
      <h1>You're running low on credits</h1>
      <p>You've used <strong>${used}</strong> of your <strong>${limit}</strong> monthly credits.</p>
      <p>Upgrade your plan to keep analyzing cases without interruption.</p>
      <a href="${appUrl("/settings/billing")}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;">Upgrade Plan</a>
    `),
  });
}

export async function sendCreditsExhaustedEmail(to: string) {
  await sendEmail({
    to,
    subject: "Credits Exhausted",
    html: emailLayout(`
      <h1>You've used all your credits</h1>
      <p>You've reached your monthly credit limit. Upgrade your plan to continue analyzing cases.</p>
      <a href="${appUrl("/settings/billing")}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;">Upgrade Plan</a>
    `),
  });
}

export async function sendPaymentFailedEmail(to: string) {
  await sendEmail({
    to,
    subject: "Payment Failed — Action Required",
    html: emailLayout(`
      <h1>Your payment failed</h1>
      <p>We were unable to process your subscription payment. Please update your billing information to avoid service interruption.</p>
      <a href="${appUrl("/settings/billing")}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;">Update Billing</a>
    `),
  });
}

export async function sendAutoDeleteWarningEmail(
  to: string,
  caseName: string,
  daysLeft: number,
  caseId: string,
) {
  await sendEmail({
    to,
    subject: `Case Will Be Deleted in ${daysLeft} Days: ${caseName}`,
    html: emailLayout(`
      <h1>Case scheduled for deletion</h1>
      <p>Your case <strong>${escapeHtml(caseName)}</strong> will be automatically deleted in <strong>${daysLeft} days</strong> per your plan's retention policy.</p>
      <p>Export your report before then to keep a copy.</p>
      <a href="${appUrl(`/cases/${caseId}`)}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none;font-weight:500;">View & Export</a>
    `),
  });
}

function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}${path}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emailLayout(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7;">
    <div style="padding:32px 32px 0;">
      <div style="font-size:18px;font-weight:700;color:#18181b;margin-bottom:24px;">ClearTerms</div>
    </div>
    <div style="padding:0 32px 32px;color:#3f3f46;font-size:15px;line-height:1.6;">
      ${content}
    </div>
    <div style="padding:16px 32px;border-top:1px solid #e4e4e7;font-size:12px;color:#a1a1aa;">
      This is an automated notification from ClearTerms. AI-generated analysis is not legal advice.
    </div>
  </div>
</body>
</html>`;
}
