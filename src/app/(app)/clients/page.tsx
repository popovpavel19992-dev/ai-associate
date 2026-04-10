// src/app/(app)/clients/page.tsx
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { ClientFilters } from "@/components/clients/client-filters";
import { ClientTable } from "@/components/clients/client-table";

export default function ClientsPage() {
  const params = useSearchParams();
  const search = params.get("q") ?? undefined;
  const type = (params.get("type") as "individual" | "organization" | null) ?? undefined;
  const status = (params.get("status") as "active" | "archived" | null) ?? "active";
  const page = Number(params.get("page") ?? "1");
  const limit = 25;

  const { data, isLoading } = trpc.clients.list.useQuery({
    search,
    type,
    status,
    limit,
    offset: (page - 1) * limit,
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <Link href="/clients/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Client
          </Button>
        </Link>
      </div>
      <ClientFilters />
      {isLoading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <ClientTable rows={data?.clients ?? []} />
      )}
    </div>
  );
}
