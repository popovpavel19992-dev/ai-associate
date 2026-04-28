"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function IntakeTemplatesSettingsPage() {
  const { data: profile } = trpc.users.getProfile.useQuery();
  const isAdmin = profile?.role === "owner" || profile?.role === "admin";
  const utils = trpc.useUtils();
  const { data: templates, isLoading } = trpc.publicIntake.templates.list.useQuery();
  const createMut = trpc.publicIntake.templates.create.useMutation({
    onSuccess: () => {
      utils.publicIntake.templates.list.invalidate();
      toast.success("Template created");
    },
    onError: (e) => toast.error(e.message),
  });

  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [caseType, setCaseType] = React.useState("");
  const [thankYou, setThankYou] = React.useState("");

  function reset() {
    setName("");
    setSlug("");
    setDescription("");
    setCaseType("");
    setThankYou("");
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Intake templates</h1>
        <p className="mt-2 text-sm text-zinc-600">Only owners and admins can manage public intake templates.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Public intake templates</h1>
          <p className="text-sm text-zinc-500">
            Reusable forms prospects can fill out without logging in.
          </p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
          <DialogTrigger render={<Button />}>
            <Plus className="size-4 mr-1" /> New template
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New intake template</DialogTitle>
              <DialogDescription>
                You can edit fields and the public URL after creating.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Family Law Intake"
                />
              </div>
              <div>
                <Label htmlFor="slug">Slug (optional)</Label>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="family-law"
                />
                <p className="text-xs text-zinc-500 mt-1">Auto-derived from name if blank.</p>
              </div>
              <div>
                <Label htmlFor="desc">Description</Label>
                <Textarea
                  id="desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </div>
              <div>
                <Label htmlFor="case-type">Case type (default for created cases)</Label>
                <Input
                  id="case-type"
                  value={caseType}
                  onChange={(e) => setCaseType(e.target.value)}
                  placeholder="Family Law"
                />
              </div>
              <div>
                <Label htmlFor="thanks">Thank-you message</Label>
                <Textarea
                  id="thanks"
                  value={thankYou}
                  onChange={(e) => setThankYou(e.target.value)}
                  rows={3}
                  placeholder="Thanks — we'll be in touch within 1 business day."
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                disabled={!name.trim() || createMut.isPending}
                onClick={() => {
                  createMut.mutate(
                    {
                      name: name.trim(),
                      slug: slug.trim() || undefined,
                      description: description.trim() || undefined,
                      caseType: caseType.trim() || undefined,
                      thankYouMessage: thankYou.trim() || undefined,
                      fields: [],
                    },
                    {
                      onSuccess: () => {
                        setOpen(false);
                        reset();
                      },
                    },
                  );
                }}
              >
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : templates && templates.length > 0 ? (
        <div className="rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Name</th>
                <th className="px-4 py-2 text-left font-medium">Slug</th>
                <th className="px-4 py-2 text-left font-medium">Case type</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Submissions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b border-zinc-100 dark:border-zinc-800/60 hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                  <td className="px-4 py-2">
                    <Link
                      href={`/settings/intake-templates/${t.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-zinc-500">{t.slug}</td>
                  <td className="px-4 py-2 text-zinc-500">{t.caseType ?? "—"}</td>
                  <td className="px-4 py-2">
                    {t.isActive ? (
                      <Badge variant="default">Active</Badge>
                    ) : (
                      <Badge variant="outline">Inactive</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2 text-zinc-500">{t.submissionsCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
          No templates yet. Create one to start collecting public intake submissions.
        </div>
      )}
    </div>
  );
}
