import React, { useEffect, useRef, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../theme/ThemeContext";
import type {
  DebugPlay,
  DebugTrick,
  HandDebugLog,
  LiveDecisions,
} from "../../game/hearts/debugLog";
import {
  cardStr,
  formatSessionAsMarkdown,
  passDirectionLabel,
  passOffset,
} from "../../game/hearts/debugLog";
import type { AiPreset } from "../../game/hearts/types";
import { runPimcBenchmark, type LatencyRow } from "../../game/hearts/pimc/benchmark";
import { resolvePersona } from "../../game/hearts/types";

interface Props {
  visible: boolean;
  onClose: () => void;
  logs: readonly HandDebugLog[];
  notes: readonly string[];
  playerLabels: readonly string[];
  aiDifficulty: AiPreset;
  onNotesChange: (handIdx: number, text: string) => void;
  /** Called while rendering for the hand in progress (#3163); omit when not tracked. */
  getLive?: () => LiveDecisions | null;
}

async function copyToClipboard(text: string): Promise<void> {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  }
}

/**
 * PIMC engine timing on this device (#2587): times the engine on 30 real
 * decision points at 16 / 32 / 64 sampled deals and shows the median, p95
 * and worst case per move. Budget: under 1 s per move, aiming for 250 ms.
 */
function PimcTimingSection({ active }: { active: boolean }) {
  const { colors } = useTheme();
  const [rows, setRows] = useState<readonly LatencyRow[] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Stops a run when the panel closes or unmounts, so it never keeps
  // loading the JS thread behind the live game or overlaps a new run.
  const runId = useRef(0);
  useEffect(() => {
    if (!active) {
      runId.current++;
      setProgress(null);
    }
  }, [active]);
  useEffect(
    () => () => {
      runId.current++;
    },
    []
  );
  const run = async () => {
    const id = ++runId.current;
    const stale = () => runId.current !== id;
    setRows(null);
    setError(null);
    setProgress("0%");
    try {
      const result = await runPimcBenchmark({
        cancelled: stale,
        onProgress: (done, total) => {
          if (!stale()) setProgress(`${Math.round((100 * done) / total)}%`);
        },
      });
      if (!stale()) setRows(result);
    } catch (e) {
      if (!stale()) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!stale()) setProgress(null);
    }
  };
  const ms = (x: number) => `${Math.round(x)} ms`;
  return (
    <View style={[styles.handSection, { borderColor: colors.border }]}>
      <Text style={[styles.handTitle, { color: colors.accent }]}>
        PIMC engine timing ({Platform.OS})
      </Text>
      <Pressable
        style={[styles.copyBtn, { backgroundColor: colors.surfaceAlt, alignSelf: "flex-start" }]}
        onPress={() => void run()}
        disabled={progress !== null}
        accessibilityRole="button"
        accessibilityLabel="Run the PIMC engine timing benchmark"
      >
        <Text style={[styles.copyBtnText, { color: colors.text }]}>
          {progress !== null ? `Running… ${progress}` : "Run timing"}
        </Text>
      </Pressable>
      {error !== null && (
        <Text style={[styles.handRow, { color: colors.textMuted }]}>Failed: {error}</Text>
      )}
      {rows?.map((r) => (
        <Text key={r.samples} style={[styles.handRow, { color: colors.textMuted }]}>
          <Text style={{ color: colors.text }}>{r.samples} deals: </Text>
          median {ms(r.p50)} · p95 {ms(r.p95)} · worst {ms(r.max)} ({r.decisions} moves)
        </Text>
      ))}
    </View>
  );
}

/**
 * Why the conservative CPU played what it did (#3163): the last trick with
 * each play's principle ID, then a scrollable log of every CPU decision in the
 * hand. Plays without a principle (the human, legacy personas, older logs)
 * show "—"; with no CPU decisions at all the section is omitted.
 */
