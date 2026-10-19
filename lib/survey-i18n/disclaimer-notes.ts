/**
 * Leaf helpers for Disclaimer/Notes short-answer tabs.
 * Kept separate from `rules.ts` so client bundles do not hit circular-import
 * bindings where named exports can be undefined at runtime.
 */

const DISCLAIMER_HINTS = ["disclaimer", "aviso legal", "leyó aviso"] as const;
const NOTES_HINTS = ["note", "notes", "notas"] as const;

/** Short-answer Disclaimer/Notes (or disclaimer + notas) — not Yes/No disclaimer. */
export function questionLooksLikeDisclaimerNotes(questionName: string): boolean {
  const q = questionName.trim().toLowerCase();
  if (!q) return false;
  const disclaimerLike = DISCLAIMER_HINTS.some((hint) => q.includes(hint));
  if (!disclaimerLike) return false;
  return NOTES_HINTS.some((hint) => q.includes(hint));
}
