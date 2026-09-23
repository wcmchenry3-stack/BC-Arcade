import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
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

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 2000;

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function FeedbackWidget({ visible, onClose }: Props) {
  const { t } = useTranslation("feedback");
  const { colors } = useTheme();
  const { status, error, submit, reset } = useFeedbackSubmit();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<FeedbackType>("bug");
  const [titleError, setTitleError] = useState("");
  const [descError, setDescError] = useState("");

  function handleClose() {
    reset();
    setTitle("");
    setDescription("");
    setType("bug");
    setTitleError("");
    setDescError("");
    onClose();
  }

  function validate(): boolean {
    let valid = true;
    if (!title.trim()) {
      setTitleError(t("error_title_required"));
      valid = false;
    } else {
      setTitleError("");
    }
    if (!description.trim()) {
      setDescError(t("error_description_required"));
      valid = false;
    } else {
      setDescError("");
    }
    return valid;
  }

  async function handleSubmit() {
    if (!validate()) return;
    await submit({ title: title.trim(), description: description.trim(), type });
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
      <View style={s.overlay}>
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
            {status === "success" ? (
              /* ── Success state ── */
              <View style={s.successContainer} accessibilityLiveRegion="polite">
                <Text style={s.successTitle}>{t("submit_success")}</Text>
                <Pressable
                  style={[s.primaryBtn, { backgroundColor: colors.accent }]}
                  onPress={handleClose}
                  accessibilityRole="button"
                >
                  <Text style={[s.primaryBtnText, { color: colors.textOnAccent }]}>
                    {t("close_label")}
                  </Text>
                </Pressable>
              </View>
            ) : (
              /* ── Form state ── */
              <>
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

                {/* Title field */}
                <Text style={s.label} nativeID="feedback-title-label">
                  {t("label_title")}
                </Text>
                <TextInput
                  style={[
                    s.input,
                    {
                      color: colors.text,
                      backgroundColor: colors.surfaceAlt,
                      borderColor: titleError ? colors.error : colors.border,
                    },
                  ]}
                  value={title}
                  onChangeText={(v) => {
                    setTitle(v.slice(0, TITLE_MAX));
                    if (titleError) setTitleError("");
                  }}
                  placeholder={t("placeholder_title")}
                  placeholderTextColor={colors.textMuted}
                  maxLength={TITLE_MAX}
                  returnKeyType="next"
                  accessibilityLabelledBy="feedback-title-label"
                  accessibilityRequired
                />
                {titleError ? (
                  <Text style={[s.fieldError, { color: colors.error }]} accessibilityRole="alert">
                    {titleError}
                  </Text>
                ) : (
                  <Text style={[s.charCount, { color: colors.textMuted }]}>
                    {title.length}/{TITLE_MAX}
                  </Text>
                )}

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
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>["colors"]) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(0,0,0,0.55)",
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: "90%",
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
      flex: 1,
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
    input: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
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
    successContainer: {
      alignItems: "center",
      paddingVertical: 24,
      gap: 12,
    },
    successTitle: {
      fontSize: 17,
      fontWeight: "600",
      color: colors.text,
      textAlign: "center",
    },
  });
}
