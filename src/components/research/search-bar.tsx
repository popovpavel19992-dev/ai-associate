// src/components/research/search-bar.tsx
"use client";

import * as React from "react";
import { Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading?: boolean;
  placeholder?: string;
  className?: string;
}

export function SearchBar({
  value,
  onChange,
  onSubmit,
  loading = false,
  placeholder = "Search case law...",
  className,
}: SearchBarProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    onSubmit();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn("flex w-full items-center gap-2", className)}
      role="search"
    >
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={loading}
          className="pl-8"
          aria-label="Search case law"
        />
      </div>
      <Button type="submit" disabled={loading || value.trim().length < 2}>
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            <span>Searching</span>
          </>
        ) : (
          <span>Search</span>
        )}
      </Button>
    </form>
  );
}
