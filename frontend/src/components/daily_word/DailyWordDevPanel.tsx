/**
 * Daily Word's developer panel (#1293; moved out of DailyWordScreen in #2978):
 * today's puzzle and its answer, a local board reset, the board's state and the
 * API call log (`game/daily_word/devLog`). Dev builds only.
 */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import {
  DEV_ACCENT_STRONG,
  DEV_STATUS_ERROR_BG,
  DEV_STATUS_OK_BG,
  DEV_SURFACE_FAINTEST,
  DEV_TEXT_FAINT,
  DEV_TEXT_SECONDARY,
  DEV_WARNING_TEXT,
} from "../../theme/theme.constants";
import { DevActionButton, DevPanelShell, DevSection } from "../dev/DevPanelShell";
import { dailyWordApi } from "../../game/daily_word/api";
import { devLog, type DevLogEntry } from "../../game/daily_word/devLog";
import type { DailyWordState } from "../../game/daily_word/types";

export interface DailyWordDevPanelProps {
  readonly enabled: boolean;
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly state: DailyWordState | null;
  /** Starts today's board over (local only). */
  readonly onReset: () => Promise<unknown>;
}

export default function DailyWordDevPanel(props: DailyWordDevPanelProps) {
  if (!props.enabled) return null;
  return <DailyWordDevPanelBody {...props} />;
}

function DailyWordDevPanelBody({ open, onOpen, onClose, state, onReset }: DailyWordDevPanelProps) {
  const { colors } = useTheme();
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerVisible, setAnswerVisible] = useState(false);
  const [logEntries, setLogEntries] = useState<DevLogEntry[]>(() => devLog.list().slice());
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  useEffect(() => devLog.subscribe(() => setLogEntries(devLog.list().slice())), []);

  const muted = { color: colors.textMuted };

  return (
    <DevPanelShell
      enabled
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      title="Dev Panel"
      panelStyle={styles.panel}
      contentStyle={styles.content}
    >
      <DevSection title="Today's Puzzle">
        {state !== null && (
          <>
            <Text style={[styles.infoText, muted]}>
              {`puzzle_id: ${state.puzzle_id}\nword_length: ${state.word_length}\nlang: ${state.language}`}
            </Text>

            <DevActionButton
              label={answerVisible ? "Hide Answer" : "Show Answer"}
              textStyle={styles.bold}
              onPress={async () => {
                if (answerVisible) {
                  setAnswerVisible(false);
                  setAnswer(null);
                } else {
                  try {
                    const r = await dailyWordApi.getAnswer(state.puzzle_id);
                    setAnswer(r.answer.toUpperCase());
                    setAnswerVisible(true);
                  } catch {
                    setAnswer("(failed to fetch)");
                    setAnswerVisible(true);
                  }
                }
              }}
            />

            {answerVisible && answer !== null && <Text style={styles.answerText}>{answer}</Text>}

            <DevActionButton
              label="Reset Game"
              variant="primary"
              style={styles.resetBtn}
              textStyle={styles.resetText}
              onPress={async () => {
                await onReset();
                setAnswer(null);
                setAnswerVisible(false);
                onClose();
              }}
            />
            <Text style={styles.warningText}>
              {
                "Resets local board only — backend rate limit (20/hr per session+puzzle) still applies"
              }
            </Text>
          </>
        )}
      </DevSection>

      <DevSection title="Game State">
        {state !== null && (
          <Text style={[styles.infoText, muted]}>
            {`row: ${state.current_row}  won: ${state.won}  done: ${state.is_complete}`}
            {state.rows
              .filter((r) => r.submitted)
              .map(
                (r, i) =>
                  `\n${i + 1}: ${r.tiles.map((tile) => tile.letter).join("")}  [${r.tiles.map((tile) => tile.status[0]).join("")}]`
              )
              .join("")}
          </Text>
        )}
      </DevSection>

      <DevSection title="API Log">
        <DevActionButton
          label="Clear log"
          textStyle={styles.bold}
          onPress={() => {
            devLog.clear();
            setExpandedIndex(null);
          }}
        />

        {logEntries.length === 0 && <Text style={[styles.infoText, muted]}>No API calls yet</Text>}

        {logEntries.map((entry, idx) => (
          <Pressable
            key={`${entry.ts}-${entry.method}-${entry.path}`}
            style={styles.logEntry}
            onPress={() => setExpandedIndex(expandedIndex === idx ? null : idx)}
          >
            <View style={styles.logHeader}>
              <Text style={[styles.logStatus, entry.error ? styles.statusError : styles.statusOk]}>
                {entry.status ?? "err"}
              </Text>
              <Text style={styles.logPath} numberOfLines={1}>
                {entry.method} {entry.path.split("?")[0]}
              </Text>
              <Text style={[styles.infoText, muted, styles.logTime]}>
                {new Date(entry.ts).toLocaleTimeString()}
              </Text>
            </View>
            {expandedIndex === idx && (
              <Text style={styles.logBody}>
                {JSON.stringify(
                  { body: entry.body, response: entry.response, error: entry.error },
                  null,
                  2
                )}
              </Text>
            )}
          </Pressable>
        ))}
      </DevSection>

      <DevActionButton label="Close" textStyle={styles.bold} onPress={onClose} />
    </DevPanelShell>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 20,
    width: 300,
  },
  content: {
    paddingBottom: 4,
  },
  bold: {
    fontWeight: "700",
  },
  resetBtn: {
    backgroundColor: DEV_ACCENT_STRONG,
  },
  resetText: {
    fontSize: 13,
  },
  infoText: {
    fontSize: 11,
    lineHeight: 17,
  },
  answerText: {
    fontSize: 22,
    fontWeight: "900",
    color: "#ffd700",
    textAlign: "center",
    letterSpacing: 6,
  },
  warningText: {
    fontSize: 10,
    color: DEV_WARNING_TEXT,
    textAlign: "center",
    fontStyle: "italic",
  },
  logEntry: {
    backgroundColor: DEV_SURFACE_FAINTEST,
    borderRadius: 6,
    padding: 8,
    gap: 4,
  },
  logHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  logStatus: {
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  statusError: {
    backgroundColor: DEV_STATUS_ERROR_BG,
    color: "#ff6060",
  },
  statusOk: {
    backgroundColor: DEV_STATUS_OK_BG,
    color: "#60e060",
  },
  logPath: {
    fontSize: 11,
    color: DEV_TEXT_SECONDARY,
    flex: 1,
  },
  logTime: {
    flex: 0,
    fontSize: 10,
  },
  logBody: {
    fontSize: 10,
    color: DEV_TEXT_FAINT,
  },
});
