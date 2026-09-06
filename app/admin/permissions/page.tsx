"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  availableActionsForModule,
  permissionActionLabel,
} from "@/lib/permissionMatrix";
import type { PermissionAction } from "@/lib/permissionMatrix";
import {
  normalPermissionActions,
  prepareVisiblePermissionModules,
  specializedPermissionActions,
} from "@/lib/permissionVisibility";

export default function PermissionsPage() {
  const searchParams = useSearchParams();
  const [roles, setRoles] = useState<any[]>([]);
  const [modules, setModules] = useState<any[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [permissions, setPermissions] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  async function loadBaseData() {
    const { data: roleData, error: roleError } = await supabase
      .from("roles")
      .select("id, role_name, role_code, is_system_role")
      .eq("status", "active")
      .order("role_name");

    if (roleError) {
      setMessage(roleError.message);
      return;
    }

    const { data: moduleData, error: moduleError } = await supabase
      .from("erp_modules")
      .select("id, module_group, module_code, module_name, sort_order, status")
      .eq("status", "active");

    if (moduleError) {
      setMessage(moduleError.message);
      return;
    }

    setRoles(roleData || []);

    setModules(prepareVisiblePermissionModules(moduleData || []));

    const roleId = searchParams.get("role_id");

    if (roleId && (roleData || []).some((role) => role.id === roleId)) {
      await loadPermissions(roleId);
    }
  }

  useEffect(() => {
    loadBaseData();
  }, [searchParams]);

  async function loadPermissions(roleId: string) {
    setSelectedRoleId(roleId);
    setMessage("");

    if (!roleId) {
      setPermissions([]);
      return;
    }

    const { data, error } = await supabase
      .from("role_permissions")
      .select("id, role_id, module_code, action_code, allowed")
      .eq("role_id", roleId);

    if (error) {
      setMessage(error.message);
      return;
    }

    setPermissions(data || []);
  }

  const filteredModules = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return modules;

    return modules.filter((module) => {
      const moduleCode = permissionModuleCode(module);
      const actionText = availableActionsForDisplayModule(module)
        .flatMap((action) => [
          action,
          permissionActionLabel(action),
          module.visible_action_labels?.[action] || "",
        ])
        .join(" ");
      return [
        module.module_name,
        module.module_code,
        moduleCode,
        module.permission_note,
        module.technical_group,
        actionText,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [modules, search]);

  const groupedModules = useMemo(() => {
    return filteredModules.reduce<Record<string, any[]>>((acc, item) => {
      if (!acc[item.module_group]) acc[item.module_group] = [];
      acc[item.module_group].push(item);
      return acc;
    }, {});
  }, [filteredModules]);

  function permissionKey(moduleCode: string, actionCode: string) {
    return `${moduleCode}.${actionCode}`;
  }

  function permissionModuleCode(module: any) {
    return module.permission_module_code || module.module_code;
  }

  function availableActionsForDisplayModule(module: any): PermissionAction[] {
    if (module.display_only && !module.permission_module_code) return [];
    if (Array.isArray(module.visible_actions)) return module.visible_actions as PermissionAction[];
    return availableActionsForModule(permissionModuleCode(module));
  }

  function visibleModuleCodesForSave() {
    return Array.from(
      new Set(
        modules
          .map((module) =>
            module.display_only && !module.permission_module_code
              ? null
              : permissionModuleCode(module)
          )
          .filter(Boolean)
      )
    );
  }

  function visiblePermissionKeysForSave() {
    return Array.from(
      new Set(
        modules.flatMap((module) => {
          if (module.display_only && !module.permission_module_code) return [];
          const moduleCode = permissionModuleCode(module);
          return availableActionsForDisplayModule(module).map(
            (action: string) => `${moduleCode}.${action}`
          );
        })
      )
    );
  }

  function isAllowed(moduleCode: string, actionCode: string) {
    return permissions.some(
      (permission) =>
        permission.module_code === moduleCode &&
        permission.action_code === actionCode &&
        permission.allowed === true
    );
  }

  function setPermission(
    currentPermissions: any[],
    moduleCode: string,
    actionCode: string,
    allowed: boolean
  ) {
    const existing = currentPermissions.find(
      (item) =>
        item.module_code === moduleCode &&
        item.action_code === actionCode
    );

    if (existing) {
      return currentPermissions.map((item) =>
        item.module_code === moduleCode &&
        item.action_code === actionCode
          ? { ...item, allowed }
          : item
      );
    }

    return [
      ...currentPermissions,
      {
        role_id: selectedRoleId,
        module_code: moduleCode,
        action_code: actionCode,
        allowed,
      },
    ];
  }

  function togglePermission(moduleCode: string, actionCode: string) {
    setPermissions((prev) => {
      const current = isAllowed(moduleCode, actionCode);
      return setPermission(prev, moduleCode, actionCode, !current);
    });
  }

  function setAllPermissions(allowed: boolean) {
    if (!selectedRoleId) return;

    const visibleModuleCodes = new Set(visibleModuleCodesForSave());
    let next: any[] = permissions.filter(
      (permission) => !visibleModuleCodes.has(permission.module_code)
    );

    modules.forEach((module) => {
      availableActionsForDisplayModule(module).forEach((action) => {
        next = setPermission(next, permissionModuleCode(module), action, allowed);
      });
    });

    setPermissions(next);
  }

  function setGroupPermissions(groupName: string, allowed: boolean) {
    if (!selectedRoleId) return;

    setPermissions((prev) => {
      let next = [...prev];

      (groupedModules[groupName] || []).forEach((module) => {
        availableActionsForDisplayModule(module).forEach((action) => {
          next = setPermission(next, permissionModuleCode(module), action, allowed);
        });
      });

      return next;
    });
  }

  function setRowPermissions(module: any, allowed: boolean) {
    if (!selectedRoleId) return;

    setPermissions((prev) => {
      let next = [...prev];

      availableActionsForDisplayModule(module).forEach((action) => {
        next = setPermission(next, permissionModuleCode(module), action, allowed);
      });

      return next;
    });
  }

  function isRowAllChecked(module: any) {
    const availableActions = availableActionsForDisplayModule(module);
    if (availableActions.length === 0) return false;
    return availableActions.every((action) =>
      isAllowed(permissionModuleCode(module), action)
    );
  }

  async function savePermissions() {
    if (!selectedRoleId) {
      setMessage("Select a role first.");
      return;
    }

    try {
      setSaving(true);
      setMessage("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch("/api/admin/permissions", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          role_id: selectedRoleId,
          visible_module_codes: visibleModuleCodesForSave(),
          visible_permission_keys: visiblePermissionKeysForSave(),
          permissions,
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to save permissions.");
      }

      await loadPermissions(selectedRoleId);
      setMessage("Permissions updated successfully.");
    } catch (error: any) {
      setMessage(error.message || "Failed to save permissions.");
    } finally {
      setSaving(false);
    }
  }

  const selectedRole = roles.find((role) => role.id === selectedRoleId);

  return (
    <div className="space-y-6 pb-24">
      <div>
        <h1 className="text-3xl font-bold">Role Permissions</h1>
        <p className="text-gray-500">
          Set module and action access for each role.
        </p>
      </div>

      <section className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-slate-700">
        <p className="font-semibold text-slate-900">
          This page controls functional permissions for roles.
        </p>
        <p className="mt-1">
          User-specific overrides and Company/Site access are managed separately in{" "}
          <Link href="/admin/users" className="font-semibold text-blue-700 underline-offset-2 hover:underline">
            User Administration
          </Link>
          .
        </p>
      </section>

      {message && (
        <div className="rounded-lg border bg-yellow-50 p-3 text-sm text-yellow-800">
          {message}
        </div>
      )}

      <section className="rounded-lg border bg-white p-6">
        <label className="mb-1 block text-sm font-medium">
          Select Role
        </label>

        <select
          value={selectedRoleId}
          onChange={(e) => loadPermissions(e.target.value)}
          className="w-full rounded-lg border px-3 py-2"
        >
          <option value="">Select Role</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.role_name}
            </option>
          ))}
        </select>

        {selectedRole && (
          <p className="mt-2 text-sm text-gray-500">
            Editing permissions for: {selectedRole.role_name}
          </p>
        )}
      </section>

      {selectedRoleId && (
        <>
          <section className="rounded-lg border bg-white p-6">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
              <label className="block min-w-[260px] flex-1 text-sm font-medium text-slate-700">
                Search permissions
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search module, action, code or description"
                  className="mt-1 h-10 w-full rounded-lg border px-3 text-sm font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setAllPermissions(true)}
                className="rounded bg-blue-600 px-4 py-2 text-white"
              >
                Select All Permissions
              </button>

              <button
                type="button"
                onClick={() => setAllPermissions(false)}
                className="rounded border px-4 py-2"
              >
                Clear All Permissions
              </button>
              </div>
            </div>
            <p className="mb-4 text-xs text-slate-500">
              Permission source: checked controls are granted to this role; unsupported actions are shown as —. Rows marked as mapped save to their canonical permission key.
            </p>

            <div className="space-y-8 overflow-x-auto">
              {filteredModules.length === 0 && (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-slate-500">
                  No permissions match your search.
                </div>
              )}
              {Object.entries(groupedModules).map(([groupName, items]) => {
                const specializedItems = items.filter((module) => specializedPermissionActions(module).length > 0);
                const normalItems = items.filter((module) => specializedPermissionActions(module).length === 0 && normalPermissionActions(module).length > 0);
                const groupActions = Array.from(
                  new Set(normalItems.flatMap((module) => normalPermissionActions(module))),
                ) as PermissionAction[];

                return (
                <div key={groupName}>
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <h3 className="font-semibold text-gray-700">
                      {groupName}
                    </h3>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setGroupPermissions(groupName, true)}
                        className="rounded bg-slate-900 px-3 py-1 text-sm text-white"
                      >
                        Select Group
                      </button>

                      <button
                        type="button"
                        onClick={() => setGroupPermissions(groupName, false)}
                        className="rounded border px-3 py-1 text-sm"
                      >
                        Clear Group
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full min-w-max text-sm">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="p-2 text-left">Module</th>
                          <th className="p-2 text-center">All</th>
                          {groupActions.map((action) => (
                            <th key={action} className="p-2 text-center">{permissionActionLabel(action)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {normalItems.map((module) => {
                          const availableActions = normalPermissionActions(module);
                          const effectiveModuleCode = permissionModuleCode(module);
                          return (
                            <tr key={module.id} className="border-t">
                              <td className="p-2 font-medium">
                                {module.module_name}
                                {module.permission_module_code && module.permission_module_code !== module.module_code && <div className="text-xs font-normal text-blue-700">Mapped to {module.permission_module_code}</div>}
                                {module.permission_note && <div className="text-xs font-normal text-slate-500">{module.permission_note}</div>}
                              </td>
                              <td className="p-2 text-center">
                                <input type="checkbox" checked={isRowAllChecked(module)} disabled={availableActions.length === 0} onChange={(e) => setRowPermissions(module, e.target.checked)} />
                              </td>
                              {groupActions.map((action) => (
                                <td key={action} className="p-2 text-center">
                                  {availableActions.includes(action) ? <input type="checkbox" checked={isAllowed(effectiveModuleCode, action)} onChange={() => togglePermission(effectiveModuleCode, action)} /> : <span className="text-slate-300">—</span>}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {specializedItems.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {specializedItems.map((module) => {
                          const actions = availableActionsForDisplayModule(module);
                        const effectiveModuleCode = permissionModuleCode(module);
                        return (
                          <div key={module.id} className="rounded-md border bg-slate-50 p-2">
                            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                              <span className="font-medium">{module.module_name}</span>
                              {module.permission_module_code && module.permission_module_code !== module.module_code && <span className="text-xs font-medium text-blue-700">Mapped to {module.permission_module_code}</span>}
                              {module.permission_note && <span className="text-xs text-slate-500">{module.permission_note}</span>}
                            </div>
                            <div className="flex flex-wrap gap-3">
                              {actions.map((action) => (
                                <label key={action} className="flex items-center gap-1.5 text-sm">
                                  <input type="checkbox" checked={isAllowed(effectiveModuleCode, action)} onChange={() => togglePermission(effectiveModuleCode, action)} />
                                  {permissionActionLabel(action)}
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </section>

          <div className="sticky bottom-5 flex justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={savePermissions}
              className="rounded-lg bg-blue-600 px-5 py-3 text-white shadow-lg disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Permissions"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
