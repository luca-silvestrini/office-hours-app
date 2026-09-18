/**
 * Placeholder brand mark — a clock face over the deep-blue brand square.
 * Swap the inner <svg> for the Newman Center's own logo when there's an
 * asset to use.
 */
export function BrandMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-xl bg-brand text-brand-on shadow-card ${className}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-[58%] w-[58%]">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" opacity="0.55" />
        <path
          d="M12 7.2v5.1l3.2 1.9"
          stroke="var(--gold-strong)"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export default BrandMark;
