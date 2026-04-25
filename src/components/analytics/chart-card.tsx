"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export function ChartCard({
  title,
  loading,
  empty,
  children,
}: {
  title: string;
  loading?: boolean;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-72">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Loading…
          </div>
        ) : empty ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            No data
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
