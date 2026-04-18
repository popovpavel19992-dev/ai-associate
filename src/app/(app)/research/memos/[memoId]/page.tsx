// src/app/(app)/research/memos/[memoId]/page.tsx
"use client";

import * as React from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { MemoSectionNav } from "@/components/research/memo-section-nav";
import { MemoSectionEditor } from "@/components/research/memo-section-editor";
import { MemoRewriteChat } from "@/components/research/memo-rewrite-chat";
import { Button } from "@/components/ui/button";

const SECTIONS = ["issue", "rule", "application", "conclusion"] as const;
type Section = (typeof SECTIONS)[number];

export default function MemoEditorPage() {
  const params = useParams<{ memoId: string }>();
  const memoId = params?.memoId as string;
  const searchParams = useSearchParams();
  const router = useRouter();

  const sectionParam = (searchParams?.get("section") as Section | null) ?? "issue";
  const activeSection: Section = SECTIONS.includes(sectionParam) ? sectionParam : "issue";

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.research.memo.get.useQuery(
    { memoId },
    {
      refetchInterval: (q) =>
        q.state.data?.memo.status === "generating" ? 2000 : false,
    },
  );

  const setActive = (s: Section) => {
    router.replace(`/research/memos/${memoId}?section=${s}`, { scroll: false });
  };

  if (isLoading || !data) return <div className="p-6">Loading…</div>;

  const memo = data.memo;
  const sections = new Map(data.sections.map((s) => [s.sectionType, s]));
  const active = sections.get(activeSection);

  if (memo.status === "generating") {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">{memo.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Generating sections… (auto-refreshes every 2s)</p>
        <div className="mt-6 grid gap-3">
          {SECTIONS.map((s) => (
            <div key={s} className="h-24 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-900" />
          ))}
        </div>
      </div>
    );
  }

  if (memo.status === "failed") {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold">{memo.title}</h1>
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <p className="font-medium">Generation failed: {memo.errorMessage ?? "unknown"}</p>
          <p className="mt-1">Credits refunded.</p>
        </div>
        <Button
          className="mt-4"
          onClick={async () => {
            await utils.client.research.memo.retryGenerate.mutate({ memoId });
            await utils.research.memo.get.invalidate({ memoId });
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-60 shrink-0 border-r border-zinc-200 dark:border-zinc-800">
        <MemoSectionNav
          memo={{ id: memo.id, title: memo.title }}
          sections={data.sections}
          active={activeSection}
          onSelect={setActive}
        />
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        {active ? (
          <MemoSectionEditor
            memoId={memo.id}
            section={active}
            onRequestRewrite={() => {}}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Section not found.</p>
        )}
      </main>
      <aside className="hidden w-96 shrink-0 border-l border-zinc-200 dark:border-zinc-800 lg:flex lg:flex-col">
        <MemoRewriteChat memoId={memo.id} sectionType={activeSection} />
      </aside>
    </div>
  );
}
