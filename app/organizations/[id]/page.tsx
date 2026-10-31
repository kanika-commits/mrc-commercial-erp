import OrganizationDetailClient from "@/app/organizations/[id]/OrganizationDetailClient";

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrganizationDetailClient organizationId={id} />;
}
