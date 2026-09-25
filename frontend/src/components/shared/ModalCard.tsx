import React from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";

export interface ModalCardProps {
  visible: boolean;
  /** Android back / web Escape. Omit for pickers that must be answered. */
  onRequestClose?: () => void;
  title?: string;
  body?: string;
  /**
   * `sm` = compact dialog (86%, max 360). `md` = content panel (90%, max 420,
   * capped at 85% height). ModalCard does not scroll: put long `md` content in
   * a ScrollView.
   */
  size?: "sm" | "md";
  /** 3pt accent rule along the top edge, used by confirm dialogs. */
  accentTop?: boolean;
  animationType?: "fade" | "slide";
  testID?: string;
  children?: React.ReactNode;
}

/**
 * Centered card over the theme's `overlay` backdrop. The one modal shell for
 * dialogs and pickers so they share backdrop, surface, radius and type
 * (#2601). Content goes in `children`; put the action pills
 * (ModalPrimaryButton, ModalSecondaryButton) in a ModalActions.
 */
export function ModalCard({
  visible,
  onRequestClose,
  title,
  body,
  size = "sm",
  accentTop = false,
  animationType = "fade",
  testID,
  children,
}: ModalCardProps) {
  const { colors } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType={animationType}
      onRequestClose={onRequestClose}
      accessibilityViewIsModal
    >
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <View
          testID={testID}
          style={[
            styles.card,
            size === "md" ? styles.cardMd : styles.cardSm,
            { backgroundColor: colors.surfaceHigh, borderColor: colors.border },
            accentTop && { borderTopWidth: 3, borderTopColor: colors.accent },
          ]}
        >
          {title !== undefined && (
            <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
              {title}
            </Text>
          )}
          {body !== undefined && (
            <Text style={[styles.body, { color: colors.textMuted }]}>{body}</Text>
          )}
          {children}
        </View>
      </View>
    </Modal>
  );
}

/** Vertical stack of modal action pills with even spacing and no trailing gap. */
export function ModalActions({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return <View style={[styles.actions, style]}>{children}</View>;
}

interface ModalButtonProps {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export interface ModalPrimaryButtonProps extends ModalButtonProps {
  /** `danger` fills with the theme error color for destructive confirms. */
  tone?: "accent" | "danger";
}

/** Filled pill: the main action in a ModalCard. */
export function ModalPrimaryButton({
  label,
  onPress,
  tone = "accent",
  accessibilityLabel,
  testID,
  style,
}: ModalPrimaryButtonProps) {
  const { colors } = useTheme();
  const fill: ViewStyle =
    tone === "danger"
      ? { backgroundColor: colors.error }
      : Platform.OS === "web"
        ? ({
            backgroundImage: `linear-gradient(135deg, ${colors.accent}, ${colors.accentBright})`,
            boxShadow: `0 0 20px ${colors.accent}55`,
          } as ViewStyle)
        : { backgroundColor: colors.accentBright };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.primary,
        fill,
        { transform: [{ scale: pressed ? 0.96 : 1 }] },
        style,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
    >
      <Text style={[styles.primaryText, { color: colors.textOnAccent }]}>{label}</Text>
    </Pressable>
  );
}

export interface ModalSecondaryButtonProps extends ModalButtonProps {
  /** `accent` = accent outline (alternate choice). `muted` = neutral outline (cancel). */
  tone?: "accent" | "muted";
}

/** Outlined pill: the alternate or cancel action in a ModalCard. */
export function ModalSecondaryButton({
  label,
  onPress,
  tone = "muted",
  accessibilityLabel,
  testID,
  style,
}: ModalSecondaryButtonProps) {
  const { colors } = useTheme();
  const accent = tone === "accent";

  return (
    <Pressable
      style={[styles.secondary, { borderColor: accent ? colors.accent : colors.border }, style]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
    >
      <Text
        style={[
          styles.secondaryText,
          accent ? styles.secondaryTextAccent : styles.secondaryTextMuted,
          { color: accent ? colors.accent : colors.textMuted },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
  },
  cardSm: {
    width: "86%",
    maxWidth: 360,
  },
  cardMd: {
    width: "90%",
    maxWidth: 420,
    maxHeight: "85%",
  },
  title: {
    fontFamily: typography.heading,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginBottom: 10,
    textAlign: "center",
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
    textAlign: "center",
  },
  actions: {
    alignItems: "center",
    gap: 10,
  },
  primary: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
    minWidth: 180,
  },
  primaryText: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  secondary: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    minWidth: 180,
  },
  secondaryText: {
    fontSize: 13,
    textTransform: "uppercase",
  },
  secondaryTextAccent: {
    fontWeight: "800",
    letterSpacing: 1,
  },
  secondaryTextMuted: {
    fontWeight: "700",
    letterSpacing: 0.5,
  },
});
