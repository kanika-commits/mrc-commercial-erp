import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sortCompanies } from "@/lib/companyOrdering";
import { requirePermission } from "@/lib/serverPermissions";
import { isValidPermissionAction } from "@/lib/permissionMatrix";
import {
  canAccessTargetUser,
  loadActorOrganizationScope,
  validateSubmittedUserScope,
} from "@/lib/adminUserScope";
import {
  loadEmployeeLinkOptions,
  loadLinkedEmployeeForUser,
  setUserEmployeeLink,
} from "@/app/api/admin/users/_employeeLinking";

function parseVisiblePermissionKeys(value: unknown) {
  if (!Array.isArray(value)) {
    return {
      error: "visible_permission_keys is required for user permission updates.",
      keys: [] as string[],
    };
  }

  const keys: string[] = [];
  for (const item of value) {
    const permissionKey = String(item || "").trim();
    const parts = permissionKey.split(":");
    if (
      parts.length !== 2 ||
      !parts[0]?.trim() ||
      !parts[1]?.trim() ||
      !isValidPermissionAction(parts[0].trim(), parts[1].trim())
    ) {
      return {
        error: "visible_permission_keys contains an invalid permission key.",
        keys: [] as string[],
      };
    }
    keys.push(`${parts[0].trim()}:${parts[1].trim()}`);
  }

  const dedupedKeys = Array.from(new Set(keys));
  if (dedupedKeys.length === 0) {
    return {
      error: "visible_permission_keys is required for user permission updates.",
      keys: [] as string[],
    };
  }

  return { error: null, keys: dedupedKeys };
}

async function deleteVisibleUserPermissions(
  supabase: ReturnType<typeof adminClient>,
  userId: string,
  visiblePermissionKeys: string[],
) {
  if (visiblePermissionKeys.length === 0) return;

  const moduleCodes = Array.from(
    new Set(visiblePermissionKeys.map((key) => key.split(":")[0]).filter(Boolean)),
  );
  if (moduleCodes.length === 0) return;

  const { data, error } = await supabase
    .from("user_permissions")
    .select("id, module_code, action_code")
    .eq("user_id", userId)
    .in("module_code", moduleCodes);

  if (error) throw error;

  const idsToDelete = (data || [])
    .filter((row) => visiblePermissionKeys.includes(`${row.module_code}:${row.action_code}`))
    .map((row) => row.id)
    .filter(Boolean);

  if (idsToDelete.length === 0) return;

  const { error: deleteError } = await supabase
    .from("user_permissions")
    .delete()
    .in("id", idsToDelete);

  if (deleteError) throw deleteError;
}

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

