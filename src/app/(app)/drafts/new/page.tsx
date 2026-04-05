import { CreateDraftForm } from "@/components/drafts/create-draft-form";

export default function NewDraftPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Generate Contract</h1>
      <p className="text-sm text-muted-foreground">
        Fill in the details below and AI will generate a complete contract draft for your review.
      </p>
      <CreateDraftForm />
    </div>
  );
}
