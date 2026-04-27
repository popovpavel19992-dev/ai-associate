/**
 * Format integer cents as currency (e.g. 123456 USD → "$1,234.56").
 * Uses Intl.NumberFormat; falls back to "<currency> 0.00" for unknown ISO codes.
 */
export function formatCurrency(cents: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}
