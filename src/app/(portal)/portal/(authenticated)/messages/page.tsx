"use client";

import Link from "next/link";
import { Loader2, MessageSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

export default function PortalMessagesPage() {
  const { data, isLoading } = trpc.portalCases.list.useQuery();

  const cases = data?.cases?.filter((c) => {
    const vis = (c.portalVisibility ?? {}) as Record<string, boolean>;
    return vis.messages !== false;
  }) ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Messages</h1>
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !cases.length ? (
        <p className="text-muted-foreground text-center py-12">No message threads</p>
      ) : (
        <div className="space-y-3">
          {cases.map((c) => (
            <Link key={c.id} href={`/portal/cases/${c.id}?tab=messages`}>
              <Card className="transition-colors hover:bg-accent/50 cursor-pointer">
                <CardContent className="flex items-center gap-3 py-4">
                  <MessageSquare className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">Click to view messages</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
