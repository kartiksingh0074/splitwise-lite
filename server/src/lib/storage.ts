import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StorageAdapter {
  save(key: string, data: Buffer, contentType: string): Promise<void>;
  read(key: string): Promise<{ data: Buffer; contentType: string } | null>;
}

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * Dev storage adapter. Keys are always server-generated (`<uuidv7>.<ext>`, see the settlements
 * service), never derived from user input, so no path-traversal handling is needed beyond
 * `path.basename` as a defensive floor. `contentType` on save is unused here (the extension
 * already encodes it, read back via EXTENSION_CONTENT_TYPES) but kept in the interface since a
 * future S3StorageAdapter needs it to set the object's Content-Type header explicitly.
 */
export class LocalDiskStorageAdapter implements StorageAdapter {
  constructor(private readonly baseDir: string) {}

  private resolve(key: string): string {
    return path.join(this.baseDir, path.basename(key));
  }

  async save(key: string, data: Buffer, _contentType: string): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(this.resolve(key), data);
  }

  async read(key: string): Promise<{ data: Buffer; contentType: string } | null> {
    try {
      const data = await readFile(this.resolve(key));
      const ext = path.extname(key).slice(1);
      const contentType = EXTENSION_CONTENT_TYPES[ext] ?? "application/octet-stream";
      return { data, contentType };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}
