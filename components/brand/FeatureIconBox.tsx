import type { ReactNode } from "react";

/** Feature cards on the landing page. */
export const FEATURE_ICON_BOX_CARD_CLASS =
  "w-12 h-12 min-w-12 min-h-12 shrink-0 rounded-xl flex items-center justify-center text-2xl";

/** Hero mark above the landing title (keep in sync with `BOXED_SIZES.hero` in WhaleMark). */
export const FEATURE_ICON_BOX_HERO_CLASS =
  "h-20 w-20 min-w-20 min-h-20 shrink-0 rounded-2xl flex items-center justify-center text-3xl";

type Props = {
  children: ReactNode;
  toneClassName: string;
  /** `card` = feature tiles; `hero` = larger mark above the title */
  size?: "card" | "hero";
  className?: string;
};

export default function FeatureIconBox({
  children,
  toneClassName,
  size = "card",
  className = "",
}: Props) {
  const boxClass = size === "hero" ? FEATURE_ICON_BOX_HERO_CLASS : FEATURE_ICON_BOX_CARD_CLASS;

  return (
    <div
      className={[boxClass, toneClassName, className].filter(Boolean).join(" ")}
      aria-hidden
    >
      {children}
    </div>
  );
}
