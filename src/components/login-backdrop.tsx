import Image from "next/image";

/**
 * Login-page backdrop — Old St. Mary's, covering the full viewport behind the
 * sign-in card. This replaces the Mary/Joseph side panels on login; those are
 * still used on the dashboard (see side-devotion.tsx).
 *
 * A single horizontal mask keeps the middle at full strength and dissolves
 * only the left and right edges. No vertical fade is needed: the image covers
 * the viewport, so its top and bottom meet the screen edges and there's no
 * rectangle boundary to hide.
 */
const FADE_SIDES =
  "linear-gradient(to right, transparent 0%, #000 22%, #000 78%, transparent 100%)";

export function LoginBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="relative h-full w-full opacity-60"
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
          src="/devotion/old-st-marys.png"
          alt="Old St. Mary's"
          fill
          sizes="100vw"
          priority
          className="object-cover"
        />
      </div>
    </div>
  );
}

export default LoginBackdrop;