async function requireUserPermission(request: Request, actionCode: "delete") {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const token = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    return { error: "Missing auth token.", status: 401 };
  }

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser(token);

  if (userError) throw userError;

  if (!user) {
    return { error: "User not found.", status: 401 };
  }

  const { data: userRoles, error: userRolesError } = await supabase
    .from("user_roles")
    .select("role_id")
    .eq("user_id", user.id);

  if (userRolesError) throw userRolesError;

  const roleIds = (userRoles || []).map((row) => row.role_id).filter(Boolean);

  if (roleIds.length === 0) {
    return {
      error: `You do not have permission to ${actionCode} users.`,
      status: 403,
    };
  }

  const { data: roles, error: rolesError } = await supabase
    .from("roles")
    .select("id, role_code")
    .in("id", roleIds);

  if (rolesError) throw rolesError;

  const roleCodes = (roles || []).map((role) => role.role_code).filter(Boolean);

  if (roleCodes.includes("platform_owner")) {
    return { user };
  }

  const [
    { data: rolePermissions, error: rolePermissionError },
    { data: userPermissions, error: userPermissionError },
  ] = await Promise.all([
    supabase
      .from("role_permissions")
      .select("module_code, action_code, allowed")
      .in("role_id", roleIds),
    supabase
      .from("user_permissions")
      .select("module_code, action_code, allowed")
      .eq("user_id", user.id),
  ]);

  if (rolePermissionError) throw rolePermissionError;
  if (userPermissionError) throw userPermissionError;

  const allowed = [...(rolePermissions || []), ...(userPermissions || [])].some(
    (permission) =>
      permission.allowed === true &&
      ((permission.module_code === "*" && permission.action_code === "*") ||
        (permission.module_code === "users" &&
          permission.action_code === actionCode))
  );

  if (!allowed) {
    return {
      error: `You do not have permission to ${actionCode} users.`,
      status: 403,
    };
  }

  return { user };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const permission = await requirePermission(request, "users", "view");

    if ("response" in permission) {
      return permission.response;
    }

    const { id } = await params;
    const supabase = adminClient();
    const actorOrganizationIds = await loadActorOrganizationScope(
      supabase,
      permission
    );

    if (!(await canAccessTargetUser(supabase, actorOrganizationIds, id))) {
      return NextResponse.json(
        { error: "You do not have permission to access this user." },
        { status: 403 }
      );
    }

    const organizationsQuery = supabase
      .from("organizations")
      .select("id, name, code, status")
      .eq("status", "active")
      .order("name");
    const companiesQuery = supabase
      .from("companies")
      .select("id, organization_id, company_name, company_code, status")
      .eq("status", "active")
      .order("company_name");
    const sitesQuery = supabase
      .from("sites")
      .select("id, organization_id, company_id, site_name, site_code, status")
      .eq("status", "active")
      .order("site_name");

    const [
      profile,
      roles,
      organizations,
      companies,
      sites,
      modules,
      userRoles,
      accessRows,
      userPermissions,
      linkedEmployee,
      employeeOptions,
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("*")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("roles")
        .select("id, role_name, role_code, status")
        .eq("status", "active")
        .order("role_name"),
      actorOrganizationIds
        ? organizationsQuery.in("id", actorOrganizationIds)
        : organizationsQuery,
      actorOrganizationIds
        ? companiesQuery.in("organization_id", actorOrganizationIds)
        : companiesQuery,
      actorOrganizationIds
        ? sitesQuery.in("organization_id", actorOrganizationIds)
        : sitesQuery,
      supabase
        .from("erp_modules")
        .select("id, module_group, module_code, module_name, sort_order")
        .or("status.eq.active,module_code.eq.dashboard"),
      supabase.from("user_roles").select("role_id").eq("user_id", id),
      supabase
        .from("user_access_assignments")
        .select("organization_id, company_id, site_id")
        .eq("user_id", id),
      supabase
        .from("user_permissions")
        .select("module_code, action_code, allowed")
        .eq("user_id", id),
      loadLinkedEmployeeForUser(supabase, id, actorOrganizationIds),
      loadEmployeeLinkOptions(supabase, actorOrganizationIds, id),
    ]);

    for (const result of [
      profile,
      roles,
      organizations,
      companies,
      sites,
      modules,
      userRoles,
      accessRows,
      userPermissions,
    ]) {
      if (result.error) throw result.error;
    }

    const visibleRoleIds = (roles.data || []).map((role: any) => role.id).filter(Boolean);
    const rolePermissions =
      visibleRoleIds.length > 0
        ? await supabase
            .from("role_permissions")
            .select("role_id, module_code, action_code, allowed")
            .in("role_id", visibleRoleIds)
        : { data: [], error: null };

    if (rolePermissions.error) throw rolePermissions.error;

    return NextResponse.json({
      profile: profile.data,
      roles: roles.data || [],
      organizations: organizations.data || [],
      companies: sortCompanies(companies.data || []),
      sites: sites.data || [],
      modules: modules.data || [],
      userRoles: userRoles.data || [],
      accessRows: accessRows.data || [],
      userPermissions: userPermissions.data || [],
      rolePermissions: rolePermissions.data || [],
      linkedEmployee,
      employeeOptions,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load user access." },
      { status: 500 }
    );
  }
}

function uniqueRows<T>(rows: T[], keyFor: (row: T) => string) {
  return Array.from(new Map(rows.map((row) => [keyFor(row), row])).values());
}

type RoleRow = {
  user_id: string;
  role_id: string;
};

type AccessRow = {
  user_id: string;
  organization_id: string | null;
  company_id: string | null;
  site_id: string | null;
};

