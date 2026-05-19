import { NextResponse } from "next/server";
import {
  assertDataAccessAllowed,
  CredentialsRequiredError,
  resolveContextFromRequest,
  runWithCredentialContextAsync,
  type DataAccessRequirements,
} from "@/lib/credentials";

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

type ApiHandlerOptions = {
  /** When set, runs the handler inside the browser session credential context. */
  req?: Request;
  /** Require session credentials before executing (only when session mode is enabled). */
  requireCredentials?: DataAccessRequirements;
};

/**
 * Wrap a route handler with consistent try/catch and `{ ok, data | error, code }` responses.
 */
export function withApiHandler<T>(
  logLabel: string,
  handler: () => Promise<T>,
  options?: ApiHandlerOptions
): Promise<NextResponse<ApiSuccessBody<T> | ApiErrorBody>> {
  const execute = async (): Promise<T> => {
    if (options?.req) {
      const ctx = resolveContextFromRequest(options.req);
      return runWithCredentialContextAsync(ctx, async () => {
        if (options.requireCredentials) {
          assertDataAccessAllowed(options.requireCredentials);
        }
        return handler();
      });
    }
    return handler();
  };

  return execute()
    .then((data) => apiOk(data))
    .catch((err) => {
      if (err instanceof CredentialsRequiredError) {
        return apiError(err.message, 401);
      }
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
