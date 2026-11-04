/** Manual / cached name + address keyed by normalized PDI / PRIMARYID. */
export type PdiIdentityRecord = {
  pdiId: string;
  voterName: string;
  voterAddress: string;
  /** ISO timestamp of the last manual or import write. */
  updatedAt: string;
  /** Optional note (source, who entered, etc.). */
  note?: string;
};

export type PdiIdentityIndexFile = {
  version: 1;
  byPdiId: Record<string, PdiIdentityRecord>;
};

export type PdiIdentityUpsertInput = {
  pdiId: string;
  voterName?: string;
  voterAddress?: string;
  note?: string;
  /**
   * When true, empty strings clear stored name/address.
   * Default false: empty input fields leave existing values alone.
   */
  replaceEmpty?: boolean;
};
