"use client";

import { useEffect, useState } from "react";

type Props = {
  name?: string | null;
  photoUrl?: string | null;
  size?: "sm" | "md" | "lg";
};

const sizes = {
  sm: "h-9 w-9 text-xs",
  md: "h-16 w-16 text-lg",
  lg: "h-24 w-24 text-2xl",
};

function initials(name?: string | null) {
  const parts = String(name || "Employee")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return (parts[0]?.[0] || "E") + (parts[1]?.[0] || "");
}

export default function EmployeePhoto({ name, photoUrl, size = "md" }: Props) {
  const [failed, setFailed] = useState(false);
  const className = `${sizes[size]} shrink-0 overflow-hidden rounded-full border bg-slate-100 font-semibold uppercase text-slate-600`;

  useEffect(() => {
    setFailed(false);
  }, [photoUrl]);

  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt={name ? `${name} profile photo` : "Employee profile photo"}
        className={`${className} object-cover`}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className={`${className} flex items-center justify-center`}>
      {initials(name)}
    </div>
  );
}
