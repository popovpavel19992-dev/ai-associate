// src/app/(app)/settings/out-of-office/page.tsx
//
// Phase 3.14 — Settings → Out of Office.
"use client";

import * as React from "react";
import { Plus, Loader2, X, Edit, AlertCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Period = {
  id: string;
  startDate: string;
  endDate: string;
  status: "scheduled" | "active" | "ended" | "cancelled";
  autoResponseSubject: string;
  autoResponseBody: string;
  coverageUserId: string | null;
  emergencyKeywordResponse: string | null;
};

const STATUS_TONE: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
  active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200",
  ended: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  cancelled: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 line-through",
};

export default function OutOfOfficeSettingsPage() {
  const utils = trpc.useUtils();
  const { data: list, isLoading } = trpc.outOfOffice.list.useQuery({ includeEnded: true });
  const { data: defaults } = trpc.outOfOffice.defaults.useQuery();
  const { data: members } = trpc.outOfOffice.orgMembers.useQuery();
  const { data: active } = trpc.outOfOffice.getActive.useQuery();

  const createMut = trpc.outOfOffice.create.useMutation({
    onSuccess: () => {
      toast.success("Out of office scheduled");
      utils.outOfOffice.list.invalidate();
      utils.outOfOffice.getActive.invalidate();
      setOpen(false);
      reset();
    },
    onError: (e) => toast.error(e.message),
  });
  const updateMut = trpc.outOfOffice.update.useMutation({
    onSuccess: () => {
      toast.success("Updated");
      utils.outOfOffice.list.invalidate();
      utils.outOfOffice.getActive.invalidate();
      setEditingId(null);
      setOpen(false);
      reset();
    },
    onError: (e) => toast.error(e.message),
  });
  const cancelMut = trpc.outOfOffice.cancel.useMutation({
    onSuccess: () => {
      toast.success("OOO cancelled");
      utils.outOfOffice.list.invalidate();
      utils.outOfOffice.getActive.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const [open, setOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [subject, setSubject] = React.useState("Out of Office Auto-Reply");
  const [body, setBody] = React.useState("");
  const [coverageUserId, setCoverageUserId] = React.useState<string>("");
  const [emergencyResponse, setEmergencyResponse] = React.useState("");

  function reset() {
    setStartDate("");
    setEndDate("");
    setSubject("Out of Office Auto-Reply");
    setBody(defaults?.defaultBody ?? "");
    setCoverageUserId("");
    setEmergencyResponse("");
  }

  React.useEffect(() => {
    if (defaults && !body) setBody(defaults.defaultBody);
  }, [defaults, body]);

  function startEdit(p: Period) {
    setEditingId(p.id);
    setStartDate(p.startDate);
    setEndDate(p.endDate);
    setSubject(p.autoResponseSubject);
    setBody(p.autoResponseBody);
    setCoverageUserId(p.coverageUserId ?? "");
    setEmergencyResponse(p.emergencyKeywordResponse ?? "");
    setOpen(true);
  }

  function handleSubmit() {
    if (!startDate || !endDate || !body.trim()) {
      toast.error("Start, end, and message are required.");
      return;
    }
    const payload = {
      startDate,
      endDate,
      autoResponseSubject: subject.trim() || "Out of Office Auto-Reply",
      autoResponseBody: body,
      coverageUserId: coverageUserId || null,
      emergencyKeywordResponse: emergencyResponse.trim() || null,
    };
    if (editingId) {
      updateMut.mutate({ oooId: editingId, ...payload });
    } else {
      createMut.mutate(payload);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Out of Office</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Auto-respond to inbound replies while you&apos;re away.
          </p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) {
              setEditingId(null);
              reset();
            }
          }}
        >
          <DialogTrigger render={<Button />}>
            <Plus className="size-4 mr-1" /> Schedule OOO
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit OOO" : "Schedule out of office"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="start">Start date</Label>
                  <Input
                    id="start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="end">End date</Label>
                  <Input
                    id="end"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="subject">Auto-reply subject</Label>
                <Input
                  id="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={200}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="body">Auto-reply message</Label>
                <Textarea
                  id="body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={6}
                  placeholder={defaults?.defaultBody}
                  maxLength={5000}
                />
                {defaults && (
                  <p className="text-xs text-muted-foreground">
                    Merge tags:{" "}
                    {defaults.mergeTags.map((t) => t.tag).join(", ")}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label>Coverage attorney (optional)</Label>
                <Select
                  value={coverageUserId || "none"}
                  onValueChange={(v) => setCoverageUserId(!v || v === "none" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {(members ?? []).map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} ({m.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="emergency">Emergency response (optional)</Label>
                <Textarea
                  id="emergency"
                  value={emergencyResponse}
                  onChange={(e) => setEmergencyResponse(e.target.value)}
                  rows={3}
                  placeholder="Sent instead of the regular auto-reply when message contains URGENT or EMERGENCY."
                  maxLength={5000}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={handleSubmit}
                disabled={createMut.isPending || updateMut.isPending}
              >
                {(createMut.isPending || updateMut.isPending) && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                {editingId ? "Save changes" : "Schedule"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {active && (
        <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20">
          <AlertCircle className="size-5 mt-0.5 text-amber-700 dark:text-amber-200" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
              You are out of office until {active.endDate}.
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-200">
              Auto-responses are being sent for inbound replies on cases where you&apos;re the lead.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => cancelMut.mutate({ oooId: active.id })}
            disabled={cancelMut.isPending}
          >
            <X className="size-4 mr-1" /> Cancel now
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (list ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No OOO periods yet.</p>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Start</th>
                <th className="px-3 py-2">End</th>
                <th className="px-3 py-2">Coverage</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(list ?? []).map((p) => {
                const coverage = members?.find((m) => m.id === p.coverageUserId);
                return (
                  <tr key={p.id} className="border-t">
                    <td className="px-3 py-2">
                      <Badge className={STATUS_TONE[p.status] ?? ""}>{p.status}</Badge>
                    </td>
                    <td className="px-3 py-2">{p.startDate}</td>
                    <td className="px-3 py-2">{p.endDate}</td>
                    <td className="px-3 py-2">
                      {coverage ? coverage.name : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right space-x-1">
                      {p.status !== "ended" && p.status !== "cancelled" && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => startEdit(p as Period)}>
                            <Edit className="size-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => cancelMut.mutate({ oooId: p.id })}
                          >
                            <X className="size-4" />
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
