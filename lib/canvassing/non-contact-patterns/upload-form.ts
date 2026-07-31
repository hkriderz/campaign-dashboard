import "server-only";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;

export type NonContactUploadFileInput = {
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

export async function readNonContactUploadFormFiles(form: FormData): Promise<NonContactUploadFileInput[]> {
  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  const relativePaths = parseRelativePaths(form.get("relativePaths"));

  if (!files.length) {
    throw new Error("Upload at least one CSV or XLSX knock-detail file.");
  }

  const out: NonContactUploadFileInput[] = [];
  let totalBytes = 0;

  for (let index = 0; index < files.length; index++) {
    const file = files[index]!;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".xlsx")) {
      throw new Error(`Unsupported file type for "${file.name}". Upload CSV or XLSX files.`);
    }
    if (file.size === 0) {
      throw new Error(`"${file.name}" is empty.`);
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new Error(`"${file.name}" is too large. Maximum file size is 50 MB.`);
    }

    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("Upload batch is too large. Maximum total upload size is 150 MB.");
    }

    out.push({
      fileName: file.name,
      relativePath: relativePaths[index] || file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
  }

  return out;
}

export function parseNonContactSettingsFormValue(raw: FormDataEntryValue | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw.toString()) as unknown;
  } catch {
    return null;
  }
}
