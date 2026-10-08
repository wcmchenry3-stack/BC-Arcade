/**
 * Shared chrome for the in-screen developer panels (#2978): the orange DEV
 * button, the panel itself (a centred modal, or a side panel drawn over a live
 * game), its title, and the controls the panels are built from. Styled from the
 * `DEV_*` tokens in `theme/theme.constants.ts`.
 *
 * Every piece renders nothing unless `enabled` is true. Callers pass the
 * screen's own gate (`__DEV__`, or `__DEV__ || isPreLaunchApiBuild()` where
 * internal builds get the panel too), so store builds never show one.
 */
import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import {
  DEV_ACCENT,
  DEV_ACCENT_BORDER,
  DEV_ACCENT_DIM,
  DEV_ACCENT_MUTED,
  DEV_OVERLAY_BG,
  DEV_SIDEBAR_BG,
  DEV_SURFACE_DIM,
  DEV_SURFACE_SUBTLE,
} from "../../theme/theme.constants";

export interface DevButtonProps {
  readonly enabled: boolean;
  readonly onPress: () => void;
  /** Corner of the nearest positioned parent the button sits in. */
  readonly position?: "top-left" | "bottom-right";
}

/** The small orange "DEV" button that opens a panel. */
export function DevButton({ enabled, onPress, position = "top-left" }: DevButtonProps) {
  if (!enabled) return null;
  return (
    <Pressable
      style={[styles.devButton, position === "top-left" ? styles.topLeft : styles.bottomRight]}
      onPress={onPress}
    >
      <Text style={styles.devButtonText}>DEV</Text>
    </Pressable>
  );
}

export interface DevPanelShellProps {
  readonly enabled: boolean;
  readonly open: boolean;
  /** Called by the DEV button; omit it (or pass `showButton={false}`) for a panel opened elsewhere. */
  readonly onOpen?: () => void;
  /** The modal's back-button / Escape request. */
  readonly onClose: () => void;
  readonly title: string;
  /**
   * `modal` (default): a centred card over a dimmed screen. `sidebar`: a panel
   * on the right edge of the nearest positioned parent, leaving the game visible.
   */
  readonly variant?: "modal" | "sidebar";
  readonly showButton?: boolean;
  readonly buttonPosition?: DevButtonProps["position"];
  /** Sidebar only: false lays the content out without a ScrollView. */
  readonly scroll?: boolean;
  readonly panelStyle?: StyleProp<ViewStyle>;
  readonly contentStyle?: StyleProp<ViewStyle>;
  readonly titleStyle?: StyleProp<TextStyle>;
  readonly accessibilityLabel?: string;
  readonly accessibilityRole?: ViewProps["accessibilityRole"];
  readonly pointerEvents?: ViewProps["pointerEvents"];
  /** On the `Modal` (modal) or the panel view (sidebar). */
  readonly testID?: string;
  readonly children?: React.ReactNode;
}

export function DevPanelShell({
  enabled,
  open,
  onOpen,
  onClose,
  title,
  variant = "modal",
  showButton = true,
  buttonPosition,
  scroll = true,
  panelStyle,
  contentStyle,
  titleStyle,
  accessibilityLabel,
  accessibilityRole,
  pointerEvents,
  testID,
  children,
}: DevPanelShellProps) {
  const { colors } = useTheme();
  if (!enabled) return null;

  const button =
    showButton && onOpen ? <DevButton enabled onPress={onOpen} position={buttonPosition} /> : null;
  const heading = <Text style={[styles.title, titleStyle]}>{title}</Text>;

  if (variant === "sidebar") {
    return (
      <>
        {button}
        {open && (
          <View
            style={[styles.sidebar, panelStyle]}
            accessible={accessibilityLabel !== undefined ? true : undefined}
            accessibilityLabel={accessibilityLabel}
            accessibilityRole={accessibilityRole}
            pointerEvents={pointerEvents}
            testID={testID}
          >
            {scroll ? (
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[styles.sidebarContent, contentStyle]}
              >
                {heading}
                {children}
              </ScrollView>
            ) : (
              <>
                {heading}
                {children}
              </>
            )}
          </View>
        )}
      </>
    );
  }

  return (
    <>
      {button}
      <Modal
        visible={open}
        transparent
        animationType="fade"
        accessibilityViewIsModal
        onRequestClose={onClose}
        testID={testID}
      >
        <View style={styles.overlay}>
          <View
            style={[styles.modalPanel, { backgroundColor: colors.surfaceHigh }, panelStyle]}
            accessibilityLabel={accessibilityLabel}
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[styles.modalContent, contentStyle]}
            >
              {heading}
              {children}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

/** A "── Title ──" header followed by its controls (no wrapper, so the panel's gap applies). */
export function DevSection({
  title,
  color,
  children,
}: {
  readonly title: string;
  /** Header colour; the muted dev accent by default. */
  readonly color?: string;
  readonly children?: React.ReactNode;
}) {
  return (
    <>
      <Text style={[styles.sectionHeader, color !== undefined && { color }]}>
        {`── ${title} ──`}
      </Text>
      {children}
    </>
  );
}

