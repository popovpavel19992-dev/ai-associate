import { MotionDetail } from "@/components/cases/motions/motion-detail";

export default async function MotionDetailPage({ params }: { params: Promise<{ id: string; motionId: string }> }) {
  const { id, motionId } = await params;
  return <MotionDetail caseId={id} motionId={motionId} />;
}
