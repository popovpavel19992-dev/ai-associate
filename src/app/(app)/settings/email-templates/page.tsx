"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { TemplatesList } from "@/components/settings/email-templates/templates-list";
import { TemplateEditor } from "@/components/settings/email-templates/template-editor";

export default function EmailTemplatesPage() {
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  function openNew() {
    setEditingId(null);
    setEditorOpen(true);
  }

  function openEdit(id: string) {
    setEditingId(id);
    setEditorOpen(true);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Email templates</h1>
        <Button onClick={openNew}>
          <Plus className="size-4 mr-1" /> New template
        </Button>
      </div>
      <TemplatesList onEdit={openEdit} />
      <TemplateEditor templateId={editingId} open={editorOpen} onOpenChange={setEditorOpen} />
    </div>
  );
}
