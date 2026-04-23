"use client";

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";

export function RulesTable({
  rules,
  onEdit,
}: {
  rules: Array<{ id: string; orgId: string | null; name: string; triggerEvent: string; days: number; dayType: string; jurisdiction: string; citation: string | null; active: boolean }>;
  onEdit: (id: string) => void;
}) {
  const utils = trpc.useUtils();
  const del = trpc.deadlines.deleteRule.useMutation({
    onSuccess: async () => { toast.success("Rule deleted"); await utils.deadlines.listRules.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const create = trpc.deadlines.createRule.useMutation({
    onSuccess: async () => { toast.success("Rule cloned"); await utils.deadlines.listRules.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  function clone(r: typeof rules[number]) {
    create.mutate({
      triggerEvent: r.triggerEvent,
      name: `${r.name} (firm copy)`,
      days: r.days,
      dayType: r.dayType as "calendar" | "court",
      shiftIfHoliday: true,
      defaultReminders: [7, 3, 1],
      jurisdiction: r.jurisdiction,
      citation: r.citation ?? undefined,
    });
  }

  if (rules.length === 0) return <p className="text-sm text-muted-foreground">No rules.</p>;

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="p-2">Name</th>
          <th className="p-2">Trigger</th>
          <th className="p-2">Days</th>
          <th className="p-2">Type</th>
          <th className="p-2">Jurisdiction</th>
          <th className="p-2">Citation</th>
          <th className="p-2">Source</th>
          <th className="p-2" />
        </tr>
      </thead>
      <tbody>
        {rules.map((r) => {
          const isSeed = r.orgId == null;
          return (
            <tr key={r.id} className="border-t">
              <td className="p-2 font-medium">{r.name}</td>
              <td className="p-2">{r.triggerEvent}</td>
              <td className="p-2">{r.days}</td>
              <td className="p-2">{r.dayType}</td>
              <td className="p-2">{r.jurisdiction}</td>
              <td className="p-2 truncate max-w-xs">{r.citation}</td>
              <td className="p-2">{isSeed ? "FRCP seed" : "Firm"}</td>
              <td className="p-2 text-right">
                {isSeed ? (
                  <Button size="sm" variant="ghost" onClick={() => clone(r)} title="Copy as firm rule">
                    <Copy className="size-4" />
                  </Button>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => onEdit(r.id)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => {
                      if (confirm(`Delete rule "${r.name}"?`)) del.mutate({ ruleId: r.id });
                    }}>
                      <Trash2 className="size-4" />
                    </Button>
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
