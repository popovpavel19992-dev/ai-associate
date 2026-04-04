"use client";

import { useState } from "react";
import { Loader2, RotateCcw, Sparkles, Save, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Clause {
  id: string;
  clauseNumber: string;
  title: string;
  generatedText: string | null;
  userEditedText: string | null;
  aiNotes: string | null;
  clauseType: string | null;
}

interface DraftClauseEditorProps {
  clause: Clause | null;
  fullText: string;
  onSave: (clauseId: string, text: string) => void;
  onRewrite: (clauseId: string, instruction: string) => void;
  onReset: (clauseId: string) => void;
  isSaving: boolean;
}

type ViewMode = "clauses" | "fulltext";

export function DraftClauseEditor({
  clause,
  fullText,
  onSave,
  onRewrite,
  onReset,
  isSaving,
}: DraftClauseEditorProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("clauses");
  const [editedText, setEditedText] = useState("");
  const [showRewrite, setShowRewrite] = useState(false);
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [initialized, setInitialized] = useState<string | null>(null);

  // Sync editor text when clause changes
  if (clause && clause.id !== initialized) {
    setEditedText(clause.userEditedText ?? clause.generatedText ?? "");
    setInitialized(clause.id);
    setShowRewrite(false);
    setRewriteInstruction("");
  }

  if (viewMode === "fulltext") {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <button
            onClick={() => setViewMode("clauses")}
            className={cn(
              "rounded-md px-3 py-1 text-sm",
              "text-muted-foreground hover:bg-muted",
            )}
          >
            Clauses
          </button>
          <button
            className={cn(
              "rounded-md px-3 py-1 text-sm",
              "bg-primary/10 font-medium text-primary",
            )}
          >
            Full Text
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {fullText}
          </pre>
        </div>
      </div>
    );
  }

  if (!clause) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a clause to edit
      </div>
    );
  }

  const handleSave = () => {
    onSave(clause.id, editedText);
  };

  const handleRewrite = () => {
    if (!rewriteInstruction.trim()) return;
    onRewrite(clause.id, rewriteInstruction.trim());
    setShowRewrite(false);
    setRewriteInstruction("");
  };

  const handleReset = () => {
    onReset(clause.id);
    setEditedText(clause.generatedText ?? "");
  };

  return (
    <div className="flex h-full flex-col">
      {/* View mode toggle */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <button
          className={cn(
            "rounded-md px-3 py-1 text-sm",
            "bg-primary/10 font-medium text-primary",
          )}
        >
          Clauses
        </button>
        <button
          onClick={() => setViewMode("fulltext")}
          className={cn(
            "rounded-md px-3 py-1 text-sm",
            "text-muted-foreground hover:bg-muted",
          )}
        >
          Full Text
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Clause header */}
        <div>
          <h3 className="text-base font-semibold">
            {clause.clauseNumber}. {clause.title}
          </h3>
          {clause.clauseType && (
            <p className="mt-1 text-xs capitalize text-muted-foreground">
              Type: {clause.clauseType}
            </p>
          )}
        </div>

        {/* AI notes */}
        {clause.aiNotes && (
          <div className="flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <p className="text-blue-800 dark:text-blue-200">{clause.aiNotes}</p>
          </div>
        )}

        {/* Editor */}
        <Textarea
          value={editedText}
          onChange={(e) => setEditedText(e.target.value)}
          rows={12}
          className="min-h-[200px] font-mono text-sm"
          disabled={isSaving}
        />

        {/* AI Rewrite inline */}
        {showRewrite && (
          <div className="flex gap-2">
            <Input
              placeholder="e.g. Make the liability cap $500k..."
              value={rewriteInstruction}
              onChange={(e) => setRewriteInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRewrite();
              }}
              disabled={isSaving}
              className="flex-1"
            />
            <Button
              size="sm"
              onClick={handleRewrite}
              disabled={!rewriteInstruction.trim() || isSaving}
            >
              Rewrite
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowRewrite(false);
                setRewriteInstruction("");
              }}
            >
              Cancel
            </Button>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Save className="mr-1 h-3 w-3" />
            )}
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowRewrite(!showRewrite)}
            disabled={isSaving}
          >
            <Sparkles className="mr-1 h-3 w-3" />
            AI Rewrite
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleReset}
            disabled={isSaving || !clause.userEditedText}
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            Reset
          </Button>
        </div>
      </div>
    </div>
  );
}
