import React from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";

type MaterialIconName = React.ComponentProps<typeof MaterialIcons>["name"];

interface TabConfig {
  icon: MaterialIconName;
  labelKey: string;
}

const TAB_CONFIG: Record<string, TabConfig> = {
  Lobby: { icon: "sports-esports", labelKey: "nav.lobby" },
  Ranks: { icon: "leaderboard", labelKey: "nav.ranks" },
  Profile: { icon: "person", labelKey: "nav.profile" },
  Settings: { icon: "settings", labelKey: "nav.settings" },
};

export default function BottomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { colors, theme } = useTheme();
  const { t } = useTranslation("common");

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.wrapper,
        {
          paddingBottom: insets.bottom || 8,
          shadowColor: colors.chromeShadowColor,
          shadowOpacity: colors.chromeShadowOpacity,
        },
        Platform.OS === "web" && styles.wrapperWeb,
      ]}
    >
      {/* Blur background */}
      {Platform.OS === "web" ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.blurFallback,
            {
              backgroundColor: colors.chromeBg,
              ...Platform.select({
                web: {
                  backdropFilter: "blur(20px)",
                  WebkitBackdropFilter: "blur(20px)",
                } as object,
              }),
            },
          ]}
        />
      ) : (
        <BlurView
          intensity={80}
          tint={theme === "dark" ? "dark" : "light"}
          style={[StyleSheet.absoluteFill, styles.blurFallback]}
        />
      )}

      {/* Tab items */}
      <View style={styles.tabs}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const config = TAB_CONFIG[route.name] ?? {
            icon: "circle" as MaterialIconName,
            labelKey: route.name,
          };
          const label = t(config.labelKey as Parameters<typeof t>[0]);

          return (
            <Pressable
              key={route.key}
              onPress={() => navigation.navigate(route.name)}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
            >
              {focused ? (
                <LinearGradient
                  colors={[colors.accent, colors.accentBright]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.activePill}
                >
                  <MaterialIcons name={config.icon} size={20} color={colors.textOnAccent} />
                  <Text style={[styles.label, { color: colors.textOnAccent }]}>{label}</Text>
                </LinearGradient>
              ) : (
                <View style={styles.inactivePill}>
                  <MaterialIcons name={config.icon} size={20} color={colors.text} />
                  <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    overflow: "hidden",
    shadowOffset: { width: 0, height: -4 },
    shadowRadius: 20,
    elevation: 8,
    flexShrink: 0,
  },
  wrapperWeb: {
    alignSelf: "stretch",
  },
  blurFallback: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
  tabs: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  tab: {
    flex: 1,
    alignItems: "center",
  },
  tabPressed: {
    transform: [{ scale: 0.9 }],
  },
  activePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  inactivePill: {
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  label: {
    fontFamily: typography.label,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
