import Image from "next/image";

const WHALE_ICON_SRC = "/whale-icon.png";

/** Default boxed tone (feature cards, nav-sized marks). */
export const BRAND_ICON_BOX_CLASS =
  "bg-indigo-500/15 border border-indigo-500/20 dark:border-indigo-500/30";

/** Landing hero whale tile — solid interior for whale contrast; glow is separate. */
export const BRAND_ICON_BOX_BLUE_CLASS =
  "bg-blue-50 border border-blue-200/90 dark:bg-[#1a2d4a] dark:border-blue-400/50";

const BOXED_SIZES = {
  sm: { box: "h-8 w-8 rounded-xl", img: 24 },
  md: { box: "h-10 w-10 rounded-xl", img: 30 },
  lg: { box: "w-12 h-12 rounded-xl", img: 40 },
  /** Landing hero — larger than `lg` cards. */
  hero: { box: "h-20 w-20 min-h-20 min-w-20 rounded-2xl", img: 56 },
} as const;

const PLAIN_SIZES = {
  sm: { img: 28, className: "size-7" },
  md: { img: 32, className: "size-8" },
  /** Inside `FeatureIconBox` card tiles (`w-12`). */
  lg: { img: 96, className: "size-10" },
  /** Inside boxed `hero` tile or `FeatureIconBox size="hero"`. */
  hero: { img: 112, className: "size-14" },
} as const;

type PlainSize = keyof typeof PLAIN_SIZES;
type BoxedSize = keyof typeof BOXED_SIZES;

type WhaleMarkProps =
  | {
      variant?: "plain";
      size?: PlainSize;
      className?: string;
      alt?: string;
    }
  | {
      variant: "boxed";
      size?: BoxedSize;
      className?: string;
      alt?: string;
    };

export default function WhaleMark({
  variant = "boxed",
  size = "sm",
  className = "",
  alt = "Campaign Dashboard",
}: WhaleMarkProps) {
  const imgClass = "object-contain shrink-0";

  if (variant === "plain") {
    const plainSize = (size ?? "sm") as PlainSize;
    const s = PLAIN_SIZES[plainSize];
    return (
      <Image
        src={WHALE_ICON_SRC}
        alt={alt}
        width={s.img}
        height={s.img}
        className={[imgClass, s.className, className].join(" ")}
        priority={plainSize === "lg" || plainSize === "hero"}
        aria-hidden={alt === ""}
      />
    );
  }

  const boxedSize = (size ?? "sm") as BoxedSize;
  const s = BOXED_SIZES[boxedSize];

  if (boxedSize === "hero") {
    return (
      <span
        className={["relative inline-flex shrink-0", className].join(" ")}
        aria-hidden={alt === ""}
      >
        <span
          className="pointer-events-none absolute -inset-4 rounded-3xl bg-blue-500/35 blur-2xl dark:bg-blue-400/25"
          aria-hidden
        />
        <span
          className={[
            "relative inline-flex items-center justify-center",
            BRAND_ICON_BOX_BLUE_CLASS,
            s.box,
          ].join(" ")}
        >
          <Image
            src={WHALE_ICON_SRC}
            alt={alt}
            width={s.img}
            height={s.img}
            className={imgClass}
            priority
          />
        </span>
      </span>
    );
  }

  return (
    <span
      className={[
        "relative inline-flex shrink-0 items-center justify-center",
        BRAND_ICON_BOX_CLASS,
        s.box,
        className,
      ].join(" ")}
      aria-hidden={alt === ""}
    >
      <Image
        src={WHALE_ICON_SRC}
        alt={alt}
        width={s.img}
        height={s.img}
        className={imgClass}
        priority={boxedSize === "lg"}
      />
    </span>
  );
}
