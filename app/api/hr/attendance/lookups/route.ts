import { NextResponse } from "next/server";
import {
  adminClient,
  jsonError,
  loadEmployeeAttendanceLookups,
  requireAttendanceView,
} from "../_shared";

export async function GET(request: Request) {
  try {
    const auth = await requireAttendanceView(request);
    if ("response" in auth) return auth.response;
    const admin = adminClient();
    const lookups = await loadEmployeeAttendanceLookups(admin, auth);
    return NextResponse.json(lookups);
  } catch (error: any) {
    return jsonError(error.message || "Failed to load employee attendance lookups.", 500);
  }
}
