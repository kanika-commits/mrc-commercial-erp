import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/202607300005_site_wise_muster_workflow_configuration.sql", "utf8");
const configApi = fs.readFileSync("app/api/labour/configuration/route.ts", "utf8");
const configPage = fs.readFileSync("app/labour/configuration/page.tsx", "utf8");
const approvalApi = fs.readFileSync("app/api/labour/approvals/route.ts", "utf8");

assert.match(migration, /add column if not exists approval_layer_count integer not null default 2/, "Site config must store approval layer count");
assert.match(migration, /add column if not exists approval_workflow_version integer not null default 1/, "Site config must version approval workflows");
assert.match(migration, /check \(approval_layer_count between 1 and 5\)/, "Layer count must be constrained from 1 to 5");
assert.match(migration, /create table if not exists public\.labour_site_approval_layers/, "Site approval layer table must exist");
assert.match(migration, /layer_sequence integer not null check \(layer_sequence between 1 and 5\)/, "Layer sequence must be deterministic and limited");
assert.match(migration, /stage_name text not null/, "Stage names must be configurable and required");
assert.match(migration, /approver_user_id uuid not null references public\.profiles/, "Each layer must have exactly one ERP approver");
assert.doesNotMatch(migration, /alternate_approver|backup_approver/, "No alternate or backup approver columns are allowed");
assert.match(migration, /labour_site_approval_layers_sequence_uidx/, "Active layers must be unique per configuration/version/sequence");
assert.match(migration, /create table if not exists public\.labour_site_configuration_events/, "Configuration audit events must be stored");
assert.match(migration, /previous_values jsonb/, "Configuration audit must retain previous values");
assert.match(migration, /new_values jsonb not null default '\{\}'::jsonb/, "Configuration audit must retain new values");
assert.match(migration, /labour_daily_submissions[\s\S]+approval_workflow_snapshot jsonb not null default '\{\}'::jsonb/, "Engineer submissions must be able to freeze workflow snapshots later");
assert.match(migration, /labour_attendance_periods[\s\S]+approval_workflow_snapshot jsonb not null default '\{\}'::jsonb/, "Standard attendance periods must be able to freeze workflow snapshots later");
assert.match(migration, /corrected_after_lock boolean not null default false/, "Post-lock correction marker must be available without replacing approval status");
assert.match(migration, /attendance_lock_hours >= 0 and attendance_lock_hours <= 168/, "Lock-after hours must support non-negative whole hours");

assert.match(configApi, /function approvalLayerCount/, "Configuration API must validate layer count");
assert.match(configApi, /if \(layerCount === null\) return jsonError\("Approval layer count must be between 1 and 5\."\)/, "Invalid layer counts must be rejected");
assert.match(configApi, /normalizeApprovalLayers/, "Configuration API must normalize layers by sequence");
assert.match(configApi, /Stage name is required for Layer/, "Each configured layer must require a stage name");
assert.match(configApi, /\$\{label\} approver is required/, "Each configured layer must require one approver");
assert.match(configApi, /resolveLayerApprover/, "Layer approvers must be resolved server-side");
assert.match(configApi, /approver must have an active ERP login/, "Layer approvers must use active ERP identities");
assert.match(configApi, /workflowChanged/, "Workflow changes must create a new version");
assert.match(configApi, /approval_workflow_version: workflowVersion/, "Saved config must persist the active workflow version");
assert.match(configApi, /from\("labour_site_approval_layers"\)\.insert\(layerRows\)/, "Layer rows must be persisted separately from the site config");
assert.match(configApi, /from\("labour_site_configuration_events"\)\.insert/, "Configuration changes must write audit history");
assert.match(configApi, /wholeHours[\s\S]+hours >= 0/, "API lock-hour validation must allow zero");

assert.match(configPage, /Approval Workflow/, "Muster Configuration page must expose approval workflow configuration");
assert.match(configPage, /Number of Approval Layers/, "Page must expose layer-count selector");
assert.match(configPage, /\[1, 2, 3, 4, 5\]/, "Layer selector must be limited to one through five");
assert.match(configPage, /Stage Name/, "Page must expose configurable stage names");
assert.match(configPage, /Select Approver/, "Page must expose one approver selector per layer");
assert.match(configPage, /Reducing approval layers will remove/, "Reducing layers with existing config must ask for confirmation");
assert.match(configPage, /Unlock & Correction Authority/, "Override authority must be labelled as unlock and correction authority");
assert.match(configPage, /Configuration Audit History/, "Configuration audit history must be visible read-only");
assert.match(configPage, /Attendance for[\s\S]+will lock on/, "Page must show calculated lock-time example");
assert.doesNotMatch(configPage, /alternate approver|backup approver/i, "Page must not introduce alternate approvers");

assert.match(approvalApi, /pending_pm_approval/, "Current hard-coded approval states remain in place for later phased replacement");
assert.match(approvalApi, /pending_ho_approval/, "Current HO approval states remain in place for compatibility");

console.log("Labour Muster approval configuration rules passed.");
