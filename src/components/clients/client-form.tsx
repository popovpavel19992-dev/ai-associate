// src/components/clients/client-form.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import type { CreateClientInput } from "@/lib/clients";
import {
  ConflictReviewModal,
  type ReviewHit,
  type Severity,
} from "@/components/conflict-checker/conflict-review-modal";

type Mode = "create";

interface Props {
  mode: Mode;
}

export function ClientForm({ mode }: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [clientType, setClientType] = useState<"individual" | "organization">("individual");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [ein, setEin] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");

  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [country, setCountry] = useState("US");

  const [notes, setNotes] = useState("");

  // Conflict modal state
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewHits, setReviewHits] = useState<ReviewHit[]>([]);
  const [reviewSeverity, setReviewSeverity] = useState<Severity | null>(null);
  const [pendingLogId, setPendingLogId] = useState<string | null>(null);

  const runConflictCheck = trpc.conflictChecker.runCheck.useMutation();
  const recordOverride = trpc.conflictChecker.recordOverride.useMutation();
  const attachTarget = trpc.conflictChecker.attachTarget.useMutation();

  const create = trpc.clients.create.useMutation({
    onSuccess: async ({ client }) => {
      if (pendingLogId) {
        try {
          await attachTarget.mutateAsync({ logId: pendingLogId, clientId: client.id });
        } catch {
          /* non-fatal */
        }
      }
      utils.clients.list.invalidate();
      toast.success("Client created");
      router.push(`/clients/${client.id}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const buildInput = (): CreateClientInput => {
    const base = {
      country,
      addressLine1: addressLine1 || undefined,
      addressLine2: addressLine2 || undefined,
      city: city || undefined,
      state: state || undefined,
      zipCode: zipCode || undefined,
      notes: notes || undefined,
    };
    return clientType === "individual"
      ? {
          clientType: "individual",
          firstName,
          lastName,
          dateOfBirth: dateOfBirth || undefined,
          ...base,
        }
      : {
          clientType: "organization",
          companyName,
          ein: ein || undefined,
          industry: industry || undefined,
          website: website || undefined,
          ...base,
        };
  };

  const queryName = (): string =>
    clientType === "individual" ? `${firstName} ${lastName}`.trim() : companyName.trim();

  const submit = async () => {
    const name = queryName();
    if (!name) return;

    try {
      const result = await runConflictCheck.mutateAsync({
        name,
        address: addressLine1 || undefined,
        context: "client_create",
      });

      if (result.hits.length > 0) {
        setReviewHits(result.hits as ReviewHit[]);
        setReviewSeverity(result.highestSeverity);
        setPendingLogId(result.logId);
        setReviewOpen(true);
        return;
      }

      setPendingLogId(result.logId);
      create.mutate(buildInput());
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleOverride = async (reason: string) => {
    if (!pendingLogId) return;
    try {
      // Insert the client first so we have a clientId for the override row.
      const created = await new Promise<{ id: string }>((resolve, reject) => {
        create.mutate(buildInput(), {
          onSuccess: ({ client }) => resolve({ id: client.id }),
          onError: (e) => reject(e),
        });
      }).catch((e) => {
        throw e;
      });
      await recordOverride.mutateAsync({
        logId: pendingLogId,
        clientId: created.id,
        reason,
      });
      setReviewOpen(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const canSubmit =
    clientType === "individual"
      ? firstName.trim().length > 0 && lastName.trim().length > 0
      : companyName.trim().length > 0;

  const isPending =
    create.isPending || runConflictCheck.isPending || recordOverride.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === "create" ? "New Client" : "Edit Client"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex gap-2">
          <Button
            type="button"
            variant={clientType === "individual" ? "default" : "outline"}
            onClick={() => setClientType("individual")}
          >
            Individual
          </Button>
          <Button
            type="button"
            variant={clientType === "organization" ? "default" : "outline"}
            onClick={() => setClientType("organization")}
          >
            Organization
          </Button>
        </div>

        {clientType === "individual" ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="dob">Date of birth</Label>
              <Input id="dob" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2">
              <Label htmlFor="company">Company name</Label>
              <Input id="company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={200} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ein">EIN</Label>
              <Input id="ein" placeholder="12-3456789" value={ein} onChange={(e) => setEin(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="industry">Industry</Label>
              <Input id="industry" value={industry} onChange={(e) => setIndustry(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="website">Website</Label>
              <Input id="website" placeholder="https://" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label>Address</Label>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Line 1" className="col-span-2" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
            <Input placeholder="Line 2" className="col-span-2" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} />
            <Input placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
            <Input placeholder="State" value={state} onChange={(e) => setState(e.target.value)} />
            <Input placeholder="ZIP" value={zipCode} onChange={(e) => setZipCode(e.target.value)} />
            <Input placeholder="Country" maxLength={2} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />
        </div>

        <Button onClick={submit} disabled={!canSubmit || isPending} className="w-full">
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create Client
        </Button>
      </CardContent>

      <ConflictReviewModal
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        hits={reviewHits}
        highestSeverity={reviewSeverity}
        onCancel={() => setReviewOpen(false)}
        onOverride={handleOverride}
        isOverriding={create.isPending || recordOverride.isPending}
      />
    </Card>
  );
}
