// Trust accounting currency / date helpers (USD MVP).

export function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function parseUsdToCents(input: string): number | null {
  const trimmed = input.trim().replace(/[$,\s]/g, "");
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

export function formatTxnDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export const TXN_TYPE_LABELS: Record<string, string> = {
  deposit: "Deposit",
  disbursement: "Disbursement",
  transfer: "Transfer",
  adjustment: "Adjustment",
  interest: "Interest",
  service_charge: "Service charge",
};
