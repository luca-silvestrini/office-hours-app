# Brand assets

    crest.png    the Newman Center shield — used in the page header and on
                 the login screen

## Requirements

- **Transparent background (PNG).** The header is a solid blue bar, so an
  image saved with its own white or dark background will show as a rectangle
  behind the shield. If the copy you have is on a dark background, remove it
  before saving.
- Portrait orientation, roughly 1:1.15 (the shield's natural shape). The
  layout uses a fixed height with automatic width, so any ratio displays
  without distortion.
- ~400px tall is plenty; it renders at 36px in the header and 80px on the
  login page.

An SVG (`crest.svg`) would be sharper at any size — if the Newman Center has
a vector version of the crest, prefer it and change the filename in
`src/app/page.tsx` and `src/app/login/page.tsx`.
