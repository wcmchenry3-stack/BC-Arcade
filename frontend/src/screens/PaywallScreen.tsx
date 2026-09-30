/**
 * Paywall for one premium game (#841, docs/IAP.md §9.3). A modal opened from a
 * locked premium tile; registered only in builds where a premium game is
 * visible (App.tsx), so it is unreachable in v1.0 store builds.
 *
 * All purchase work goes through the `PurchaseAdapter` (usePurchases); this
 * screen never imports a store library. The price is always the store's
 * localized `displayPrice`. Restore Purchases sits directly under Buy so it is
 * visible without scrolling (Apple Guideline 3.1.1).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation, useRoute, type ParamListBase } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import * as Sentry from "@sentry/react-native";
import { AppHeader, APP_HEADER_HEIGHT } from "../components/shared/AppHeader";
import { PRIVACY_POLICY_URL, SUPPORT_URL, TERMS_OF_SERVICE_URL } from "../config/legal";
import { useEntitlements } from "../entitlements/EntitlementContext";
import { entryRouteForSlug } from "../entitlements/premiumRoutes";
import { isPremiumGameSlug, type PremiumGameSlug } from "../entitlements/premiumProducts";
import { gameTitle } from "../i18n/gameTitle";
import { usePurchases } from "../purchases/PurchaseProvider";
import { useRestorePurchases } from "../purchases/useRestorePurchases";
import type { PurchaseErrorCode, StoreProduct } from "../purchases/types";
import { useTheme } from "../theme/ThemeContext";
import { typography } from "../theme/typography";

type ProductState =
  | { status: "loading" }
  | { status: "ready"; product: StoreProduct }
  | { status: "missing" }
  | { status: "error" };

type Notice =
  | { kind: "pending" }
  | { kind: "awaiting_server" }
  | { kind: "error"; code: PurchaseErrorCode; retryable: boolean };

const MIN_TARGET = 52; // >= 48dp Android / 44pt iOS

export default function PaywallScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const route = useRoute();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation([
    "common",
    "cascade",
    "blackjack",
    "hearts",
    "starswarm",
    "mahjong",
  ]);
  const { canPlay, isLoading: entitlementsLoading } = useEntitlements();
  const { adapter, isAvailable } = usePurchases();
  const restorer = useRestorePurchases();

  const rawSlug = (route.params as { gameSlug?: string } | undefined)?.gameSlug ?? "";
  const slug: PremiumGameSlug | null = isPremiumGameSlug(rawSlug) ? rawSlug : null;
  const game = slug ? gameTitle(t, slug) : "";

  const [productState, setProductState] = useState<ProductState>({ status: "loading" });
  const [purchasing, setPurchasing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const mounted = useRef(true);
  const navigatedRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Land in the game once it is unlocked (already owned, bought, or restored).
  const goToGame = useCallback(() => {
    if (!slug || navigatedRef.current) return;
    const target = entryRouteForSlug(slug);
    navigatedRef.current = true;
    if (!target) {
      navigation.goBack();
      return;
    }
    // Navigating to MainTabs pops the paywall modal off the root stack.
    navigation.navigate("MainTabs", { screen: "Lobby", params: { screen: target } });
  }, [navigation, slug]);

  const owned = slug !== null && !entitlementsLoading && canPlay(slug);
  useEffect(() => {
    if (owned) goToGame();
  }, [owned, goToGame]);

  // Load the store product (localized price). Never hardcode a price.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setProductState({ status: "loading" });
    adapter
      .getProducts([slug])
      .then((products) => {
        if (cancelled) return;
        const product = products.find((p) => p.gameSlug === slug);
        setProductState(product ? { status: "ready", product } : { status: "missing" });
      })
      .catch((e) => {
        Sentry.captureException(e, { tags: { subsystem: "purchases", op: "getProducts" } });
        if (!cancelled) setProductState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, slug, reloadKey]);

  const onBuy = useCallback(async () => {
    if (!slug || purchasing) return;
    setPurchasing(true);
    setNotice(null);
    try {
      const outcome = await adapter.purchase(slug);
      if (!mounted.current) return;
      switch (outcome.kind) {
        case "owned":
          goToGame();
          break;
        case "pending":
          setNotice({ kind: "pending" });
          break;
        case "awaiting_server":
          setNotice({ kind: "awaiting_server" });
          break;
        case "cancelled":
          break; // back on the paywall, silently
        case "error":
          setNotice({ kind: "error", code: outcome.code, retryable: outcome.retryable });
          break;
      }
    } catch (e) {
      Sentry.captureException(e, { tags: { subsystem: "purchases", op: "purchase" } });
      if (mounted.current) setNotice({ kind: "error", code: "unknown", retryable: true });
    } finally {
      if (mounted.current) setPurchasing(false);
    }
  }, [adapter, goToGame, purchasing, slug]);

  const onRestore = useCallback(async () => {
    setNotice(null);
    const r = await restorer.restore();
    if (r && slug && (r.restored.includes(slug) || r.alreadyOwned.includes(slug))) goToGame();
  }, [goToGame, restorer, slug]);

  const openSupport = () => {
    Linking.openURL(SUPPORT_URL).catch((e) => {
      Sentry.captureException(e, { tags: { subsystem: "purchases", op: "openSupport" } });
    });
  };
  const openUrl = (url: string) => {
    Linking.openURL(url).catch((e) => {
      Sentry.captureException(e, { tags: { subsystem: "purchases", op: "openLegalUrl" } });
    });
  };

  const noticeText = (n: Notice): string => {
    if (n.kind === "pending") return t("common:paywall.pending");
    if (n.kind === "awaiting_server") return t("common:paywall.awaitingServer");
    switch (n.code) {
      case "not_linkable":
        return t("common:paywall.notLinkable");
      case "store_unavailable":
        return t("common:paywall.storeUnavailable");
      case "product_unavailable":
        return t("common:paywall.productUnavailable");
      default:
        return n.retryable ? t("common:paywall.errorRetry") : t("common:paywall.errorFatal");
    }
  };

  const restoreText: Record<string, string> = {
    restored: t("common:restore.restored"),
    pending: t("common:restore.pending"),
    nothing: t("common:restore.nothing"),
    error: t("common:restore.error"),
  };

  const busy = purchasing || restorer.busy;
  const product = productState.status === "ready" ? productState.product : null;
  const blocked = notice?.kind === "pending" || (notice?.kind === "error" && !notice.retryable);
  const canBuy = product !== null && !busy && !owned && !blocked;
  const retryableError = notice?.kind === "error" && notice.retryable;

  let buyLabel = t("common:paywall.loadingPrice");
  if (product) buyLabel = t("common:paywall.buy", { price: product.displayPrice });
  else if (productState.status !== "loading") buyLabel = t("common:paywall.unavailableButton");

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <AppHeader
        title={t("common:paywall.header")}
        onBack={() => navigation.goBack()}
        requireBack
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: APP_HEADER_HEIGHT + insets.top + 24, paddingBottom: insets.bottom + 24 },
        ]}
      >
        {!slug ? (
          <Text style={[styles.body, { color: colors.text }]} testID="paywall-invalid">
            {t("common:paywall.productUnavailable")}
          </Text>
        ) : (
          <>
            <Text
              style={[styles.heading, { color: colors.text }]}
              accessibilityRole="header"
              testID="paywall-game-name"
            >
              {game}
            </Text>
            <Text style={[styles.body, { color: colors.textMuted }]} testID="paywall-description">
              {product?.description || t(`${slug}:game.description`)}
            </Text>
            <View style={[styles.card, { backgroundColor: colors.surfaceHigh }]}>
              <Text style={[styles.cardLine, { color: colors.text }]}>
                {t("common:paywall.oneTime")}
              </Text>
              <Text style={[styles.cardLine, { color: colors.text }]}>
                {t("common:paywall.unlimitedReplay")}
              </Text>
            </View>

            {owned ? (
              <View accessibilityLiveRegion="polite" testID="paywall-owned">
                <Text style={[styles.body, { color: colors.text }]}>
                  {t("common:paywall.owned")}
                </Text>
                <Pressable
                  onPress={goToGame}
                  style={[styles.primary, { backgroundColor: colors.accent }]}
                  accessibilityRole="button"
                  accessibilityLabel={t("common:paywall.play", { game })}
                  testID="paywall-play"
                >
                  <Text style={[styles.primaryText, { color: colors.textOnAccent }]}>
                    {t("common:paywall.play", { game })}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={onBuy}
                disabled={!canBuy}
                style={[
                  styles.primary,
                  { backgroundColor: colors.accent, opacity: canBuy ? 1 : 0.5 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  product
                    ? t("common:paywall.buyLabel", { game, price: product.displayPrice })
                    : buyLabel
                }
                accessibilityState={{ disabled: !canBuy, busy: purchasing }}
                testID="paywall-buy"
              >
                {purchasing ? (
                  <ActivityIndicator color={colors.textOnAccent} testID="paywall-purchasing" />
                ) : (
                  <Text style={[styles.primaryText, { color: colors.textOnAccent }]}>
                    {buyLabel}
                  </Text>
                )}
              </Pressable>
            )}

            {productState.status === "error" && (
              <View accessibilityLiveRegion="polite">
                <Text style={[styles.message, { color: colors.text }]} testID="paywall-load-error">
                  {t("common:paywall.loadError")}
                </Text>
                <Pressable
                  onPress={() => setReloadKey((k) => k + 1)}
                  style={[styles.secondary, { borderColor: colors.border }]}
                  accessibilityRole="button"
                  testID="paywall-reload"
                >
                  <Text style={[styles.secondaryText, { color: colors.text }]}>
                    {t("common:paywall.retry")}
                  </Text>
                </Pressable>
              </View>
            )}
            {productState.status === "missing" && (
              <Text
                style={[styles.message, { color: colors.text }]}
                accessibilityLiveRegion="polite"
                testID="paywall-unavailable"
              >
                {isAvailable
                  ? t("common:paywall.productUnavailable")
                  : t("common:paywall.storeUnavailable")}
              </Text>
            )}

            {notice && (
              <View
                style={[
                  styles.notice,
                  { backgroundColor: colors.surface, borderColor: colors.error },
                ]}
                accessibilityLiveRegion="polite"
                testID={`paywall-notice-${notice.kind}`}
              >
                <Text style={[styles.message, { color: colors.text }]}>{noticeText(notice)}</Text>
                {notice.kind === "error" && notice.code === "not_linkable" && (
                  <Pressable
                    onPress={openSupport}
                    style={[styles.secondary, { borderColor: colors.border }]}
                    accessibilityRole="link"
                    testID="paywall-support"
                  >
                    <Text style={[styles.secondaryText, { color: colors.text }]}>
                      {t("common:paywall.contactSupport")}
                    </Text>
                  </Pressable>
                )}
                {retryableError && (
                  <Pressable
                    onPress={onBuy}
                    disabled={busy || !product}
                    style={[styles.secondary, { borderColor: colors.border }]}
                    accessibilityRole="button"
                    testID="paywall-retry"
                  >
                    <Text style={[styles.secondaryText, { color: colors.text }]}>
                      {t("common:paywall.retry")}
                    </Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* Apple 3.1.1: a visible Restore Purchases action, not buried in a menu. */}
            <Pressable
              onPress={onRestore}
              disabled={busy}
              style={[styles.secondary, { borderColor: colors.border, opacity: busy ? 0.5 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={t("common:paywall.restore")}
              accessibilityState={{ disabled: busy, busy: restorer.busy }}
              testID="paywall-restore"
            >
              {restorer.busy ? (
                <ActivityIndicator color={colors.text} testID="paywall-restoring" />
              ) : (
                <Text style={[styles.secondaryText, { color: colors.text }]}>
                  {t("common:paywall.restore")}
                </Text>
              )}
            </Pressable>
            {restorer.status !== "idle" && restorer.status !== "busy" && !owned && (
              <Text
                style={[styles.message, { color: colors.text }]}
                accessibilityLiveRegion="polite"
                testID={`paywall-restore-${restorer.status}`}
              >
                {restoreText[restorer.status]}
              </Text>
            )}

            <View style={styles.legalRow}>
              <Pressable
                onPress={() => openUrl(TERMS_OF_SERVICE_URL)}
                style={styles.legalLink}
                accessibilityRole="link"
                accessibilityLabel={t("common:legal.termsOfService")}
                testID="paywall-terms"
              >
                <Text style={[styles.legalText, { color: colors.text }]}>
                  {t("common:legal.termsOfService")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => openUrl(PRIVACY_POLICY_URL)}
                style={styles.legalLink}
                accessibilityRole="link"
                accessibilityLabel={t("common:legal.privacyPolicy")}
                testID="paywall-privacy"
              >
                <Text style={[styles.legalText, { color: colors.text }]}>
                  {t("common:legal.privacyPolicy")}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 24, gap: 16 },
  heading: { fontFamily: typography.heading, fontSize: 28, letterSpacing: -0.5 },
  body: { fontFamily: typography.body, fontSize: 16, lineHeight: 24 },
  card: { borderRadius: 16, padding: 16, gap: 8 },
  cardLine: { fontFamily: typography.body, fontSize: 15, lineHeight: 22 },
  primary: {
    minHeight: MIN_TARGET,
    borderRadius: 26,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { fontFamily: typography.label, fontSize: 16, textAlign: "center" },
  secondary: {
    minHeight: MIN_TARGET,
    borderRadius: 26,
    borderWidth: 1,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontFamily: typography.label, fontSize: 15, textAlign: "center" },
  message: { fontFamily: typography.body, fontSize: 14, lineHeight: 20 },
  notice: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 12 },
  legalRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  legalLink: { minHeight: 48, minWidth: 48, paddingHorizontal: 12, justifyContent: "center" },
  legalText: { fontFamily: typography.body, fontSize: 13, textDecorationLine: "underline" },
});
