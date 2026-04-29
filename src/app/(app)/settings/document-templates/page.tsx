// src/app/(app)/settings/document-templates/page.tsx
//
// Phase 3.12 — Settings → Document Templates list. Shows the firm's custom
// templates plus the global library (read-only). Owner/admin can create new
// org templates.
"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, FileText, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const CATEGORIES = [
  "retainer", "engagement", "fee_agreement", "nda", "conflict_waiver",
  "termination", "demand", "settlement", "authorization", "other",
] as const;

export default function DocumentTemplatesSettingsPage() {
  const utils = trpc.useUtils();
  const { data: templates, isLoading } = trpc.documentTemplates.templates.list.useQuery();
  const createMut = trpc.documentTemplates.templates.create.useMutation({
    onSuccess: () => {
      toast.success("Template created");
      utils.documentTemplates.templates.list.invalidate();
      setOpen(false);
      setName("");
      setDescription("");
      setBody("");
    },
    onError: (e) => toast.error(e.message),
  });

  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [category, setCategory] = React.useState<(typeof CATEGORIES)[number]>("other");
  const [body, setBody] = React.useState("");
  const [filterCat, setFilterCat] = React.useState<string>("");

  const filtered = (templates ?? []).filter((t) => !filterCat || t.category === filterCat);

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Document Templates</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="size-4 mr-1" /> New Template
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>New document template</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="tpl-name">Name</Label>
                <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="tpl-cat">Category</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as typeof category)}>
                  <SelectTrigger id="tpl-cat"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="tpl-desc">Description (optional)</Label>
                <Textarea id="tpl-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
              </div>
              <div>
                <Label htmlFor="tpl-body">Body (use {"{{key}}"} merge tags)</Label>
                <Textarea
                  id="tpl-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={10}
                  className="font-mono text-xs"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                disabled={createMut.isPending || !name.trim() || !body.trim()}
                onClick={() => createMut.mutate({ name, description, category, body, variables: [] })}
              >
                {createMut.isPending && <Loader2 className="size-4 animate-spin mr-1" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-2">
        <Label htmlFor="filter-cat" className="text-sm text-zinc-500">Filter:</Label>
        <Select
          value={filterCat || "all"}
          onValueChange={(v) => {
            const next = v ?? "";
            setFilterCat(next === "all" ? "" : next);
          }}
        >
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" /> Loading...
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((t) => (
          <Link key={t.id} href={`/settings/document-templates/${t.id}`}>
            <div className="rounded border border-zinc-800 px-3 py-2 hover:bg-zinc-900">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-zinc-500" />
                <span className="font-medium">{t.name}</span>
                <Badge variant="outline">{t.category}</Badge>
                {t.orgId === null && <Badge variant="secondary">Library</Badge>}
                {!t.isActive && <Badge variant="destructive">inactive</Badge>}
              </div>
              {t.description && <div className="mt-1 text-xs text-zinc-500">{t.description}</div>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
