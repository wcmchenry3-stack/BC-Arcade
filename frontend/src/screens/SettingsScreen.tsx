import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, Modal, Switch } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import * as Sentry from "@sentry/react-native";
import { useTheme, type ThemeMode } from "../theme/ThemeContext";
import { MODAL_SCRIM } from "../theme/theme.constants";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { AppHeader, APP_HEADER_HEIGHT } from "../components/shared/AppHeader";
import { gameEventClient } from "../game/_shared/gameEventClient";
import { useDeck } from "../game/_shared/decks/CardDeckContext";
import { useSoundSettings } from "../game/_shared/SoundContext";
import { clearSession } from "../game/_shared/session";
import { scoreQueue } from "../game/_shared/scoreQueue";
import { pendingGamesStore } from "../game/_shared/pendingGamesStore";
import { eventStore } from "../game/_shared/eventStore";
import { statsApi } from "../api/stats";

const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

export default function SettingsScreen() {
  const { colors, themeMode, setThemeMode } = useTheme();
  const { activeDeck, setDeck, availableDecks } = useDeck();
  const { muted, setMuted } = useSoundSettings();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation("common");

  const themeLabel: Record<ThemeMode, string> = {
    system: t("theme.system", "System"),
    light: t("theme.lightShort", "Light"),
    dark: t("theme.darkShort", "Dark"),
  };

  const [confirmVisible, setConfirmVisible] = useState(false);
  const [successVisible, setSuccessVisible] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [deleteSuccessVisible, setDeleteSuccessVisible] = useState(false);
  const [deleteErrorVisible, setDeleteErrorVisible] = useState(false);

  const handleClearLogs = async () => {
    setConfirmVisible(false);
    try {
      await gameEventClient.clearAll();
      setSuccessVisible(true);
      setTimeout(() => setSuccessVisible(false), 2000);
    } catch (e) {
      Sentry.captureException(e, {
        tags: { subsystem: "settings", op: "clearLogs" },
      });
    }
  };

  const handleDeleteData = async () => {
    setDeleteConfirmVisible(false);
    try {
      await statsApi.deleteMyData();
      await Promise.all([
        clearSession(),
        pendingGamesStore.clearAll(),
        eventStore.clearAll(),
        scoreQueue.clearAll(),
      ]);
      setDeleteSuccessVisible(true);
      setTimeout(() => setDeleteSuccessVisible(false), 3000);
    } catch (e) {
      Sentry.captureException(e, {
        tags: { subsystem: "settings", op: "deleteData" },
      });
      setDeleteErrorVisible(true);
      setTimeout(() => setDeleteErrorVisible(false), 3000);
    }
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: APP_HEADER_HEIGHT + insets.top },
      ]}
    >
      <AppHeader title={t("nav.settings")} />

      <View style={[styles.row, { borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.text }]}>{t("theme.label", "Theme")}</Text>
        <View
          style={[styles.segmented, { backgroundColor: colors.surfaceAlt }]}
          accessibilityRole="radiogroup"
          accessibilityLabel={t("theme.label", "Theme")}
          testID="theme-mode-segmented"
        >
          {THEME_MODES.map((mode) => {
            const active = mode === themeMode;
            return (
              <Pressable
                key={mode}
                onPress={() => setThemeMode(mode)}
                style={[
                  styles.segment,
                  { backgroundColor: active ? colors.accent : "transparent" },
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                // RN Web 0.21 drops accessibilityState; set aria-checked so web
                // screen readers and the Playwright suite can observe selection.
                aria-checked={active}
                accessibilityLabel={themeLabel[mode]}
                testID={`theme-mode-${mode}`}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: active ? colors.textOnAccent : colors.text },
                  ]}
                >
                  {themeLabel[mode]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.row, { borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.text }]}>{t("deck.label")}</Text>
        <View style={styles.pillGroup}>
          {availableDecks.map((id) => {
            const active = id === activeDeck.id;
            return (
              <Pressable
                key={id}
                onPress={() => setDeck(id)}
                style={[
                  styles.pill,
                  { backgroundColor: active ? colors.accent : colors.surfaceAlt },
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  active ? t("deck.selected", { name: id }) : t("deck.select", { name: id })
                }
                accessibilityState={{ selected: active }}
                testID={`deck-pill-${id}`}
              >
                <Text
                  style={[styles.pillText, { color: active ? colors.textOnAccent : colors.text }]}
                >
                  {id.charAt(0).toUpperCase() + id.slice(1)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.row, { borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.text }]}>
          {t("settings.language", "Language")}
        </Text>
        <LanguageSwitcher />
      </View>

      <View style={[styles.row, { borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.text }]}>
          {t("settings.soundEffects", "Sound effects")}
        </Text>
        <Switch
          value={!muted}
          onValueChange={(enabled) => setMuted(!enabled)}
          trackColor={{ false: colors.surfaceAlt, true: colors.accent }}
          thumbColor={colors.textOnAccent}
          accessibilityRole="switch"
          accessibilityLabel={t("settings.soundEffects", "Sound effects")}
          accessibilityState={{ checked: !muted }}
          testID="sound-effects-toggle"
        />
      </View>

      <View style={[styles.rowStacked, { borderColor: colors.border }]}>
        <View style={styles.rowStackedText}>
          <Text style={[styles.label, { color: colors.text }]}>
            {t("clearLogs.label", "Clear local logs")}
          </Text>
          <Text style={[styles.description, { color: colors.text, opacity: 0.7 }]}>
            {t("clearLogs.description")}
          </Text>
        </View>
        <Pressable
          onPress={() => setConfirmVisible(true)}
          style={[styles.destructive, { backgroundColor: colors.surfaceAlt }]}
          testID="clear-logs-button"
          accessibilityRole="button"
          accessibilityLabel={t("clearLogs.label")}
        >
          <Text style={{ color: colors.text }}>{t("clearLogs.button", "Clear")}</Text>
        </Pressable>
      </View>

      <View style={[styles.rowStacked, { borderColor: colors.border }]}>
        <View style={styles.rowStackedText}>
          <Text style={[styles.label, { color: colors.text }]}>
            {t("deleteData.label", "Delete my data")}
          </Text>
          <Text style={[styles.description, { color: colors.text, opacity: 0.7 }]}>
            {t("deleteData.description")}
          </Text>
        </View>
        <Pressable
          onPress={() => setDeleteConfirmVisible(true)}
          style={[styles.destructive, { backgroundColor: colors.error }]}
          testID="delete-data-button"
          accessibilityRole="button"
          accessibilityLabel={t("deleteData.label")}
        >
          <Text style={[styles.destructiveText, { color: colors.textOnAccent }]}>
            {t("deleteData.button", "Delete")}
          </Text>
        </Pressable>
      </View>

      <Modal
        visible={confirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmVisible(false)}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: MODAL_SCRIM }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {t("clearLogs.confirm.title")}
            </Text>
            <Text style={[styles.modalBody, { color: colors.text }]}>
              {t("clearLogs.confirm.body")}
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setConfirmVisible(false)}
                style={[styles.modalButton, { backgroundColor: colors.surfaceAlt }]}
                testID="clear-logs-cancel"
                accessibilityRole="button"
              >
                <Text style={{ color: colors.text }}>{t("clearLogs.confirm.cancel")}</Text>
              </Pressable>
              <Pressable
                onPress={handleClearLogs}
                style={[styles.modalButton, { backgroundColor: colors.error }]}
                testID="clear-logs-confirm"
                accessibilityRole="button"
              >
                <Text style={[styles.modalDestructiveText, { color: colors.textOnAccent }]}>
                  {t("clearLogs.confirm.confirm")}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={deleteConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteConfirmVisible(false)}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: MODAL_SCRIM }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {t("deleteData.confirm.title")}
            </Text>
            <Text style={[styles.modalBody, { color: colors.text }]}>
              {t("deleteData.confirm.body")}
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setDeleteConfirmVisible(false)}
                style={[styles.modalButton, { backgroundColor: colors.surfaceAlt }]}
                testID="delete-data-cancel"
                accessibilityRole="button"
              >
                <Text style={{ color: colors.text }}>{t("deleteData.confirm.cancel")}</Text>
              </Pressable>
              <Pressable
                onPress={handleDeleteData}
                style={[styles.modalButton, { backgroundColor: colors.error }]}
                testID="delete-data-confirm"
                accessibilityRole="button"
              >
                <Text style={[styles.modalDestructiveText, { color: colors.textOnAccent }]}>
                  {t("deleteData.confirm.confirm")}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {successVisible && (
        <View style={[styles.toast, { backgroundColor: colors.surface }]}>
          <Text style={{ color: colors.text }}>{t("clearLogs.success")}</Text>
        </View>
      )}

      {deleteSuccessVisible && (
        <View style={[styles.toast, { backgroundColor: colors.surface }]}>
          <Text style={{ color: colors.text }}>{t("deleteData.success")}</Text>
        </View>
      )}

      {deleteErrorVisible && (
        <View style={[styles.toast, { backgroundColor: colors.error }]}>
          <Text style={{ color: colors.textOnAccent }}>{t("deleteData.error")}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  rowStacked: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    borderBottomWidth: 1,
    gap: 12,
  },
  rowStackedText: { flex: 1 },
  label: { fontSize: 16 },
  description: { fontSize: 13, marginTop: 4 },
  destructive: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  destructiveText: { fontWeight: "600" },
  segmented: { flexDirection: "row", borderRadius: 8, padding: 2 },
  segment: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    minWidth: 60,
    alignItems: "center",
  },
  segmentText: { fontSize: 14, fontWeight: "500" },
  pillGroup: { flexDirection: "row", gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  pillText: { fontSize: 14, fontWeight: "500" },
  modalBackdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 12,
    padding: 24,
  },
  modalTitle: { fontSize: 18, fontWeight: "600", marginBottom: 12 },
  modalBody: { fontSize: 14, lineHeight: 20, marginBottom: 20 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  modalButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  modalDestructiveText: { fontWeight: "600" },
  toast: {
    position: "absolute",
    bottom: 40,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    elevation: 4,
  },
});
