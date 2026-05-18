export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { bootstrapServerEnv, ensureRuntimeDataDirs } = await import(
    "@/lib/server/bootstrap-env"
  );
  bootstrapServerEnv();
  ensureRuntimeDataDirs();
}
