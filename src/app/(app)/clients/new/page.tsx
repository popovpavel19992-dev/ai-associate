// src/app/(app)/clients/new/page.tsx
import { ClientForm } from "@/components/clients/client-form";

export default function NewClientPage() {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <ClientForm mode="create" />
    </div>
  );
}
