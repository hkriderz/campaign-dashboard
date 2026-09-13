import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Sans, Newsreader } from "next/font/google";
import {
  DEFAULT_THEME,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  parseThemeMode,
} from "@/lib/theme";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans-plex",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "600"],
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
      </body>
    </html>
  );
}
