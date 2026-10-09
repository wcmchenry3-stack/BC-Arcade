import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { ConfirmModal } from "../shared/ConfirmModal";
import { useDisplayName } from "../../game/_shared/displayName";
import {
  joinLeaderboards,
  leaveLeaderboards,
  refreshDisplayNameFromServer,
  rerollDisplayName,
  useLeaderboardSyncPending,
} from "../../game/_shared/displayNameSync";
import { useNetwork } from "../../game/_shared/NetworkContext";

/**
 * Leaderboard participation (#2637, #2778). Players never type a public name:
 * "Join leaderboards" is the explicit opt-in and the server generates the
 * name; "Get a new name" asks it for another; "Leave leaderboards" takes the
 * player off every board.
 *
 * States, in order: a leave still waiting to reach the server; a join still
 * waiting (no name yet; it can be cancelled with "Leave"); on the boards under
 * a name; not on any board.
 */
export default function LeaderboardMembership() {
  const { colors } = useTheme();
  const { t } = useTranslation("profile");
  const { isOnline } = useNetwork();
  const { name, isLoaded } = useDisplayName();
  const pending = useLeaderboardSyncPending();
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [busy, setBusy] = useState<"join" | "reroll" | null>(null);
  const [error, setError] = useState<"join" | "reroll" | "leave" | null>(null);

  // The server is the source of truth for the name (it replaced typed names
  // with generated ones): bring this device's copy up to date when online.
  useEffect(() => {
    if (isOnline) void refreshDisplayNameFromServer();
  }, [isOnline]);

  const handleJoin = useCallback(async () => {
    setError(null);
    setBusy("join");
    const ok = await joinLeaderboards();
    setBusy(null);
    if (!ok) setError("join");
  }, []);

  const handleReroll = useCallback(async () => {
    setError(null);
    setBusy("reroll");
    const result = await rerollDisplayName();
    setBusy(null);
    // "not_joined": the device now shows the not-on-boards state, which says
    // it all; it isn't a connection problem.
    if (result.status === "failed") setError("reroll");
  }, []);

  const handleLeave = useCallback(async () => {
    setConfirmVisible(false);
    setError(null);
    if (!(await leaveLeaderboards())) setError("leave");
  }, []);

  if (!isLoaded) return null;

  const link = (
    label: string,
    icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"],
    onPress: () => void,
    testID: string,
    disabled = false
  ) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      testID={testID}
      hitSlop={4}
      style={({ pressed }) => [styles.linkButton, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}
    >
      <MaterialCommunityIcons name={icon} size={18} color={colors.text} />
      <Text style={[styles.linkText, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );

  let body: React.ReactNode;
  if (pending === "leave") {
    body = (
      <Text
        accessibilityLiveRegion="polite"
        testID="profile-name-removing"
        style={[styles.presenceText, { color: colors.textMuted }]}
      >
        {t("boards.leaving")}
      </Text>
    );
  } else if (name == null && pending === "join") {
    body = (
      <>
        <Text
          accessibilityLiveRegion="polite"
          testID="profile-joining"
          style={[styles.presenceText, { color: colors.textMuted }]}
        >
          {t(isOnline ? "boards.joiningOnline" : "boards.joining")}
        </Text>
        {link(
          t("boards.leave"),
          "account-remove-outline",
          () => {
            setError(null);
            setConfirmVisible(true);
          },
          "profile-cancel-join"
        )}
      </>
    );
  } else if (name != null) {
    body = (
      <>
        <Text
          accessibilityLiveRegion="polite"
          testID="profile-board-name"
          style={[styles.presenceName, { color: colors.text }]}
        >
          {t("boards.onBoardsAs", { name })}
        </Text>
        <Text style={[styles.presenceText, { color: colors.textMuted }]}>
          {t("boards.generatedHelper")}
        </Text>
        {link(
          t("boards.reroll"),
          "dice-multiple-outline",
          () => void handleReroll(),
          "profile-reroll-name",
          busy != null || !isOnline
        )}
        {link(
          t("boards.leave"),
          "account-remove-outline",
          () => {
            setError(null);
            setConfirmVisible(true);
          },
          "profile-remove-name"
        )}
      </>
    );
  } else {
    body = (
      <>
        <Text
          accessibilityLiveRegion="polite"
          testID="profile-not-on-boards"
          style={[styles.presenceText, { color: colors.textMuted }]}
        >
          {t("boards.notOnBoards")}
        </Text>
        <Pressable
          onPress={() => void handleJoin()}
          disabled={busy != null}
          accessibilityRole="button"
          accessibilityLabel={t("boards.join")}
          accessibilityState={{ disabled: busy != null, busy: busy === "join" }}
          testID="profile-join-boards"
          style={[
            styles.joinButton,
            { backgroundColor: colors.accentBright, opacity: busy != null ? 0.4 : 1 },
          ]}
        >
          <Text style={[styles.joinText, { color: colors.textOnAccent }]}>{t("boards.join")}</Text>
        </Pressable>
      </>
    );
  }

  const errorKey =
    error === "join"
      ? "boards.joinError"
      : error === "reroll"
        ? "boards.rerollError"
        : error === "leave"
          ? "boards.leaveError"
          : null;

  return (
    <View style={styles.presence} testID="profile-display-name">
      <Text style={[styles.membershipLabel, { color: colors.textMuted }]}>{t("boards.title")}</Text>
      {body}
      {errorKey != null && (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={[styles.presenceText, { color: colors.error }]}
        >
          {t(errorKey)}
        </Text>
      )}
      <ConfirmModal
        visible={confirmVisible}
        title={t("boards.confirm.title")}
        body={t("boards.confirm.body")}
        confirmLabel={t("boards.confirm.confirm")}
        cancelLabel={t("boards.confirm.cancel")}
        destructive
        onConfirm={handleLeave}
        onCancel={() => setConfirmVisible(false)}
        testID="profile-remove-name-confirm"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  presence: { gap: 6 },
  membershipLabel: {
    fontFamily: typography.label,
    fontSize: 13,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  presenceName: { fontFamily: typography.bodyMedium, fontSize: 16 },
  presenceText: { fontFamily: typography.body, fontSize: 13 },
  joinButton: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  joinText: { fontFamily: typography.label, fontSize: 15 },
  linkButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    minHeight: 44,
  },
  linkText: {
    fontFamily: typography.bodyMedium,
    fontSize: 14,
    textDecorationLine: "underline",
  },
});