type PermissionRow = {
  user_id: string;
  module_code: string;
  action_code: string;
  allowed: boolean;
};

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const permission = await requirePermission(request, "users", "edit");

    if ("response" in permission) {
      return permission.response;
    }

    const { id } = await params;
    const body = await request.json();
    const {
      full_name,
      role_ids,
      organization_ids,
      company_ids,
      site_ids,
      user_permissions,
      visible_permission_keys,
      linked_employee_id,
    } = body;
    const hasNameUpdate = Object.prototype.hasOwnProperty.call(body, "full_name");
    const hasAccessUpdate =
      Object.prototype.hasOwnProperty.call(body, "role_ids") ||
      Object.prototype.hasOwnProperty.call(body, "organization_ids") ||
      Object.prototype.hasOwnProperty.call(body, "company_ids") ||
      Object.prototype.hasOwnProperty.call(body, "site_ids") ||
      Object.prototype.hasOwnProperty.call(body, "user_permissions");
    const hasPermissionUpdate = Object.prototype.hasOwnProperty.call(body, "user_permissions");
    const hasLinkUpdate = Object.prototype.hasOwnProperty.call(body, "linked_employee_id");

    const trimmedFullName = hasNameUpdate ? String(full_name || "").trim() : null;

    if (hasNameUpdate && !trimmedFullName) {
      return NextResponse.json(
        { error: "User name is required." },
        { status: 400 }
      );
    }

    if (!hasNameUpdate && !hasAccessUpdate && !hasLinkUpdate) {
      return NextResponse.json(
        { error: "No user changes were provided." },
        { status: 400 }
      );
    }

    if (hasAccessUpdate && (!Array.isArray(role_ids) || role_ids.length === 0)) {
      return NextResponse.json(
        { error: "Select at least one role." },
        { status: 400 }
      );
    }

    if (
      hasAccessUpdate &&
      (!Array.isArray(organization_ids) || organization_ids.length === 0)
    ) {
      return NextResponse.json(
        { error: "Select at least one organization." },
        { status: 400 }
      );
    }

    const supabase = adminClient();
    const actorOrganizationIds = await loadActorOrganizationScope(
      supabase,
      permission
    );

    if (!(await canAccessTargetUser(supabase, actorOrganizationIds, id))) {
      return NextResponse.json(
        { error: "You do not have permission to edit this user." },
        { status: 403 }
      );
    }

    if (hasAccessUpdate) {
      const { data: existingUserRoles, error: existingUserRolesError } = await supabase
        .from("user_roles")
        .select("role_id")
        .eq("user_id", id);

      if (existingUserRolesError) throw existingUserRolesError;

      const currentRoleIds = (existingUserRoles || [])
        .map((role) => role.role_id)
        .filter(Boolean);
      const submittedRoleIds = (role_ids || []).filter(Boolean);
      const roleIdsToCheck = Array.from(
        new Set([...currentRoleIds, ...submittedRoleIds])
      );

      const { data: roleRowsForValidation, error: roleValidationError } =
        roleIdsToCheck.length > 0
          ? await supabase
              .from("roles")
              .select("id, role_code")
              .in("id", roleIdsToCheck)
          : { data: [], error: null };

      if (roleValidationError) throw roleValidationError;

      const platformOwnerRoleIds = new Set(
        (roleRowsForValidation || [])
          .filter((role) => role.role_code === "platform_owner")
          .map((role) => role.id)
      );
      const targetIsPlatformOwner = currentRoleIds.some((roleId) =>
        platformOwnerRoleIds.has(roleId)
      );
      const payloadAssignsPlatformOwner = submittedRoleIds.some((roleId: string) =>
        platformOwnerRoleIds.has(roleId)
      );

      if (targetIsPlatformOwner || payloadAssignsPlatformOwner) {
        return NextResponse.json(
          {
            error:
              "Platform Owner is a system identity and cannot be changed through user management.",
          },
          { status: 403 }
        );
      }
    }

    if (hasAccessUpdate) {
      const scopeValidation = await validateSubmittedUserScope(
        supabase,
        actorOrganizationIds,
        {
          organizationIds: organization_ids || [],
          companyIds: company_ids || [],
          siteIds: site_ids || [],
        }
      );

      if (!scopeValidation.allowed) {
        return NextResponse.json(
          { error: scopeValidation.error },
          { status: 403 }
        );
      }
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile) {
      return NextResponse.json(
        { error: "User profile was not found." },
        { status: 404 }
      );
    }

    if (hasNameUpdate) {
      const { error: updateProfileError } = await supabase
        .from("profiles")
        .update({ full_name: trimmedFullName })
        .eq("id", id);

      if (updateProfileError) throw updateProfileError;

      if (!hasAccessUpdate) {
        if (hasLinkUpdate) {
          const linkResult = await setUserEmployeeLink(supabase, request, permission, {
            userId: id,
            employeeId: linked_employee_id,
            actorOrganizationIds,
          });

          if ("error" in linkResult) {
            return NextResponse.json(
              { error: linkResult.error },
              { status: linkResult.status }
            );
          }
        }

        return NextResponse.json({
          user_id: id,
          full_name: trimmedFullName,
          profile_updated: true,
          linked_employee_id: hasLinkUpdate ? linked_employee_id || null : undefined,
        });
      }
    }

    if (hasLinkUpdate && !hasAccessUpdate) {
      const linkResult = await setUserEmployeeLink(supabase, request, permission, {
        userId: id,
        employeeId: linked_employee_id,
        actorOrganizationIds,
      });

      if ("error" in linkResult) {
        return NextResponse.json(
          { error: linkResult.error },
          { status: linkResult.status }
        );
      }

      const savedLink = linkResult as { linked_employee_id: string | null; link_changed: boolean };

      return NextResponse.json({
        user_id: id,
        linked_employee_id: savedLink.linked_employee_id,
        link_changed: savedLink.link_changed,
      });
    }

    const { data: selectedSites, error: siteError } = site_ids?.length
      ? await supabase
          .from("sites")
          .select("id, company_id, organization_id")
          .in("id", site_ids)
      : { data: [], error: null };

    if (siteError) throw siteError;

    const companyIds = Array.from(
      new Set([
        ...(company_ids || []),
        ...(selectedSites || []).map((site) => site.company_id).filter(Boolean),
      ])
    );

    const { data: selectedCompanies, error: companyError } = companyIds.length
      ? await supabase
          .from("companies")
          .select("id, organization_id")
          .in("id", companyIds)
      : { data: [], error: null };

    if (companyError) throw companyError;

    const companyById = new Map(
      (selectedCompanies || []).map((company) => [company.id, company])
    );
    const siteById = new Map((selectedSites || []).map((site) => [site.id, site]));

    const roleRows = uniqueRows<RoleRow>(
      role_ids.map((roleId: string) => ({
        user_id: id,
        role_id: roleId,
      })),
      (row) => `${row.user_id}.${row.role_id}`
    );

    const accessRows = uniqueRows<AccessRow>(
      [
        ...organization_ids.map((organizationId: string) => ({
          user_id: id,
          organization_id: organizationId,
          company_id: null,
          site_id: null,
        })),
        ...(company_ids || []).map((companyId: string) => {
          const company = companyById.get(companyId);

          return {
            user_id: id,
            organization_id: company?.organization_id || null,
            company_id: companyId,
            site_id: null,
          };
        }),
        ...(site_ids || []).map((siteId: string) => {
          const site = siteById.get(siteId);
          const company = site?.company_id ? companyById.get(site.company_id) : null;

          return {
            user_id: id,
            organization_id: company?.organization_id || organization_ids[0] || null,
            company_id: site?.company_id || null,
            site_id: siteId,
          };
        }),
      ],
      (row) => `${row.user_id}.${row.organization_id || ""}.${row.company_id || ""}.${row.site_id || ""}`
    );

    const parsedVisiblePermissionKeys = hasPermissionUpdate
      ? parseVisiblePermissionKeys(visible_permission_keys)
      : { error: null, keys: [] as string[] };
    if (parsedVisiblePermissionKeys.error) {
      return NextResponse.json(
        { error: parsedVisiblePermissionKeys.error },
        { status: 400 },
      );
    }

    if (hasPermissionUpdate && !Array.isArray(user_permissions)) {
      return NextResponse.json(
        { error: "user_permissions must be an array." },
        { status: 400 },
      );
    }

    const visiblePermissionKeys = parsedVisiblePermissionKeys.keys;
    const visiblePermissionKeySet = new Set(visiblePermissionKeys);
    const submittedPermissionRows = user_permissions || [];
    for (const permission of submittedPermissionRows) {
      const moduleCode = String(permission?.module_code || "").trim();
      const actionCode = String(permission?.action_code || "").trim();
      const permissionKey = `${moduleCode}:${actionCode}`;

      if (
        permission?.allowed !== true ||
        !moduleCode ||
        !actionCode ||
        !isValidPermissionAction(moduleCode, actionCode) ||
        !visiblePermissionKeySet.has(permissionKey)
      ) {
        return NextResponse.json(
          { error: "user_permissions contains an invalid or non-visible permission row." },
          { status: 400 },
        );
      }
    }

    const permissionRows = uniqueRows<PermissionRow>(
      submittedPermissionRows.map((permission: any) => ({
        user_id: id,
        module_code: String(permission.module_code || "").trim(),
        action_code: String(permission.action_code || "").trim(),
        allowed: true,
      })),
      (row) => `${row.user_id}.${row.module_code}.${row.action_code}`
    );

    const { error: deleteRolesError } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", id);

    if (deleteRolesError) throw deleteRolesError;

    const { error: insertRolesError } = await supabase
      .from("user_roles")
      .insert(roleRows);

    if (insertRolesError) throw insertRolesError;

    const { error: deleteAccessError } = await supabase
      .from("user_access_assignments")
      .delete()
      .eq("user_id", id);

    if (deleteAccessError) throw deleteAccessError;

    if (accessRows.length > 0) {
      const { error: insertAccessError } = await supabase
        .from("user_access_assignments")
        .insert(accessRows);

      if (insertAccessError) throw insertAccessError;
    }

    if (hasPermissionUpdate) {
      await deleteVisibleUserPermissions(supabase, id, visiblePermissionKeys);
    }

    if (hasPermissionUpdate && permissionRows.length > 0) {
      const { error: insertPermissionsError } = await supabase
        .from("user_permissions")
        .insert(permissionRows);

      if (insertPermissionsError) throw insertPermissionsError;
    }

    return NextResponse.json({
      user_id: id,
      roles_saved: roleRows.length,
      access_saved: accessRows.length,
      permissions_saved: permissionRows.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to save user access." },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const permission = await requirePermission(request, "users", "edit");

    if ("response" in permission) {
      return permission.response;
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").trim();

    if (action !== "reset_password") {
      return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
    }

    const newPassword = String(body.new_password || "");
    const confirmationText = String(body.confirmation_text || "").trim();

    if (confirmationText !== "RESET") {
      return NextResponse.json(
        { error: "Type RESET to confirm password reset." },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "New password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const supabase = adminClient();
    const actorOrganizationIds = await loadActorOrganizationScope(
      supabase,
      permission
    );

    if (!(await canAccessTargetUser(supabase, actorOrganizationIds, id))) {
      return NextResponse.json(
        { error: "You do not have permission to reset this user's password." },
        { status: 403 }
      );
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile) {
      return NextResponse.json(
        { error: "User profile was not found." },
        { status: 404 }
      );
    }

    const { error: resetError } = await supabase.auth.admin.updateUserById(id, {
      password: newPassword,
    });

    if (resetError) throw resetError;

    return NextResponse.json({ user_id: id, password_reset: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to reset password." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await requirePermission(request, "users", "delete");

    if ("response" in access) {
      return access.response;
    }

    const { id } = await params;

    if (access.user.id === id) {
      return NextResponse.json(
        { error: "You cannot delete your own app user record." },
        { status: 400 }
      );
    }

    const supabase = adminClient();
    const actorOrganizationIds = await loadActorOrganizationScope(supabase, access);

    if (!(await canAccessTargetUser(supabase, actorOrganizationIds, id))) {
      return NextResponse.json(
        { error: "You do not have permission to delete this user." },
        { status: 403 }
      );
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile) {
      return NextResponse.json(
        { error: "User profile was not found." },
        { status: 404 }
      );
    }

    const [
      deletePermissions,
      deleteAccess,
      deleteRoles,
    ] = await Promise.all([
      supabase.from("user_permissions").delete().eq("user_id", id),
      supabase.from("user_access_assignments").delete().eq("user_id", id),
      supabase.from("user_roles").delete().eq("user_id", id),
    ]);

    for (const result of [deletePermissions, deleteAccess, deleteRoles]) {
      if (result.error) throw result.error;
    }

    const { error: deleteProfileError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", id);

    if (deleteProfileError) throw deleteProfileError;

    return NextResponse.json({
      user_id: id,
      deleted: true,
      auth_user_deleted: false,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete user." },
      { status: 500 }
    );
  }
}
