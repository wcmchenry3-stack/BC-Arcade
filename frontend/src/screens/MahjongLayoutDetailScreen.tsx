import React, { useEffect, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle } from "react-native-reanimated";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import { useNavigation, useRoute } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RouteProp } from "@react-navigation/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HomeStackParamList } from "../../App";
import { getLayout, LAYOUTS } from "../game/mahjong/layouts/registry";
import { createGame } from "../game/mahjong/engine";
import { useMahjongCamera } from "../game/mahjong/layout";
import { computeZoomBounds, clamp } from "../game/mahjong/zoom";
import { GameShell } from "../components/shared/GameShell";
import GameCanvas from "../components/mahjong/GameCanvas";

const NOOP = () => {};

export default function MahjongLayoutDetailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const route = useRoute<RouteProp<HomeStackParamList, "MahjongLayoutDetail">>();
  const insets = useSafeAreaInsets();
  const { layoutId } = route.params;

  const meta = LAYOUTS.find((m) => m.id === layoutId);
  const layout = useMemo(() => getLayout(layoutId), [layoutId]);
  const state = useMemo(() => createGame(layout), [layout]);
  const camera = useMahjongCamera(layout);

  const { minZoom: initMin, maxZoom: initMax } = computeZoomBounds(camera.scale, camera.tileWidth);
  const minZoom = useSharedValue(initMin);
  const maxZoom = useSharedValue(initMax);
  const zoomScale = useSharedValue(initMin);
  const baseScale = useSharedValue(initMin);
  const translateX = useSharedValue(0);
  const baseTranslateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const baseTranslateY = useSharedValue(0);

  useEffect(() => {
    const bounds = computeZoomBounds(camera.scale, camera.tileWidth);
    minZoom.value = bounds.minZoom;
    maxZoom.value = bounds.maxZoom;
    zoomScale.value = bounds.minZoom;
    baseScale.value = bounds.minZoom;
    translateX.value = 0;
    baseTranslateX.value = 0;
    translateY.value = 0;
    baseTranslateY.value = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.scale, camera.tileWidth]);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      zoomScale.value = clamp(baseScale.value * e.scale, minZoom.value, maxZoom.value);
    })
    .onEnd(() => {
      baseScale.value = zoomScale.value;
    });

  const panGesture = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .activeOffsetX([-8, 8])
    .activeOffsetY([-8, 8])
    .onUpdate((e) => {
      translateX.value = baseTranslateX.value + e.translationX;
      translateY.value = baseTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      baseTranslateX.value = translateX.value;
      baseTranslateY.value = translateY.value;
    });

  const boardGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const gestureAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: zoomScale.value },
    ],
  }));

  const tierLabel = meta ? `T${meta.tier} · ${meta.tileCount} tiles` : "";

  return (
    <GameShell
      title={meta?.name ?? layoutId}
      requireBack
      onBack={() => navigation.goBack()}
      style={{ paddingBottom: Math.max(insets.bottom, 16) }}
    >
      <View style={styles.content}>
        {tierLabel ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>{tierLabel}</Text>
          </View>
        ) : null}

        <View
          style={{
            width: camera.viewportWidth,
            height: camera.viewportHeight,
            overflow: "hidden",
            alignSelf: "center",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <GestureDetector gesture={boardGesture}>
            <Animated.View
              style={[{ width: camera.boardWidth, height: camera.boardHeight }, gestureAnimStyle]}
            >
              <GameCanvas
                state={state}
                camera={camera}
                onTilePress={NOOP}
                onShufflePress={NOOP}
                onNewGamePress={NOOP}
              />
            </Animated.View>
          </GestureDetector>
        </View>
      </View>
    </GameShell>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    alignItems: "center",
  },
  metaRow: {
    paddingVertical: 6,
  },
  metaText: {
    color: "#8090c0",
    fontSize: 13,
    fontWeight: "600",
  },
});
