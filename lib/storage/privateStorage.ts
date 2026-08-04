export type StorageProvider = "supabase" | "r2";

export type StoredObject = {
  provider: StorageProvider;
  bucket: string;
  key: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum?: string | null;
};

export type UploadInput = {
  bucket: string;
  key: string;
  file: File;
  checksum?: string | null;
};

export interface PrivateStorageAdapter {
  upload(input: UploadInput): Promise<StoredObject>;
  delete(input: { bucket: string; key: string }): Promise<void>;
  createSignedReadUrl(input: { bucket: string; key: string; expiresIn?: number }): Promise<string>;
}

type SupabaseClient = any;

class SupabasePrivateStorageAdapter implements PrivateStorageAdapter {
  constructor(private readonly admin: SupabaseClient) {}

  async upload(input: UploadInput): Promise<StoredObject> {
    const buffer = Buffer.from(await input.file.arrayBuffer());
    const { error } = await this.admin.storage
      .from(input.bucket)
      .upload(input.key, buffer, {
        contentType: input.file.type || "application/octet-stream",
        upsert: false,
      });

    if (error) throw error;

    return {
      provider: "supabase",
      bucket: input.bucket,
      key: input.key,
      originalFileName: input.file.name,
      mimeType: input.file.type || "application/octet-stream",
      sizeBytes: input.file.size,
      checksum: input.checksum || null,
    };
  }

  async delete(input: { bucket: string; key: string }) {
    const { error } = await this.admin.storage.from(input.bucket).remove([input.key]);
    if (error) throw error;
  }

  async createSignedReadUrl(input: { bucket: string; key: string; expiresIn?: number }) {
    const { data, error } = await this.admin.storage
      .from(input.bucket)
      .createSignedUrl(input.key, input.expiresIn || 60 * 10);

    if (error) throw error;
    if (!data?.signedUrl) throw new Error("Could not create signed file URL.");

    return data.signedUrl;
  }
}

export function createPrivateStorageAdapter(admin: SupabaseClient): PrivateStorageAdapter {
  const provider = (process.env.PRIVATE_STORAGE_PROVIDER || "supabase").toLowerCase();
  if (provider !== "supabase") {
    throw new Error(`Private storage provider '${provider}' is not configured yet.`);
  }

  return new SupabasePrivateStorageAdapter(admin);
}

export function safeObjectKey(parts: Array<string | null | undefined>) {
  return parts
    .map((part) =>
      String(part || "")
        .trim()
        .replace(/[^a-zA-Z0-9._/-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-/]+|[-/]+$/g, ""),
    )
    .filter(Boolean)
    .join("/");
}
