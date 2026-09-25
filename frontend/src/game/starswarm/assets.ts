import { useImage } from "@shopify/react-native-skia";
import type { SkImage } from "@shopify/react-native-skia";
import type { LoadedSprites } from "./render/frame";
import type { DrawImages } from "./render/drawFrame";

import playerShipSrc from "../../../assets/starswarm/player-ship.webp";
import buddyShipSrc from "../../../assets/starswarm/buddy-ship.webp";
import enemyGruntSrc from "../../../assets/starswarm/enemy-grunt.webp";
import enemyEliteSrc from "../../../assets/starswarm/enemy-elite.webp";
import enemyBossSrc from "../../../assets/starswarm/enemy-boss.webp";
import enemyCarrierSrc from "../../../assets/starswarm/enemy-carrier.webp";
import bulletPlayerSrc from "../../../assets/starswarm/bullet-player.webp";
import bulletEnemySrc from "../../../assets/starswarm/bullet-enemy.webp";
import bulletChargeSrc from "../../../assets/starswarm/bullet-charge.webp";
import puShieldSrc from "../../../assets/starswarm/powerups/shield_gold.png";
import puBombSrc from "../../../assets/starswarm/powerups/space-missiles-018.png";
import puBuddySrc from "../../../assets/starswarm/powerups/player-life.png";
import puLightningSrc from "../../../assets/starswarm/powerups/bolt_gold.png";
import explosionFrame00 from "../../../assets/starswarm/explosion/frame00.png";
import explosionFrame01 from "../../../assets/starswarm/explosion/frame01.png";
import explosionFrame02 from "../../../assets/starswarm/explosion/frame02.png";
import explosionFrame03 from "../../../assets/starswarm/explosion/frame03.png";
import explosionFrame04 from "../../../assets/starswarm/explosion/frame04.png";
import explosionFrame05 from "../../../assets/starswarm/explosion/frame05.png";
import explosionFrame06 from "../../../assets/starswarm/explosion/frame06.png";
import explosionFrame07 from "../../../assets/starswarm/explosion/frame07.png";
import explosionFrame08 from "../../../assets/starswarm/explosion/frame08.png";
import explosionFrame09 from "../../../assets/starswarm/explosion/frame09.png";
import explosionFrame10 from "../../../assets/starswarm/explosion/frame10.png";
import explosionFrame11 from "../../../assets/starswarm/explosion/frame11.png";
import explosionFrame12 from "../../../assets/starswarm/explosion/frame12.png";
import explosionFrame13 from "../../../assets/starswarm/explosion/frame13.png";
import explosionFrame14 from "../../../assets/starswarm/explosion/frame14.png";
import explosionFrame15 from "../../../assets/starswarm/explosion/frame15.png";
import explosionFrame16 from "../../../assets/starswarm/explosion/frame16.png";
import explosionFrame17 from "../../../assets/starswarm/explosion/frame17.png";
import explosionFrame18 from "../../../assets/starswarm/explosion/frame18.png";
import explosionFrame19 from "../../../assets/starswarm/explosion/frame19.png";

export interface StarSwarmImages {
  playerShip: SkImage | null;
  buddyShip: SkImage | null;
  enemyGrunt: SkImage | null;
  enemyElite: SkImage | null;
  enemyBoss: SkImage | null;
  enemyCarrier: SkImage | null;
  bulletPlayer: SkImage | null;
  bulletEnemy: SkImage | null;
  bulletCharge: SkImage | null;
  /** 20-frame fire explosion strip; null slots fall back to procedural particle burst. */
  explosionFrames: (SkImage | null)[];
  puShield: SkImage | null;
  puBomb: SkImage | null;
  puBuddy: SkImage | null;
  puLightning: SkImage | null;
}

