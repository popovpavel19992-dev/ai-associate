// src/components/research/memo-section-editor.tsx
// STUB — replaced in Task 12
"use client";

interface MemoSectionEditorProps {
  memoId: string;
  section: {
    sectionType: "issue" | "rule" | "application" | "conclusion";
    content: string;
    citations: string[];
  };
  onRequestRewrite: () => void;
}

export function MemoSectionEditor(_props: MemoSectionEditorProps) {
  return <div>TODO: Task 12 — section editor</div>;
}
