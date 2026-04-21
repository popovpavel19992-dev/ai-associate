"use client";

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export function TemplatesList({ onEdit }: { onEdit: (templateId: string) => void }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.emailTemplates.list.useQuery();
  const del = trpc.emailTemplates.delete.useMutation({
    onSuccess: async () => {
      await utils.emailTemplates.list.invalidate();
      toast.success("Template deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const templates = data?.templates ?? [];
  if (templates.length === 0) return <p className="text-sm text-muted-foreground">No templates yet.</p>;

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="p-2">Name</th>
          <th className="p-2">Subject</th>
          <th className="p-2">Updated</th>
          <th className="p-2" />
        </tr>
      </thead>
      <tbody>
        {templates.map((t) => (
          <tr key={t.id} className="border-t">
            <td className="p-2 font-medium">{t.name}</td>
            <td className="p-2 truncate max-w-xs">{t.subject}</td>
            <td className="p-2">{format(new Date(t.updatedAt), "PP")}</td>
            <td className="p-2 text-right">
              <Button size="sm" variant="ghost" onClick={() => onEdit(t.id)}>
                <Pencil className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (confirm(`Delete "${t.name}"? Existing log entries remain; template_id becomes null.`)) {
                    del.mutate({ templateId: t.id });
                  }
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
