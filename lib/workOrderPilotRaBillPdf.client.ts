import { getAccessToken } from "@/components/hr/hrClient";

export async function loadPilotRaBillPdf(billId: string): Promise<string> {
  const token = await getAccessToken();
  const response = await fetch(`/api/work-orders/pilot-ra-bills/${encodeURIComponent(billId)}/reviewed-pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) {
    let detail = "Request failed.";
    try { detail = JSON.parse(new TextDecoder().decode(bytes)).error || detail; } catch { /* non-JSON error body */ }
    throw new Error(`Unable to load reviewed Pilot RA Bill PDF (HTTP ${response.status}): ${detail}`);
  }
  const contentType = response.headers.get("content-type") || "";
  const signature = new TextDecoder().decode(bytes.slice(0, 5));
  if (!contentType.toLowerCase().includes("application/pdf") || signature !== "%PDF-") {
    throw new Error(`Unable to load reviewed Pilot RA Bill PDF (HTTP ${response.status}): server returned a non-PDF response.`);
  }
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}
