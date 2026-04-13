// src/components/clients/client-table.tsx
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ClientTypeBadge } from "./client-type-badge";

interface Row {
  id: string;
  displayName: string;
  clientType: "individual" | "organization";
  primaryContactName: string | null;
  caseCount: number;
}

export function ClientTable({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
        No clients found.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 dark:bg-zinc-900">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Name</th>
            <th className="px-4 py-2 text-left font-medium">Type</th>
            <th className="px-4 py-2 text-left font-medium">Primary contact</th>
            <th className="px-4 py-2 text-left font-medium">Cases</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-zinc-200 dark:border-zinc-800">
              <td className="px-4 py-3">
                <Link href={`/clients/${r.id}`} className="font-medium hover:underline">
                  {r.displayName}
                </Link>
              </td>
              <td className="px-4 py-3">
                <ClientTypeBadge type={r.clientType} />
              </td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                {r.primaryContactName ?? "—"}
              </td>
              <td className="px-4 py-3">{r.caseCount}</td>
              <td className="px-4 py-3 text-right">
                <Link href={`/clients/${r.id}`} aria-label="View">
                  <ChevronRight className="h-4 w-4 text-zinc-400" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
