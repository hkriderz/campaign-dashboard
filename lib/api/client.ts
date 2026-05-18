import type { ApiErrorBody, ApiSuccessBody } from "@/lib/api/http";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: number;

  constructor(message: string, status: number, code: number) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

type FetchJsonOptions = RequestInit & {
  /** When set, thrown as {@link ApiClientError} if response is not ok. */
  errorLabel?: string;
};

/**
 * Typed fetch for dashboard API routes that return `{ ok, data }` or `{ ok: false, error, code }`.
 */
export async function fetchApiJson<T>(
  url: string,
  options?: FetchJsonOptions
): Promise<T> {
  const res = await fetch(url, options);
  const body = (await res.json().catch(() => null)) as
    | ApiSuccessBody<T>
    | ApiErrorBody
    | { error?: string; code?: number }
    | null;

  if (body && typeof body === "object" && "ok" in body && body.ok === true) {
    return body.data;
  }

  const fromOkShape =
    body && typeof body === "object" && "ok" in body && body.ok === false
      ? body.error
      : null;
  const message =
    fromOkShape ??
    (body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : null) ??
    options?.errorLabel ??
    `Request failed (${res.status})`;

  const code =
    body && typeof body === "object" && "code" in body && typeof body.code === "number"
      ? body.code
      : res.status;

  throw new ApiClientError(message, res.status, code);
}
