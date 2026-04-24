"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export function RuleEditorModal({
  ruleId,
  open,
  onOpenChange,
}: {
  ruleId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [triggerEvent, setTriggerEvent] = React.useState("");
  const [name, setName] = React.useState("");
  const [days, setDays] = React.useState<string>("21");
  const [dayType, setDayType] = React.useState<"calendar" | "court">("calendar");
  const [jurisdiction, setJurisdiction] = React.useState("FRCP");
  const [citation, setCitation] = React.useState("");
  const [remindersStr, setRemindersStr] = React.useState("7,3,1");
  const [appliesMode, setAppliesMode] = React.useState<"all" | "specific">("all");
  const [selectedMotionTypes, setSelectedMotionTypes] = React.useState<string[]>([]);

  const { data: templates } = trpc.motions.listTemplates.useQuery();
  const motionTypeOptions = React.useMemo(() => {
    const active = (templates ?? []).filter((t) => t.active);
    const deduped = Array.from(
      new Map(active.map((t) => [t.motionType, { slug: t.motionType, label: t.name }])).values(),
    );
    return deduped;
  }, [templates]);

  React.useEffect(() => {
    if (open && !ruleId) {
      setTriggerEvent(""); setName(""); setDays("21"); setDayType("calendar");
      setJurisdiction("FRCP"); setCitation(""); setRemindersStr("7,3,1");
      setAppliesMode("all"); setSelectedMotionTypes([]);
    }
  }, [open, ruleId]);

  const create = trpc.deadlines.createRule.useMutation({
    onSuccess: async () => { toast.success("Rule created"); await utils.deadlines.listRules.invalidate(); onOpenChange(false); },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.deadlines.updateRule.useMutation({
    onSuccess: async () => { toast.success("Rule saved"); await utils.deadlines.listRules.invalidate(); onOpenChange(false); },
    onError: (e) => toast.error(e.message),
  });

  const reminders = remindersStr.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n) && n >= 0).slice(0, 5);
  const daysN = parseInt(days, 10);

  function save() {
    if (!triggerEvent || !name || isNaN(daysN)) { toast.error("Trigger, name, and days are required"); return; }
    if (ruleId) {
      update.mutate({ ruleId, name, days: daysN, dayType, defaultReminders: reminders });
    } else {
      const appliesToMotionTypes =
        triggerEvent === "motion_filed" && appliesMode === "specific"
          ? selectedMotionTypes
          : null;
      if (appliesToMotionTypes && appliesToMotionTypes.length === 0) {
        toast.error("Pick at least one motion type or choose All motions");
        return;
      }
      create.mutate({
        triggerEvent, name, days: daysN, dayType,
        shiftIfHoliday: true, defaultReminders: reminders,
        jurisdiction, citation: citation || undefined,
        appliesToMotionTypes,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{ruleId ? "Edit rule" : "New rule"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!ruleId && (
            <>
              <div><Label>Trigger event</Label><Input value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)} placeholder="e.g. served_defendant" /></div>
              <div><Label>Jurisdiction</Label><Input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} /></div>
              <div><Label>Citation (optional)</Label><Input value={citation} onChange={(e) => setCitation(e.target.value)} placeholder="e.g. CPLR 3012(a)" /></div>
            </>
          )}
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} /></div>
          <div><Label>Days</Label><Input type="number" value={days} onChange={(e) => setDays(e.target.value)} /></div>
          <div>
            <Label>Day type</Label>
            <div className="flex gap-3 mt-1">
              <label className="flex items-center gap-1 text-sm">
                <input type="radio" checked={dayType === "calendar"} onChange={() => setDayType("calendar")} />
                Calendar days
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input type="radio" checked={dayType === "court"} onChange={() => setDayType("court")} />
                Court days (skip weekends + holidays)
              </label>
            </div>
          </div>
          <div><Label>Default reminders</Label><Input value={remindersStr} onChange={(e) => setRemindersStr(e.target.value)} placeholder="7,3,1" /></div>
          {!ruleId && triggerEvent === "motion_filed" && (
            <div>
              <Label>Applies to motion types</Label>
              <div className="flex gap-3 mt-1">
                <label className="flex items-center gap-1 text-sm">
                  <input type="radio" checked={appliesMode === "all"} onChange={() => setAppliesMode("all")} />
                  All motions
                </label>
                <label className="flex items-center gap-1 text-sm">
                  <input type="radio" checked={appliesMode === "specific"} onChange={() => setAppliesMode("specific")} />
                  Specific types
                </label>
              </div>
              {appliesMode === "specific" && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {motionTypeOptions.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No active motion templates available.</span>
                  ) : motionTypeOptions.map((opt) => {
                    const checked = selectedMotionTypes.includes(opt.slug);
                    return (
                      <button
                        type="button"
                        key={opt.slug}
                        onClick={() =>
                          setSelectedMotionTypes((s) => (checked ? s.filter((x) => x !== opt.slug) : [...s, opt.slug]))
                        }
                        className={`rounded-full border px-3 py-1 text-xs ${checked ? "bg-blue-600 text-white border-blue-600" : "border-gray-300"}`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={create.isPending || update.isPending}>
            {create.isPending || update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
