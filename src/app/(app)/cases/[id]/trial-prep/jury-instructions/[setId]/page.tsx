import { JuryInstructionSetDetail } from "@/components/cases/trial-prep/jury-instruction-set-detail";

export default async function JuryInstructionSetDetailPage({
  params,
}: {
  params: Promise<{ id: string; setId: string }>;
}) {
  const { id, setId } = await params;
  return <JuryInstructionSetDetail caseId={id} setId={setId} />;
}
