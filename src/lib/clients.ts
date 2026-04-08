type DisplayInput =
  | { clientType: "individual"; firstName?: string | null; lastName?: string | null }
  | { clientType: "organization"; companyName?: string | null };

export function deriveDisplayName(input: DisplayInput): string {
  if (input.clientType === "individual") {
    const first = (input.firstName ?? "").trim();
    const last = (input.lastName ?? "").trim();
    return [first, last].filter(Boolean).join(" ");
  }
  return (input.companyName ?? "").trim();
}
