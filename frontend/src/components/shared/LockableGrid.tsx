import React, { useRef } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

export interface LockableGridProps<T> {
  readonly title: string;
  /** Set to "header" to announce the title as a heading. */
  readonly titleAccessibilityRole?: "header";
  /** Label of the Continue button; the button is hidden when omitted. */
  readonly continueLabel?: string;
  readonly onContinue: () => void;
  readonly items: readonly T[];
  /** Cards per row; a short last row is padded so cards keep their width. */
  readonly columns: number;
  /** Gap between rows and between cards. */
  readonly gap: number;
  readonly keyOf: (item: T) => string | number;
  readonly isUnlocked: (item: T) => boolean;
  readonly onSelect: (item: T) => void;
  readonly testIDOf: (item: T) => string;
  readonly accessibilityLabelOf: (item: T, unlocked: boolean) => string;
  /** Card body; the lock glyph is appended for locked items. */
  readonly renderContent: (item: T, unlocked: boolean) => React.ReactNode;
  /** Per-screen card sizing (aspect ratio, inner gap, padding). */
  readonly cardStyle?: StyleProp<ViewStyle>;
  readonly lockStyle?: StyleProp<TextStyle>;
  /**
   * Index of an item to bring into view when the grid first lays out (e.g. the
   * furthest unlocked level). Omitted: the grid opens at the top.
   */
  readonly initialScrollIndex?: number;
}

/** Space kept above the row scrolled to, so the row before it peeks in. */
const SCROLL_MARGIN = 24;

/**
 * Title + optional Continue button + a grid of cards that are disabled and
 * dimmed with a 🔒 while locked. Shared by the Mahjong layout picker and the
 * Sort level picker.
 */
export function LockableGrid<T>({
  title,
  titleAccessibilityRole,
  continueLabel,
  onContinue,
  items,
  columns,
  gap,
  keyOf,
  isUnlocked,
  onSelect,
  testIDOf,
  accessibilityLabelOf,
  renderContent,
  cardStyle,
  lockStyle,
  initialScrollIndex,
}: LockableGridProps<T>) {
  const { colors } = useTheme();
  const rows = chunk(items, columns);
  // Scroll once, when both the grid's and the target row's offsets are known.
  const targetRow =
    initialScrollIndex !== undefined && initialScrollIndex >= columns
      ? Math.floor(initialScrollIndex / columns)
      : null;
  const scrollRef = useRef<ScrollView>(null);
  const gridY = useRef<number | null>(null);
  const rowY = useRef<number | null>(null);
  const scrolled = useRef(false);
  const maybeScroll = () => {
    if (scrolled.current || gridY.current === null || rowY.current === null) return;
    scrolled.current = true;
    const y = Math.max(0, gridY.current + rowY.current - SCROLL_MARGIN);
    scrollRef.current?.scrollTo({ y, animated: false });
  };

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={[styles.container, { backgroundColor: colors.background }]}
    >
      <Text
        style={[styles.title, { color: colors.text }]}
        accessibilityRole={titleAccessibilityRole}
      >
        {title}
      </Text>

      {continueLabel !== undefined && (
        <Pressable
          style={[styles.continueBtn, { backgroundColor: colors.accent }]}
          onPress={onContinue}
          accessibilityRole="button"
          accessibilityLabel={continueLabel}
        >
          <Text style={[styles.continueBtnText, { color: colors.textOnAccent }]}>
            {continueLabel}
          </Text>
        </Pressable>
      )}

      <View
        style={{ gap }}
        onLayout={
          targetRow === null
            ? undefined
            : (e) => {
                gridY.current = e.nativeEvent.layout.y;
                maybeScroll();
              }
        }
      >
        {rows.map((row, rowIdx) => (
          <View
            key={rowIdx}
            style={[styles.row, { gap }]}
            onLayout={
              rowIdx === targetRow
                ? (e) => {
                    rowY.current = e.nativeEvent.layout.y;
                    maybeScroll();
                  }
                : undefined
            }
          >
            {row.map((item) => {
              const unlocked = isUnlocked(item);
              return (
                <Pressable
                  key={keyOf(item)}
                  testID={testIDOf(item)}
                  style={[
                    styles.card,
                    cardStyle,
                    {
                      backgroundColor: unlocked ? colors.surfaceHigh : colors.surface,
                      borderColor: unlocked ? colors.accent : colors.border,
                      opacity: unlocked ? 1 : 0.5,
                    },
                  ]}
                  onPress={unlocked ? () => onSelect(item) : undefined}
                  disabled={!unlocked}
                  accessibilityRole="button"
                  accessibilityLabel={accessibilityLabelOf(item, unlocked)}
                  accessibilityState={{ disabled: !unlocked }}
                >
                  {renderContent(item, unlocked)}
                  {!unlocked && <Text style={lockStyle}>🔒</Text>}
                </Pressable>
              );
            })}
            {row.length < columns &&
              Array.from({ length: columns - row.length }).map((_, i) => (
                <View key={`pad-${i}`} style={styles.cardPad} />
              ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    gap: 16,
  },
  title: {
    fontFamily: typography.heading,
    fontSize: 20,
    textAlign: "center",
    marginBottom: 8,
  },
  continueBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  continueBtnText: {
    fontFamily: typography.label,
    fontSize: 14,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
  },
  card: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cardPad: {
    flex: 1,
  },
});
