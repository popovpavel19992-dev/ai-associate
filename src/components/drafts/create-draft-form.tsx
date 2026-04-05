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
import { CONTRACT_TYPES, CONTRACT_TYPE_LABELS, US_STATES } from "@/lib/constants";

export function CreateDraftForm() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [contractType, setContractType] = useState<string>("");
  const [partyA, setPartyA] = useState("");
  const [partyARole, setPartyARole] = useState("");
  const [partyB, setPartyB] = useState("");
  const [partyBRole, setPartyBRole] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [keyTerms, setKeyTerms] = useState("");
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [linkedCaseId, setLinkedCaseId] = useState("");
  const [referenceContractId, setReferenceContractId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const casesQuery = trpc.cases.list.useQuery(
    { limit: 100, offset: 0 },
    { staleTime: 60_000 },
  );

  const contractsQuery = trpc.contracts.list.useQuery(
    { limit: 100, offset: 0 },
    { staleTime: 60_000 },
  );

  const readyContracts = contractsQuery.data?.filter(
    (c) => c.status === "ready",
  );

  const createDraft = trpc.drafts.create.useMutation({
    onError: (err) => {
      setError(err.message);
    },
  });

  const isSubmitting = createDraft.isPending;

  const handleSubmit = async () => {
    if (!name.trim() || !contractType || !partyA.trim() || !partyB.trim()) return;

    setError(null);

    try {
      const result = await createDraft.mutateAsync({
        name: name.trim(),
        contractType: contractType as (typeof CONTRACT_TYPES)[number],
        partyA: partyA.trim(),
        partyARole: partyARole.trim() || undefined,
        partyB: partyB.trim(),
        partyBRole: partyBRole.trim() || undefined,
        jurisdiction: jurisdiction || undefined,
        keyTerms: keyTerms.trim() || undefined,
        specialInstructions: specialInstructions.trim() || undefined,
        linkedCaseId: linkedCaseId || undefined,
        referenceContractId: referenceContractId || undefined,
      });

      toast.success("Draft generation started");
      router.push(`/drafts/${result.id}`);
    } catch {
      // Error handled by onError callback
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate Contract Draft</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Contract Name */}
        <div className="space-y-2">
          <Label htmlFor="draft-name">Contract Name</Label>
          <Input
            id="draft-name"
            placeholder="e.g. Acme Corp — Service Agreement"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            disabled={isSubmitting}
          />
        </div>

        {/* Contract Type */}
        <div className="space-y-2">
          <Label htmlFor="draft-type">Contract Type</Label>
          <select
            id="draft-type"
            value={contractType}
            onChange={(e) => setContractType(e.target.value)}
            disabled={isSubmitting}
            className="flex h-9 w-full rounded-md border border-zinc-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:border-zinc-800"
          >
            <option value="">Select type...</option>
            {CONTRACT_TYPES.map((type) => (
              <option key={type} value={type}>
                {CONTRACT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        {/* Parties */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="party-a">Party A</Label>
            <Input
              id="party-a"
              placeholder="e.g. Acme Corp"
              value={partyA}
              onChange={(e) => setPartyA(e.target.value)}
              maxLength={500}
              disabled={isSubmitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="party-a-role">Party A Role</Label>
            <Input
              id="party-a-role"
              placeholder="e.g. Client"
              value={partyARole}
              onChange={(e) => setPartyARole(e.target.value)}
              maxLength={200}
              disabled={isSubmitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="party-b">Party B</Label>
            <Input
              id="party-b"
              placeholder="e.g. Beta LLC"
              value={partyB}
              onChange={(e) => setPartyB(e.target.value)}
              maxLength={500}
              disabled={isSubmitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="party-b-role">Party B Role</Label>
            <Input
              id="party-b-role"
              placeholder="e.g. Counterparty"
              value={partyBRole}
              onChange={(e) => setPartyBRole(e.target.value)}
              maxLength={200}
              disabled={isSubmitting}
            />
          </div>
        </div>

        {/* Jurisdiction */}
        <div className="space-y-2">
          <Label htmlFor="jurisdiction">Jurisdiction</Label>
          <select
            id="jurisdiction"
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
            disabled={isSubmitting}
            className="flex h-9 w-full rounded-md border border-zinc-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:border-zinc-800"
          >
            <option value="">Select state (optional)</option>
            {US_STATES.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </div>

        {/* Key Terms */}
        <div className="space-y-2">
          <Label htmlFor="key-terms">Key Terms</Label>
          <Textarea
            id="key-terms"
            placeholder="Describe key terms, payment amounts, durations, etc."
            value={keyTerms}
            onChange={(e) => setKeyTerms(e.target.value)}
            maxLength={5000}
            rows={4}
            disabled={isSubmitting}
          />
        </div>

        {/* Special Instructions */}
        <div className="space-y-2">
          <Label htmlFor="special-instructions">Special Instructions</Label>
          <Textarea
            id="special-instructions"
            placeholder="Any additional instructions for the AI drafter..."
            value={specialInstructions}
            onChange={(e) => setSpecialInstructions(e.target.value)}
            maxLength={5000}
            rows={3}
            disabled={isSubmitting}
          />
        </div>

        {/* Linked Case */}
        <div className="space-y-2">
          <Label htmlFor="linked-case">Link to Case (optional)</Label>
          <select
            id="linked-case"
            value={linkedCaseId}
            onChange={(e) => setLinkedCaseId(e.target.value)}
            disabled={isSubmitting}
            className="flex h-9 w-full rounded-md border border-zinc-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:border-zinc-800"
          >
            <option value="">None</option>
            {casesQuery.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Reference Contract */}
        <div className="space-y-2">
          <Label htmlFor="reference-contract">Reference Contract (optional)</Label>
          <select
            id="reference-contract"
            value={referenceContractId}
            onChange={(e) => setReferenceContractId(e.target.value)}
            disabled={isSubmitting}
            className="flex h-9 w-full rounded-md border border-zinc-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:border-zinc-800"
          >
            <option value="">None</option>
            {readyContracts?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Select a reviewed contract as a reference for the draft.
          </p>
        </div>

        {/* Submit */}
        <Button
          onClick={handleSubmit}
          disabled={
            !name.trim() ||
            !contractType ||
            !partyA.trim() ||
            !partyB.trim() ||
            isSubmitting
          }
          className="w-full"
        >
          {isSubmitting && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          {isSubmitting ? "Generating..." : "Generate Draft (3 credits)"}
        </Button>

        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
