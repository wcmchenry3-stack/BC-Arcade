import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Path, Polygon, Rect } from "react-native-svg";
import { useTranslation } from "react-i18next";
import type { Color } from "../types";

export const BALL_SIZE = 36;

export const BALL_COLORS: Record<Color, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  purple: "#a855f7",
  pink: "#ec4899",
  teal: "#14b8a6",
};

// White symbols on a 100×100 viewBox — one per color for colorblind mode.
// Chosen to be distinct in shape even in greyscale.
const SYMBOL_FILL = "#ffffff";

function TriangleSymbol() {
  return <Polygon points="50,10 90,85 10,85" fill={SYMBOL_FILL} />;
}
function CircleSymbol() {
  return <Circle cx="50" cy="50" r="38" fill={SYMBOL_FILL} />;
}
function SquareSymbol() {
  return <Rect x="14" y="14" width="72" height="72" fill={SYMBOL_FILL} />;
}
function StarSymbol() {
  // 5-pointed star: outer r=40, inner r=16, center (50,50)
  return (
    <Polygon
      points="50,10 59,37 88,38 65,55 74,82 50,66 26,82 35,55 12,38 41,37"
      fill={SYMBOL_FILL}
    />
  );
}
function HexagonSymbol() {
  return <Polygon points="50,12 85,31 85,69 50,88 15,69 15,31" fill={SYMBOL_FILL} />;
}
function DiamondSymbol() {
  return <Polygon points="50,10 88,50 50,90 12,50" fill={SYMBOL_FILL} />;
}
function CrossSymbol() {
  return (
    <Path
      d="M34,8 L66,8 L66,34 L92,34 L92,66 L66,66 L66,92 L34,92 L34,66 L8,66 L8,34 L34,34 Z"
      fill={SYMBOL_FILL}
    />
  );
}
function PentagonSymbol() {
  return <Polygon points="50,10 88,38 73,82 27,82 12,38" fill={SYMBOL_FILL} />;
}

const SYMBOLS: Record<Color, React.FC> = {
  red: TriangleSymbol,
  blue: CircleSymbol,
  green: SquareSymbol,
  yellow: StarSymbol,
  orange: HexagonSymbol,
  purple: DiamondSymbol,
  pink: CrossSymbol,
  teal: PentagonSymbol,
};

export interface BallViewProps {
  readonly color: Color;
  readonly colorblindMode?: boolean;
  readonly size?: number;
}

export default function BallView({
  color,
  colorblindMode = false,
  size = BALL_SIZE,
}: BallViewProps) {
  const { t } = useTranslation("sort");
  const Symbol = SYMBOLS[color];

  return (
    <View
      accessible
      accessibilityLabel={t(`color.${color}` as const)}
      style={[
        styles.ball,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: BALL_COLORS[color] },
      ]}
    >
      {colorblindMode && (
        <Svg
          width={size * 0.6}
          height={size * 0.6}
          viewBox="0 0 100 100"
          style={{ position: "absolute", top: size * 0.2, left: size * 0.2 }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Symbol />
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  ball: {
    overflow: "hidden",
  },
});
