"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export interface CaseCaption {
  plaintiffName: string | null;
  defendantName: string | null;
  caseNumber: string | null;
  court: string | null;
  district: string | null;
}

export function CaseCaptionCard({ caseId, caption }: { caseId: string; caption: CaseCaption }) {
  const [open, setOpen] = React.useState(false);
  const utils = trpc.useUtils();

  const [plaintiffName, setPlaintiff] = React.useState("");
  const [defendantName, setDefendant] = React.useState("");
  const [caseNumber, setCaseNumber] = React.useState("");
  const [court, setCourt] = React.useState("");
  const [district, setDistrict] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setPlaintiff(caption.plaintiffName ?? "");
      setDefendant(caption.defendantName ?? "");
      setCaseNumber(caption.caseNumber ?? "");
      setCourt(caption.court ?? "");
      setDistrict(caption.district ?? "");
    }
  }, [open, caption]);

  const update = trpc.cases.update.useMutation({
    onSuccess: async () => {
      toast.success("Caption saved");
      await utils.cases.getById.invalidate({ caseId });
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const rows: [string, string | null][] = [
    ["Court", caption.court],
    ["District", caption.district],
    ["Plaintiff", caption.plaintiffName],
    ["Defendant", caption.defendantName],
    ["Case No.", caption.caseNumber],
  ];

  return (
    <div className="rounded-lg border border-zinc-800 p-4 md:col-span-2">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Litigation Caption
        </p>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setOpen(true)}>
          <Pencil className="size-3.5 mr-1" /> Edit
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <p className="text-xs text-zinc-500 mb-1">{label}</p>
            <p className="text-sm text-zinc-300">{value || "\u2014"}</p>
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Edit litigation caption</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label>Court</Label><Input value={court} onChange={(e) => setCourt(e.target.value)} maxLength={200} placeholder="U.S. District Court" /></div>
            <div className="sm:col-span-2"><Label>District</Label><Input value={district} onChange={(e) => setDistrict(e.target.value)} maxLength={200} placeholder="Southern District of New York" /></div>
            <div><Label>Plaintiff</Label><Input value={plaintiffName} onChange={(e) => setPlaintiff(e.target.value)} maxLength={200} /></div>
            <div><Label>Defendant</Label><Input value={defendantName} onChange={(e) => setDefendant(e.target.value)} maxLength={200} /></div>
            <div className="sm:col-span-2"><Label>Case No.</Label><Input value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} maxLength={100} placeholder="1:24-cv-01234" /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={update.isPending}
              onClick={() => update.mutate({
                caseId,
                plaintiffName: plaintiffName.trim(),
                defendantName: defendantName.trim(),
                caseNumber: caseNumber.trim(),
                court: court.trim(),
                district: district.trim(),
              })}
            >
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
