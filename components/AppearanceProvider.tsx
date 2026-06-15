"use client";

import { useEffect } from "react";

const STORAGE_KEY = "constructiq.appearance";

const allowedFontScales = ["compact", "comfortable", "large"] as const;
const allowedFontModes = ["modern-sans", "technical"] as const;
const allowedAccentThemes = ["constructiq-industrial"] as const;

export type AppearanceSettings = {
  fontScale: (typeof allowedFontScales)[number];
  fontFamilyMode: (typeof allowedFontModes)[number];
  accentTheme: (typeof allowedAccentThemes)[number];
};

export const defaultAppearanceSettings: AppearanceSettings = {
  fontScale: "comfortable",
  fontFamilyMode: "modern-sans",
  accentTheme: "constructiq-industrial",
};

export function readAppearanceSettings(): AppearanceSettings {
  if (typeof window === "undefined") return defaultAppearanceSettings;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};

    return {
      fontScale: allowedFontScales.includes(parsed.fontScale)
        ? parsed.fontScale
        : defaultAppearanceSettings.fontScale,
      fontFamilyMode: allowedFontModes.includes(parsed.fontFamilyMode)
        ? parsed.fontFamilyMode
        : defaultAppearanceSettings.fontFamilyMode,
      accentTheme: allowedAccentThemes.includes(parsed.accentTheme)
        ? parsed.accentTheme
        : defaultAppearanceSettings.accentTheme,
    };
  } catch {
    return defaultAppearanceSettings;
  }
}

export function saveAppearanceSettings(settings: AppearanceSettings) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  applyAppearanceSettings(settings);
  window.dispatchEvent(new CustomEvent("constructiq:appearance-change"));
}

export function applyAppearanceSettings(settings: AppearanceSettings) {
  const root = document.documentElement;

  root.dataset.fontScale = settings.fontScale;
  root.dataset.fontMode = settings.fontFamilyMode;
  root.dataset.accentTheme = settings.accentTheme;
}

export default function AppearanceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    function syncAppearance() {
      applyAppearanceSettings(readAppearanceSettings());
    }

    syncAppearance();
    window.addEventListener("storage", syncAppearance);
    window.addEventListener("constructiq:appearance-change", syncAppearance);

    return () => {
      window.removeEventListener("storage", syncAppearance);
      window.removeEventListener("constructiq:appearance-change", syncAppearance);
    };
  }, []);

  return <>{children}</>;
}
