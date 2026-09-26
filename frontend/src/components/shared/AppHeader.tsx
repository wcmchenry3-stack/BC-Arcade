import React, { useEffect, useState } from "react";
import { View, Text, Image, StyleSheet, Platform, Pressable, Modal } from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import * as Sentry from "@sentry/react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import FeedbackWidget from "../FeedbackWidget/FeedbackWidget";
import { ConfirmModal } from "./ConfirmModal";
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
  /**
   * Screen-reader label for the back button when it does not go home, e.g.
   * "Back to levels". Defaults to common:nav.backLabel.
   */
  backAccessibilityLabel?: string;
  /**
   * When provided, shows the ⋯ menu with a Scorecard item: the live view of
   * the match in progress (Hearts, Yacht, Blackjack). See GH #711, #2636.
   */
  onOpenScorecard?: () => void;
  /**
   * When provided, shows the ⋯ menu with a Stats item (#2635): the game's
   * shared stats screen. GameShell sets it from its `gameType` prop.
   */
  onOpenStats?: () => void;
  /**
   * When provided, shows the ⋯ menu with a Leaderboard item (#2633). Pass
   * `useLeaderboardLink`'s result: undefined for games without an openable board.
   */
  onOpenLeaderboard?: () => void;
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
  backAccessibilityLabel,
  onOpenScorecard,
  onOpenStats,
  onOpenLeaderboard,
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
  const showMenu =
    !!onOpenScorecard ||
    !!onOpenStats ||
    !!onOpenLeaderboard ||
    !!onNewGame ||
    !!onLevelSelect ||
    !!onEditPlayerNames;

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

  const handleMenuScorecard = () => {
    setMenuOpen(false);
    onOpenScorecard?.();
  };

  const handleMenuStats = () => {
    setMenuOpen(false);
    onOpenStats?.();
  };

  const handleMenuLeaderboard = () => {
    setMenuOpen(false);
    onOpenLeaderboard?.();
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

  // #2481 — the ⋯ menu replaces the "?" button outright, so before this every
  // gameplay screen had no way to send feedback: exactly where a player is
  // most likely to hit something worth reporting. Reuses the widget the "?"
  // opens, and `feedback:title` rather than a new key, so no locale needs a
  // new string.
  const handleMenuFeedback = () => {
    setMenuOpen(false);
    setHelpOpen(true);
  };

  const handleAbandonConfirm = () => {
    setAbandonVisible(false);
    onNewGame?.();
  };

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
            accessibilityLabel={backAccessibilityLabel ?? t("common:nav.backLabel")}
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
            hitSlop={12}
            testID="nav-back"
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
            testID="nav-menu"
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
          {!!onOpenScorecard && (
            <Pressable
              onPress={handleMenuScorecard}
              accessibilityRole="menuitem"
              testID="nav-menu-scorecard"
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
                {t("common:overflow.menu.scorecard")}
              </Text>
            </Pressable>
          )}

          {!!onOpenStats && (
            <Pressable
              onPress={handleMenuStats}
              accessibilityRole="menuitem"
              testID="nav-menu-stats"
              style={(state) => [
                styles.dropdownItem,
                state.pressed && { backgroundColor: colors.surfaceAlt },
              ]}
            >
              <MaterialIcons
                name="insights"
                size={18}
                color={colors.accent}
                style={styles.itemIcon}
              />
              <Text style={[styles.itemLabel, { color: colors.text }]}>
                {t("common:overflow.menu.stats")}
              </Text>
            </Pressable>
          )}

          {!!onOpenLeaderboard && (
            <Pressable
              onPress={handleMenuLeaderboard}
              accessibilityRole="menuitem"
              testID="nav-menu-leaderboard"
              style={(state) => [
                styles.dropdownItem,
                state.pressed && { backgroundColor: colors.surfaceAlt },
              ]}
            >
              <MaterialIcons
                name="emoji-events"
                size={18}
                color={colors.accent}
                style={styles.itemIcon}
              />
              <Text style={[styles.itemLabel, { color: colors.text }]}>
                {t("common:overflow.menu.leaderboard")}
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

          {/* #2481 — always last, and always present: the one menu item that
              does not depend on which handlers the screen passed in. */}
          <Pressable
            onPress={handleMenuFeedback}
            accessibilityRole="menuitem"
            testID="nav-menu-feedback"
            style={(state) => [
              styles.dropdownItem,
              state.pressed && { backgroundColor: colors.surfaceAlt },
            ]}
          >
            <MaterialIcons
              name="feedback"
              size={18}
              color={colors.accent}
              style={styles.itemIcon}
            />
            <Text style={[styles.itemLabel, { color: colors.text }]}>{t("title")}</Text>
          </Pressable>
        </View>
      </Modal>

      {/* ─── Abandon dialog ────────────────────────────────────────────────── */}
      <ConfirmModal
        visible={abandonVisible}
        title={t("common:overflow.abandon.title")}
        body={t("common:overflow.abandon.body")}
        confirmLabel={t("common:overflow.abandon.startNew")}
        cancelLabel={t("common:overflow.abandon.keepPlaying")}
        cancelFirst
        onConfirm={handleAbandonConfirm}
        onCancel={() => setAbandonVisible(false)}
      />
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
});
