import { NextResponse } from "next/server";
import { provisionManagedOrganization } from "@/lib/platformProvisioningServer";

export async function POST(request: Request) {
  const result = await provisionManagedOrganization(request, await request.json().catch(() => ({})));
  if ("response" in result) return result.response;
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  return NextResponse.json(result.data);
}
