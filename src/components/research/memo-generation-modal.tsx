"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { ALL_JURISDICTIONS, JURISDICTION_LABELS, type Jurisdiction } from "./filter-types";

interface MemoGenerationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  defaultQuestion: string;
  bookmarkCount: number;
  chatCount: number;
  statuteCount: number;
}

export function MemoGenerationModal({
  open, onOpenChange, sessionId, defaultQuestion, bookmarkCount, chatCount, statuteCount,
}: MemoGenerationModalProps) {
  const [question, setQuestion] = React.useState(defaultQuestion);
  const [jurisdiction, setJurisdiction] = React.useState<Jurisdiction | "">("");
  const router = useRouter();
  const generateMut = trpc.research.memo.generate.useMutation();

  React.useEffect(() => {
    if (open) setQuestion(defaultQuestion);
  }, [open, defaultQuestion]);

  const canGenerate = bookmarkCount + chatCount > 0 && question.trim().length >= 2;

  const submit = async () => {
    const out = await generateMut.mutateAsync({
      sessionId,
      memoQuestion: question.trim(),
      jurisdiction: jurisdiction || undefined,
    });
    router.push(`/research/memos/${out.memoId}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate IRAC memo</DialogTitle>
          <DialogDescription>
            Uses {bookmarkCount} bookmarked opinion{bookmarkCount === 1 ? "" : "s"}, {chatCount} chat
            exchange{chatCount === 1 ? "" : "s"}, and {statuteCount} statute{statuteCount === 1 ? "" : "s"}{" "}
            referenced in this session.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="memo-question">Memo question</Label>
            <Textarea
              id="memo-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="min-h-[100px]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="memo-juris">Jurisdictional focus (optional)</Label>
            <select
              id="memo-juris"
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value as Jurisdiction | "")}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">— Any —</option>
              {ALL_JURISDICTIONS.map((j) => (
                <option key={j} value={j}>{JURISDICTION_LABELS[j]}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            Cost: 3 credits. Section rewrites are free.
          </p>
          {!canGenerate && bookmarkCount + chatCount === 0 && (
            <p className="text-xs text-amber-600">
              Bookmark an opinion or ask a question in this session before generating.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!canGenerate || generateMut.isPending}>
            {generateMut.isPending ? "Starting…" : "Generate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
