"use client";

export default function ResearchPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Legal Research
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Search U.S. federal and state case law, then ask AI for grounded analysis.
      </p>

      <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-muted-foreground dark:border-zinc-800 dark:bg-zinc-900/50">
        ClearTerms Research provides case-law analysis, not legal advice.
      </div>

      <div className="mt-6 rounded-md border border-dashed border-zinc-700 p-8 text-center text-sm text-muted-foreground">
        Search bar coming soon
      </div>
    </div>
  );
}
