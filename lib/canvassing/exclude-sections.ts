export type KnockExcludeSections = {
  pivot: boolean;
  gaps: boolean;
  shift: boolean;
};

export type DoorknockExcludeSections = {
  pivot: boolean;
  low_doors_low_support: boolean;
  low_contact_rate: boolean;
  survey_support_struggle: boolean;
  non_contact_outlier: boolean;
};

export type DataCheckExcludeSections = DoorknockExcludeSections & {
  geo_timing_check: boolean;
};

export type NonContactExcludeSections = {
  summary: boolean;
  "flagged-nc": boolean;
  "flagged-c": boolean;
  details: boolean;
  baselines: boolean;
};

export const DEFAULT_KNOCK_EXCLUDE_SECTIONS: KnockExcludeSections = {
  pivot: false,
  gaps: true,
  shift: true,
};

export const DEFAULT_DOORKNOCK_EXCLUDE_SECTIONS: DoorknockExcludeSections = {
  pivot: true,
  low_doors_low_support: true,
  low_contact_rate: true,
  survey_support_struggle: true,
  non_contact_outlier: true,
};

export const DEFAULT_DATA_CHECK_EXCLUDE_SECTIONS: DataCheckExcludeSections = {
  ...DEFAULT_DOORKNOCK_EXCLUDE_SECTIONS,
  geo_timing_check: true,
};

export const DEFAULT_NON_CONTACT_EXCLUDE_SECTIONS: NonContactExcludeSections = {
  summary: true,
  "flagged-nc": true,
  "flagged-c": true,
  details: true,
  baselines: true,
};

export function resolveExcludeSections<T extends Record<string, boolean>>(
  raw: Partial<T> | Record<string, boolean> | null | undefined,
  defaults: T
): T {
  const next = { ...defaults };
  if (!raw || typeof raw !== "object") return next;
  for (const key of Object.keys(defaults) as Array<keyof T>) {
    const value = (raw as Partial<T>)[key];
    if (typeof value === "boolean") next[key] = value as T[keyof T];
  }
  return next;
}
