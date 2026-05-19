import React, { useEffect, useState } from "react";
import { View, Text, Image, StyleSheet, Platform, Pressable, Modal, ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import * as Sentry from "@sentry/react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import FeedbackWidget from "../FeedbackWidget/FeedbackWidget";
import logoSource from "../../../assets/logo.png";

export const APP_HEADER_HEIGHT = 64;

export interface AppHeaderProps {
  title: string;
  rightSlot?: React.ReactNode;
  onBack?: () => void;
  /**
   * Screens that must always show a back button set this to true. If onBack
   * is missing at mount, AppHeader reports a Sentry warning so a regression
   * (e.g. accidental refactor that drops the handler) surfaces in telemetry
   * instead of stranding users on the screen. See GH #498.
   */
  requireBack?: boolean;
  /** When provided, shows the ⋯ menu with a Scoreboard item. See GH #711. */
  onOpenScoreboard?: () => void;
  /** When provided, shows the ⋯ menu with a New Game item (with abandon confirmation). See GH #711. */
  onNewGame?: () => void;
  /** When provided, shows the ⋯ menu with a Level Select item (no confirmation — goes directly to layout picker). */
  onLevelSelect?: () => void;
  /** When provided, shows the ⋯ menu with an Edit Names item. */
  onEditPlayerNames?: () => void;
}

export function AppHeader({
  title,
  rightSlot,
  onBack,
  requireBack = false,
  onOpenScoreboard,
  onNewGame,
  onLevelSelect,
  onEditPlayerNames,
}: AppHeaderProps) {
  const { colors, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(["feedback", "common"]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [abandonVisible, setAbandonVisible] = useState(false);

  const totalHeight = APP_HEADER_HEIGHT + insets.top;
  const showMenu = !!onOpenScoreboard || !!onNewGame || !!onLevelSelect || !!onEditPlayerNames;

  // #498 — mount-time telemetry: record whether the back affordance is wired
  // up so we can detect regressions where a screen silently drops onBack.
  useEffect(() => {
    Sentry.addBreadcrumb({
      category: "ui.header",
      level: "info",
      message: "AppHeader mount",
      data: { title, hasBack: !!onBack, requireBack },
    });
    if (requireBack && !onBack) {
      Sentry.captureMessage(
        `AppHeader[${title}] rendered without onBack despite requireBack`,
        "warning"
      );
    }
    // Intentionally run once per mount — we care about the initial render of
    // each screen, not every prop toggle. Screens remount on navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // #498 — tap-time telemetry: wrap onBack so a breadcrumb lands in Sentry
  // the instant the press registers. If users report "back does nothing" we
  // can distinguish "tap never fired" from "handler fired but navigation
  // silently failed" by whether this breadcrumb is present.
  const handleBackPress = onBack
    ? () => {
        Sentry.addBreadcrumb({
          category: "ui.header",
          level: "info",
          message: "AppHeader back press",
          data: { title },
        });
        onBack();
      }
    : undefined;

  const handleMenuScoreboard = () => {
    setMenuOpen(false);
    onOpenScoreboard?.();
  };

  const handleMenuNewGame = () => {
    setMenuOpen(false);
    setAbandonVisible(true);
  };

  const handleMenuLevelSelect = () => {
    setMenuOpen(false);
    onLevelSelect?.();
  };

  const handleMenuEditNames = () => {
    setMenuOpen(false);
    onEditPlayerNames?.();
  };

  const handleAbandonConfirm = () => {
    setAbandonVisible(false);
    onNewGame?.();
  };

  // Gradient "Start New" button uses secondary → accent on web; fallback on native.
  const startNewBg: ViewStyle =
    Platform.OS === "web"
      ? ({
          backgroundImage: `linear-gradient(135deg, ${colors.secondary}, ${colors.accent})`,
        } as ViewStyle)
      : { backgroundColor: colors.secondary };

  return (
    <View
      accessibilityRole="header"
      style={[
        styles.wrapper,
        {
          height: totalHeight,
          shadowColor: colors.chromeShadowColor,
          shadowOpacity: colors.chromeShadowOpacity,
        },
      ]}
    >
      {Platform.OS === "web" ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: colors.chromeBg,
              // React Native Web passes unknown style props through to CSS
              ...Platform.select({
                web: {
                  backdropFilter: "blur(20px)",
                  WebkitBackdropFilter: "blur(20px)",
                } as object,
              }),
            },
          ]}
        />
      ) : (
        <BlurView
          intensity={80}
          tint={theme === "dark" ? "dark" : "light"}
          style={StyleSheet.absoluteFill}
        />
      )}

      <View style={[styles.content, { paddingTop: insets.top }]}>
        {handleBackPress ? (
          <Pressable
            onPress={handleBackPress}
            accessibilityRole="button"
            accessibilityLabel={t("common:nav.backLabel")}
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
            hitSlop={12}
          >
            <Text style={[styles.backText, { color: colors.text }]}>{t("common:nav.back")}</Text>
          </Pressable>
        ) : (
          <View style={styles.logoSlot}>
            <Image
              source={logoSource}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel="BC Arcade"
              accessibilityRole="image"
            />
          </View>
        )}

        <Text
          style={[styles.title, { color: colors.text }]}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {title}
        </Text>

        <View style={styles.rightSlot}>{rightSlot ?? null}</View>

        {showMenu ? (
          <Pressable
            onPress={() => setMenuOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t("common:overflow.menu.label")}
            style={({ pressed }) => [
              styles.menuButton,
              { backgroundColor: colors.accent },
              pressed && styles.menuButtonPressed,
            ]}
            hitSlop={8}
          >
            <MaterialIcons name="more-horiz" size={20} color={colors.textOnAccent} />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setHelpOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t("fab_label")}
            style={({ pressed }) => [
              styles.helpButton,
              { backgroundColor: colors.accent },
              pressed && styles.helpButtonPressed,
            ]}
            hitSlop={8}
          >
            <Text style={[styles.helpButtonText, { color: colors.textOnAccent }]}>?</Text>
          </Pressable>
        )}
      </View>

      <FeedbackWidget visible={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* ─── Overflow dropdown ─────────────────────────────────────────────── */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="none"
        onRequestClose={() => setMenuOpen(false)}
      >
        {/* Scrim — tapping outside the panel closes the menu */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setMenuOpen(false)}
          accessibilityLabel={t("common:overflow.menu.label")}
        />

        {/* Dropdown panel — 6 px above the header bottom to match design intent */}
        <View
          style={[
            styles.dropdown,
            {
              top: totalHeight - 6,
              backgroundColor: colors.surfaceHigh,
              borderColor: colors.border,
              ...Platform.select({
                web: { boxShadow: "0 8px 24px rgba(0,0,0,0.5)" } as object,
              }),
            },
          ]}
        >
          {!!onOpenScoreboard && (
            <Pressable
              onPress={handleMenuScoreboard}
              accessibilityRole="menuitem"
              style={(state) => [
                styles.dropdownItem,
                state.pressed && { backgroundColor: colors.surfaceAlt },
              ]}
            >
              <MaterialIcons
                name="leaderboard"
                size={18}
                color={colors.accent}
                style={styles.itemIcon}
              />
              <Text style={[styles.itemLabel, { color: colors.text }]}>
                {t("common:overflow.menu.scoreboard")}
              </Text>
            </Pressable>
          )}

          {!!onNewGame && (
            <Pressable
              onPress={handleMenuNewGame}
              accessibilityRole="menuitem"
              style={(state) => [
                styles.dropdownItem,
                state.pressed && { backgroundColor: colors.surfaceAlt },
              ]}
            >
              <MaterialIcons
                name="refresh"
                size={18}
                color={colors.secondary}
                style={styles.itemIcon}
              />
              <Text style={[styles.itemLabel, { color: colors.text }]}>
                {t("common:overflow.menu.newGame")}
              </Text>
            </Pressable>
          )}

          {!!onLevelSelect && (
            <Pressable
              onPress={handleMenuLevelSelect}
              accessibilityRole="menuitem"
              style={(state) => [
                styles.dropdownItem,
                state.pressed && { backgroundColor: colors.surfaceAlt },
              ]}
            >
              <MaterialIcons
                name="grid-view"
                size={18}
                color={colors.accent}
                style={styles.itemIcon}
              />
              <Text style={[styles.itemLabel, { color: colors.text }]}>
                {t("common:overflow.menu.levelSelect")}
              </Text>
            </Pressable>
          )}

          {!!onEditPlayerNames && (
            <Pressable
              onPress={handleMenuEditNames}
              accessibilityRole="menuitem"
              style={(state) => [
                styles.dropdownItem,
                state.pressed && { backgroundColor: colors.surfaceAlt },
              ]}
            >
              <MaterialIcons name="edit" size={18} color={colors.accent} style={styles.itemIcon} />
              <Text style={[styles.itemLabel, { color: colors.text }]}>
                {t("common:overflow.menu.editNames")}
              </Text>
            </Pressable>
          )}
        </View>
      </Modal>

      {/* ─── Abandon dialog ────────────────────────────────────────────────── */}
      <Modal
        visible={abandonVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAbandonVisible(false)}
        accessibilityViewIsModal
      >
        <View
          style={[
            styles.abandonOverlay,
            Platform.select({
              web: {
                backdropFilter: "blur(4px)",
                WebkitBackdropFilter: "blur(4px)",
              } as object,
            }),
          ]}
        >
          <View
            style={[
              styles.abandonCard,
              { backgroundColor: colors.surfaceHigh, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.abandonTitle, { color: colors.text }]} accessibilityRole="header">
              {t("common:overflow.abandon.title")}
            </Text>
            <Text style={[styles.abandonBody, { color: colors.textMuted }]}>
              {t("common:overflow.abandon.body")}
            </Text>

            {/* Keep Playing — outline pill (safe action first) */}
            <Pressable
              style={[styles.keepPlayingBtn, { borderColor: colors.border }]}
              onPress={() => setAbandonVisible(false)}
              accessibilityRole="button"
              accessibilityLabel={t("common:overflow.abandon.keepPlaying")}
            >
              <Text style={[styles.keepPlayingText, { color: colors.text }]}>
                {t("common:overflow.abandon.keepPlaying")}
              </Text>
            </Pressable>

            {/* Start New — gradient pill */}
            <Pressable
              style={({ pressed }) => [
                styles.startNewBtn,
                startNewBg,
                { transform: [{ scale: pressed ? 0.96 : 1 }] },
              ]}
              onPress={handleAbandonConfirm}
              accessibilityRole="button"
              accessibilityLabel={t("common:overflow.abandon.startNew")}
            >
              <Text style={[styles.startNewText, { color: colors.textOnAccent }]}>
                {t("common:overflow.abandon.startNew")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 20,
    elevation: 4,
  },
  content: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
  },
  logoSlot: {
    width: 80,
    alignItems: "flex-start",
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#1a0a2e",
  },
  backButton: {
    width: 80,
    height: 32,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  backButtonPressed: {
    opacity: 0.6,
  },
  backText: {
    fontFamily: typography.heading,
    fontSize: 15,
  },
  title: {
    fontFamily: typography.heading,
    fontSize: 16,
    flex: 1,
    textAlign: "center",
    marginHorizontal: 8,
  },
  rightSlot: {
    minWidth: 80,
    alignItems: "flex-end",
  },
  helpButton: {
    marginLeft: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  helpButtonPressed: {
    opacity: 0.7,
  },
  helpButtonText: {
    fontFamily: typography.heading,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 18,
  },
  menuButton: {
    marginLeft: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  menuButtonPressed: {
    opacity: 0.7,
  },
  // ── Dropdown panel ──────────────────────────────────────────────────────
  dropdown: {
    position: "absolute",
    right: 16,
    borderWidth: 1,
    borderRadius: 12,
    padding: 6,
    minWidth: 160,
    // Native shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 16,
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  itemIcon: {
    marginRight: 10,
  },
  itemLabel: {
    fontFamily: typography.bodyMedium,
    fontSize: 13,
  },
  // ── Abandon dialog ──────────────────────────────────────────────────────
  abandonOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  abandonCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
    width: "86%",
    maxWidth: 320,
  },
  abandonTitle: {
    fontFamily: typography.heading,
    fontSize: 17,
    marginBottom: 10,
    textAlign: "center",
  },
  abandonBody: {
    fontFamily: typography.body,
    fontSize: 13,
    lineHeight: 19.5,
    marginBottom: 20,
    textAlign: "center",
  },
  keepPlayingBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 10,
    width: "100%",
    alignItems: "center",
  },
  keepPlayingText: {
    fontFamily: typography.label,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  startNewBtn: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
    width: "100%",
    alignItems: "center",
  },
  startNewText: {
    fontFamily: typography.label,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
});
