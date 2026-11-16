import { Agent } from "undici";

export type AttendanceDiagnosticRoute = "attendance/daily" | "attendance/monthly" | "attendance/approval-groups";
export const supabaseServerDispatcher = new Agent({ maxHeaderSize: 128 * 1024 });

function details(error: any) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    cause: {
      code: error?.cause?.code,
      errno: error?.cause?.errno,
      syscall: error?.cause?.syscall,
      hostname: error?.cause?.hostname,
    },
  };
}

function headerReport(headers: Headers | undefined) {
  if (!headers) return { names: [], approx_bytes: 0 };
  const names: string[] = [];
  let approxBytes = 0;
  headers.forEach((value, name) => {
    names.push(name);
    approxBytes += name.length + value.length + 4;
  });
  return { names: names.sort(), approx_bytes: approxBytes };
}

export function routeFromRequest(request: Request): AttendanceDiagnosticRoute | null {
  const path = new URL(request.url).pathname;
  if (path.includes("/api/hr/attendance/daily")) return "attendance/daily";
  if (path.includes("/api/hr/attendance/monthly")) return "attendance/monthly";
  if (path.includes("/api/hr/attendance/approval-groups")) return "attendance/approval-groups";
  return null;
}

export function diagnosticFetch(route: AttendanceDiagnosticRoute, client: "auth" | "admin") {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const started = Date.now();
    const request = new Request(input, init);
    try {
      const response = await fetch(request, { dispatcher: supabaseServerDispatcher } as RequestInit);
      console.info("attendance_supabase_call", {
        route,
        operation: `${client}.supabase.fetch`,
        method: request.method,
        request_headers: headerReport(request.headers),
        response_status: response.status,
        response_headers: headerReport(response.headers),
        elapsed_ms: Date.now() - started,
      });
      return response;
    } catch (error) {
      console.error("attendance_supabase_failure", {
        route,
        operation: `${client}.supabase.fetch`,
        method: request.method,
        request_headers: headerReport(request.headers),
        elapsed_ms: Date.now() - started,
        ...details(error),
      });
      throw error;
    }
  };
}

export function logFailure(route: AttendanceDiagnosticRoute | null, operation: string, started: number, error: unknown) {
  if (route) console.error("attendance_operation_failure", { route, operation, elapsed_ms: Date.now() - started, ...details(error) });
}
