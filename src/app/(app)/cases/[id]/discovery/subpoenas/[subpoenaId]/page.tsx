import { SubpoenaDetail } from "@/components/cases/discovery/subpoena-detail";

export default async function SubpoenaPage({
  params,
}: {
  params: Promise<{ id: string; subpoenaId: string }>;
}) {
  const { id, subpoenaId } = await params;
  return <SubpoenaDetail caseId={id} subpoenaId={subpoenaId} />;
}
