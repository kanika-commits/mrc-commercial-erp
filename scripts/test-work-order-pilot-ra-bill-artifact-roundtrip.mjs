import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const helper = fs.readFileSync("lib/workOrderPilotRaBillArtifact.server.ts", "utf8");
const route = fs.readFileSync("app/api/work-orders/pilot-ra-bills/[id]/reviewed-pdf/route.ts", "utf8");
assert.match(helper, /Buffer\.isBuffer/);
assert.match(helper, /instanceof Uint8Array/);
assert.match(helper, /Array\.isArray/);
assert.match(route, /decodePilotPdfBytes/);
assert.match(route, /pilotPdfIntegrity/);
assert.match(route, /requirePermission\(request, "work_orders", "approve"\)/);
assert.match(route, /applyOrganizationScope\(query, scope\)/);
assert.match(route, /Pilot reviewed PDF not found/);
assert.match(route, /failed integrity verification/);
assert.match(route, /in\(\"status\", \[\"submitted\", \"approved\", \"rejected\"\]\)/);
assert.doesNotMatch(route, /eq\(\"ra_bill\.status\", \"submitted\"\)/);

const bytes = Buffer.from("%PDF-1.7\nsynthetic Pilot artifact\n%%EOF\n", "utf8");
const hash = crypto.createHash("sha256").update(bytes).digest("hex");
const encodings = [bytes, new Uint8Array(bytes), { type: "Buffer", data: [...bytes] }, `\\x${bytes.toString("hex")}`, `\\x${Buffer.from(JSON.stringify({ type: "Buffer", data: [...bytes] }), "utf8").toString("hex")}`, bytes.toString("base64")];
for (const encoded of encodings) {
  let decoded = encoded && typeof encoded === "object" && !Buffer.isBuffer(encoded) && !(encoded instanceof Uint8Array) && Array.isArray(encoded.data) ? Buffer.from(encoded.data) : Buffer.isBuffer(encoded) ? encoded : encoded instanceof Uint8Array ? Buffer.from(encoded) : Buffer.from(String(encoded).startsWith("\\x") ? String(encoded).slice(2) : String(encoded), String(encoded).startsWith("\\x") ? "hex" : "base64");
  try { const parsed = JSON.parse(decoded.toString("utf8")); if (parsed && Array.isArray(parsed.data)) decoded = Buffer.from(parsed.data); } catch {}
  assert.deepEqual(decoded, bytes);
  assert.equal(crypto.createHash("sha256").update(decoded).digest("hex"), hash);
  assert.equal(decoded.length, bytes.length);
}
const tampered = Buffer.from(bytes); tampered[8] ^= 1;
assert.notEqual(crypto.createHash("sha256").update(tampered).digest("hex"), hash);
const wrongCycle = { reviewed_pdf_sha256: hash, reviewed_pdf_byte_length: bytes.length, pdf_bytes: Buffer.from("%PDF-wrong-cycle") };
assert.notEqual(crypto.createHash("sha256").update(wrongCycle.pdf_bytes).digest("hex"), wrongCycle.reviewed_pdf_sha256);
console.log("Pilot RA Bill artifact round-trip contract passed.");
