import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthUserFromCookies } from "@/lib/auth/current";
import { isPublicAuthPath, safeNextPath } from "@/lib/auth/public-paths";
import localFont from "next/font/local";
import {
  DEFAULT_THEME,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  parseThemeMode,
} from "@/lib/theme";
import BusyIndicator from "@/components/shared/BusyIndicator";
import "./globals.css";

/** Self-hosted so Docker/Dokploy builds never call fonts.google.com. */
const plexSans = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-sans-plex",
  display: "swap",
});

const newsreader = localFont({
  src: [
    { path: "./fonts/newsreader-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/newsreader-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Campaign Operations Dashboard",
  description:
    "Phone banking, texting, and canvassing analytics for Scale to Win campaigns.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerStore = await headers();
  const pathname = headerStore.get("x-cd-pathname") ?? "";
  if (pathname && !isPublicAuthPath(pathname)) {
    const user = await getAuthUserFromCookies();
    if (!user) {
      const next = safeNextPath(pathname);
      redirect(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
    }
  }

  const cookieStore = await cookies();
  const theme =
    parseThemeMode(cookieStore.get(THEME_STORAGE_KEY)?.value) ?? DEFAULT_THEME;
  const isDark = theme === "dark";

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plexSans.variable} ${newsreader.variable}${isDark ? " dark" : ""}`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_INIT_SCRIPT,
          }}
        />
      </head>
      <body
        suppressHydrationWarning
        className="font-sans bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 antialiased min-h-screen overflow-x-hidden"
      >
        {children}
        <BusyIndicator />
      </body>
    </html>
  );
}
