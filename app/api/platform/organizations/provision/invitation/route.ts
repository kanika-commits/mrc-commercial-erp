import { createManagedTenantInvitation } from "@/lib/managedTenant/invitations";
export async function POST(request: Request) { const body = await request.json().catch(() => ({})); const result = await createManagedTenantInvitation(request, body); return result.response; }
