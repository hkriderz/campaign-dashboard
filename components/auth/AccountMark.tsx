type Props = {
  login: string;
  size?: "sm" | "md";
};

/** Letter mark used when an account has no picture. */
export default function AccountMark({ login, size = "md" }: Props) {
  const letter = login.trim().charAt(0).toUpperCase() || "?";
  const dim = size === "sm" ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm";

  return (
    <span
      aria-hidden
      className={`${dim} inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--section-rule)] bg-[color-mix(in_srgb,var(--section-accent)_16%,var(--section-paper))] font-semibold text-[var(--section-ink)]`}
    >
      {letter}
    </span>
  );
}
