/**
 * Simple geometric cross — the reference design's Marian monogram reduced to
 * something that still reads as Catholic at 20px without the filigree.
 * Swap for the Newman Center's own logo when there's an asset to use.
 */
export function CrossGlyph({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3v18M6 9h12"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BrandMark({
  className = "h-10 w-10",
  boxed = true,
}: {
  className?: string;
  boxed?: boolean;
}) {
  if (!boxed) {
    return <CrossGlyph className={`${className} text-[var(--gold-strong)]`} />;
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-xl bg-brand ring-1 ring-[var(--gold-strong)]/45 ${className}`}
      aria-hidden="true"
    >
      <CrossGlyph className="h-[52%] w-[52%] text-[var(--gold-strong)]" />
    </span>
  );
}

export default BrandMark;
