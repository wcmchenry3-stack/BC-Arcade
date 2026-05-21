/**
 * AudioLibrarySpikeScreen — gapless BGM loop evaluation harness.
 * Part of spike #1782 / epic #1779.
 *
 * Tests three looping approaches side-by-side so you can listen for an
 * audible gap/click at the loop boundary on real iOS and Android hardware.
 *
 * Gate: __DEV__ only. Do not route to this screen in production builds.
 *
 * REQUIRES a custom dev client (react-native-audio-api uses native C++/Oboe).
 * Will NOT work in Expo Go.
 *
 * To wire up temporarily:
 *   In your navigator, add under __DEV__:
 *     <Stack.Screen name="AudioLibrarySpike" component={AudioLibrarySpikeScreen} />
 *   Then navigate to it from any debug button or the dev menu.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  createAudioPlayer,
  useAudioPlaylist,
  useAudioPlaylistStatus,
  type AudioPlayer,
} from "expo-audio";
import {
  AudioBufferSourceNode,
  AudioContext,
  GainNode,
} from "react-native-audio-api";

// Test track: shortest bundled BGM (~4.8 MB), loops fastest — most likely to expose a gap.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TEST_TRACK = require("../../../assets/sounds/mahjong-bg-1.mp3");
const BG_VOL = 0.2;

// ---------------------------------------------------------------------------
// Approach A: expo-audio createAudioPlayer with player.loop = true
// Current production approach. Uses AVPlayer (iOS) / ExoPlayer (Android).
// Risk: codec frame-padding gap on loop restart.
// ---------------------------------------------------------------------------

function ApproachA() {
  const playerRef = useRef<AudioPlayer | null>(null);
  const [playing, setPlaying] = useState(false);

  const start = useCallback(() => {
    playerRef.current?.remove();
    const p = createAudioPlayer(TEST_TRACK);
    p.loop = true;
    p.volume = BG_VOL;
    try {
      p.play();
    } catch {
      // web AudioContext may be suspended
    }
    playerRef.current = p;
    setPlaying(true);
  }, []);

  const stop = useCallback(() => {
    playerRef.current?.pause();
    playerRef.current?.remove();
    playerRef.current = null;
    setPlaying(false);
  }, []);

  useEffect(() => () => { playerRef.current?.remove(); }, []);

  return (
    <SectionCard
      label="A — expo-audio: player.loop = true"
      sublabel="Current production approach. AVPlayer / ExoPlayer loop restart."
      playing={playing}
      onStart={start}
      onStop={stop}
    />
  );
}

// ---------------------------------------------------------------------------
// Approach B: expo-audio useAudioPlaylist with loop: 'single'
// Uses AVQueuePlayer (iOS) / ExoPlayer queue (Android) for gapless.
// Risk: less gap than A, but gapless is not guaranteed at the native queue seam.
// ---------------------------------------------------------------------------

function ApproachB() {
  const playlist = useAudioPlaylist({
    sources: [{ assetId: TEST_TRACK }],
    loop: "single",
  });
  const status = useAudioPlaylistStatus(playlist);
  const playingRef = useRef(false);
  const [playing, setPlaying] = useState(false);

  const start = useCallback(() => {
    playlist.volume = BG_VOL;
    try {
      playlist.play();
    } catch {
      // ignore
    }
    playingRef.current = true;
    setPlaying(true);
  }, [playlist]);

  const stop = useCallback(() => {
    playlist.pause();
    playingRef.current = false;
    setPlaying(false);
  }, [playlist]);

  const loopCount = status.currentIndex; // single-item playlist wraps currentIndex on loop

  return (
    <SectionCard
      label="B — expo-audio: useAudioPlaylist loop:'single'"
      sublabel="AVQueuePlayer / ExoPlayer queue. Gapless at queue seam (not guaranteed)."
      playing={playing}
      loopCount={loopCount}
      onStart={start}
      onStop={stop}
    />
  );
}

// ---------------------------------------------------------------------------
// Approach C: react-native-audio-api AudioBufferSourceNode.loop = true
// Decodes the file to PCM in memory; loops at exactly sample 0.
// This is the same mechanism game engines use — zero gap guaranteed.
// ---------------------------------------------------------------------------

function ApproachC() {
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loopCount, setLoopCount] = useState(0);
  const [status, setStatus] = useState<"idle" | "decoding" | "ready">("idle");

  const stop = useCallback(() => {
    try {
      sourceRef.current?.stop();
    } catch {
      // may throw if already stopped
    }
    sourceRef.current = null;
    setPlaying(false);
  }, []);

  const start = useCallback(async () => {
    try {
      if (!ctxRef.current) {
        ctxRef.current = new AudioContext();
        const gain = ctxRef.current.createGain();
        gain.gain.value = BG_VOL;
        gain.connect(ctxRef.current.destination);
        gainRef.current = gain;
      }

      stop();

      setStatus("decoding");
      // decodeAudioData accepts a bundled asset number directly
      const buffer = await ctxRef.current.decodeAudioData(TEST_TRACK);
      setStatus("ready");

      const source = ctxRef.current.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.onLoopEnded = () => setLoopCount((n) => n + 1);
      source.connect(gainRef.current!);
      source.start(0);
      sourceRef.current = source;
      setPlaying(true);
      setLoopCount(0);
    } catch (e) {
      setStatus("idle");
      console.error("[AudioLibrarySpike] react-native-audio-api error:", e);
    }
  }, [stop]);

  useEffect(() => () => {
    try { sourceRef.current?.stop(); } catch { /* ignore */ }
    ctxRef.current?.close().catch(() => {});
  }, []);

  return (
    <SectionCard
      label="C — react-native-audio-api: AudioBufferSourceNode.loop"
      sublabel={`Decodes to PCM buffer; restarts at sample 0. Zero-gap guaranteed.\nRequires custom dev client.${status === "decoding" ? "\nDecoding…" : ""}`}
      playing={playing}
      loopCount={loopCount}
      onStart={start}
      onStop={stop}
    />
  );
}

