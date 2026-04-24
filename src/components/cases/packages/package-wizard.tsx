"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ExhibitList } from "./exhibit-list";

export function PackageWizard({
  caseId,
  motionId,
  packageId,
}: {
  caseId: string;
  motionId: string;
  packageId: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: pkg, refetch } = trpc.filingPackages.get.useQuery({ packageId });
  const [proposedOrder, setProposedOrder] = React.useState<string>("");
  const [previewOpen, setPreviewOpen] = React.useState(false);

  React.useEffect(() => {
    if (pkg?.proposedOrderText !== undefined) setProposedOrder(pkg.proposedOrderText ?? "");
  }, [pkg?.proposedOrderText]);

  const saveOrder = trpc.filingPackages.updateProposedOrder.useMutation({
    onSuccess: () => toast.success("Saved"),
    onError: (e) => toast.error(e.message),
  });

  const finalize = trpc.filingPackages.finalize.useMutation({
    onSuccess: async () => {
      toast.success("Package finalized");
      await utils.filingPackages.get.invalidate({ packageId });
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.filingPackages.delete.useMutation({
    onSuccess: () => router.push(`/cases/${caseId}/motions/${motionId}`),
  });

  const { data: downloadData } = trpc.filingPackages.getDownloadUrl.useQuery(
    { packageId },
    { enabled: pkg?.status === "finalized" },
  );

  if (!pkg) return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  const isFinalized = pkg.status === "finalized";
  const canFinalize = !isFinalized && proposedOrder.trim().length > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{pkg.title}</h1>
          <p className="text-sm text-gray-600">Status: {pkg.status}</p>
        </div>
        <div className="flex gap-2">
          {!isFinalized && (
            <>
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
              >
                Preview
              </button>
              <button
                type="button"
                disabled={!canFinalize || finalize.isPending}
                onClick={() => finalize.mutate({ packageId })}
                className="rounded-md bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
              >
                {finalize.isPending ? "Finalizing…" : "Finalize"}
              </button>
              <button
                type="button"
                onClick={() => confirm("Delete this draft package?") && del.mutate({ packageId })}
                className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
              >
                Delete
              </button>
            </>
          )}
          {isFinalized && downloadData?.url && (
            <a
              href={downloadData.url}
              className="rounded-md bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700"
            >
              Download filing package
            </a>
          )}
        </div>
      </header>

      <ExhibitList
        packageId={packageId}
        caseId={caseId}
        exhibits={pkg.exhibits ?? []}
        onChanged={refetch}
      />

      <section className="rounded-md border border-gray-200 p-4">
        <h2 className="font-semibold mb-3">Proposed Order</h2>
        <textarea
          value={proposedOrder}
          onChange={(e) => setProposedOrder(e.target.value)}
          disabled={isFinalized}
          rows={8}
          className="w-full rounded border p-2 font-mono text-sm"
        />
        {!isFinalized && (
          <div className="mt-2">
            <button
              type="button"
              disabled={saveOrder.isPending || proposedOrder === (pkg.proposedOrderText ?? "")}
              onClick={() => saveOrder.mutate({ packageId, text: proposedOrder })}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              {saveOrder.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </section>

      {previewOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-5xl rounded-md bg-white p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">Preview (regenerates on each open)</h2>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="rounded border px-2 py-1 text-sm"
              >
                Close
              </button>
            </div>
            <iframe
              src={`/api/packages/${packageId}/preview`}
              title="Package preview"
              className="h-[70vh] w-full border"
            />
          </div>
        </div>
      )}
    </div>
  );
}
