import React, { useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import type { HandDebugLog } from "../../game/hearts/debugLog";
import { cardStr, formatSessionAsMarkdown } from "../../game/hearts/debugLog";

interface Props {
  visible: boolean;
  onClose: () => void;
  logs: readonly HandDebugLog[];
  notes: string[];
  playerLabels: string[];
  aiDifficulty: string;
  onNotesChange: (handIdx: number, text: string) => void;
}

async function copyToClipboard(text: string): Promise<void> {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  }
}

function passLabel(dir: string): string {
  const map: Record<string, string> = {
    left: "Pass Left",
    right: "Pass Right",
    across: "Pass Across",
    none: "No Pass",
  };
  return map[dir] ?? dir;
}

function passOffset(dir: string): number {
  if (dir === "left") return 1;
  if (dir === "right") return 3;
  if (dir === "across") return 2;
  return 0;
}

interface HandSectionProps {
  log: HandDebugLog;
  handIdx: number;
  note: string;
  playerLabels: string[];
  onNotesChange: (handIdx: number, text: string) => void;
}

function HandSection({ log, handIdx, note, playerLabels, onNotesChange }: HandSectionProps) {
  const { colors } = useTheme();
  const label = (i: number) => playerLabels[i] ?? `P${i}`;

  const offset = passOffset(log.passDirection);

  return (
    <View style={[styles.handSection, { borderColor: colors.border }]}>
      <Text style={[styles.handTitle, { color: colors.accent }]}>
        Hand {log.handNumber} — {passLabel(log.passDirection)}
      </Text>

      <Text style={[styles.sectionHeader, { color: colors.text }]}>Initial Deals</Text>
      {[0, 1, 2, 3].map((i) => (
        <Text key={i} style={[styles.handRow, { color: colors.textMuted }]}>
          <Text style={{ color: colors.text }}>{label(i)}: </Text>
          {(log.initialHands[i] ?? []).map(cardStr).join(" ") || "—"}
        </Text>
      ))}

      {log.passDirection !== "none" && (
        <>
          <Text style={[styles.sectionHeader, { color: colors.text }]}>Pass Selections</Text>
          {[0, 1, 2, 3].map((from) => {
            const to = (from + offset) % 4;
            const sel = log.passSelections[from] ?? [];
            return (
              <Text key={from} style={[styles.handRow, { color: colors.textMuted }]}>
                <Text style={{ color: colors.text }}>
                  {label(from)} → {label(to)}:{" "}
                </Text>
                {sel.map(cardStr).join(" ") || "—"}
              </Text>
            );
          })}

          <Text style={[styles.sectionHeader, { color: colors.text }]}>Final Hands</Text>
          {[0, 1, 2, 3].map((i) => (
            <Text key={i} style={[styles.handRow, { color: colors.textMuted }]}>
              <Text style={{ color: colors.text }}>{label(i)}: </Text>
              {(log.finalHands[i] ?? []).map(cardStr).join(" ") || "—"}
            </Text>
          ))}
        </>
      )}

      <Text style={[styles.sectionHeader, { color: colors.text }]}>
        Tricks ({log.tricks.length})
      </Text>
      {log.tricks.map((trick, t) => {
        const byPlayer: string[] = ["—", "—", "—", "—"];
        for (const play of trick.plays) {
          const s = cardStr(play.card);
          byPlayer[play.playerIndex] =
            play.playerIndex === trick.winnerIndex ? `[${s}]` : s;
        }
        return (
          <Text key={t} style={[styles.trickRow, { color: colors.textMuted }]}>
            <Text style={{ color: colors.text }}>T{t + 1} </Text>
            {byPlayer.map((c, i) => `${label(i)}:${c}`).join("  ")}
            {"  "}
            <Text style={{ color: colors.accent }}>
              → {label(trick.winnerIndex)}
              {trick.pointsWon > 0 ? ` +${trick.pointsWon}` : ""}
            </Text>
          </Text>
        );
      })}

      <Text style={[styles.sectionHeader, { color: colors.text }]}>Scores</Text>
      <Text style={[styles.handRow, { color: colors.textMuted }]}>
        {[0, 1, 2, 3]
          .map((i) => `${label(i)} +${log.scoreDeltas[i] ?? 0}`)
          .join("  ")}
      </Text>
      <Text style={[styles.handRow, { color: colors.textMuted }]}>
        Running:{" "}
        {[0, 1, 2, 3]
          .map((i) => `${label(i)} ${log.cumulativeScoresAfter[i] ?? 0}`)
          .join("  ")}
      </Text>

      <Text style={[styles.sectionHeader, { color: colors.text }]}>Notes</Text>
      <TextInput
        style={[
          styles.noteInput,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
        ]}
        value={note}
        onChangeText={(text) => onNotesChange(handIdx, text)}
        placeholder="Observations about this hand..."
        placeholderTextColor={colors.textMuted}
        multiline
        numberOfLines={3}
      />
    </View>
  );
}

export default function HeartsDebugPanel({
  visible,
  onClose,
  logs,
  notes,
  playerLabels,
  aiDifficulty,
  onNotesChange,
}: Props) {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const text = formatSessionAsMarkdown(logs, notes, playerLabels, aiDifficulty);
    try {
      await copyToClipboard(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Hearts Debugger{logs.length > 0 ? ` — ${logs.length} hand${logs.length !== 1 ? "s" : ""}` : ""}
          </Text>
          <View style={styles.headerActions}>
            <Pressable
              style={[styles.copyBtn, { backgroundColor: copied ? colors.accent : colors.surfaceAlt }]}
              onPress={() => void handleCopy()}
              accessibilityRole="button"
              accessibilityLabel="Copy session to clipboard"
            >
              <Text style={[styles.copyBtnText, { color: copied ? colors.textOnAccent : colors.text }]}>
                {copied ? "Copied!" : "Copy"}
              </Text>
            </Pressable>
            <Pressable
              style={styles.closeBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close debugger"
            >
              <Text style={[styles.closeBtnText, { color: colors.text }]}>✕</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {logs.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>
              No hands logged yet. Play a hand to see debug data here.
            </Text>
          ) : (
            logs.map((log, i) => (
              <HandSection
                key={i}
                log={log}
                handIdx={i}
                note={notes[i] ?? ""}
                playerLabels={playerLabels}
                onNotesChange={onNotesChange}
              />
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 52,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    flex: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  copyBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  copyBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  closeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  closeBtnText: {
    fontSize: 18,
    fontWeight: "600",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  emptyText: {
    textAlign: "center",
    marginTop: 40,
    fontSize: 14,
  },
  handSection: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  handTitle: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 4,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  handRow: {
    fontSize: 12,
    fontFamily: "monospace",
    flexWrap: "wrap",
  },
  trickRow: {
    fontSize: 11,
    fontFamily: "monospace",
    flexWrap: "wrap",
  },
  noteInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    minHeight: 64,
    textAlignVertical: "top",
    marginTop: 4,
  },
});
