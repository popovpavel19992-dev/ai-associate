import { IntakePage } from "@/components/portal/intake/intake-page";

export default async function Page({
  params,
}: {
  params: Promise<{ formId: string }>;
}) {
  const { formId } = await params;
  return <IntakePage formId={formId} />;
}
