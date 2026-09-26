import React, { useState } from "react";
import { View, Text, Pressable, Modal, FlatList, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { LOCALES, NATIVE_LOCALES } from "../i18n/locales";
import { useTheme } from "../theme/ThemeContext";

export default function LanguageSwitcher() {
  const { i18n, t } = useTranslation("common");
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  const current = LOCALES.find((l) => l.code === i18n.language) ?? LOCALES[0];
  if (current === undefined) return null;

  function select(code: string) {
    i18n.changeLanguage(code);
    setOpen(false);
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.trigger, { borderColor: colors.border }]}
        accessibilityRole="button"
        accessibilityLabel={t("lang.switcherLabel")}
        accessibilityState={{ expanded: open }}
      >
        <Text style={[styles.triggerText, { color: colors.textMuted }]}>
          {current.flag} {current.nativeLabel}
        </Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        accessibilityViewIsModal
      >
        <Pressable
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}
          onPress={() => setOpen(false)}
        >
          <View
            style={[styles.sheet, { backgroundColor: colors.modalBg, borderColor: colors.border }]}
          >
            <FlatList
              data={NATIVE_LOCALES}
              keyExtractor={(item) => item.code}
              renderItem={({ item }) => {
                const active = item.code === i18n.language;
                return (
                  <Pressable
                    onPress={() => select(item.code)}
                    style={[
                      styles.option,
                      { borderBottomColor: colors.border },
                      active && { backgroundColor: colors.surfaceAlt },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${item.nativeLabel} — ${item.label}`}
                  >
                    <Text style={[styles.optionText, { color: colors.text }]}>
                      {item.flag} {item.nativeLabel}
                    </Text>
                    {active && <Text style={[styles.check, { color: colors.accent }]}>✓</Text>}
                  </Pressable>
                );
              }}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  triggerText: {
    fontSize: 13,
  },
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    maxHeight: 480,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    minHeight: 44,
  },
  optionText: {
    fontSize: 15,
  },
  check: {
    fontSize: 16,
    fontWeight: "700",
  },
});
