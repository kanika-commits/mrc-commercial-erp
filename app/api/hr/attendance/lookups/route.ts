import { NextResponse } from "next/server";
import {
  adminClient,
  jsonError,
  loadEmployeeAttendanceLookups,
  requireEmployeeAttendanceLookupView,
} from "../_shared";

export async function GET(request: Request) {
  try {
    const auth = await requireEmployeeAttendanceLookupView(request);
    if ("response" in auth) return auth.response;
    const admin = adminClient();
    const lookups = await loadEmployeeAttendanceLookups(admin, auth);
    return NextResponse.json(lookups);
  } catch (error: any) {
    return jsonError(error.message || "Failed to load employee attendance lookups.", 500);
  }
}
