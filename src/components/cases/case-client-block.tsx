import Link from "next/link";
import { ClientTypeBadge } from "@/components/clients/client-type-badge";

interface Props {
  client: {
    id: string;
    displayName: string;
    clientType: "individual" | "organization";
  };
}

export function CaseClientBlock({ client }: Props) {
  return (
    <section className="space-y-2 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="text-sm font-semibold">Client</h3>
      <Link href={`/clients/${client.id}`} className="block font-medium hover:underline">
        {client.displayName}
      </Link>
      <ClientTypeBadge type={client.clientType} />
    </section>
  );
}
