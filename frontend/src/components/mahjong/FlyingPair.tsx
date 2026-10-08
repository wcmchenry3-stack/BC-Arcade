import React, { useEffect } from "react";
import { Image, Platform, View } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withSequence,
  withDelay,
  runOnJS,
  Easing,
} from "react-native-reanimated";

import type { BoardCamera } from "../../game/mahjong/layout";
import type { SlotTile } from "../../game/mahjong/types";

// ---------------------------------------------------------------------------
// FlyingPair — two matched tiles slide toward each other then burst and fade
// ---------------------------------------------------------------------------

export interface FlyingPairData {
  id: string;
  tile1: SlotTile;
  tile2: SlotTile;
}

// Colors that match the canvas tile rendering.
const FP_FACE = "#f5f0e8";
const FP_BORDER = "#ffd700";
const FP_SIDE_R = "#a89070";
const FP_SIDE_B = "#987860";
// Border inset between the gold frame and the ivory face, in logical pixels.
const FACE_INSET = 2;

function FlyingTileGlyph({
  faceWidth: fw,
  faceHeight: fh,
  sideWidth: sw,
  imgUri,
}: {
  faceWidth: number;
  faceHeight: number;
  sideWidth: number;
  imgUri: string | null;
}) {
  return (
    // overflow: "visible" is intentional so the 3-D side panels render outside
    // the face bounds. Note: Android clips overflow in deeply nested Views by
    // default, so the side shadows won't appear on native until the parent
    // Animated.View chain also carries overflow: "visible".
    <View style={{ width: fw, height: fh, overflow: "visible" }}>
      {/* 3-D right side */}
      <View
        style={{
          position: "absolute",
          left: fw,
          top: sw,
          width: sw,
          height: fh,
          backgroundColor: FP_SIDE_R,
        }}
      />
      {/* 3-D bottom side */}
      <View
        style={{
          position: "absolute",
          left: sw,
          top: fh,
          width: fw,
          height: sw,
          backgroundColor: FP_SIDE_B,
        }}
      />
      {/* Gold border (selected-tile look) */}
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: fw,
          height: fh,
          backgroundColor: FP_BORDER,
          borderRadius: 2,
        }}
      />
      {/* Ivory face */}
      <View
        style={{
          position: "absolute",
          left: FACE_INSET,
          top: FACE_INSET,
          width: fw - FACE_INSET * 2,
          height: fh - FACE_INSET * 2,
          backgroundColor: FP_FACE,
          borderRadius: 1,
          overflow: "hidden",
        }}
      >
        {/* SVG art — only on web where RN Image renders SVG via <img> */}
        {Platform.OS === "web" && imgUri !== null && (
          <Image
            source={{ uri: imgUri }}
            style={{
              position: "absolute",
              left: FACE_INSET,
              top: FACE_INSET,
              right: FACE_INSET,
              bottom: FACE_INSET,
            }}
            resizeMode="contain"
          />
        )}
      </View>
    </View>
  );
}

export default function FlyingPair({
  tile1,
  tile2,
  camera,
  tileUris,
  onDone,
}: FlyingPairData & {
  camera: BoardCamera;
  tileUris: readonly (string | null)[];
  onDone: () => void;
}) {
  const { x: x1, y: y1 } = camera.tileToScreen(tile1.col, tile1.row, tile1.layer);
  const { x: x2, y: y2 } = camera.tileToScreen(tile2.col, tile2.row, tile2.layer);
  const { faceWidth: fw, faceHeight: fh, sideWidth: sw } = camera;

  // Face-center coords so the overlay aligns exactly with the canvas tile face.
  const c1x = x1 + fw / 2;
  const c1y = y1 + fh / 2;
  const c2x = x2 + fw / 2;
  const c2y = y2 + fh / 2;
  const midX = (c1x + c2x) / 2;
  const midY = (c1y + c2y) / 2;
  const burstR = Math.round(fw * 0.65);

  const t1cx = useSharedValue(c1x);
  const t1cy = useSharedValue(c1y);
  const t2cx = useSharedValue(c2x);
  const t2cy = useSharedValue(c2y);
  const pairOpacity = useSharedValue(1);
  const burstScaleVal = useSharedValue(0);
  const burstOpacity = useSharedValue(0);

  useEffect(() => {
    const moveCfg = { duration: 220, easing: Easing.out(Easing.quad) };
    t1cx.value = withTiming(midX, moveCfg);
    t1cy.value = withTiming(midY, moveCfg);
    t2cx.value = withTiming(midX, moveCfg);
    t2cy.value = withTiming(midY, moveCfg);
    // Hold fully visible through the slide, then snap-fade after meeting.
    pairOpacity.value = withSequence(
      withTiming(1, { duration: 220 }),
      withTiming(0, { duration: 70 }, (finished) => {
        if (finished) runOnJS(onDone)();
      })
    );
    burstScaleVal.value = withDelay(220, withSpring(1.8, { damping: 7, stiffness: 100 }));
    burstOpacity.value = withSequence(
      withDelay(220, withTiming(0.9, { duration: 25 })),
      withTiming(0, { duration: 85 })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tile1Style = useAnimatedStyle(() => ({
    position: "absolute",
    left: t1cx.value - fw / 2,
    top: t1cy.value - fh / 2,
    opacity: pairOpacity.value,
  }));

  const tile2Style = useAnimatedStyle(() => ({
    position: "absolute",
    left: t2cx.value - fw / 2,
    top: t2cy.value - fh / 2,
    opacity: pairOpacity.value,
  }));

  const burstStyle = useAnimatedStyle(() => ({
    position: "absolute",
    left: midX - burstR,
    top: midY - burstR,
    width: burstR * 2,
    height: burstR * 2,
    borderRadius: burstR,
    backgroundColor: FP_BORDER,
    transform: [{ scale: burstScaleVal.value }],
    opacity: burstOpacity.value,
  }));

  const img1 = tileUris[tile1.faceId - 1] ?? null;
  const img2 = tileUris[tile2.faceId - 1] ?? null;

  return (
    <>
      <Animated.View pointerEvents="none" style={tile1Style}>
        <FlyingTileGlyph faceWidth={fw} faceHeight={fh} sideWidth={sw} imgUri={img1} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={tile2Style}>
        <FlyingTileGlyph faceWidth={fw} faceHeight={fh} sideWidth={sw} imgUri={img2} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={burstStyle} />
    </>
  );
}
