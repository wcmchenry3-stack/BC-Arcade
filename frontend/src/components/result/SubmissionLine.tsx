import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useTranslation } from "react-i18next";
import type { Colors } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import JoinLeaderboardsPrompt from "../shared/JoinLeaderboardsPrompt";
import type { IconName, ResultSubmission } from "./resultTypes";

/**
 * The card's leaderboard line: the only part of the card that knows the
 * rank-lookup status (`RankLookupStatus`, from `useGameRank`).
 */
export function SubmissionLine({
  submission,
  colors,
}: {
  submission: ResultSubmission;
  colors: Colors;
}) {
  const { t } = useTranslation("result");
  const { status, rank, isBest, playerName, onJoinLeaderboards, onRetry } = submission;

  // Nothing submitted yet (or this outcome isn't submitted), or the game is on
  // no board (#2677): no line at all.
  if (status === "idle" || status === "unranked") return null;

  if (status === "needsName") {
    return (
      <View style={[styles.namePrompt, { backgroundColor: colors.surfaceAlt }]}>
        <JoinLeaderboardsPrompt testID="result-name-prompt" onJoin={onJoinLeaderboards} />
      </View>
    );
  }

  let icon: IconName = "check";
  let text: string;
  let color = colors.textMuted;
  switch (status) {
    case "saved":
      // The rank is always the player's best entry's (#2633): this game's
      // placing when it is that entry, else "Your best: #N".
      text =
        rank == null
          ? t("submission.saved", { name: playerName ?? "" })
          : isBest === false
            ? t("submission.savedBest", { name: playerName ?? "", rank })
            : t("submission.savedRanked", { name: playerName ?? "", rank });
      break;
    case "offline":
      icon = "cloud-off-outline";
      text = t("submission.offline");
      break;
    case "error":
      icon = "alert-circle-outline";
      text = t("submission.error");
      color = colors.error;
      break;
    case "submitting":
      icon = "cloud-upload-outline";
      text = t("submission.saving");
      break;
  }

  return (
    <View style={styles.submission}>
      <View
        style={styles.submissionLine}
        accessible
        accessibilityLiveRegion="polite"
        accessibilityRole={status === "error" ? "alert" : "text"}
      >
        <MaterialCommunityIcons name={icon} size={16} color={color} />
        <Text style={[styles.submissionText, { color }]}>{text}</Text>
      </View>
      {status === "error" && onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={t("submission.retry")}
          hitSlop={8}
        >
          <Text style={[styles.retryText, { color: colors.text }]}>{t("submission.retry")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  namePrompt: { alignSelf: "stretch", padding: 14, borderRadius: 12 },
  submission: { alignItems: "center", gap: 6 },
  submissionLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  submissionText: { fontFamily: typography.bodyMedium, fontSize: 13, textAlign: "center" },
  retryText: {
    fontFamily: typography.label,
    fontSize: 14,
    textDecorationLine: "underline",
  },
});
