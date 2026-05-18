import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@google-cloud/bigquery"],
  /**
   * BQ snapshot JSON under data/bq-snapshots is written from server code on each tag page load.
   * Without ignoring it, webpack's file watcher retriggers compiles in a tight loop in dev.
   */
  webpack: (config, { dev }) => {
    if (dev) {
      // Next validates `watchOptions.ignored` as non-empty strings only; defaults may include RegExp.
      const prev = config.watchOptions?.ignored;
      const stringIgnores: string[] = [];
      if (Array.isArray(prev)) {
        for (const item of prev) {
          if (typeof item === "string" && item.trim().length > 0) stringIgnores.push(item);
        }
      } else if (typeof prev === "string" && prev.trim().length > 0) {
        stringIgnores.push(prev);
      }
      stringIgnores.push("**/data/bq-snapshots/**");
      config.watchOptions = {
        ...config.watchOptions,
        ignored: stringIgnores,
      };
    }
    return config;
  },
};

export default nextConfig;
