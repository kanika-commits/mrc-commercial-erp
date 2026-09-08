"use client";

import { createContext, useContext } from "react";
import { defaultTenantBranding, type TenantBranding } from "@/lib/tenantBranding";

export type TenantBrandingStatus = "loading" | "ready" | "fallback";

type TenantBrandingContextValue = {
  branding: TenantBranding;
  status: TenantBrandingStatus;
};

export const TenantBrandingContext = createContext<TenantBrandingContextValue>({
  branding: defaultTenantBranding,
  status: "loading",
});

export function useTenantBranding() {
  return useContext(TenantBrandingContext);
}
