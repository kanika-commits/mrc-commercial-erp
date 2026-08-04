import fs from "node:fs";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

for (const file of [".env.local", ".env"]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const expected = {
  groupId: "ef473767-e4e2-4f6f-b857-f3fa100b2587",
  organizationId: "3b65abde-9f9f-4f1b-bd40-fa261a76920b",
  companyId: "4d890ed5-e458-4c4b-9375-f805951e76a5",
  siteId: "398e699a-253f-48b7-b73e-6fce65251ab2",
  workDate: "2026-07-30",
  engineerEmployeeId: "7be14157-6e63-4ab8-88ec-3299899ff456",
  members: [
    { membershipId: "2310d219-dc1e-4b11-9493-6c31560c98ba", workerId: "887deb9e-aba0-4a2f-a0ab-fb854acded02", labourCode: "LAB000009" },
    { membershipId: "de392117-8cd5-4046-947e-af66a0230e6d", workerId: "924bc20e-481f-46f7-902c-3c74bdfa99e9", labourCode: "LAB000005" },
  ],
};

async function main() {
  const { data: group, error: groupError } = await supabase
    .from("labour_work_groups")
    .select("id, organization_id, company_id, site_id, work_date, engineer_employee_id, group_number, status, group_type")
    .eq("id", expected.groupId)
    .maybeSingle();
  if (groupError) throw groupError;
  assert.ok(group, "Affected Group 1 was not found");
  assert.equal(group.organization_id, expected.organizationId);
  assert.equal(group.company_id, expected.companyId);
  assert.equal(group.site_id, expected.siteId);
  assert.equal(group.work_date, expected.workDate);
  assert.equal(group.engineer_employee_id, expected.engineerEmployeeId);
  assert.equal(group.group_number, 1);
  assert.equal(group.group_type, "engineer_group");

  const memberIds = expected.members.map((member) => member.membershipId);
  const workerIds = expected.members.map((member) => member.workerId);
  const { data: members, error: membersError } = await supabase
    .from("labour_work_group_members")
    .select("id, work_group_id, labour_worker_id, status, organization_id, company_id, site_id, work_date, labour_workers(labour_code, worker_name)")
    .in("id", memberIds);
  if (membersError) throw membersError;
  assert.equal((members || []).length, expected.members.length, "Expected affected membership rows were not all found");
  for (const expectedMember of expected.members) {
    const member = members.find((row) => row.id === expectedMember.membershipId);
    assert.ok(member, `Membership ${expectedMember.membershipId} missing`);
    assert.equal(member.work_group_id, expected.groupId);
    assert.equal(member.labour_worker_id, expectedMember.workerId);
    assert.equal(member.status, "cancelled");
    assert.equal(member.organization_id, expected.organizationId);
    assert.equal(member.company_id, expected.companyId);
    assert.equal(member.site_id, expected.siteId);
    assert.equal(member.work_date, expected.workDate);
    assert.equal(member.labour_workers?.labour_code, expectedMember.labourCode);
  }

  const { data: conflicts, error: conflictError } = await supabase
    .from("labour_work_group_members")
    .select("id, work_group_id, labour_worker_id, status")
    .eq("organization_id", expected.organizationId)
    .eq("company_id", expected.companyId)
    .eq("site_id", expected.siteId)
    .eq("work_date", expected.workDate)
    .eq("status", "active")
    .in("labour_worker_id", workerIds);
  if (conflictError) throw conflictError;
  assert.equal((conflicts || []).length, 0, "One of the affected workers already has an active group membership for the same site/date");

  const now = new Date().toISOString();
  const { error: groupUpdateError } = await supabase
    .from("labour_work_groups")
    .update({ status: "draft", updated_at: now })
    .eq("id", expected.groupId)
    .eq("status", "submitted");
  if (groupUpdateError) throw groupUpdateError;

  const { error: memberUpdateError } = await supabase
    .from("labour_work_group_members")
    .update({ status: "active", updated_at: now })
    .in("id", memberIds)
    .eq("status", "cancelled");
  if (memberUpdateError) throw memberUpdateError;

  const { data: repairedMembers, error: verifyError } = await supabase
    .from("labour_work_group_members")
    .select("id, status")
    .in("id", memberIds);
  if (verifyError) throw verifyError;
  assert.deepEqual((repairedMembers || []).map((row) => row.status).sort(), ["active", "active"]);

  console.log(JSON.stringify({
    repaired_group_id: expected.groupId,
    restored_status: "draft",
    reactivated_membership_ids: memberIds,
    reactivated_labour_codes: expected.members.map((member) => member.labourCode),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