export function useStarSwarmImages(): StarSwarmImages {
  const playerShip = useImage(playerShipSrc);
  const buddyShip = useImage(buddyShipSrc);
  const enemyGrunt = useImage(enemyGruntSrc);
  const enemyElite = useImage(enemyEliteSrc);
  const enemyBoss = useImage(enemyBossSrc);
  const enemyCarrier = useImage(enemyCarrierSrc);
  const bulletPlayer = useImage(bulletPlayerSrc);
  const bulletEnemy = useImage(bulletEnemySrc);
  const bulletCharge = useImage(bulletChargeSrc);
  const puShield = useImage(puShieldSrc);
  const puBomb = useImage(puBombSrc);
  const puBuddy = useImage(puBuddySrc);
  const puLightning = useImage(puLightningSrc);
  const f00 = useImage(explosionFrame00);
  const f01 = useImage(explosionFrame01);
  const f02 = useImage(explosionFrame02);
  const f03 = useImage(explosionFrame03);
  const f04 = useImage(explosionFrame04);
  const f05 = useImage(explosionFrame05);
  const f06 = useImage(explosionFrame06);
  const f07 = useImage(explosionFrame07);
  const f08 = useImage(explosionFrame08);
  const f09 = useImage(explosionFrame09);
  const f10 = useImage(explosionFrame10);
  const f11 = useImage(explosionFrame11);
  const f12 = useImage(explosionFrame12);
  const f13 = useImage(explosionFrame13);
  const f14 = useImage(explosionFrame14);
  const f15 = useImage(explosionFrame15);
  const f16 = useImage(explosionFrame16);
  const f17 = useImage(explosionFrame17);
  const f18 = useImage(explosionFrame18);
  const f19 = useImage(explosionFrame19);

  return {
    playerShip,
    buddyShip,
    enemyGrunt,
    enemyElite,
    enemyBoss,
    enemyCarrier,
    bulletPlayer,
    bulletEnemy,
    bulletCharge,
    puShield,
    puBomb,
    puBuddy,
    puLightning,
    explosionFrames: [
      f00,
      f01,
      f02,
      f03,
      f04,
      f05,
      f06,
      f07,
      f08,
      f09,
      f10,
      f11,
      f12,
      f13,
      f14,
      f15,
      f16,
      f17,
      f18,
      f19,
    ],
  };
}

/** #2564: which sprites have loaded — the frame builder draws a fallback for any that haven't. */
export function loadedSprites(images: StarSwarmImages): LoadedSprites {
  return {
    playerShip: images.playerShip !== null,
    buddyShip: images.buddyShip !== null,
    enemyGrunt: images.enemyGrunt !== null,
    enemyElite: images.enemyElite !== null,
    enemyBoss: images.enemyBoss !== null,
    enemyCarrier: images.enemyCarrier !== null,
    bulletPlayer: images.bulletPlayer !== null,
    puShield: images.puShield !== null,
    puBomb: images.puBomb !== null,
    puBuddy: images.puBuddy !== null,
    puLightning: images.puLightning !== null,
    explosion: images.explosionFrames.map((f) => f !== null),
  };
}

/** #2565: the sprite set the UI-thread renderer draws with, keyed like the display list. */
export function drawImagesOf(images: StarSwarmImages): DrawImages {
  return {
    playerShip: images.playerShip,
    buddyShip: images.buddyShip,
    enemyGrunt: images.enemyGrunt,
    enemyElite: images.enemyElite,
    enemyBoss: images.enemyBoss,
    enemyCarrier: images.enemyCarrier,
    bulletPlayer: images.bulletPlayer,
    puShield: images.puShield,
    puBomb: images.puBomb,
    puBuddy: images.puBuddy,
    puLightning: images.puLightning,
    explosion: images.explosionFrames,
  };
}

/** #2565: same images, same slots — so the picture worklet is rebuilt only when one loads. */
export function sameDrawImages(a: DrawImages, b: DrawImages): boolean {
  const keys = Object.keys(a) as (keyof DrawImages)[];
  for (const k of keys) {
    if (k === "explosion") continue;
    if (a[k] !== b[k]) return false;
  }
  if (a.explosion.length !== b.explosion.length) return false;
  for (let i = 0; i < a.explosion.length; i++) {
    if (a.explosion[i] !== b.explosion[i]) return false;
  }
  return true;
}
