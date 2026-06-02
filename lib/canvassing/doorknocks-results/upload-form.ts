import "server-only";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export type DoorknockUploadFileInput = {
  fileName: string;
  relativePath?: string;
  buffer: Buffer;
};

function parseRelativePaths(raw: FormDataEntryValue | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw.toString()) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => (typeof item === "string" ? item.trim() : ""));
  } catch {
    return [];
  }
}

export async function readDoorknockUploadFormFiles(form: FormData): Promise<DoorknockUploadFileInput[]> {
  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  const relativePaths = parseRelativePaths(form.get("relativePaths"));

  if (!files.length) {
    throw new Error("Upload at least one PDI contact-report CSV.");
  }

  const out: DoorknockUploadFileInput[] = [];
  let totalBytes = 0;

  for (let index = 0; index < files.length; index++) {
    const file = files[index]!;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      throw new Error(`"${file.name}" is not a CSV file.`);
    }
    if (file.size === 0) {
      throw new Error(`"${file.name}" is empty.`);
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new Error(`"${file.name}" is too large. Maximum file size is 25 MB.`);
    }

    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("Upload batch is too large. Maximum total upload size is 100 MB.");
    }

    out.push({
      fileName: file.name,
      relativePath: relativePaths[index] || file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
  }

  return out;
}

export function parseDoorknockSettingsFormValue(raw: FormDataEntryValue | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw.toString()) as unknown;
  } catch {
    return null;
  }
}
