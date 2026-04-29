import { notFound } from "next/navigation";
import { PublicIntakeTemplatesService } from "@/server/services/public-intake/templates-service";
import { PublicIntakeForm } from "@/components/intake/public-intake-form";

export const dynamic = "force-dynamic";

export default async function PublicIntakePage({
  params,
}: {
  params: Promise<{ orgSlug: string; templateSlug: string }>;
}) {
  const { orgSlug, templateSlug } = await params;
  const svc = new PublicIntakeTemplatesService();
  const lookup = await svc.getBySlug(orgSlug, templateSlug);
  if (!lookup) notFound();

  const { template, orgName } = lookup;

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-12">
      <div className="mx-auto max-w-2xl px-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-500">{orgName}</p>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            {template.name}
          </h1>
          {template.description ? (
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {template.description}
            </p>
          ) : null}
          <div className="mt-6">
            <PublicIntakeForm
              orgSlug={orgSlug}
              templateSlug={templateSlug}
              fields={template.fields ?? []}
              thankYouMessage={template.thankYouMessage}
            />
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-zinc-500">
          Powered by ClearTerms
        </p>
      </div>
    </main>
  );
}
