import { useImage } from "@shopify/react-native-skia";
import type { SkImage } from "@shopify/react-native-skia";
import type { LoadedSprites } from "./render/frame";
import type { DrawImages } from "./render/drawFrame";

import p1BaseSrc from "../../../assets/starswarm/player/p1-base.webp";
import p1Guns2Src from "../../../assets/starswarm/player/p1-guns2.webp";
import p1Guns3Src from "../../../assets/starswarm/player/p1-guns3.webp";
import p1Plating1Src from "../../../assets/starswarm/player/p1-plating1.webp";
import p1Plating2Src from "../../../assets/starswarm/player/p1-plating2.webp";
import p2BaseSrc from "../../../assets/starswarm/player/p2-base.webp";
import p2Guns2Src from "../../../assets/starswarm/player/p2-guns2.webp";
import p2Guns3Src from "../../../assets/starswarm/player/p2-guns3.webp";
import p2Plating1Src from "../../../assets/starswarm/player/p2-plating1.webp";
import p2Plating2Src from "../../../assets/starswarm/player/p2-plating2.webp";
import p3BaseSrc from "../../../assets/starswarm/player/p3-base.webp";
import p3Guns2Src from "../../../assets/starswarm/player/p3-guns2.webp";
import p3Guns3Src from "../../../assets/starswarm/player/p3-guns3.webp";
import p3Plating1Src from "../../../assets/starswarm/player/p3-plating1.webp";
import p3Plating2Src from "../../../assets/starswarm/player/p3-plating2.webp";
import buddyShipSrc from "../../../assets/starswarm/buddy-escort.webp";
import enemyGruntSrc from "../../../assets/starswarm/enemy/grunt.webp";
import enemyEliteSrc from "../../../assets/starswarm/enemy/elite.webp";
import enemyEliteAttackSrc from "../../../assets/starswarm/enemy/elite-attack.webp";
import enemyEliteHurtSrc from "../../../assets/starswarm/enemy/elite-hurt.webp";
import enemyGuardianSrc from "../../../assets/starswarm/enemy/guardian.webp";
import enemyGuardianPlateSrc from "../../../assets/starswarm/enemy/guardian-plate.webp";
import enemyGuardianCracksSrc from "../../../assets/starswarm/enemy/guardian-cracks.webp";
import enemyGuardianPlate2Src from "../../../assets/starswarm/enemy/guardian-plate2.webp";
import enemyCarrierSrc from "../../../assets/starswarm/enemy/carrier.webp";
import enemyCarrierCracksSrc from "../../../assets/starswarm/enemy/carrier-cracks.webp";
import bulletPlayerSrc from "../../../assets/starswarm/bullet-player.webp";
import bulletEnemySrc from "../../../assets/starswarm/bullet-enemy.webp";
import bulletChargeSrc from "../../../assets/starswarm/bullet-charge.webp";
import puShieldSrc from "../../../assets/starswarm/powerups/shield_gold.png";
import puBombSrc from "../../../assets/starswarm/powerups/space-missiles-018.png";
import puBuddySrc from "../../../assets/starswarm/powerups/player-life.png";
import puLightningSrc from "../../../assets/starswarm/powerups/bolt_gold.png";
import rockLarge1Src from "../../../assets/starswarm/rock/large-1.webp";
import rockLarge1VeinsSrc from "../../../assets/starswarm/rock/large-1-veins.webp";
import rockLarge2Src from "../../../assets/starswarm/rock/large-2.webp";
import rockLarge2VeinsSrc from "../../../assets/starswarm/rock/large-2-veins.webp";
import rockSmall1Src from "../../../assets/starswarm/rock/small-1.webp";
import rockSmall2Src from "../../../assets/starswarm/rock/small-2.webp";

