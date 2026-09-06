"use client";
import { useParams, useSearchParams } from "next/navigation";
import RequisitionForm from "../../RequisitionForm";
export default function EditRequisitionPage() { const params = useParams<{ id: string }>(); const searchParams = useSearchParams(); const lineKeys = searchParams.get("line_keys")?.split(",").filter(Boolean) || []; return <RequisitionForm requisitionId={params.id} approvalEdit={searchParams.get("mode") === "approval"} approvalOrigin={searchParams.get("origin") === "detail"} selectedLineKeys={lineKeys} />; }
