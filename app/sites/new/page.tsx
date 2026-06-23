"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  Info,
  MapPin,
  Save,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function NewSitePage() {
  const router = useRouter();

  const [siteName, setSiteName] = useState("");
  const [siteCode, setSiteCode] = useState("");
  const [location, setLocation] = useState("");
  const [state, setState] = useState("");
  const [status, setStatus] = useState("active");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function saveSite() {
    setMessage("");

    if (!siteName.trim()) {
      setMessage("Site name is required.");
      return;
    }

    if (!siteCode.trim()) {
      setMessage("Site code is required.");
      return;
    }

    try {
      setSaving(true);

      const organizationId = "3b65abde-9f9f-4f1b-bd40-fa261a76920b";

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session expired. Please log in again.");
      }

      const response = await fetch("/api/sites", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          organization_id: organizationId,
          site_name: siteName.trim(),
          site_code: siteCode.trim(),
          location: location.trim() || null,
          state: state.trim() || null,
          status,
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to save site.");
      }

      router.push("/sites");
    } catch (error: unknown) {
      setMessage(
        error instanceof Error ? error.message : "Failed to save site."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#fcf8fa] px-6 py-8 pb-28 text-slate-950 md:px-10">
      <div className="mx-auto max-w-7xl">
        <nav className="mb-4 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Link href="/modules/master-setup" className="hover:text-black">
            Master Setup
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <Link href="/sites" className="hover:text-black">
            Sites
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-black">Add Site</span>
        </nav>

        <div className="mb-10 max-w-4xl">
          <h1 className="text-3xl font-semibold tracking-tight text-black md:text-[32px] md:leading-10">
            Create New Project Site
          </h1>
          <p className="mt-2 max-w-3xl text-base leading-6 text-slate-600">
            Configure a new construction zone within your enterprise registry.
            This site will serve as the operational hub for project-level
            reporting and resource allocation.
          </p>
        </div>

        {message && (
          <div className="mb-6 rounded border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            {message}
          </div>
        )}

        <div className="flex flex-col items-start gap-6 xl:flex-row">
          <section className="w-full max-w-4xl overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-[#f6f3f5] px-6 py-4">
              <h2 className="text-lg font-semibold text-black">
                Site Configuration
              </h2>
            </div>

            <div className="space-y-6 p-6">
              <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-3">
                <label className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Identification
                </label>
                <div className="space-y-5 md:col-span-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-600">
                      Site Name *
                    </label>
                    <input
                      value={siteName}
                      onChange={(e) => setSiteName(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-slate-900 focus:ring-0"
                      placeholder="e.g. Mumbai Coastal Road - Package 02"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-600">
                        Site Code *
                      </label>
                      <div className="relative">
                        <input
                          value={siteCode}
                          onChange={(e) =>
                            setSiteCode(e.target.value.toUpperCase())
                          }
                          className="w-full rounded border border-slate-300 bg-white px-3 py-2.5 pr-10 text-sm font-semibold uppercase outline-none transition focus:border-[#00658b] focus:ring-0"
                          placeholder="BLR-2024-AP01"
                        />
                        {siteCode.trim() && (
                          <CheckCircle2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#00658b]" />
                        )}
                      </div>
                    </div>

                    <div className="rounded border border-slate-200 bg-[#f6f3f5] p-4">
                      <p className="text-xs leading-5 text-slate-500">
                        <strong className="mb-1 block text-slate-900">
                          Naming Convention:
                        </strong>
                        Format: [REGION]-[YEAR]-[ID]
                        <br />
                        Example: BLR-2024-AP01
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <hr className="border-slate-200" />

              <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-3">
                <label className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Geography
                </label>
                <div className="space-y-5 md:col-span-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-600">
                      Location
                    </label>
                    <input
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-slate-900 focus:ring-0"
                      placeholder="Plot No., zone, city or project address"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-600">
                      State
                    </label>
                    <input
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-slate-900 focus:ring-0"
                      placeholder="State"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <aside className="w-full space-y-6 xl:sticky xl:top-24 xl:w-80">
            <div className="rounded border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Form Progress
                </h3>
                <span className="text-sm font-bold text-black">
                  {
                    [
                      siteName.trim() && siteCode.trim(),
                      location.trim() || state.trim(),
                    ].filter(Boolean).length
                  }
                  /2
                </span>
              </div>
              <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-[#00658b]"
                  style={{
                    width: `${
                      ([
                        siteName.trim() && siteCode.trim(),
                        location.trim() || state.trim(),
                      ].filter(Boolean).length /
                        2) *
                      100
                    }%`,
                  }}
                />
              </div>
              <ul className="space-y-2 text-sm text-slate-600">
                <ProgressItem done={Boolean(siteName.trim() && siteCode.trim())}>
                  Identification entered
                </ProgressItem>
                <ProgressItem done={Boolean(location.trim() || state.trim())}>
                  Geography added
                </ProgressItem>
              </ul>
            </div>

            <div className="rounded border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-black">
                <Building2 className="h-4 w-4 text-[#00658b]" />
                Site Registry
              </div>
              <p className="text-sm leading-6 text-slate-600">
                Sites are independent project locations. Company is selected
                later on Work Orders.
              </p>
            </div>

            <div className="overflow-hidden rounded border border-slate-200 bg-slate-950 p-6 text-white shadow-sm">
              <MapPin className="mb-8 h-6 w-6 text-[#87d2fe]" />
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
                Location Preview
              </p>
              <p className="mt-2 text-sm leading-6 text-white/75">
                Add location and state details to make this site easier to find
                in operational views.
              </p>
            </div>
          </aside>
        </div>

        <footer className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 px-6 py-4 shadow-[0_-8px_24px_rgba(15,23,42,0.04)] backdrop-blur md:left-[268px] md:px-10">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Info className="h-4 w-4 text-[#00658b]" />
              Required fields are marked with an asterisk.
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/sites"
                className="rounded border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Discard and Exit
              </Link>
              <button
                type="button"
                onClick={saveSite}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded bg-[#00658b] px-6 py-2.5 text-sm font-bold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save Site"}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}

function ProgressItem({
  done,
  children,
}: {
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className={done ? "flex items-center gap-2" : "flex items-center gap-2 opacity-60"}>
      {done ? (
        <CheckCircle2 className="h-4 w-4 text-[#00658b]" />
      ) : (
        <span className="h-4 w-4 rounded-full border border-slate-300" />
      )}
      {children}
    </li>
  );
}
