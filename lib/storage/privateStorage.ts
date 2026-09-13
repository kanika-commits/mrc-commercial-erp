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
  copyObject(input: { bucket: string; sourcePath: string; destinationPath: string; originalFileName?: string; mimeType?: string | null; sizeBytes?: number | null }): Promise<StoredObject>;
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

  async copyObject(input: { bucket: string; sourcePath: string; destinationPath: string; originalFileName?: string; mimeType?: string | null; sizeBytes?: number | null }) {
    const { data, error } = await this.admin.storage.from(input.bucket).download(input.sourcePath);
    if (error) throw error;
    if (!data) throw new Error("Source storage object was not found.");
    const buffer = Buffer.from(await data.arrayBuffer());
    const { error: uploadError } = await this.admin.storage.from(input.bucket).upload(input.destinationPath, buffer, { contentType: input.mimeType || data.type || "application/octet-stream", upsert: false });
    if (uploadError) throw uploadError;
    return { provider: "supabase", bucket: input.bucket, key: input.destinationPath, originalFileName: input.originalFileName || input.destinationPath.split("/").pop() || "document", mimeType: input.mimeType || data.type || "application/octet-stream", sizeBytes: input.sizeBytes ?? buffer.byteLength, checksum: null } satisfies StoredObject;
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

export async function copyObjectsWithCompensation(adapter: PrivateStorageAdapter, inputs: Array<{ bucket: string; sourcePath: string; destinationPath: string; originalFileName?: string; mimeType?: string | null; sizeBytes?: number | null }>) {
  const copied: Array<{ bucket: string; key: string }> = [];
  try {
    const results: StoredObject[] = [];
    for (const input of inputs) {
      const result = await adapter.copyObject(input);
      copied.push({ bucket: result.bucket, key: result.key });
      results.push(result);
    }
    return results;
  } catch (error) {
    const cleanupFailures: Array<{ bucket: string; key: string; error: unknown }> = [];
    for (const destination of copied.reverse()) {
      try { await adapter.delete(destination); } catch (cleanupError) { cleanupFailures.push({ ...destination, error: cleanupError }); }
    }
    if (cleanupFailures.length && error && typeof error === "object") Object.assign(error, { cleanupFailures });
    throw error;
  }
}
