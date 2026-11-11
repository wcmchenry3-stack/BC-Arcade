/**
 * #3572: a card in flight is transparent in its pile, but the view its gesture is attached to
 * (the `ref` and `collapsable` RNGH's GestureDetector clones onto DraggableCard's child) stays
 * opaque: iOS Fabric and RNGH on Android skip a view under alpha 0.01 when they hit-test, so a
 * transparent gesture view would drop a tap or a drag on a card mid-flight or mid-turn.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { render } from "@testing-library/react-native";

import { TransparentFace } from "../TransparentFace";
import { CardFlightContext, createCardFlightStore, HiddenWhileFlying } from "../cardFlights";
import type { FlightSpec } from "../cardMotion";

const opacity = (el: { props: { style?: unknown } }) =>
  StyleSheet.flatten(el.props.style as never)?.opacity;

const spec: FlightSpec = {
  key: "hearts-6",
  card: { suit: "hearts", rank: 6, faceUp: true },
  from: { x: 0, y: 0 },
  to: { x: 10, y: 0 },
  fromFaceUp: true,
  toFaceUp: true,
  delayMs: 0,
  durationMs: 200,
};

/** As GestureDetector hands it on: `collapsable: false` and its ref. */
const gestureRef = React.createRef<View>();

it("a card in flight: its gesture view stays opaque, only the face inside is transparent", async () => {
  const store = createCardFlightStore();
  store.launch([spec], 0, 1);
  const onPress = jest.fn();
  const api = await render(
    <CardFlightContext.Provider value={store}>
      <HiddenWhileFlying cardKey="hearts-6" collapsable={false} ref={gestureRef} onPress={onPress}>
        <Text testID="face">6♥</Text>
      </HiddenWhileFlying>
    </CardFlightContext.Provider>
  );
  // The face's view, then the gesture's view around it.
  const gestureView = api.getByTestId("face").parent!.parent!;
  expect(gestureView.props.collapsable).toBe(false);
  expect(opacity(gestureView)).toBeUndefined();
  // The face: transparent, and still given DraggableCard's test-mode onPress.
  const face = api.getByTestId("face");
  expect(face.props.onPress).toBe(onPress);
  expect(opacity(face.parent!)).toBe(0);
});

it("TransparentFace (the foundation's top card) keeps its gesture view opaque too", async () => {
  const api = await render(
    <TransparentFace hidden collapsable={false} ref={gestureRef}>
      <Text testID="face">K♣</Text>
    </TransparentFace>
  );
  // The face's view, then the gesture's view around it.
  const gestureView = api.getByTestId("face").parent!.parent!;
  expect(gestureView.props.collapsable).toBe(false);
  expect(opacity(gestureView)).toBeUndefined();
  expect(opacity(api.getByTestId("face").parent!)).toBe(0);
});

it("a card not in flight is drawn as it is", async () => {
  const store = createCardFlightStore();
  const api = await render(
    <CardFlightContext.Provider value={store}>
      <HiddenWhileFlying cardKey="hearts-6">
        <Text testID="face">6♥</Text>
      </HiddenWhileFlying>
    </CardFlightContext.Provider>
  );
  expect(opacity(api.getByTestId("face").parent!)).toBeUndefined();
});
