"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { GenerateBranchesButton } from "./generate-branches-button";
import { QuestionBranchTree } from "./question-branch-tree";
import type {
  Branch,
  QuestionBranches,
  QuestionSnapshot,
} from "@/server/db/schema/case-deposition-topic-branches";

const dot = (l?: string | null) =>
  l === "high" ? "●●●" : l === "med" ? "●●○" : l === "low" ? "●○○" : "";

function isStale(
  snapshot: QuestionSnapshot[],
  current: Array<{ id: string; text: string }>,
): boolean {
  if (snapshot.length !== current.length) return true;
  const m = new Map(snapshot.map((s) => [s.questionId, s.text]));
  for (const q of current) if (m.get(q.id) !== q.text) return true;
  return false;
}

export function TopicBranchesSection(props: {
  caseId: string;
  outlineId: string;
  topicId: string;
  questions: Array<{ id: string; text: string; number: number }>;
  betaEnabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const q = trpc.depositionBranches.getBranches.useQuery(
    { caseId: props.caseId, topicId: props.topicId },
    { enabled: props.betaEnabled },
  );
  if (!props.betaEnabled) return null;
  const row = q.data;

  if (q.isLoading) return null;

  if (!row) {
    return (
      <div className="ml-2 mt-2 border-l-2 border-zinc-700 pl-3">
        <div className="text-xs text-zinc-500">
          Anticipated answers (not generated)
        </div>
        {props.questions.length > 0 && (
          <div className="mt-1">
            <GenerateBranchesButton
              caseId={props.caseId}
              outlineId={props.outlineId}
              topicId={props.topicId}
              isPending={false}
            />
          </div>
        )}
      </div>
    );
  }

  const stale = isStale(row.questionsSnapshot, props.questions);
  const branchesByQ = new Map(
    (row.branchesJson as QuestionBranches[]).map((qb) => [
      qb.questionId,
      qb.branches as Branch[],
    ]),
  );

  return (
    <div className="ml-2 mt-2 border-l-2 border-zinc-700 pl-3">
      <button
        type="button"
        className="flex w-full items-center justify-between text-xs text-zinc-300"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span>
          {expanded ? "▾" : "▸"} Anticipated answers ({branchesByQ.size} of{" "}
          {props.questions.length} questions)
          {row.confidenceOverall && (
            <span className="ml-2 text-zinc-500">
              confidence: {row.confidenceOverall} {dot(row.confidenceOverall)}
            </span>
          )}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-3">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>Generated {new Date(row.createdAt).toLocaleString()}</span>
            <GenerateBranchesButton
              caseId={props.caseId}
              outlineId={props.outlineId}
              topicId={props.topicId}
              isPending={false}
              regenerate
            />
          </div>
          {stale && (
            <div className="rounded border border-amber-500/30 p-2 text-xs text-amber-400">
              ⚠ Questions changed since generation — regenerate for fresh
              branches.
            </div>
          )}
          {props.questions.map((qq) => {
            const branches = branchesByQ.get(qq.id);
            if (!branches) return null;
            return (
              <QuestionBranchTree
                key={qq.id}
                question={{ number: qq.number, text: qq.text }}
                branches={branches}
              />
            );
          })}
          <details>
            <summary className="cursor-pointer text-xs text-zinc-400">
              Reasoning
            </summary>
            <article className="prose prose-sm whitespace-pre-wrap">
              {row.reasoningMd}
            </article>
          </details>
        </div>
      )}
    </div>
  );
}