// ---------------------------------------------------------------------------
// Shared card component
// ---------------------------------------------------------------------------

interface SectionCardProps {
  label: string;
  sublabel: string;
  playing: boolean;
  loopCount?: number;
  onStart: () => void;
  onStop: () => void;
}

function SectionCard({ label, sublabel, playing, loopCount, onStart, onStop }: SectionCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{label}</Text>
      <Text style={styles.cardSublabel}>{sublabel}</Text>
      {loopCount !== undefined && (
        <Text style={styles.loopCount}>Loops completed: {loopCount}</Text>
      )}
      <View style={styles.row}>
        <Pressable
          style={[styles.btn, styles.btnPlay, playing && styles.btnDisabled]}
          onPress={onStart}
          disabled={playing}
        >
          <Text style={styles.btnText}>Play</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.btnStop, !playing && styles.btnDisabled]}
          onPress={onStop}
          disabled={!playing}
        >
          <Text style={styles.btnText}>Stop</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function AudioLibrarySpikeScreen() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>BGM Library Spike</Text>
      <Text style={styles.subtitle}>Issue #1782 — Epic #1779</Text>

      <View style={styles.instructions}>
        <Text style={styles.instructionsTitle}>Test protocol</Text>
        <Text style={styles.instructionsBody}>
          {`1. Use headphones — gaps are easiest to hear at moderate volume.\n`}
          {`2. Play each approach and listen for 3+ loop cycles.\n`}
          {`3. Listen for a brief click, silence, or hiccup at the moment the track restarts.\n`}
          {`4. Note the result for each approach on issue #1782.\n\n`}
          {`Platform: ${Platform.OS} ${Platform.Version}`}
        </Text>
      </View>

      <ApproachA />
      <ApproachB />
      <ApproachC />

      <View style={styles.notes}>
        <Text style={styles.notesTitle}>Expected results</Text>
        <Text style={styles.notesBody}>
          {`A: Likely audible gap on Android (MP3 frame-padding). May be silent on iOS.\n`}
          {`B: May be gapless or near-gapless depending on platform/build.\n`}
          {`C: Should be completely silent at loop boundary on both platforms.`}
        </Text>
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0d0d1a" },
  content: { padding: 20, paddingBottom: 60 },

  title: { fontSize: 22, fontWeight: "700", color: "#fff", marginBottom: 2 },
  subtitle: { fontSize: 13, color: "#888", marginBottom: 20 },

  instructions: {
    backgroundColor: "#1a1a2e",
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
  },
  instructionsTitle: { fontSize: 14, fontWeight: "600", color: "#a0c4ff", marginBottom: 6 },
  instructionsBody: { fontSize: 13, color: "#ccc", lineHeight: 20 },

  card: {
    backgroundColor: "#1a1a2e",
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
  },
  cardLabel: { fontSize: 14, fontWeight: "700", color: "#fff", marginBottom: 4 },
  cardSublabel: { fontSize: 12, color: "#888", marginBottom: 10, lineHeight: 17 },
  loopCount: { fontSize: 13, color: "#a0c4ff", marginBottom: 10 },

  row: { flexDirection: "row", gap: 10 },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  btnPlay: { backgroundColor: "#2d6a4f" },
  btnStop: { backgroundColor: "#7d1b1b" },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 14 },

  notes: {
    backgroundColor: "#1a1a2e",
    borderRadius: 10,
    padding: 14,
    marginTop: 4,
  },
  notesTitle: { fontSize: 14, fontWeight: "600", color: "#a0c4ff", marginBottom: 6 },
  notesBody: { fontSize: 12, color: "#aaa", lineHeight: 19 },
});
