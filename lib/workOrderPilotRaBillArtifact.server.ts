import crypto from "node:crypto";

export function decodePilotPdfBytes(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value && typeof value === "object" && Array.isArray((value as any).data)) return Buffer.from((value as any).data);
  const text = String(value || "");
  const raw = Buffer.from(text.startsWith("\\x") ? text.slice(2) : text, text.startsWith("\\x") ? "hex" : "base64");
  try {
    const parsed = JSON.parse(raw.toString("utf8"));
    if (parsed && Array.isArray(parsed.data)) return Buffer.from(parsed.data);
  } catch { /* raw PDF bytes are not JSON */ }
  return raw;
}

export function pilotPdfIntegrity(bytes: Buffer) {
  return { sha256: crypto.createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length };
}
