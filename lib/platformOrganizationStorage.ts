export type OrganizationStorageProvider = "google_drive" | "supabase_storage";

export type OrganizationStorageConfig = {
  organization_id: string;
  provider: OrganizationStorageProvider;
  secret_ref: string | null;
  drive_root_id: string | null;
  verification_status: "pending" | "verified" | "failed";
  verified_at: string | null;
};

type AdminClient = { from: (table: string) => any; rpc: (name: string, args: Record<string, unknown>) => any };

export function assertOrganizationStorageProvider(value: unknown): OrganizationStorageProvider {
  if (value !== "google_drive" && value !== "supabase_storage") throw new Error("A supported organization storage provider is required.");
  return value;
}

export function organizationObjectKey(organizationId: string, entityScope: string, entityId: string, fileName: string) {
  return [organizationId, entityScope, entityId, fileName].map((part) => String(part || "").trim()).join("/");
}

export async function loadOrganizationStorageConfig(admin: AdminClient, organizationId: string): Promise<OrganizationStorageConfig | null> {
  const result = await admin.from("organization_storage_configurations").select("organization_id,provider,secret_ref,drive_root_id,verification_status,verified_at").eq("organization_id", organizationId).maybeSingle();
  // The organization storage table is an additive platform-storage feature.
  // Older Work Order tenants use the legacy bucket path until that feature's
  // migration is installed; do not make PDF preview/draft creation fail just
  // because the optional table is absent. resolveWorkOrderStorage still checks
  // platform_organization_setup_states before selecting the legacy path.
  if (result.error) {
    const message = String(result.error.message || "");
    if (/relation .*organization_storage_configurations.*does not exist|organization_storage_configurations.*schema cache/i.test(message)) return null;
    throw result.error;
  }
  if (!result.data) return null;
  if (result.data.provider === "google_drive" && !result.data.secret_ref) throw new Error("Organization Google Drive configuration is incomplete.");
  if (result.data.provider === "supabase_storage" && result.data.secret_ref) throw new Error("Supabase Storage configuration must not contain a credential reference.");
  return result.data as OrganizationStorageConfig;
}

export async function saveOrganizationStorageConfig(admin: AdminClient, input: { organizationId: string; provider: unknown; driveRootId?: string | null; driveSecret?: string | null; actorUserId: string }) {
  const provider = assertOrganizationStorageProvider(input.provider);
  if (provider === "google_drive" && !input.driveSecret) throw new Error("Google Drive configuration requires a server-side secret.");
  if (provider === "supabase_storage" && (input.driveSecret || input.driveRootId)) throw new Error("Supabase Storage must not receive Drive credentials or folder IDs.");
  const result = await admin.rpc("save_organization_storage_configuration", { p_organization_id: input.organizationId, p_provider: provider, p_drive_root_id: input.driveRootId || null, p_drive_secret: input.driveSecret || null, p_actor_user_id: input.actorUserId });
  if (result.error) throw result.error;
  return result.data;
}

export async function revokeOrganizationStorageSecret(admin: AdminClient, organizationId: string, actorUserId: string) {
  const result = await admin.rpc("revoke_organization_storage_secret", { p_organization_id: organizationId, p_actor_user_id: actorUserId });
  if (result.error) throw result.error;
  return result.data;
}

export function assertOrganizationDocumentScope(expectedOrganizationId: string, documentOrganizationId: unknown, configOrganizationId: unknown) {
  if (String(documentOrganizationId || "") !== expectedOrganizationId || String(configOrganizationId || "") !== expectedOrganizationId) throw new Error("Document storage is outside the authorized organization.");
}

export function assertVerifiedStorageConfig(config: OrganizationStorageConfig | null) {
  if (!config || config.verification_status !== "verified") throw new Error("Organization storage is not verified.");
  return config;
}

type StorageClient = { storage: { from: (bucket: string) => any } };

export async function verifySupabaseOrganizationStorage(admin: AdminClient & StorageClient, organizationId: string, bucket: string) {
  const config = await loadOrganizationStorageConfig(admin, organizationId);
  if (!config || config.provider !== "supabase_storage") throw new Error("Supabase Storage is not the selected organization provider.");
  const key = organizationObjectKey(organizationId, "__verification__", crypto.randomUUID(), "probe.txt");
  const storage = admin.storage.from(bucket);
  let uploaded = false;
  try {
    const upload = await storage.upload(key, new Uint8Array([111, 107]), { contentType: "text/plain", upsert: false });
    if (upload.error) throw upload.error;
    uploaded = true;
    const downloaded = await storage.download(key);
    if (downloaded.error || !downloaded.data) throw downloaded.error || new Error("Storage verification read failed.");
    const signed = await storage.createSignedUrl(key, 60);
    if (signed.error || !signed.data?.signedUrl) throw signed.error || new Error("Storage verification signed URL failed.");
    const update = await admin.from("organization_storage_configurations").update({ verification_status: "verified", verified_at: new Date().toISOString() }).eq("organization_id", organizationId).eq("provider", "supabase_storage");
    if (update.error) throw update.error;
    return { verified: true, provider: "supabase_storage" as const };
  } finally {
    if (uploaded) await storage.remove([key]);
  }
}

export async function requireOrganizationStorageConfig(admin: AdminClient, organizationId: string) {
  return assertVerifiedStorageConfig(await loadOrganizationStorageConfig(admin, organizationId));
}

export async function resolveWorkOrderStorage(admin: AdminClient, organizationId: string) {
  const config = await loadOrganizationStorageConfig(admin, organizationId);
  if (config) return { mode: "configured" as const, config: assertVerifiedStorageConfig(config) };
  const setup = await admin.from("platform_organization_setup_states").select("lifecycle_status").eq("organization_id", organizationId).maybeSingle();
  if (setup.error && setup.error.code !== "42P01" && !/platform_organization_setup_states.*schema cache/i.test(String(setup.error.message || ""))) throw setup.error;
  if (setup.data) throw new Error("Organization storage is not configured and verified.");
  return { mode: "legacy" as const, config: null };
}
