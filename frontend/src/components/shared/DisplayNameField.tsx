import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import {
  DISPLAY_NAME_MAX_LENGTH,
  normalizeDisplayName,
  useDisplayName,
} from "../../game/_shared/displayName";

export interface DisplayNameFieldProps {
  /** Visible label above the input. */
  label: string;
  /** Helper line under the input. */
  helper: string;
  /** Called with the saved name after a successful save. */
  onSaved?: (name: string) => void;
  /** The input gets `${testID}-input` and the Save button `${testID}-save`. */
  testID?: string;
}

/**
 * Label + text input + Save for the player's display name (#2502). Used on the
 * Profile screen and, as the one-time prompt, on the end-of-game result card.
 */
export default function DisplayNameField({
  label,
  helper,
  onSaved,
  testID,
}: DisplayNameFieldProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("profile");
  const { name, isLoaded, setName } = useDisplayName();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  // Seed the input with the stored name once it loads (or changes elsewhere),
  // but never over text the player has started typing.
  const edited = useRef(false);
  useEffect(() => {
    if (isLoaded && !edited.current) setDraft(name ?? "");
    // Removed elsewhere (Profile's "Remove my name", #2637): an earlier "Saved" no longer holds.
    if (name == null) setStatus((s) => (s === "saved" ? "idle" : s));
  }, [isLoaded, name]);

  const valid = normalizeDisplayName(draft);
  const unchanged = valid != null && valid === name;
  const canSave = valid != null && !unchanged && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    const saved = await setName(draft);
    setSaving(false);
    if (saved) {
      edited.current = false;
      setDraft(saved);
      setStatus("saved");
      onSaved?.(saved);
    } else {
      setStatus("error");
    }
  }

  return (
    <View testID={testID} style={styles.container}>
      <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>
      <View style={styles.row}>
        <TextInput
          testID={testID ? `${testID}-input` : undefined}
          value={draft}
          onChangeText={(text) => {
            edited.current = true;
            setDraft(text);
            setStatus("idle");
          }}
          placeholder={t("displayName.placeholder")}
          placeholderTextColor={colors.textMuted}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={handleSave}
          accessibilityLabel={label}
          style={[
            styles.input,
            {
              color: colors.text,
              backgroundColor: colors.surfaceHigh,
              borderColor: colors.textMuted,
            },
          ]}
        />
        <Pressable
          testID={testID ? `${testID}-save` : undefined}
          onPress={handleSave}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel={t("displayName.save")}
          accessibilityState={{ disabled: !canSave, busy: saving }}
          style={[
            styles.saveBtn,
            { backgroundColor: colors.accentBright, opacity: canSave ? 1 : 0.4 },
          ]}
        >
          <Text style={[styles.saveText, { color: colors.textOnAccent }]}>
            {t("displayName.save")}
          </Text>
        </Pressable>
      </View>
      {status === "saved" ? (
        <Text accessibilityLiveRegion="polite" style={[styles.helper, { color: colors.text }]}>
          {t("displayName.saved")}
        </Text>
      ) : status === "error" ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={[styles.helper, { color: colors.error }]}
        >
          {t("displayName.saveError")}
        </Text>
      ) : (
        <Text style={[styles.helper, { color: colors.textMuted }]}>{helper}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  label: {
    fontFamily: typography.label,
    fontSize: 13,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  row: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1,
    minWidth: 0,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    fontFamily: typography.bodyMedium,
    fontSize: 16,
  },
  saveBtn: {
    height: 48,
    minWidth: 72,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: { fontFamily: typography.label, fontSize: 15 },
  helper: { fontFamily: typography.body, fontSize: 13 },
});
