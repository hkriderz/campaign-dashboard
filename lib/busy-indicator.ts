type BusyListener = (busy: boolean) => void;

const listeners = new Set<BusyListener>();
let inFlight = 0;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let fetchPatched = false;

const HIDE_DEBOUNCE_MS = 140;

function emit(busy: boolean) {
  for (const listener of listeners) listener(busy);
}

function setBusyVisible(busy: boolean) {
  if (typeof document !== "undefined") {
    if (busy) document.documentElement.setAttribute("data-app-busy", "true");
    else document.documentElement.removeAttribute("data-app-busy");
  }
  emit(busy);
}

export function beginBusy() {
  inFlight += 1;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (inFlight === 1) setBusyVisible(true);
}

export function endBusy() {
  inFlight = Math.max(0, inFlight - 1);
  if (inFlight > 0) return;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (inFlight === 0) setBusyVisible(false);
  }, HIDE_DEBOUNCE_MS);
}

export function subscribeBusy(listener: BusyListener): () => void {
  listeners.add(listener);
  listener(inFlight > 0);
  return () => {
    listeners.delete(listener);
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  if (init?.headers) return new Headers(init.headers);
  if (typeof Request !== "undefined" && input instanceof Request) return new Headers(input.headers);
  return new Headers();
}

/** Skip prefetch / static asset traffic so the cursor does not flicker on Link hover. */
export function shouldTrackFetch(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (typeof window === "undefined") return false;

  const url = requestUrl(input);
  const absolute = url.startsWith("http") ? url : new URL(url, window.location.origin).href;
  if (!absolute.startsWith(window.location.origin)) return false;

  const path = absolute.slice(window.location.origin.length);
  if (path.startsWith("/_next/static") || path.startsWith("/_next/image") || path.startsWith("/icon")) {
    return false;
  }

  const headers = requestHeaders(input, init);
  if (headers.get("next-router-prefetch") === "1") return false;
  if (headers.get("purpose") === "prefetch") return false;
  if (headers.get("x-middleware-prefetch") === "1") return false;

  return true;
}

export function ensureFetchPatched() {
  if (fetchPatched || typeof window === "undefined") return;
  fetchPatched = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const track = shouldTrackFetch(input, init);
    if (track) beginBusy();
    try {
      return await original(input, init);
    } finally {
      if (track) endBusy();
    }
  };
}