export interface StarSwarmImages {
  /**
   * #3592: the player ship's layers (all three ships, #3600: P1, P2, P3 in that order, so the ship picker never waits on a load). Stacked in this
   * order by `render/ship.ts`.
   */
  p1Base: SkImage | null;
  p1Guns2: SkImage | null;
  p1Guns3: SkImage | null;
  p1Plating1: SkImage | null;
  p1Plating2: SkImage | null;
  p2Base: SkImage | null;
  p2Guns2: SkImage | null;
  p2Guns3: SkImage | null;
  p2Plating1: SkImage | null;
  p2Plating2: SkImage | null;
  p3Base: SkImage | null;
  p3Guns2: SkImage | null;
  p3Guns3: SkImage | null;
  p3Plating1: SkImage | null;
  p3Plating2: SkImage | null;
  buddyShip: SkImage | null;
  /** #3593: the hive's sprites and damage layers (`render/enemies.ts` picks them). */
  enemyGrunt: SkImage | null;
  enemyElite: SkImage | null;
  enemyEliteAttack: SkImage | null;
  enemyEliteHurt: SkImage | null;
  enemyGuardian: SkImage | null;
  enemyGuardianPlate: SkImage | null;
  enemyGuardianCracks: SkImage | null;
  enemyGuardianPlate2: SkImage | null;
  enemyCarrier: SkImage | null;
  enemyCarrierCracks: SkImage | null;
  bulletPlayer: SkImage | null;
  bulletEnemy: SkImage | null;
  bulletCharge: SkImage | null;
  puShield: SkImage | null;
  puBomb: SkImage | null;
  puBuddy: SkImage | null;
  puLightning: SkImage | null;
  /**
   * #3596: the rock shapes (neutral, tinted per rock at draw time) and the large ones' ore
   * veins (`render/asteroids.ts` picks them).
   */
  rockLarge1: SkImage | null;
  rockLarge1Veins: SkImage | null;
  rockLarge2: SkImage | null;
  rockLarge2Veins: SkImage | null;
  rockSmall1: SkImage | null;
  rockSmall2: SkImage | null;
}

export function useStarSwarmImages(): StarSwarmImages {
  const p1Base = useImage(p1BaseSrc);
  const p1Guns2 = useImage(p1Guns2Src);
  const p1Guns3 = useImage(p1Guns3Src);
  const p1Plating1 = useImage(p1Plating1Src);
  const p1Plating2 = useImage(p1Plating2Src);
  const p2Base = useImage(p2BaseSrc);
  const p2Guns2 = useImage(p2Guns2Src);
  const p2Guns3 = useImage(p2Guns3Src);
  const p2Plating1 = useImage(p2Plating1Src);
  const p2Plating2 = useImage(p2Plating2Src);
  const p3Base = useImage(p3BaseSrc);
  const p3Guns2 = useImage(p3Guns2Src);
  const p3Guns3 = useImage(p3Guns3Src);
  const p3Plating1 = useImage(p3Plating1Src);
  const p3Plating2 = useImage(p3Plating2Src);
  const buddyShip = useImage(buddyShipSrc);
  const enemyGrunt = useImage(enemyGruntSrc);
  const enemyElite = useImage(enemyEliteSrc);
  const enemyEliteAttack = useImage(enemyEliteAttackSrc);
  const enemyEliteHurt = useImage(enemyEliteHurtSrc);
  const enemyGuardian = useImage(enemyGuardianSrc);
  const enemyGuardianPlate = useImage(enemyGuardianPlateSrc);
  const enemyGuardianCracks = useImage(enemyGuardianCracksSrc);
  const enemyGuardianPlate2 = useImage(enemyGuardianPlate2Src);
  const enemyCarrier = useImage(enemyCarrierSrc);
  const enemyCarrierCracks = useImage(enemyCarrierCracksSrc);
  const bulletPlayer = useImage(bulletPlayerSrc);
  const bulletEnemy = useImage(bulletEnemySrc);
  const bulletCharge = useImage(bulletChargeSrc);
  const puShield = useImage(puShieldSrc);
  const puBomb = useImage(puBombSrc);
  const puBuddy = useImage(puBuddySrc);
  const puLightning = useImage(puLightningSrc);
  const rockLarge1 = useImage(rockLarge1Src);
  const rockLarge1Veins = useImage(rockLarge1VeinsSrc);
  const rockLarge2 = useImage(rockLarge2Src);
  const rockLarge2Veins = useImage(rockLarge2VeinsSrc);
  const rockSmall1 = useImage(rockSmall1Src);
  const rockSmall2 = useImage(rockSmall2Src);

  return {
    p1Base,
    p1Guns2,
    p1Guns3,
    p1Plating1,
    p1Plating2,
    p2Base,
    p2Guns2,
    p2Guns3,
    p2Plating1,
    p2Plating2,
    p3Base,
    p3Guns2,
    p3Guns3,
    p3Plating1,
    p3Plating2,
    buddyShip,
    enemyGrunt,
    enemyElite,
    enemyEliteAttack,
    enemyEliteHurt,
    enemyGuardian,
    enemyGuardianPlate,
    enemyGuardianCracks,
    enemyGuardianPlate2,
    enemyCarrier,
    enemyCarrierCracks,
    bulletPlayer,
    bulletEnemy,
    bulletCharge,
    puShield,
    puBomb,
    puBuddy,
    puLightning,
    rockLarge1,
    rockLarge1Veins,
    rockLarge2,
    rockLarge2Veins,
    rockSmall1,
    rockSmall2,
  };
}

