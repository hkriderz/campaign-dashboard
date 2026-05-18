import { NextResponse } from "next/server";

export type ApiErrorBody = {
  ok: false;
  error: string;
  code: number;
};

export type ApiSuccessBody<T> = {
  ok: true;
  data: T;
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function apiError(error: string, code: number): NextResponse<ApiErrorBody> {
  return NextResponse.json({ ok: false, error, code }, { status: code });
}

export function apiOk<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccessBody<T>> {
  return NextResponse.json({ ok: true, data }, init);
}

/**
 * Wrap a route handler with consistent try/catch and `{ ok, data | error, code }` responses.
 */
export function withApiHandler<T>(
  logLabel: string,
  handler: () => Promise<T>
): Promise<NextResponse<ApiSuccessBody<T> | ApiErrorBody>> {
  return handler()
    .then((data) => apiOk(data))
    .catch((err) => {
      const message = errorMessage(err);
      console.error(`[${logLabel}]`, message);
      return apiError(message, 500);
    });
}

export function requireQueryParam(
  searchParams: URLSearchParams,
  name: string
): string | NextResponse<ApiErrorBody> {
  const value = searchParams.get(name)?.trim();
  if (!value) return apiError(`Missing required query param: ${name}`, 400);
  return value;
}
