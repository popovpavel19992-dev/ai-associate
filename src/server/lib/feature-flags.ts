export function isStrategyEnabled(orgId: string | null | undefined): boolean {
  if (!orgId) return false;
  const list = (process.env.STRATEGY_BETA_ORG_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(orgId);
}
