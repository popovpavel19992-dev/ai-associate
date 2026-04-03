"use client";

import { useState, useCallback, useRef } from "react";
import { Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SectionRenderer } from "./section-renderer";
import { trpc } from "@/lib/trpc";
import type { AnalysisOutput } from "@/lib/schemas";

interface EditableSectionProps {
  analysisId: string;
  sectionName: keyof AnalysisOutput;
  data: unknown;
  userEdits?: unknown;
  onSaved?: () => void;
}

export function EditableSection({
  analysisId,
  sectionName,
  data,
  userEdits,
  onSaved,
}: EditableSectionProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const saveEdits = trpc.documents.saveEdits.useMutation({
    onSuccess: () => {
      setIsEditing(false);
      onSaved?.();
    },
  });

  const handleStartEdit = useCallback(() => {
    const current = userEdits ?? data;
    setEditValue(JSON.stringify(current, null, 2));
    setIsEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [data, userEdits]);

  const handleSave = useCallback(() => {
    try {
      const parsed = JSON.parse(editValue);
      saveEdits.mutate({
        analysisId,
        sectionName,
        edits: parsed,
      });
    } catch {
      // Invalid JSON — don't save
    }
  }, [analysisId, sectionName, editValue, saveEdits]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditValue("");
  }, []);

  if (isEditing) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            onClick={handleSave}
            disabled={saveEdits.isPending}
          >
            <Check className="mr-1 size-3" />
            Save
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={handleCancel}
            disabled={saveEdits.isPending}
          >
            <X className="mr-1 size-3" />
            Cancel
          </Button>
          {saveEdits.isError && (
            <span className="text-xs text-destructive">
              Failed to save edits
            </span>
          )}
        </div>
        <Textarea
          ref={textareaRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          className="min-h-48 font-mono text-xs"
        />
      </div>
    );
  }

  return (
    <div className="group relative">
      <Button
        variant="ghost"
        size="icon-xs"
        className="absolute -top-1 right-0 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={handleStartEdit}
        aria-label={`Edit ${sectionName}`}
      >
        <Pencil className="size-3" />
      </Button>
      <SectionRenderer
        sectionName={sectionName}
        data={data}
        userEdits={userEdits}
      />
    </div>
  );
}
