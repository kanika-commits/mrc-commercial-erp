"use client";

import { createContext, useContext } from "react";

export type NotificationCounts = {
  pendingWorkOrders: number;
  pendingRaBills: number;
  pendingDebitNotes: number;
  pendingItcReview: number;
  pendingInvoiceApprovals: number;
  totalVendors: number;
  panAadhaarPending: number;
  blockedVendors: number;
  inactiveVendors: number;
};

export const EMPTY_NOTIFICATION_COUNTS: NotificationCounts = {
  pendingWorkOrders: 0,
  pendingRaBills: 0,
  pendingDebitNotes: 0,
  pendingItcReview: 0,
  pendingInvoiceApprovals: 0,
  totalVendors: 0,
  panAadhaarPending: 0,
  blockedVendors: 0,
  inactiveVendors: 0,
};

type NotificationCountsContextValue = {
  counts: NotificationCounts;
  loading: boolean;
  loaded: boolean;
  refresh: () => Promise<void>;
};

const NotificationCountsContext = createContext<NotificationCountsContextValue>({
  counts: EMPTY_NOTIFICATION_COUNTS,
  loading: false,
  loaded: false,
  refresh: async () => {},
});

export function NotificationCountsProvider({
  value,
  children,
}: {
  value: NotificationCountsContextValue;
  children: React.ReactNode;
}) {
  return (
    <NotificationCountsContext.Provider value={value}>
      {children}
    </NotificationCountsContext.Provider>
  );
}

export function useNotificationCounts() {
  return useContext(NotificationCountsContext);
}
