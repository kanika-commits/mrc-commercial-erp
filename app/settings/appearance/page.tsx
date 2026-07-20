"use client";

import { useEffect, useState } from "react";
import {
  defaultAppearanceSettings,
  readAppearanceSettings,
  saveAppearanceSettings,
  type AppearanceSettings,
} from "@/components/AppearanceProvider";
import { useAccessContext } from "@/components/AccessContext";

const fontScales: Array<{
  value: AppearanceSettings["fontScale"];
  label: string;
  description: string;
}> = [
  {
    value: "compact",
    label: "Compact",
    description: "Denser text for high-volume tables and operations screens.",
  },
  {
    value: "comfortable",
    label: "Comfortable",
    description: "Default ConstructIQ spacing and type scale.",
  },
  {
    value: "large",
    label: "Large",
    description: "Larger type for review sessions and shared displays.",
  },
];

const fontModes: Array<{
  value: AppearanceSettings["fontFamilyMode"];
  label: string;
  description: string;
}> = [
  {
    value: "modern-sans",
    label: "Modern Sans",
    description: "Inter-based interface typography for everyday ERP work.",
  },
  {
    value: "technical",
    label: "Technical",
    description: "Monospaced body text for command-center style scanning.",
  },
];

export default function AppearanceSettingsPage() {
  const { access, loading: accessLoading } = useAccessContext();
  const [settings, setSettings] = useState<AppearanceSettings>(
    defaultAppearanceSettings
  );
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const allowed = access?.roleCodes.includes("platform_owner") || false;

  useEffect(() => {
    async function loadPage() {
      setSettings(readAppearanceSettings());
      setLoading(false);
    }

    if (!accessLoading && access) {
      loadPage();
    }
  }, [access, accessLoading]);

  function updateSetting(next: AppearanceSettings) {
    setSettings(next);
    saveAppearanceSettings(next);
    setMessage("Appearance settings saved on this device.");
  }

  if (loading) {
    return <div className="p-8 text-sm text-gray-500">Loading appearance...</div>;
  }

  if (!allowed) {
    return (
      <div className="p-8">
        <div className="rounded-lg border bg-white p-6 text-sm text-gray-600">
          <h1 className="mb-2 text-xl font-semibold text-gray-900">
            Access Denied
          </h1>
          <p>Only Platform Owner and Super Admin can manage appearance settings.</p>
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-6 p-8">
      <div>
        <h1 className="text-3xl font-bold">Appearance</h1>
        <p className="text-gray-500">
          Controlled design settings for the ConstructIQ Industrial system.
        </p>
      </div>

      {message && (
        <div className="rounded-lg border bg-green-50 p-3 text-sm text-green-700">
          {message}
        </div>
      )}

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Font Scale</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {fontScales.map((option) => (
            <label key={option.value} className="rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="fontScale"
                  checked={settings.fontScale === option.value}
                  onChange={() =>
                    updateSetting({ ...settings, fontScale: option.value })
                  }
                />
                <span className="font-semibold">{option.label}</span>
              </div>
              <p className="mt-2 text-sm text-gray-500">{option.description}</p>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Font Family Mode</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {fontModes.map((option) => (
            <label key={option.value} className="rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="fontFamilyMode"
                  checked={settings.fontFamilyMode === option.value}
                  onChange={() =>
                    updateSetting({
                      ...settings,
                      fontFamilyMode: option.value,
                    })
                  }
                />
                <span className="font-semibold">{option.label}</span>
              </div>
              <p className="mt-2 text-sm text-gray-500">{option.description}</p>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-xl font-semibold">Accent Theme</h2>
        <label className="block rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <input
              type="radio"
              name="accentTheme"
              checked={settings.accentTheme === "constructiq-industrial"}
              onChange={() =>
                updateSetting({
                  ...settings,
                  accentTheme: "constructiq-industrial",
                })
              }
            />
            <span className="font-semibold">
              ConstructIQ Industrial default
            </span>
          </div>
          <p className="mt-2 text-sm text-gray-500">
            Deep navy, sky blue, cool surfaces, and controlled construction ERP
            contrast from DESIGN.md.
          </p>
        </label>
      </section>
    </section>
  );
}
