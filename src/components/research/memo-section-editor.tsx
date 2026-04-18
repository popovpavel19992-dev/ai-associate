// src/components/research/memo-section-editor.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { CitationChip } from "./citation-chip";
import { useDebouncedCallback } from "use-debounce";

interface MemoSectionEditorProps {
  memoId: string;
  section: {
    sectionType: "issue" | "rule" | "application" | "conclusion";
    content: string;
    citations: string[];
  };
  onRequestRewrite: () => void;
}

const LABEL: Record<string, string> = {
  issue: "Issue",
  rule: "Rule",
  application: "Application",
  conclusion: "Conclusion",
};

export function MemoSectionEditor({ memoId, section, onRequestRewrite }: MemoSectionEditorProps) {
  const utils = trpc.useUtils();
  const [content, setContent] = React.useState(section.content);

  React.useEffect(() => {
    setContent(section.content);
  }, [section.sectionType, section.content]);

  const updateMut = trpc.research.memo.updateSection.useMutation();

  const persist = useDebouncedCallback(async (next: string) => {
    await updateMut.mutateAsync({ memoId, sectionType: section.sectionType, content: next });
    await utils.research.memo.get.invalidate({ memoId });
  }, 1000);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{LABEL[section.sectionType]}</h2>
      <Textarea
        value={content}
        onChange={(e) => {
          const next = e.target.value;
          setContent(next);
          persist(next);
        }}
        className="min-h-[400px] font-mono text-sm"
        aria-label={`${LABEL[section.sectionType]} section content`}
      />
      {section.citations.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Citations</p>
          <div className="flex flex-wrap gap-2">
            {section.citations.map((c) => (
              <CitationChip key={c} citation={c} />
            ))}
          </div>
        </div>
      )}
      <Button type="button" variant="outline" onClick={onRequestRewrite}>
        Regenerate section with AI
      </Button>
    </div>
  );
}
