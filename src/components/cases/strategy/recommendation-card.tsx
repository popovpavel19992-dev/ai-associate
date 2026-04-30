"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CitationChip } from "./citation-chip";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface Citation {
  kind: "document" | "deadline" | "filing" | "motion" | "message";
  id: string;
  excerpt?: string;
}
interface Props {
  caseId: string;
  rec: {
    id: string;
    priority: number;
    title: string;
    rationale: string;
    citations: Citation[];
  };
  onDismissed?: () => void;
}
export function RecommendationCard({ caseId, rec, onDismissed }: Props) {
  const [hidden, setHidden] = useState(false);
  const dismiss = trpc.caseStrategy.dismiss.useMutation({
    onSuccess: () => {
      setHidden(true);
      onDismissed?.();
      toast.success("Dismissed");
    },
    onError: (e) => toast.error(e.message),
  });
  if (hidden) return null;
  return (
    <Card className="border-zinc-800 bg-zinc-900">
      <CardContent className="space-y-2 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">
                P{rec.priority}
              </span>
              <h4 className="font-medium text-zinc-100">{rec.title}</h4>
            </div>
            <p className="text-sm text-zinc-400">{rec.rationale}</p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => dismiss.mutate({ recommendationId: rec.id })}
            disabled={dismiss.isPending}
            className="text-zinc-500 hover:text-zinc-100"
          >
            <X className="size-4" />
          </Button>
        </div>
        {rec.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {rec.citations.map((c, i) => (
              <CitationChip
                key={`${c.kind}-${c.id}-${i}`}
                caseId={caseId}
                {...c}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