function CpuDecisionLog({
  tricks,
  pending,
  label,
  testID,
}: {
  tricks: readonly DebugTrick[];
  pending: readonly DebugPlay[];
  label: (i: number) => string;
  testID: string;
}) {
  const { colors } = useTheme();
  const rows: { key: string; trickNo: number; play: DebugPlay }[] = [];
  tricks.forEach((trick, t) =>
    trick.plays.forEach((play, p) => {
      if (play.principle !== undefined) rows.push({ key: `${t}-${p}`, trickNo: t + 1, play });
    })
  );
  pending.forEach((play, p) => {
    if (play.principle !== undefined) {
      rows.push({ key: `p-${p}`, trickNo: tricks.length + 1, play });
    }
  });
  if (rows.length === 0) return null;
  const last = tricks[tricks.length - 1];
  return (
    <View testID={testID}>
      <Text style={[styles.sectionHeader, { color: colors.text }]}>CPU principles</Text>
      {last && (
        <Text style={[styles.trickRow, { color: colors.textMuted }]}>
          <Text style={{ color: colors.text }}>Last trick (T{tricks.length}) </Text>
          {last.plays
            .map(
              (play) => `${label(play.playerIndex)}:${cardStr(play.card)} ${play.principle ?? "—"}`
            )
            .join("  ")}
        </Text>
      )}
      <ScrollView
        style={[styles.decisionScroll, { borderColor: colors.border }]}
        nestedScrollEnabled
        accessibilityLabel="CPU decision log"
      >
        {rows.map(({ key, trickNo, play }) => (
          <Text key={key} style={[styles.trickRow, { color: colors.textMuted }]}>
            <Text style={{ color: colors.text }}>
              T{trickNo} {label(play.playerIndex)} {cardStr(play.card)}{" "}
            </Text>
            <Text style={{ color: colors.accent }}>{play.principle ?? "—"}</Text>
            {play.reason ? ` ${play.reason}` : ""}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

interface HandSectionProps {
  log: HandDebugLog;
  handIdx: number;
  note: string;
  playerLabels: readonly string[];
  onNotesChange: (handIdx: number, text: string) => void;
}

function HandSection({ log, handIdx, note, playerLabels, onNotesChange }: HandSectionProps) {
  const { colors } = useTheme();
  const label = (i: number) => playerLabels[i] ?? `P${i}`;
  const offset = passOffset(log.passDirection);

  return (
    <View style={[styles.handSection, { borderColor: colors.border }]}>
      <Text style={[styles.handTitle, { color: colors.accent }]}>
        Hand {log.handNumber} — {passDirectionLabel(log.passDirection)}
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
                {sel
                  .map((card, k) => {
                    const principle = log.passDecisions?.[from]?.[k]?.principle;
                    return principle ? `${cardStr(card)} (${principle})` : cardStr(card);
                  })
                  .join(" ") || "—"}
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
      {log.tricks.map((trick, t) => (
        <Text key={t} style={[styles.trickRow, { color: colors.textMuted }]}>
          <Text style={{ color: colors.text }}>T{t + 1} </Text>
          {trick.plays
            .map((play) => {
              const s = cardStr(play.card);
              const cell = play.playerIndex === trick.winnerIndex ? `[${s}]` : s;
              return `${label(play.playerIndex)}:${cell}`;
            })
            .join("  ")}
          {"  "}
          <Text style={{ color: colors.accent }}>
            → {label(trick.winnerIndex)}
            {trick.pointsWon > 0 ? ` +${trick.pointsWon}` : ""}
          </Text>
        </Text>
      ))}

      <CpuDecisionLog
        tricks={log.tricks}
        pending={[]}
        label={label}
        testID={`cpu-principles-${handIdx}`}
      />

      <Text style={[styles.sectionHeader, { color: colors.text }]}>Scores</Text>
      <Text style={[styles.handRow, { color: colors.textMuted }]}>
        {[0, 1, 2, 3].map((i) => `${label(i)} +${log.scoreDeltas[i] ?? 0}`).join("  ")}
      </Text>
      <Text style={[styles.handRow, { color: colors.textMuted }]}>
        Running:{" "}
        {[0, 1, 2, 3].map((i) => `${label(i)} ${log.cumulativeScoresAfter[i] ?? 0}`).join("  ")}
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
  getLive,
}: Props) {
  const { colors } = useTheme();
  const live = visible && getLive ? getLive() : null;
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  async function handleCopy() {
    const text = formatSessionAsMarkdown(logs, notes, playerLabels, aiDifficulty);
    try {
      await copyToClipboard(text);
      if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
      setCopied(true);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      if (__DEV__) console.warn("[HeartsDebugPanel] clipboard copy failed");
    }
  }

  const isNative = Platform.OS !== "web";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View
          style={[styles.header, { borderBottomColor: colors.border, paddingTop: insets.top + 12 }]}
        >
          <View style={styles.headerTop}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Hearts Debugger
              {logs.length > 0 ? ` — ${logs.length} hand${logs.length !== 1 ? "s" : ""}` : ""}
            </Text>
            <View style={styles.headerActions}>
              <Pressable
                style={[
                  styles.copyBtn,
                  { backgroundColor: copied ? colors.accent : colors.surfaceAlt },
                ]}
                onPress={() => void handleCopy()}
                disabled={isNative}
                accessibilityRole="button"
                accessibilityLabel={isNative ? "Copy (web only)" : "Copy session to clipboard"}
              >
                <Text
                  style={[
                    styles.copyBtnText,
                    {
                      color: isNative
                        ? colors.textMuted
                        : copied
                          ? colors.textOnAccent
                          : colors.text,
                    },
                  ]}
                >
                  {copied ? "Copied!" : isNative ? "Copy (web)" : "Copy"}
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
          <Text style={[styles.personaLine, { color: colors.textMuted }]}>
            {[1, 2, 3]
              .map(
                (seat) =>
                  `${playerLabels[seat] ?? `P${seat}`}: ${resolvePersona(aiDifficulty, seat)}`
              )
              .join("  ·  ")}
          </Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 16 }]}
          keyboardShouldPersistTaps="handled"
        >
          <PimcTimingSection active={visible} />
          {live && (live.tricks.length > 0 || live.pending.length > 0) && (
            <View style={[styles.handSection, { borderColor: colors.border }]}>
              <Text style={[styles.handTitle, { color: colors.accent }]}>
                Hand {live.handNumber} — in progress
              </Text>
              <CpuDecisionLog
                tricks={live.tricks}
                pending={live.pending}
                label={(i) => playerLabels[i] ?? `P${i}`}
                testID="cpu-principles-live"
              />
            </View>
          )}
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
    flexDirection: "column",
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    gap: 4,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  personaLine: {
    fontSize: 11,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
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
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    flexWrap: "wrap",
  },
  trickRow: {
    fontSize: 11,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    flexWrap: "wrap",
  },
  decisionScroll: {
    maxHeight: 160,
    borderWidth: 1,
    borderRadius: 6,
    padding: 6,
    marginTop: 4,
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
