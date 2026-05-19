import React, { useCallback } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HomeStackParamList } from "../types/navigation";
import { LAYOUTS } from "../game/mahjong/layouts/registry";
import type { LayoutMeta } from "../game/mahjong/types";
import { GameShell } from "../components/shared/GameShell";
import { useTheme } from "../theme/ThemeContext";

export default function MahjongLayoutInspectorScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const renderItem = useCallback(
    ({ item }: { item: LayoutMeta }) => (
      <Pressable
        style={[styles.card, { backgroundColor: colors.surfaceHigh, borderColor: colors.border }]}
        onPress={() => navigation.navigate("MahjongLayoutDetail", { layoutId: item.id })}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, Tier ${item.tier}, ${item.tileCount} tiles`}
      >
        <View style={[styles.tierBadge, { backgroundColor: colors.surfaceAlt }]}>
          <Text style={[styles.tierText, { color: colors.textMuted }]}>T{item.tier}</Text>
        </View>
        <Text style={[styles.cardName, { color: colors.text }]}>{item.name}</Text>
        <Text style={[styles.cardMeta, { color: colors.textMuted }]}>{item.tileCount} tiles</Text>
      </Pressable>
    ),
    [navigation, colors]
  );

  return (
    <GameShell
      title="Layout Inspector"
      requireBack
      onBack={() => navigation.goBack()}
      style={{ paddingBottom: Math.max(insets.bottom, 16) }}
    >
      <FlatList
        data={LAYOUTS}
        keyExtractor={(m) => m.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        renderItem={renderItem}
      />
    </GameShell>
  );
}

const styles = StyleSheet.create({
  list: { padding: 12 },
  row: { gap: 12, marginBottom: 12 },
  card: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
    alignItems: "center",
    minHeight: 96,
    justifyContent: "center",
  },
  tierBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tierText: { fontSize: 10, fontWeight: "700" },
  cardName: { fontSize: 15, fontWeight: "700", textAlign: "center" },
  cardMeta: { fontSize: 12, marginTop: 4 },
});
