import Image from "next/image";

/**
 * Login-page backdrop — Raphael's Disputa del Sacramento (2075x1500) behind the
 * sign-in form. The Mary/Joseph panels are still used on the dashboard (see
 * side-devotion.tsx), not here.
 *
 * The image runs the full height of the page, so its top and bottom meet the
 * screen edges, and only the left and right sides fade out into the page
 * background.
 *
 * The box takes its height from the viewport and its width from the image's
 * own ratio, so on a normal desktop screen nothing is cropped. On a screen
 * narrower than that (a phone, a tall window) `max-w-full` caps the width and
 * `object-cover` centre-crops the sides instead, so the top and bottom still
 * reach the edges.
 *
 * Matching the box to the image ratio also matters for the fade: if the box
 * were wider, the image would letterbox inside it and its real edges would land
 * where the mask is still opaque, showing up as hard vertical lines.
 */
const FADE_SIDES =
  "linear-gradient(to right, transparent 0%, #000 8%, #000 92%, transparent 100%)";

/* Solid dark-blue side borders, drawn over the painting from md up (below that
   the image fills the width and there's no gap). Each has a tiled gold diamond-and-cross
   lattice, a thick gold rule on the inner edge. */
const BAND_W = "clamp(3rem,7vw,7rem)";

const LATTICE = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28' fill='none' stroke='#f2d98a' stroke-width='1'>` +
    `<path d='M14 1 27 14 14 27 1 14Z' opacity='.55'/>` +
    `<path d='M14 9v10M9 14h10' stroke-width='1.4' opacity='.9'/>` +
    `<circle cx='0' cy='0' r='1.6' fill='#f2d98a' stroke='none' opacity='.7'/>` +
    `<circle cx='28' cy='0' r='1.6' fill='#f2d98a' stroke='none' opacity='.7'/>` +
    `<circle cx='0' cy='28' r='1.6' fill='#f2d98a' stroke='none' opacity='.7'/>` +
    `<circle cx='28' cy='28' r='1.6' fill='#f2d98a' stroke='none' opacity='.7'/>` +
    `</svg>`,
)}")`;

function SideBand({ left }: { left: boolean }) {
  const edge = left ? "left-0 border-r-4" : "right-0 border-l-4";
  return (
    <>
      <div
        className={`absolute inset-y-0 ${edge} hidden border-gold-header bg-brand md:block`}
        style={{
          width: BAND_W,
          backgroundImage: LATTICE,
          backgroundSize: "28px 28px",
          backgroundPosition: "center top",
        }}
      />
    </>
  );
}

export function LoginBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center overflow-hidden"
    >
      <div
        className="relative h-full w-[min(100%,calc(100vh*1.55))] opacity-60"
        style={{
          maskImage: FADE_SIDES,
          WebkitMaskImage: FADE_SIDES,
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskSize: "100% 100%",
          WebkitMaskSize: "100% 100%",
        }}
      >
        <Image
          src="/devotion/disputa.jpg"
          alt="Raphael's Disputa del Sacramento"
          fill
          sizes="100vw"
          priority
          className="object-cover"
        />
      </div>
      <SideBand left />
      <SideBand left={false} />
    </div>
  );
}

export default LoginBackdrop;
