"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { RulesTable } from "@/components/settings/deadline-rules/rules-table";
import { RuleEditorModal } from "@/components/settings/deadline-rules/rule-editor-modal";
import { JURISDICTIONS, JURISDICTION_LABELS } from "@/lib/constants";

export default function DeadlineRulesPage() {
  const { data } = trpc.deadlines.listRules.useQuery();
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingRuleId, setEditingRuleId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<string>("ALL");

  const allRules = data?.rules ?? [];
  // Build jurisdiction set from rules + the canonical list so empty buckets still appear.
  const availableJurisdictions = React.useMemo(() => {
    const set = new Set<string>(JURISDICTIONS as readonly string[]);
    for (const r of allRules) set.add(r.jurisdiction);
    return Array.from(set);
  }, [allRules]);

  const filteredRules =
    filter === "ALL" ? allRules : allRules.filter((r) => r.jurisdiction === filter);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Deadline rules</h1>
        <Button onClick={() => { setEditingRuleId(null); setEditorOpen(true); }}>
          <Plus className="size-4 mr-1" /> New rule
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs text-muted-foreground" htmlFor="jurisdiction-filter">
          Jurisdiction
        </label>
        <select
          id="jurisdiction-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 rounded-md border border-zinc-200 bg-transparent px-2 text-sm dark:border-zinc-800"
        >
          <option value="ALL">All jurisdictions ({allRules.length})</option>
          {availableJurisdictions.map((j) => {
            const count = allRules.filter((r) => r.jurisdiction === j).length;
            return (
              <option key={j} value={j}>
                {JURISDICTION_LABELS[j] ?? j} ({count})
              </option>
            );
          })}
        </select>
      </div>
      <RulesTable rules={filteredRules} onEdit={(id) => { setEditingRuleId(id); setEditorOpen(true); }} />
      <RuleEditorModal ruleId={editingRuleId} open={editorOpen} onOpenChange={setEditorOpen} />
    </div>
  );
}
