/**
 * The Cascade route on web (#2960, owner decision 2026-11-11): Cascade draws with the same Skia
 * code as on iOS and Android, through Skia's web runtime (CanvasKit, WebAssembly).
 *
 * `react-native-skia`'s web module reads `global.CanvasKit` when it is first evaluated, so the
 * Cascade screen, which imports Skia, may only be imported after CanvasKit has loaded. This route
 * loads CanvasKit, then imports `CascadeScreen` in its own chunk (`loadCascadeScreen.web.ts`),
 * the pattern of Skia's `WithSkiaWeb`. Nothing outside Cascade loads CanvasKit, so start-up and
 * the other web games (Mahjong and Star Swarm keep their Canvas 2D canvases) are unaffected.
 *
 * Unlike `WithSkiaWeb`, a failed or stalled load is not an endless spinner (#2539): it shows a
 * readable error with a Retry, inside the usual game shell so Back still works.
 */
import React, { useCallback, useEffect, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import * as Sentry from "@sentry/react-native";
import { GameShell } from "../components/shared/GameShell";
import { EmptyState } from "../components/shared/EmptyState";
import { loadCascadeScreen, type CascadeScreenProps } from "./loadCascadeScreen.web";

/**
 * One Sentry event per page session (cost rule, CLAUDE.md): Retry could otherwise send one per
 * failed attempt, without limit. Later failures leave a breadcrumb on whatever event comes next.
 */
let failureReported = false;

/** @internal Test seam: forget that a failure was reported. */
export function __resetCascadeFailureReportForTests(): void {
  failureReported = false;
}

type Phase =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly Screen: ComponentType<CascadeScreenProps> }
  | { readonly kind: "error" };

export default function CascadeRoute(props: CascadeScreenProps) {
  const { t } = useTranslation("cascade");
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    loadCascadeScreen().then(
      (Screen) => {
        if (live) setPhase({ kind: "ready", Screen });
      },
      (error: unknown) => {
        if (!live) return;
        if (failureReported) {
          Sentry.addBreadcrumb({
            category: "cascade.canvaskit",
            level: "error",
            message: error instanceof Error ? error.message : "CanvasKit load failed again",
          });
        } else {
          failureReported = true;
          Sentry.captureException(error, { tags: { subsystem: "cascade.canvaskit" } });
        }
        setPhase({ kind: "error" });
      }
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setPhase({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  if (phase.kind === "ready") {
    const { Screen } = phase;
    return <Screen {...props} />;
  }
  return (
    <GameShell gameType="cascade" title={t("game.title")} requireBack loading={false}>
      {phase.kind === "loading" ? (
        <EmptyState kind="loading" message={t("web.loading")} testID="cascade-web-loading" />
      ) : (
        <EmptyState
          kind="error"
          message={t("web.loadError")}
          retry={{ label: t("web.retry"), onPress: retry }}
          testID="cascade-web-error"
        />
      )}
    </GameShell>
  );
}
