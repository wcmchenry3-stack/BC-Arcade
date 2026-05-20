// Cascade image registry.
//
// Two variants per theme:
//   icons — WebP with transparent background, for React Native <Image> in UI (menus, pickers)
//   baked — PNG pre-composited + clipped sprites, for Skia canvas rendering
//
// Metro resolves imports at bundle time; asset paths must be static literals.

// --- Fruit icons (UI display) ---
import _cherryIcon from "../../../assets/fruit-icons/cherry.webp";
import _blueberryIcon from "../../../assets/fruit-icons/blueberry.webp";
import _lemonIcon from "../../../assets/fruit-icons/lemon.webp";
import _grapesIcon from "../../../assets/fruit-icons/grapes.webp";
import _orangeIcon from "../../../assets/fruit-icons/orange.webp";
import _appleIcon from "../../../assets/fruit-icons/apple.webp";
import _peachIcon from "../../../assets/fruit-icons/peach.webp";
import _coconutIcon from "../../../assets/fruit-icons/coconut.webp";
import _dragonfruitIcon from "../../../assets/fruit-icons/dragonfruit.webp";
import _pineappleIcon from "../../../assets/fruit-icons/pineapple.webp";
import _watermelonIcon from "../../../assets/fruit-icons/watermelon.webp";
// pumpkin retained — intentional, future game tier
import _pumpkinIcon from "../../../assets/fruit-icons/pumpkin.webp";

// --- Fruit baked sprites (Skia canvas, WebP sets for runtime rendering) ---
import _cherryBaked from "../../../assets/fruits-baked/cherry.png";
import _blueberryBaked from "../../../assets/fruits-baked/blueberry.png";
import _lemonBaked from "../../../assets/fruits-baked/lemon.png";
import _grapesBaked from "../../../assets/fruits-baked/grapes.png";
import _orangeBaked from "../../../assets/fruits-baked/orange.png";
import _appleBaked from "../../../assets/fruits-baked/apple.png";
import _peachBaked from "../../../assets/fruits-baked/peach.png";
import _coconutBaked from "../../../assets/fruits-baked/coconut.png";
import _dragonfruitBaked from "../../../assets/fruits-baked/dragonfruit.png";
import _pineappleBaked from "../../../assets/fruits-baked/pineapple.png";
import _watermelonBaked from "../../../assets/fruits-baked/watermelon.png";
// pumpkin retained — intentional, future game tier (baked PNG sets for Skia vertex pipeline)
import _pumpkinBaked from "../../../assets/fruits-baked/pumpkin.png";

// --- Celestial icons (UI display) ---
import _moonIcon from "../../../assets/celestial-icons/moon.webp";
import _plutoIcon from "../../../assets/celestial-icons/pluto.webp";
import _mercuryIcon from "../../../assets/celestial-icons/mercury.webp";
import _marsIcon from "../../../assets/celestial-icons/mars.webp";
import _venusIcon from "../../../assets/celestial-icons/venus.webp";
import _earthIcon from "../../../assets/celestial-icons/earth.webp";
import _neptuneIcon from "../../../assets/celestial-icons/neptune.webp";
import _uranusIcon from "../../../assets/celestial-icons/uranus.webp";
import _saturnIcon from "../../../assets/celestial-icons/saturn.webp";
import _jupiterIcon from "../../../assets/celestial-icons/jupiter.webp";
import _sunIcon from "../../../assets/celestial-icons/sun.webp";
import _milkyWayIcon from "../../../assets/celestial-icons/milkyway.webp";

// --- Cosmos baked sprites (Skia canvas, baked PNG sets for Skia vertex pipeline) ---
import _moonBaked from "../../../assets/cosmos-baked/moon.png";
import _plutoBaked from "../../../assets/cosmos-baked/pluto.png";
import _mercuryBaked from "../../../assets/cosmos-baked/mercury.png";
import _marsBaked from "../../../assets/cosmos-baked/mars.png";
import _venusBaked from "../../../assets/cosmos-baked/venus.png";
import _earthBaked from "../../../assets/cosmos-baked/earth.png";
import _neptuneBaked from "../../../assets/cosmos-baked/neptune.png";
import _uranusBaked from "../../../assets/cosmos-baked/uranus.png";
import _saturnBaked from "../../../assets/cosmos-baked/saturn.png";
import _jupiterBaked from "../../../assets/cosmos-baked/jupiter.png";
import _sunBaked from "../../../assets/cosmos-baked/sun.png";
import _milkyWayBaked from "../../../assets/cosmos-baked/milkyway.png";

export const FRUIT_ICONS = {
  cherry: _cherryIcon,
  blueberry: _blueberryIcon,
  lemon: _lemonIcon,
  grape: _grapesIcon,
  orange: _orangeIcon,
  apple: _appleIcon,
  peach: _peachIcon,
  coconut: _coconutIcon,
  dragonfruit: _dragonfruitIcon,
  pineapple: _pineappleIcon,
  watermelon: _watermelonIcon,
  pumpkin: _pumpkinIcon,
} as const;

export const FRUIT_BAKED = {
  cherry: _cherryBaked,
  blueberry: _blueberryBaked,
  lemon: _lemonBaked,
  grape: _grapesBaked,
  orange: _orangeBaked,
  apple: _appleBaked,
  peach: _peachBaked,
  coconut: _coconutBaked,
  dragonfruit: _dragonfruitBaked,
  pineapple: _pineappleBaked,
  watermelon: _watermelonBaked,
  pumpkin: _pumpkinBaked,
} as const;

export const COSMOS_ICONS = {
  moon: _moonIcon,
  pluto: _plutoIcon,
  mercury: _mercuryIcon,
  mars: _marsIcon,
  venus: _venusIcon,
  earth: _earthIcon,
  neptune: _neptuneIcon,
  uranus: _uranusIcon,
  saturn: _saturnIcon,
  jupiter: _jupiterIcon,
  sun: _sunIcon,
  milkyWay: _milkyWayIcon,
} as const;

export const COSMOS_BAKED = {
  moon: _moonBaked,
  pluto: _plutoBaked,
  mercury: _mercuryBaked,
  mars: _marsBaked,
  venus: _venusBaked,
  earth: _earthBaked,
  neptune: _neptuneBaked,
  uranus: _uranusBaked,
  saturn: _saturnBaked,
  jupiter: _jupiterBaked,
  sun: _sunBaked,
  milkyWay: _milkyWayBaked,
} as const;
