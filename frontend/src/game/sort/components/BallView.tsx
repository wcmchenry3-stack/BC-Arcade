import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Path, Polygon, Rect } from "react-native-svg";
import { useTranslation } from "react-i18next";
import type { Color } from "../types";
import { useTheme } from "../../../theme/ThemeContext";
import { BOTTLE_LIQUID_COLORS } from "../../../theme/theme.bottle";

export const BALL_SIZE = 36;

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
function ArrowSymbol() {
  return <Polygon points="50,5 80,42 65,42 65,90 35,90 35,42 20,42" fill={SYMBOL_FILL} />;
}
function HeartSymbol() {
  return (
    <Path
      d="M50,80 C25,62 5,44 5,30 C5,15 16,8 30,8 C40,8 48,16 50,20 C52,16 60,8 70,8 C84,8 95,15 95,30 C95,44 75,62 50,80 Z"
      fill={SYMBOL_FILL}
    />
  );
}
function ShieldSymbol() {
  return (
    <Path
      d="M50,5 L88,22 L88,55 C88,75 50,95 50,95 C50,95 12,75 12,55 L12,22 Z"
      fill={SYMBOL_FILL}
    />
  );
}
function BoltSymbol() {
  return <Polygon points="60,5 22,55 48,55 40,95 78,45 52,45" fill={SYMBOL_FILL} />;
}
function RingSymbol() {
  return (
    <Path
      fillRule="evenodd"
      d="M50,8 C71,8 92,29 92,50 C92,71 71,92 50,92 C29,92 8,71 8,50 C8,29 29,8 50,8 Z M50,30 C39,30 30,39 30,50 C30,61 39,70 50,70 C61,70 70,61 70,50 C70,39 61,30 50,30 Z"
      fill={SYMBOL_FILL}
    />
  );
}
function HourglassSymbol() {
  return <Polygon points="10,8 90,8 55,50 90,92 10,92 45,50" fill={SYMBOL_FILL} />;
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
  brown: ArrowSymbol,
  lime: HeartSymbol,
  navy: ShieldSymbol,
  maroon: BoltSymbol,
  gold: RingSymbol,
  indigo: HourglassSymbol,
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
  const { theme } = useTheme();
  const ballColors = BOTTLE_LIQUID_COLORS[theme];
  const Symbol = SYMBOLS[color];

  return (
    <View
      accessible
      accessibilityLabel={t(`color.${color}` as const)}
      style={[
        styles.ball,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: ballColors[color] },
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
