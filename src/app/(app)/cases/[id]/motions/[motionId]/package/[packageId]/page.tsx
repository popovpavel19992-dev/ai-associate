import { PackageWizard } from "@/components/cases/packages/package-wizard";

export default async function PackageWizardPage({
  params,
}: {
  params: Promise<{ id: string; motionId: string; packageId: string }>;
}) {
  const { id, motionId, packageId } = await params;
  return <PackageWizard caseId={id} motionId={motionId} packageId={packageId} />;
}
