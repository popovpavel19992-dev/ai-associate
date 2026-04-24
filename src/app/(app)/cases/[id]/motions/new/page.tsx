import { MotionWizard } from "@/components/cases/motions/motion-wizard";

export default async function NewMotionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-4xl p-6">
      <MotionWizard caseId={id} />
    </div>
  );
}
