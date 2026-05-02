"use client";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

export function GenerateBranchesButton(props: {
  caseId: string;
  outlineId: string;
  topicId: string;
  isPending: boolean;
  onSuccess?: () => void;
  regenerate?: boolean;
}) {
  const utils = trpc.useUtils();
  const m = trpc.depositionBranches.generateBranchesForTopic.useMutation({
    onSuccess: () => {
      utils.depositionBranches.getBranches.invalidate({
        caseId: props.caseId,
        topicId: props.topicId,
      });
      utils.depositionBranches.listBranchesForOutline.invalidate({
        caseId: props.caseId,
        outlineId: props.outlineId,
      });
      props.onSuccess?.();
    },
  });
  const label = props.regenerate
    ? "Regenerate (2cr)"
    : "Generate anticipated answers (2 credits)";
  return (
    <Button
      size="sm"
      variant={props.regenerate ? "secondary" : "default"}
      disabled={m.isPending || props.isPending}
      onClick={() =>
        m.mutate({
          caseId: props.caseId,
          outlineId: props.outlineId,
          topicId: props.topicId,
          regenerate: props.regenerate,
        })
      }
    >
      {m.isPending ? "Analyzing…" : label}
    </Button>
  );
}
