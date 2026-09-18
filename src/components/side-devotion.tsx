import Image from "next/image";

/**
 * Decorative side panels — Our Lady on the left, St. Joseph on the right.
 * Files live at public/devotion/{mary,joseph}.jpg.
 *
 * The images run the full height of the viewport and are cover-cropped to the
 * narrow margin, so each reads as a tall strip of the painting rather than a
 * complete framed figure. `object-position` picks which vertical slice shows —
 * adjust the `focus` value per image if a face ends up outside the strip.
 *
 * Masking: a strong fade inward toward the page content (so text never sits on
 * busy artwork) plus a light feather at top and bottom (so the strip meets the
 * viewport edge without a hard line).
 *
 * Purely decorative: aria-hidden, and only shown from xl up — below that the
 * schedule needs the full width.
 */
const PANELS = [
  { side: "left", src: "/devotion/mary.jpg", alt: "Our Lady", focus: "50% 35%" },
  { side: "right", src: "/devotion/joseph.jpg", alt: "Saint Joseph", focus: "50% 35%" },
] as const;

const fadeToward = (isLeft: boolean) =>
  `linear-gradient(to ${isLeft ? "right" : "left"}, #000 0%, #000 55%, transparent 100%)`;

const FADE_VERTICAL =
  "linear-gradient(to bottom, transparent 0%, #000 7%, #000 93%, transparent 100%)";

export function SideDevotion() {
  return (
    <>
      {PANELS.map(({ side, src, alt, focus }) => {
        const isLeft = side === "left";
        return (
          <div
            key={side}
            aria-hidden="true"
            className={`pointer-events-none fixed inset-y-0 z-0 hidden select-none xl:block ${
              isLeft ? "left-0" : "right-0"
            } w-[clamp(9rem,15vw,20rem)]`}
          >
            <div
              className="relative h-full w-full opacity-[0.65]"
              style={{
                maskImage: `${fadeToward(isLeft)}, ${FADE_VERTICAL}`,
                WebkitMaskImage: `${fadeToward(isLeft)}, ${FADE_VERTICAL}`,
                maskComposite: "intersect",
                WebkitMaskComposite: "source-in",
                maskRepeat: "no-repeat",
                WebkitMaskRepeat: "no-repeat",
                maskSize: "100% 100%",
                WebkitMaskSize: "100% 100%",
              }}
            >
              <Image
                src={src}
                alt={alt}
                fill
                sizes="(min-width: 1280px) 20rem, 0px"
                className="object-cover"
                style={{ objectPosition: focus }}
                priority={false}
              />
            </div>
          </div>
        );
      })}
    </>
  );
}

export default SideDevotion;
