import React, { useLayoutEffect, useState } from "react";
import type { StyleProp, TextStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

/**
 * How a particle's progress (0 → 1) shows on screen. Keep these as module
 * constants: the animated style closes over the object, so a new one each
 * render would rebuild it each render.
 */
export type ParticleMotion =
  /** A line rotated by `angle` that grows out along its length. */
  | { readonly kind: "ray"; readonly angle: number; readonly centerOrigin?: boolean }
  /** A glyph at offset (`x`, `y`) that scales up from nothing. */
  | { readonly kind: "pop"; readonly x: number; readonly y: number };

/**
 * The particles of one overlay. Each `Particle` registers its shared value
 * here on mount, so the overlay can animate all of them from its own effects
 * and timers (hooks cannot be called in a loop, so the values live in the
 * children).
 */
export interface ParticleGroup {
  readonly register: (index: number, value: SharedValue<number> | null) => void;
  /** The mounted particles' values, in index order. */
  readonly all: () => SharedValue<number>[];
}

function createParticleGroup(): ParticleGroup {
  const slots: (SharedValue<number> | null)[] = [];
  return {
    register: (index, value) => {
      slots[index] = value;
    },
    all: () => slots.filter((v): v is SharedValue<number> => v != null),
  };
}

/** A stable `ParticleGroup` for the life of the component. */
export function useParticleGroup(): ParticleGroup {
  return useState(createParticleGroup)[0];
}

interface ParticleProps {
  readonly index: number;
  readonly group: ParticleGroup;
  readonly motion: ParticleMotion;
  readonly style: StyleProp<TextStyle>;
  /** Renders the particle as this text (e.g. ★); without it, a plain view. */
  readonly glyph?: string;
}

/** One particle: owns a single shared value (progress) and its animated style. */
export function Particle({ index, group, motion, style, glyph }: ParticleProps) {
  const progress = useSharedValue(0);

  // Layout effect: registered before the overlay's own effects run.
  useLayoutEffect(() => {
    group.register(index, progress);
    return () => group.register(index, null);
  }, [group, index, progress]);

  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.value;
    if (motion.kind === "ray") {
      const transform = [{ rotate: `${motion.angle}deg` }, { scaleX: p }];
      return motion.centerOrigin
        ? { transform, opacity: p, transformOrigin: "center" }
        : { transform, opacity: p };
    }
    return {
      transform: [{ translateX: motion.x }, { translateY: motion.y }, { scale: p }],
      opacity: p,
    };
  });

  if (glyph === undefined) return <Animated.View style={[style, animatedStyle]} />;
  return <Animated.Text style={[style, animatedStyle]}>{glyph}</Animated.Text>;
}
