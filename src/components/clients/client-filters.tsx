"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

export function ClientFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const [q, setQ] = useState(params.get("q") ?? "");
  const type = params.get("type") ?? "";
  const status = params.get("status") ?? "active";

  // Debounced URL push for the search field.
  useEffect(() => {
    const id = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (q) next.set("q", q);
      else next.delete("q");
      next.delete("page");
      startTransition(() => router.replace(`/clients?${next.toString()}`));
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    startTransition(() => router.replace(`/clients?${next.toString()}`));
  };

  return (
    <div className="flex flex-wrap gap-2">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute top-2.5 left-2 h-4 w-4 text-zinc-400" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search clients..."
          className="pl-8"
        />
      </div>
      <div className="flex gap-1">
        <Button
          variant={type === "" ? "default" : "outline"}
          size="sm"
          onClick={() => setParam("type", null)}
        >
          All types
        </Button>
        <Button
          variant={type === "individual" ? "default" : "outline"}
          size="sm"
          onClick={() => setParam("type", "individual")}
        >
          Individuals
        </Button>
        <Button
          variant={type === "organization" ? "default" : "outline"}
          size="sm"
          onClick={() => setParam("type", "organization")}
        >
          Organizations
        </Button>
      </div>
      <div className="flex gap-1">
        <Button
          variant={status === "active" ? "default" : "outline"}
          size="sm"
          onClick={() => setParam("status", "active")}
        >
          Active
        </Button>
        <Button
          variant={status === "archived" ? "default" : "outline"}
          size="sm"
          onClick={() => setParam("status", "archived")}
        >
          Archived
        </Button>
      </div>
    </div>
  );
}
