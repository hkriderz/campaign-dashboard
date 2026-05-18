import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";
import {
  DEFAULT_THEME,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  parseThemeMode,
} from "@/lib/theme";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Campaign Operations Dashboard",
  description:
    "Phone banking and canvassing analytics for Scale to Win campaigns.",
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
      className={`${inter.variable}${isDark ? " dark" : ""}`}
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
        className="font-sans bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 antialiased min-h-screen"
      >
        {children}
      </body>
    </html>
  );
}
