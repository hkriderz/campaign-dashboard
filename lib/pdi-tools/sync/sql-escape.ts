/** Escape a string for use inside BigQuery standard SQL single-quoted literals. */
export function escapeSqlStringLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "''");
}