/** A label with a value (or any controls) on the right. */
export function DevRow({
  label,
  value,
  labelStyle,
  children,
}: {
  readonly label: string;
  readonly value?: string | number;
  readonly labelStyle?: StyleProp<TextStyle>;
  readonly children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: colors.textMuted }, labelStyle]}>{label}</Text>
      {value !== undefined && <Text style={styles.value}>{value}</Text>}
      {children}
    </View>
  );
}

export interface DevStepperProps {
  readonly value: string | number;
  readonly onDecrement: () => void;
  readonly onIncrement: () => void;
  readonly decrementLabel: string;
  readonly incrementLabel: string;
  /** Row layout: the label on the left of `− value +`. */
  readonly label?: string;
  readonly labelStyle?: StyleProp<TextStyle>;
  /** `column`: a compact `+ / value / −` cell with no label (one of several side by side). */
  readonly layout?: "row" | "column";
}

export function DevStepper({
  value,
  onDecrement,
  onIncrement,
  decrementLabel,
  incrementLabel,
  label,
  labelStyle,
  layout = "row",
}: DevStepperProps) {
  const { colors } = useTheme();
  const dec = (
    <Pressable style={styles.stepBtn} onPress={onDecrement} accessibilityLabel={decrementLabel}>
      <Text style={styles.stepText}>−</Text>
    </Pressable>
  );
  const inc = (
    <Pressable style={styles.stepBtn} onPress={onIncrement} accessibilityLabel={incrementLabel}>
      <Text style={styles.stepText}>+</Text>
    </Pressable>
  );
  if (layout === "column") {
    return (
      <View style={styles.stepCell}>
        {inc}
        <Text style={[styles.value, styles.cellValue]}>{value}</Text>
        {dec}
      </View>
    );
  }
  return (
    <View style={styles.row}>
      {label !== undefined && (
        <Text style={[styles.label, { color: colors.textMuted }, labelStyle]}>{label}</Text>
      )}
      {dec}
      <Text style={styles.value}>{value}</Text>
      {inc}
    </View>
  );
}

/** A labelled switch; the label is also the switch's accessibility label. */
export function DevToggle({
  label,
  value,
  onValueChange,
}: {
  readonly label: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
}) {
  return (
    <DevRow label={label}>
      <Switch value={value} onValueChange={onValueChange} accessibilityLabel={label} />
    </DevRow>
  );
}

export interface DevActionButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  /** `primary`: solid accent with white text. */
  readonly variant?: "default" | "primary";
  readonly accessibilityLabel?: string;
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly textStyle?: StyleProp<TextStyle>;
}

export function DevActionButton({
  label,
  onPress,
  variant = "default",
  accessibilityLabel,
  testID,
  style,
  textStyle,
}: DevActionButtonProps) {
  const { colors } = useTheme();
  const primary = variant === "primary";
  return (
    <Pressable
      style={[styles.actionBtn, primary && styles.actionBtnPrimary, style]}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <Text
        style={[
          primary ? styles.actionTextPrimary : [styles.actionText, { color: colors.textMuted }],
          textStyle,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  devButton: {
    position: "absolute",
    backgroundColor: DEV_ACCENT_DIM,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    zIndex: 100,
  },
  topLeft: {
    top: 6,
    left: 6,
  },
  bottomRight: {
    bottom: 8,
    right: 8,
  },
  devButtonText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: DEV_OVERLAY_BG,
    alignItems: "center",
    justifyContent: "center",
  },
  modalPanel: {
    borderRadius: 12,
    padding: 24,
    width: 320,
    maxHeight: "85%",
    borderWidth: 1,
    borderColor: DEV_ACCENT_BORDER,
  },
  modalContent: {
    gap: 12,
  },
  sidebar: {
    position: "absolute",
    right: 0,
    top: 0,
    backgroundColor: DEV_SIDEBAR_BG,
    borderLeftWidth: 1,
    borderLeftColor: DEV_ACCENT_BORDER,
    padding: 10,
  },
  sidebarContent: {
    gap: 16,
  },
  title: {
    color: DEV_ACCENT,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 2,
    textAlign: "center",
    textTransform: "uppercase",
  },
  sectionHeader: {
    color: DEV_ACCENT_MUTED,
    fontSize: 10,
    letterSpacing: 1,
    textAlign: "center",
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  label: {
    fontSize: 13,
    flex: 1,
  },
  value: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    minWidth: 28,
    textAlign: "center",
  },
  cellValue: {
    fontSize: 20,
    minWidth: 24,
  },
  stepCell: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  stepBtn: {
    backgroundColor: DEV_SURFACE_DIM,
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: {
    color: "#fff",
    fontSize: 18,
    lineHeight: 22,
  },
  actionBtn: {
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: DEV_SURFACE_SUBTLE,
  },
  actionBtnPrimary: {
    backgroundColor: DEV_ACCENT,
  },
  actionText: {
    fontSize: 13,
  },
  actionTextPrimary: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
});
