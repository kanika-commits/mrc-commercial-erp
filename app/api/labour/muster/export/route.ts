import { GET as exportMuster } from "@/app/api/labour/attendance/monthly/route";

export async function GET(request: Request) {
  const url = new URL(request.url);
  url.searchParams.set("export", "csv");
  return exportMuster(new Request(url, { headers: request.headers }));
}
