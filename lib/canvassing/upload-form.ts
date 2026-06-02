import "server-only";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export type CanvassingUploadFileInput = {
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

export async function readCanvassingUploadFormFiles(form: FormData): Promise<CanvassingUploadFileInput[]> {
  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  const relativePaths = parseRelativePaths(form.get("relativePaths"));

  if (!files.length) {
    throw new Error("Upload at least one CSV or XLSX file.");
  }

  const out: CanvassingUploadFileInput[] = [];
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
      throw new Error(`"${file.name}" is too large. Maximum file size is 25 MB.`);
    }

    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("Upload batch is too large. Maximum total upload size is 100 MB.");
    }

    const relativePath = relativePaths[index] || file.name;
    out.push({
      fileName: file.name,
      relativePath,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
  }

  return out;
}
