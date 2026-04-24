"use client";
import Link from "next/link";
import { trpc } from "@/lib/trpc";

export function MotionsTab({ caseId }: { caseId: string }) {
  const { data: motions, isLoading } = trpc.motions.list.useQuery({ caseId });

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Motions</h2>
        <Link
          href={`/cases/${caseId}/motions/new`}
          className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          New motion
        </Link>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}

      {motions && motions.length === 0 && (
        <p className="text-sm text-gray-500">No motions yet. Click &quot;New motion&quot; to generate one.</p>
      )}

      <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
        {motions?.map((m) => (
          <li key={m.id} className="p-4 hover:bg-gray-50">
            <Link href={`/cases/${caseId}/motions/${m.id}`} className="block">
              <div className="flex items-center justify-between">
                <span className="font-medium">{m.title}</span>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    m.status === "filed" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {m.status}
                </span>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                Updated {new Date(m.updatedAt).toLocaleDateString()}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
