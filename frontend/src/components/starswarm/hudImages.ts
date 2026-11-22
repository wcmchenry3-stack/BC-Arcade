/**
 * The ship and power-up art the React Native overlays show as plain images: the ship picker's
 * previews (#3600) and, since #3598, the HUD's mini lives ships and the power-up timer's chip.
 * The same generated sprites the canvas draws (`assets/starswarm/`), one import each.
 */
import type { ShipId } from "../../game/starswarm/render/ship";

import p1Base from "../../../assets/starswarm/player/p1-base.webp";
import p2Base from "../../../assets/starswarm/player/p2-base.webp";
import p3Base from "../../../assets/starswarm/player/p3-base.webp";
import puShield from "../../../assets/starswarm/pickup/shield.webp";
import puLightning from "../../../assets/starswarm/pickup/lightning.webp";

/** Each ship's base layer: the hull, no guns or plating. */
export const SHIP_BASE_IMAGE: Readonly<Record<ShipId, number>> = {
  p1: p1Base,
  p2: p2Base,
  p3: p3Base,
};

/** The duration power-ups' hex chip tokens (#3595), for the HUD timer. */
export const POWER_UP_ICON: Readonly<Record<"shield" | "lightning", number>> = {
  shield: puShield,
  lightning: puLightning,
};
