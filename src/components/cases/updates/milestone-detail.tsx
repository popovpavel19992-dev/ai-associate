"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Undo2, FileText } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { MilestoneEditor } from "./milestone-editor";
import { RetractMilestoneModal } from "./retract-milestone-modal";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  published: "bg-green-100 text-green-800",
  retracted: "bg-muted text-muted-foreground",
};

const CATEGORY_STYLES: Record<string, string> = {
  filing: "bg-blue-100 text-blue-800",
  discovery: "bg-purple-100 text-purple-800",
  hearing: "bg-amber-100 text-amber-800",
  settlement: "bg-green-100 text-green-800",
  communication: "bg-gray-100 text-gray-700",
  other: "bg-slate-100 text-slate-700",
};

export function MilestoneDetail({ milestoneId, caseId }: { milestoneId: string; caseId: string }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.milestones.get.useQuery({ milestoneId });
  const [editingPublished, setEditingPublished] = useState(false);
  const [retractOpen, setRetractOpen] = useState(false);

  const editMut = trpc.milestones.editPublished.useMutation({
    onSuccess: async () => {
      await utils.milestones.get.invalidate({ milestoneId });
      await utils.milestones.list.invalidate({ caseId });
      toast.success("Saved (client not re-notified)");
      setEditingPublished(false);
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if (!data) return <div className="p-4 text-sm text-muted-foreground">Milestone not found</div>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{data.title}</h3>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <span>{format(new Date(data.occurredAt), "PP")}</span>
            <Badge className={CATEGORY_STYLES[data.category] ?? ""}>{data.category}</Badge>
            {data.createdByName && <span>· by {data.createdByName}</span>}
          </div>
        </div>
        <Badge className={STATUS_STYLES[data.status] ?? ""}>{data.status}</Badge>
      </div>

      {data.status === "draft" && (
        <MilestoneEditor
          milestoneId={milestoneId}
          caseId={caseId}
          initial={{
            title: data.title,
            description: data.description,
            category: data.category,
            occurredAt: data.occurredAt as unknown as string,
            documentId: data.documentId,
          }}
        />
      )}

      {data.status === "published" && !editingPublished && (
        <div className="space-y-3">
          {data.description && (
            <p className="text-sm whitespace-pre-wrap">{data.description}</p>
          )}
          {data.documentFilename && (
            <div className="text-sm inline-flex items-center gap-1 text-muted-foreground">
              <FileText className="w-4 h-4" /> {data.documentFilename}
            </div>
          )}
          <div className="flex gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" onClick={() => {
              if (confirm("Edits to a published milestone will not re-notify the client. Proceed?")) {
                setEditingPublished(true);
              }
            }}>
              <Pencil className="w-4 h-4 mr-1" /> Edit
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRetractOpen(true)}>
              <Undo2 className="w-4 h-4 mr-1" /> Retract
            </Button>
          </div>
        </div>
      )}

      {data.status === "published" && editingPublished && (
        <PublishedEditor
          initial={{
            title: data.title,
            description: data.description,
            category: data.category,
            occurredAt: data.occurredAt as unknown as string,
            documentId: data.documentId,
          }}
          onCancel={() => setEditingPublished(false)}
          onSave={(patch) => editMut.mutate({ milestoneId, ...patch })}
          pending={editMut.isPending}
        />
      )}

      {data.status === "retracted" && (
        <div className="space-y-2 opacity-70">
          {data.description && <p className="text-sm line-through whitespace-pre-wrap">{data.description}</p>}
          <p className="text-sm text-red-700">
            This update was retracted{data.retractedReason ? `: ${data.retractedReason}` : "."}
          </p>
        </div>
      )}

      <RetractMilestoneModal
        milestoneId={milestoneId}
        caseId={caseId}
        title={data.title}
        open={retractOpen}
        onOpenChange={setRetractOpen}
      />
    </div>
  );
}

function PublishedEditor({
  initial,
  onCancel,
  onSave,
  pending,
}: {
  initial: { title: string; description: string | null; category: string; occurredAt: string; documentId: string | null };
  onCancel: () => void;
  onSave: (patch: { title: string; description: string | null; category: "filing" | "discovery" | "hearing" | "settlement" | "communication" | "other"; occurredAt: Date }) => void;
  pending: boolean;
}) {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [category, setCategory] = useState(initial.category);
  const [dateStr, setDateStr] = useState(
    typeof initial.occurredAt === "string"
      ? initial.occurredAt.slice(0, 10)
      : new Date(initial.occurredAt).toISOString().slice(0, 10),
  );

  return (
    <div className="space-y-2">
      <input className="w-full border rounded px-2 py-1 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="w-full border rounded px-2 py-1 text-sm" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
      <div className="flex gap-2">
        <select className="border rounded px-2 py-1 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
          {["filing","discovery","hearing","settlement","communication","other"].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="date" className="border rounded px-2 py-1 text-sm" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
      </div>
      <div className="flex gap-2 pt-2 border-t">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={pending} onClick={() => onSave({
          title: title.trim(),
          description: description.trim() || null,
          category: category as "filing" | "discovery" | "hearing" | "settlement" | "communication" | "other",
          occurredAt: new Date(dateStr),
        })}>Save</Button>
      </div>
    </div>
  );
}
