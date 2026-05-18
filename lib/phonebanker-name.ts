const PHONEBANKER_ALIASES: Record<string, string> = {
  walter: "Walter Stone",
  "walter stone": "Walter Stone",
  andrew: "Andrew Marshall",
  "andrew marshall": "Andrew Marshall",
  "ed k": "Ed Keenan",
  "ed keenan": "Ed Keenan",
  mady: "Mady Hogan",
  "mady hogan": "Mady Hogan",
  eve: "Eve Harrison",
  "eve harrison": "Eve Harrison",
  eric: "Eric Giancoli",
  "eric giancoli": "Eric Giancoli",
  tina: "Tina M.",
  "tina m": "Tina M.",
  traci: "Traci Henderson",
  "traci henderson": "Traci Henderson",
  mosa: "Mosa Alzabey",
  "mosa alzabey": "Mosa Alzabey",
  carmen: "Carmen Acosta",
  "carmen acosta": "Carmen Acosta",
  "grace bush": "Grace Bush",
  vikas: "Vikas Bandhu",
  "vikas bandhu": "Vikas Bandhu",
};

function titleCase(raw: string): string {
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function canonicalizePhonebankerName(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!cleaned) return "";
  const alias = PHONEBANKER_ALIASES[cleaned];
  if (alias) return alias;
  return titleCase(cleaned);
}

export function canonicalizePhonebankerKey(raw: string): string {
  return canonicalizePhonebankerName(raw).toLowerCase();
}
