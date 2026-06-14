"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

const actions = [
  "view",
  "add",
  "edit",
  "delete",
  "approve",
  "reject",
  "upload",
  "export",
];

export default function PermissionsPage() {
  const searchParams = useSearchParams();
  const [roles, setRoles] = useState<any[]>([]);
  const [modules, setModules] = useState<any[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [permissions, setPermissions] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

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
      .select("id, module_group, module_code, module_name, sort_order")
      .eq("status", "active");

    if (moduleError) {
      setMessage(moduleError.message);
      return;
    }

    setRoles(roleData || []);

    setModules(
      (moduleData || []).sort((a: any, b: any) => {
        if (a.module_group === b.module_group) {
          return Number(a.sort_order || 0) - Number(b.sort_order || 0);
        }

        return String(a.module_group).localeCompare(String(b.module_group));
      })
    );

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

  const groupedModules = useMemo(() => {
    return modules.reduce<Record<string, any[]>>((acc, item) => {
      if (!acc[item.module_group]) acc[item.module_group] = [];
      acc[item.module_group].push(item);
      return acc;
    }, {});
  }, [modules]);

  function permissionKey(moduleCode: string, actionCode: string) {
    return `${moduleCode}.${actionCode}`;
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

    let next: any[] = [];

    modules.forEach((module) => {
      actions.forEach((action) => {
        next = setPermission(next, module.module_code, action, allowed);
      });
    });

    setPermissions(next);
  }

  function setGroupPermissions(groupName: string, allowed: boolean) {
    if (!selectedRoleId) return;

    setPermissions((prev) => {
      let next = [...prev];

      (groupedModules[groupName] || []).forEach((module) => {
        actions.forEach((action) => {
          next = setPermission(next, module.module_code, action, allowed);
        });
      });

      return next;
    });
  }

  function setRowPermissions(moduleCode: string, allowed: boolean) {
    if (!selectedRoleId) return;

    setPermissions((prev) => {
      let next = [...prev];

      actions.forEach((action) => {
        next = setPermission(next, moduleCode, action, allowed);
      });

      return next;
    });
  }

  function isRowAllChecked(moduleCode: string) {
    return actions.every((action) => isAllowed(moduleCode, action));
  }

  async function savePermissions() {
    if (!selectedRoleId) {
      setMessage("Select a role first.");
      return;
    }

    try {
      setSaving(true);
      setMessage("");

      const { error: deleteError } = await supabase
        .from("role_permissions")
        .delete()
        .eq("role_id", selectedRoleId);

      if (deleteError) throw deleteError;

      const uniqueRows = new Map<string, any>();

      permissions
        .filter((item) => item.allowed === true)
        .forEach((item) => {
          uniqueRows.set(permissionKey(item.module_code, item.action_code), {
            role_id: selectedRoleId,
            module_code: item.module_code,
            action_code: item.action_code,
            allowed: true,
          });
        });

      const rows = Array.from(uniqueRows.values());

      if (rows.length > 0) {
        const { error: insertError } = await supabase
          .from("role_permissions")
          .insert(rows);

        if (insertError) throw insertError;
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
            <div className="mb-6 flex flex-wrap gap-3">
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

            <div className="space-y-8 overflow-x-auto">
              {Object.entries(groupedModules).map(([groupName, items]) => (
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

                  <table className="w-full min-w-[1050px] text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="p-2 text-left">Module</th>
                        <th className="p-2 text-center">All</th>
                        {actions.map((action) => (
                          <th
                            key={action}
                            className="p-2 text-center capitalize"
                          >
                            {action}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody>
                      {items.map((module) => (
                        <tr key={module.id} className="border-t">
                          <td className="p-2 font-medium">
                            {module.module_name}
                          </td>

                          <td className="p-2 text-center">
                            <input
                              type="checkbox"
                              checked={isRowAllChecked(module.module_code)}
                              onChange={(e) =>
                                setRowPermissions(
                                  module.module_code,
                                  e.target.checked
                                )
                              }
                            />
                          </td>

                          {actions.map((action) => (
                            <td key={action} className="p-2 text-center">
                              <input
                                type="checkbox"
                                checked={isAllowed(
                                  module.module_code,
                                  action
                                )}
                                onChange={() =>
                                  togglePermission(
                                    module.module_code,
                                    action
                                  )
                                }
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
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
