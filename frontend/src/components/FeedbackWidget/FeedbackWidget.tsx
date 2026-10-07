import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { useFeedbackSubmit, FeedbackType } from "./useFeedbackSubmit";

const DESCRIPTION_MAX = 2000;

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called once feedback is sent, after the sheet has closed itself. */
  onSubmitted?: () => void;
}

export default function FeedbackWidget({ visible, onClose, onSubmitted }: Props) {
  const { t } = useTranslation("feedback");
  const { colors } = useTheme();
  const { status, error, submit, reset } = useFeedbackSubmit();

  const [description, setDescription] = useState("");
  const [type, setType] = useState<FeedbackType>("bug");
  const [descError, setDescError] = useState("");

  // Bumped on every close so a submit that resolves after the player already
  // dismissed the sheet does not close (and reset) it a second time.
  const closeCountRef = useRef(0);

  function handleClose() {
    closeCountRef.current += 1;
    reset();
    setDescription("");
    setType("bug");
    setDescError("");
    onClose();
  }

  function validate(): boolean {
    if (!description.trim()) {
      setDescError(t("error_description_required"));
      return false;
    }
    setDescError("");
    return true;
  }

  async function handleSubmit() {
    if (!validate()) return;
    // Success closes the sheet; the host shows the thank-you banner.
    const closesBefore = closeCountRef.current;
    if (await submit({ description: description.trim(), type })) {
      if (closeCountRef.current === closesBefore) handleClose();
      onSubmitted?.();
    }
  }

  const isSubmitting = status === "submitting";
  const s = makeStyles(colors);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      accessibilityViewIsModal
    >
      {/* #2482 — the description field sits at the bottom of the sheet, so
          without this the keyboard covers what the player is typing. "padding"
          on iOS; Android resizes the window itself, so "height" is a no-op
          there and the default adjustResize handles it. */}
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.sheet}>
          {/* Header */}
          <View style={s.header}>
            <Text style={s.heading} accessibilityRole="header">
              {t("title")}
            </Text>
            <Pressable
              onPress={handleClose}
              style={s.closeBtn}
              accessibilityRole="button"
              accessibilityLabel={t("close_label")}
            >
              <Text style={s.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            style={s.body}
            contentContainerStyle={s.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Error banner */}
            {status === "error" && error && (
              <View
                style={[s.errorBanner, { borderColor: colors.error }]}
                accessibilityLiveRegion="assertive"
                accessibilityRole="alert"
              >
                <Text style={[s.errorBannerText, { color: colors.error }]}>
                  {error.kind === "rate_limit"
                    ? t("submit_error_rate_limit", {
                        seconds: error.retryAfterSeconds ?? 60,
                      })
                    : t("submit_error")}
                </Text>
              </View>
            )}

            {/* Type selector */}
            <Text style={s.label}>{t("type_label")}</Text>
            <View style={s.typeRow}>
              {(["bug", "feature"] as FeedbackType[]).map((ft) => (
                <Pressable
                  key={ft}
                  style={[
                    s.typeChip,
                    {
                      backgroundColor: type === ft ? colors.accent : colors.surface,
                      borderColor: type === ft ? colors.accent : colors.border,
                    },
                  ]}
                  onPress={() => setType(ft)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: type === ft }}
                  accessibilityLabel={t(`type_${ft}`)}
                >
                  <Text
                    style={[
                      s.typeChipText,
                      {
                        color: type === ft ? colors.textOnAccent : colors.text,
                      },
                    ]}
                  >
                    {t(`type_${ft}`)}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Description field */}
            <Text style={s.label} nativeID="feedback-desc-label">
              {t("label_description")}
            </Text>
            <TextInput
              style={[
                s.textarea,
                {
                  color: colors.text,
                  backgroundColor: colors.surfaceAlt,
                  borderColor: descError ? colors.error : colors.border,
                },
              ]}
              value={description}
              onChangeText={(v) => {
                setDescription(v.slice(0, DESCRIPTION_MAX));
                if (descError) setDescError("");
              }}
              placeholder={t("placeholder_description")}
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={5}
              maxLength={DESCRIPTION_MAX}
              textAlignVertical="top"
              accessibilityLabelledBy="feedback-desc-label"
              accessibilityRequired
            />
            {descError ? (
              <Text style={[s.fieldError, { color: colors.error }]} accessibilityRole="alert">
                {descError}
              </Text>
            ) : (
              <Text style={[s.charCount, { color: colors.textMuted }]}>
                {description.length}/{DESCRIPTION_MAX}
              </Text>
            )}

            {/* Submit */}
            <Pressable
              style={[
                s.primaryBtn,
                { backgroundColor: isSubmitting ? colors.border : colors.accent },
              ]}
              onPress={handleSubmit}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityState={{ disabled: isSubmitting, busy: isSubmitting }}
              accessibilityLabel={t("submit")}
            >
              {isSubmitting ? (
                <ActivityIndicator color={colors.textOnAccent} />
              ) : (
                <Text style={[s.primaryBtnText, { color: colors.textOnAccent }]}>
                  {t("submit")}
                </Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>["colors"]) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: colors.overlay,
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: "90%",
      // #2482 — the sheet has no fixed height, so it must be allowed to shrink
      // inside the 90% cap rather than being sized purely by its content.
      flexShrink: 1,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    heading: {
      fontSize: 17,
      fontWeight: "600",
      color: colors.text,
    },
    closeBtn: {
      padding: 6,
      borderRadius: 16,
    },
    closeBtnText: {
      fontSize: 16,
      color: colors.textMuted,
    },
    body: {
      // #2482 — NOT `flex: 1`. The sheet's own height is content-derived, and a
      // flex-grow child inside a container with an indefinite main size has no
      // remaining space to grow into: on iOS the ScrollView measured to nothing
      // and the sheet collapsed to its header, which is the reported "only a
      // sliver peeking out". flexShrink lets it take its content height and
      // give way once the sheet hits maxHeight, which is when scrolling starts.
      flexShrink: 1,
    },
    bodyContent: {
      padding: 20,
      paddingBottom: 36,
      gap: 6,
    },
    label: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.textMuted,
      marginTop: 12,
      marginBottom: 4,
    },
    typeRow: {
      flexDirection: "row",
      gap: 10,
      marginBottom: 4,
    },
    typeChip: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
    },
    typeChipText: {
      fontSize: 14,
      fontWeight: "500",
    },
    textarea: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      minHeight: 120,
    },
    charCount: {
      fontSize: 12,
      textAlign: "right",
    },
    fieldError: {
      fontSize: 12,
    },
    errorBanner: {
      borderWidth: 1,
      borderRadius: 8,
      padding: 12,
      marginBottom: 4,
    },
    errorBannerText: {
      fontSize: 14,
    },
    primaryBtn: {
      marginTop: 20,
      paddingVertical: 14,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryBtnText: {
      fontSize: 15,
      fontWeight: "600",
    },
  });
}
