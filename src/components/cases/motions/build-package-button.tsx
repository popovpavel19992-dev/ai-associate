"use client";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";

export function BuildPackageButton({ caseId, motionId }: { caseId: string; motionId: string }) {
  const router = useRouter();
  const { data: packages } = trpc.filingPackages.listForMotion.useQuery({ motionId });
  const create = trpc.filingPackages.create.useMutation({
    onSuccess: (p) => router.push(`/cases/${caseId}/motions/${motionId}/package/${p.id}`),
  });
  const existing = packages?.[0];

  function handleClick() {
    if (existing) {
      router.push(`/cases/${caseId}/motions/${motionId}/package/${existing.id}`);
    } else {
      create.mutate({ motionId });
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={create.isPending}
      className="rounded-md bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
    >
      {create.isPending ? "Creating…" : existing ? "Open filing package" : "Build filing package"}
    </button>
  );
}
