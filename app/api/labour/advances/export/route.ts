import { GET as exportAdvances } from "@/app/api/labour/advances/route";

export async function GET(request: Request) {
  const url = new URL(request.url);
  url.searchParams.set("export", "csv");
  return exportAdvances(new Request(url, { headers: request.headers }));
}
