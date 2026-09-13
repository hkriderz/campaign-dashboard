import type { CampaignTag } from "./types";

export type CampaignTagMode = Extract<CampaignTag["mode"], "phonebanking" | "canvassing" | "both" | "texting">;

/** Composite Mode-dropdown values that encode phone / canvass / text membership. */
export type EditorChannelMode =
  | "all"
  | "both"
  | "phonebanking-texting"
  | "canvassing-texting"
  | "phonebanking"
  | "canvassing"
  | "texting";

export function isCampaignTagMode(value: unknown): value is CampaignTagMode {
  return (
    value === "both" ||
    value === "phonebanking" ||
    value === "canvassing" ||
    value === "texting"
  );
}

export function isEditorChannelMode(value: string): value is EditorChannelMode {
  return (
    value === "all" ||
    value === "both" ||
    value === "phonebanking-texting" ||
    value === "canvassing-texting" ||
    value === "phonebanking" ||
    value === "canvassing" ||
    value === "texting"
  );
}

/** Default texting membership when `includeInTexting` is omitted from a stored row. */
export function defaultIncludeInTexting(mode: CampaignTag["mode"]): boolean {
  return mode !== "canvassing" && mode !== "pdi";
}

/** Resolve an explicit or omitted `includeInTexting` value against `mode`. */
export function resolveIncludeInTexting(
  value: unknown,
  mode: CampaignTag["mode"]
): boolean {
  if (mode === "texting") return true;
  return typeof value === "boolean" ? value : defaultIncludeInTexting(mode);
}

export function modeAllowsQc(mode: CampaignTag["mode"]): boolean {
  return mode === "phonebanking" || mode === "both";
}

export function editorModeFromStored(
  mode: CampaignTagMode,
  includeInTexting: boolean
): EditorChannelMode {
  if (mode === "texting") return "texting";
  if (mode === "both") return includeInTexting ? "all" : "both";
  if (mode === "phonebanking") return includeInTexting ? "phonebanking-texting" : "phonebanking";
  return includeInTexting ? "canvassing-texting" : "canvassing";
}

export function storedFromEditorMode(editor: EditorChannelMode): {
  mode: CampaignTagMode;
  includeInTexting: boolean;
} {
  switch (editor) {
    case "all":
      return { mode: "both", includeInTexting: true };
    case "both":
      return { mode: "both", includeInTexting: false };
    case "phonebanking-texting":
      return { mode: "phonebanking", includeInTexting: true };
    case "canvassing-texting":
      return { mode: "canvassing", includeInTexting: true };
    case "phonebanking":
      return { mode: "phonebanking", includeInTexting: false };
    case "canvassing":
      return { mode: "canvassing", includeInTexting: false };
    case "texting":
      return { mode: "texting", includeInTexting: true };
  }
}
