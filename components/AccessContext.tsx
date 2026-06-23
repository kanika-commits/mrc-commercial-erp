"use client";

import { createContext, useContext } from "react";
import type { User } from "@supabase/supabase-js";
import type { CurrentUserAccess } from "@/lib/accessControl";

type ModuleNavigation = {
  groups: any[];
  modules: any[];
};

type AccessContextValue = {
  user: User | null;
  access: CurrentUserAccess | null;
  moduleNavigation: ModuleNavigation;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const AccessContext = createContext<AccessContextValue>({
  user: null,
  access: null,
  moduleNavigation: { groups: [], modules: [] },
  loading: true,
  error: null,
  refresh: async () => {},
});

export function AccessProvider({
  value,
  children,
}: {
  value: AccessContextValue;
  children: React.ReactNode;
}) {
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccessContext() {
  return useContext(AccessContext);
}

