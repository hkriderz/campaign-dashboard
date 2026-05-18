import { DISCLAIMER_QUESTION_HINTS, PHRASE_NORMALIZATION_RULES } from "./rules";

/** Escape single quotes for BigQuery string literals inside REGEXP_REPLACE replacement. */
function escapeBqStringLiteral(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "''");
}

/**
 * Chain REGEXP_REPLACE so STW answers / question titles in any configured language
 * normalize toward English tokens understood by existing metrics regexes.
 */
export function buildPhraseNormalizedExpr(innerSql: string): string {
  let expr = innerSql;
  for (const rule of PHRASE_NORMALIZATION_RULES) {
    const repl = escapeBqStringLiteral(rule.replace);
    expr = `REGEXP_REPLACE(${expr}, r'${rule.match}', '${repl}')`;
  }
  return expr;
}

/** REGEXP_CONTAINS pattern: any configured disclaimer hint (lowercase column expected). */
export function buildDisclaimerHintsPattern(): string {
  const body = DISCLAIMER_QUESTION_HINTS.map((h) =>
    h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("|");
  return body;
}
