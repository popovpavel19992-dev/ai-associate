"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { RulesTable } from "@/components/settings/deadline-rules/rules-table";
import { RuleEditorModal } from "@/components/settings/deadline-rules/rule-editor-modal";

export default function DeadlineRulesPage() {
  const { data } = trpc.deadlines.listRules.useQuery();
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingRuleId, setEditingRuleId] = React.useState<string | null>(null);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Deadline rules</h1>
        <Button onClick={() => { setEditingRuleId(null); setEditorOpen(true); }}>
          <Plus className="size-4 mr-1" /> New rule
        </Button>
      </div>
      <RulesTable rules={data?.rules ?? []} onEdit={(id) => { setEditingRuleId(id); setEditorOpen(true); }} />
      <RuleEditorModal ruleId={editingRuleId} open={editorOpen} onOpenChange={setEditorOpen} />
    </div>
  );
}