/** #2564: which sprites have loaded — the frame builder draws a fallback for any that haven't. */
export function loadedSprites(images: StarSwarmImages): LoadedSprites {
  return {
    p1Base: images.p1Base !== null,
    p1Guns2: images.p1Guns2 !== null,
    p1Guns3: images.p1Guns3 !== null,
    p1Plating1: images.p1Plating1 !== null,
    p1Plating2: images.p1Plating2 !== null,
    p2Base: images.p2Base !== null,
    p2Guns2: images.p2Guns2 !== null,
    p2Guns3: images.p2Guns3 !== null,
    p2Plating1: images.p2Plating1 !== null,
    p2Plating2: images.p2Plating2 !== null,
    p3Base: images.p3Base !== null,
    p3Guns2: images.p3Guns2 !== null,
    p3Guns3: images.p3Guns3 !== null,
    p3Plating1: images.p3Plating1 !== null,
    p3Plating2: images.p3Plating2 !== null,
    buddyShip: images.buddyShip !== null,
    enemyGrunt: images.enemyGrunt !== null,
    enemyElite: images.enemyElite !== null,
    enemyEliteAttack: images.enemyEliteAttack !== null,
    enemyEliteHurt: images.enemyEliteHurt !== null,
    enemyGuardian: images.enemyGuardian !== null,
    enemyGuardianPlate: images.enemyGuardianPlate !== null,
    enemyGuardianCracks: images.enemyGuardianCracks !== null,
    enemyGuardianPlate2: images.enemyGuardianPlate2 !== null,
    enemyCarrier: images.enemyCarrier !== null,
    enemyCarrierCracks: images.enemyCarrierCracks !== null,
    bulletPlayer: images.bulletPlayer !== null,
    puShield: images.puShield !== null,
    puBomb: images.puBomb !== null,
    puBuddy: images.puBuddy !== null,
    puLightning: images.puLightning !== null,
    rockLarge1: images.rockLarge1 !== null,
    rockLarge1Veins: images.rockLarge1Veins !== null,
    rockLarge2: images.rockLarge2 !== null,
    rockLarge2Veins: images.rockLarge2Veins !== null,
    rockSmall1: images.rockSmall1 !== null,
    rockSmall2: images.rockSmall2 !== null,
  };
}

/** #2565: the sprite set the UI-thread renderer draws with, keyed like the display list. */
export function drawImagesOf(images: StarSwarmImages): DrawImages {
  return {
    p1Base: images.p1Base,
    p1Guns2: images.p1Guns2,
    p1Guns3: images.p1Guns3,
    p1Plating1: images.p1Plating1,
    p1Plating2: images.p1Plating2,
    p2Base: images.p2Base,
    p2Guns2: images.p2Guns2,
    p2Guns3: images.p2Guns3,
    p2Plating1: images.p2Plating1,
    p2Plating2: images.p2Plating2,
    p3Base: images.p3Base,
    p3Guns2: images.p3Guns2,
    p3Guns3: images.p3Guns3,
    p3Plating1: images.p3Plating1,
    p3Plating2: images.p3Plating2,
    buddyShip: images.buddyShip,
    enemyGrunt: images.enemyGrunt,
    enemyElite: images.enemyElite,
    enemyEliteAttack: images.enemyEliteAttack,
    enemyEliteHurt: images.enemyEliteHurt,
    enemyGuardian: images.enemyGuardian,
    enemyGuardianPlate: images.enemyGuardianPlate,
    enemyGuardianCracks: images.enemyGuardianCracks,
    enemyGuardianPlate2: images.enemyGuardianPlate2,
    enemyCarrier: images.enemyCarrier,
    enemyCarrierCracks: images.enemyCarrierCracks,
    bulletPlayer: images.bulletPlayer,
    puShield: images.puShield,
    puBomb: images.puBomb,
    puBuddy: images.puBuddy,
    puLightning: images.puLightning,
    rockLarge1: images.rockLarge1,
    rockLarge1Veins: images.rockLarge1Veins,
    rockLarge2: images.rockLarge2,
    rockLarge2Veins: images.rockLarge2Veins,
    rockSmall1: images.rockSmall1,
    rockSmall2: images.rockSmall2,
  };
}

/** #2565: same images, same slots — so the picture worklet is rebuilt only when one loads. */
export function sameDrawImages(a: DrawImages, b: DrawImages): boolean {
  const keys = Object.keys(a) as (keyof DrawImages)[];
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}
