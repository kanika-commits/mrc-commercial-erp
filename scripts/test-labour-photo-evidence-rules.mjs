import assert from "node:assert/strict";
import fs from "node:fs";

const photoApi = fs.readFileSync("app/api/labour/photo-evidence/route.ts", "utf8");
const photoIdApi = fs.readFileSync("app/api/labour/photo-evidence/[id]/route.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/202607250001_create_labour_management_v2.sql", "utf8");
const dailyWorkMigration = fs.readFileSync("supabase/migrations/202607250004_daily_work_progress_foundation.sql", "utf8");
const permissionMatrix = fs.readFileSync("lib/permissionMatrix.ts", "utf8");
const attendancePage = fs.readFileSync("app/labour/attendance/daily/page.tsx", "utf8");
const workLogsApi = fs.readFileSync("app/api/labour/work-logs/route.ts", "utf8");
const overtimeApi = fs.readFileSync("app/api/labour/overtime/route.ts", "utf8");

assert.match(photoApi, /createPrivateStorageAdapter/, "Photo upload must use the private storage adapter");
assert.match(photoApi, /sharp/, "Camera evidence must generate a server-side watermarked derivative");
assert.match(photoApi, /watermarked_storage_key/, "Watermarked derivative storage key must be stored in metadata");
assert.match(photoApi, /if \(stored\)[\s\S]+delete\(stored\)/, "DB failure path must remove uploaded storage object");
assert.match(photoApi, /if \(storedWatermarked\)[\s\S]+delete\(storedWatermarked\)/, "DB failure path must remove uploaded watermarked storage object");
assert.match(photoIdApi, /createSignedReadUrl/, "Photo open must use server-side signed URLs");
assert.match(photoIdApi, /watermarkedKey[\s\S]+watermarkedKey \|\| photo\.storage_key/, "Approval/view route must prefer watermarked evidence when available");
assert.match(photoIdApi, /requireLabourPermission\(request,\s*"labour_photo_evidence",\s*"view"\)/, "Signed URL route must require view permission");
assert.match(photoApi, /requireLabourPermission\(request,\s*"labour_photo_evidence",\s*replacePhotoId \? "edit" : "upload"\)/, "Upload/replace permissions must be split");
assert.match(photoIdApi, /requireLabourPermission\(request,\s*"labour_photo_evidence",\s*"delete"\)/, "Delete must require delete permission");
assert.match(photoApi, /const serverReceivedAt = new Date\(\)\.toISOString\(\)/, "Trusted server timestamp must be generated server-side");
assert.match(photoApi, /server_received_at: serverReceivedAt/, "Trusted server timestamp must be stored");
assert.match(photoApi, /const evidenceContext = referenceType === "work_log"/, "Daily Work photos must build server-side evidence context");
assert.match(photoApi, /contractor_profile_id: ref\.contractor_profile_id/, "Daily Work photos must preserve contractor context");
assert.match(photoApi, /assigned_engineer_user_id: ref\.assigned_engineer_user_id/, "Daily Work photos must preserve assigned engineer context");
assert.match(photoApi, /evidence_context: evidenceContext/, "Daily Work photo metadata must store the evidence context");
assert.match(photoApi, /original_preserved: true[\s\S]+watermark_generated: Boolean\(watermarkedObject\)/, "Photo metadata must preserve original and record derivative watermark generation");
assert.match(photoApi, /company_name: ref\.company_name/, "Watermark context must include trusted company context");
assert.match(photoApi, /site_name: ref\.site_name/, "Watermark context must include trusted site context");
assert.match(photoApi, /contractor_name: ref\.contractor_name/, "Watermark context must include trusted contractor context");
assert.match(photoApi, /constructiq_camera_v1/, "Verified Daily Work photos must use the dedicated camera capture contract");
assert.match(photoApi, /captured_at/, "Verified Daily Work photos must store captured timestamp metadata");
assert.match(photoApi, /captured_by_name/, "Verified Daily Work photos must store captured-by metadata");
assert.match(photoApi, /crypto\.createHash\("sha256"\)/, "Photo checksum must be calculated");
assert.match(photoApi, /duplicate_warning/, "Duplicate checksum warning must be returned/audited");
assert.match(photoApi, /version: nextVersion/, "Replacement must create a new version");
assert.match(photoApi, /is_active: false, replaced_by_photo_id/, "Replacement must retain old version inactive");
assert.match(photoIdApi, /Locked evidence cannot be deleted/, "Locked evidence must not be deleted");

for (const column of ["work_date", "reference_type", "reference_id", "work_group_id", "work_log_id", "overtime_request_id", "photo_type", "version", "is_active", "replaced_by_photo_id", "storage_provider", "storage_bucket", "storage_key", "original_file_name", "mime_type", "size_bytes", "checksum", "server_received_at", "uploaded_by", "uploaded_by_name", "uploaded_by_email", "remarks"]) {
  assert.match(migration, new RegExp(`${column} `), `Photo evidence migration must include ${column}`);
}

for (const column of ["captured_at", "captured_by", "captured_by_name", "captured_by_email", "capture_source", "verification_metadata"]) {
  assert.match(dailyWorkMigration, new RegExp(`${column} `), `Daily Work photo migration must add ${column}`);
}

assert.match(permissionMatrix, /labour_photo_evidence: \["view", "upload", "edit", "delete"\]/, "Permission matrix must expose photo evidence actions");
assert.match(migration, /\('labour_photo_evidence', 'view'\)[\s\S]+\('labour_photo_evidence', 'upload'\)[\s\S]+\('labour_photo_evidence', 'edit'\)[\s\S]+\('labour_photo_evidence', 'delete'\)/, "Migration must seed Super Admin photo permissions");
assert.doesNotMatch(photoApi, /attendance_ot_group|labour_attendance_ot_evidence_groups/, "General photo API must not retain abandoned Attendance OT evidence group handling");
assert.doesNotMatch(photoIdApi, /attendance_ot_group/, "Photo delete route must not retain abandoned Attendance OT evidence lock exceptions");
assert.doesNotMatch(attendancePage, /Overtime Evidence|Create Evidence Group|Selected Workers|navigator\.mediaDevices\.getUserMedia|Captured by:|attendance_ot_group|capture="environment"/, "Daily attendance must not expose OT evidence workflow");
assert.match(workLogsApi, /photo_count: activePhotoCount/, "Daily Work API must return saved photo counts for compact table display");
assert.match(overtimeApi, /Required overtime photos are missing before approval/, "OT approval must block when required photos are missing");
assert.match(overtimeApi, /Self approval is not allowed/, "OT self-approval policy must be enforced");

console.log("Labour photo evidence rule tests passed.");
