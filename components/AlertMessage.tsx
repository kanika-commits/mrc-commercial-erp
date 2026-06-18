"use client";

import { useEffect, useRef } from "react";

type AlertMessageProps = {
  type: "success" | "error" | "warning" | "info";
  message: string;
  onClose?: () => void;
  scrollIntoView?: boolean;
};

const styles = {
  success: "border-sky-200 bg-sky-50 text-sky-800",
  error: "border-red-200 bg-red-50 text-red-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
};

export default function AlertMessage({
  type,
  message,
  onClose,
  scrollIntoView = true,
}: AlertMessageProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (message && scrollIntoView) {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [message, scrollIntoView]);

  if (!message) return null;

  return (
    <div
      ref={ref}
      className={`flex items-start justify-between gap-4 rounded-xl border p-4 text-sm font-medium ${styles[type]}`}
      role="alert"
    >
      <p className="leading-6">{message}</p>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-lg leading-none opacity-70 hover:bg-white/50 hover:opacity-100"
          aria-label="Close alert"
        >
          x
        </button>
      )}
    </div>
  );
}
