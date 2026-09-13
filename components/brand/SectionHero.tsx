type SectionHeroProps = {
  kicker?: string;
  title: string;
  lede?: string;
  className?: string;
};

export default function SectionHero({ kicker, title, lede, className }: SectionHeroProps) {
  return (
    <header className={["section-hero", className ?? ""].filter(Boolean).join(" ")}>
      {kicker ? <p className="section-kicker mb-2">{kicker}</p> : null}
      <h1 className="section-hero__title">{title}</h1>
      <hr className="section-hero__rule" />
      {lede ? <p className="section-hero__lede">{lede}</p> : null}
    </header>
  );
}
