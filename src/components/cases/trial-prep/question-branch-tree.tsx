"use client";

import type {
  Branch,
  QuestionBranches,
} from "@/server/db/schema/case-deposition-topic-branches";

const dot = (l: string) =>
  l === "high" ? "●●●" : l === "med" ? "●●○" : l === "low" ? "●○○" : "";

const ANSWER_LABEL: Record<string, string> = {
  admit: "Admit",
  deny: "Deny",
  evade: "Evade",
  idk: "IDK",
};

const ANSWER_TONE: Record<string, string> = {
  admit: "border-green-500/30",
  deny: "border-red-500/30",
  evade: "border-amber-500/30",
  idk: "border-zinc-500/30",
};

export function QuestionBranchTree({
  question,
  branches,
}: {
  question: { number: number; text: string };
  branches: Branch[];
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm">
        <span className="text-zinc-500">Q{question.number}.</span>{" "}
        {question.text}
      </div>
      <div className="grid gap-2 pl-4">
        {branches.map((b, i) => (
          <div
            key={i}
            className={`rounded border p-2 ${ANSWER_TONE[b.answerType] ?? ""}`}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide">
                {ANSWER_LABEL[b.answerType] ?? b.answerType}
                <span
                  className="ml-1"
                  aria-label={`likelihood: ${b.likelihood}`}
                >
                  {dot(b.likelihood)}
                </span>
              </span>
            </div>
            <div className="text-sm italic text-zinc-300">
              &quot;{b.likelyResponse}&quot;
            </div>
            <ul className="mt-1 text-sm">
              {b.followUps.map((f, j) => (
                <li key={j}>
                  → {f.text}
                  {f.purpose ? (
                    <span className="text-xs text-zinc-500">
                      {" "}
                      ({f.purpose})
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export type { QuestionBranches };
