import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HomeStackParamList } from "../../App";
import { LAYOUTS } from "../game/mahjong/layouts/registry";
import type { LayoutMeta } from "../game/mahjong/types";
import { GameShell } from "../components/shared/GameShell";

export default function MahjongLayoutInspectorScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const insets = useSafeAreaInsets();

  function renderItem({ item }: { item: LayoutMeta }) {
    return (
      <Pressable
        style={styles.card}
        onPress={() => navigation.navigate("MahjongLayoutDetail", { layoutId: item.id })}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, Tier ${item.tier}, ${item.tileCount} tiles`}
      >
        <View style={styles.tierBadge}>
          <Text style={styles.tierText}>T{item.tier}</Text>
        </View>
        <Text style={styles.cardName}>{item.name}</Text>
        <Text style={styles.cardMeta}>{item.tileCount} tiles</Text>
      </Pressable>
    );
  }

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
    backgroundColor: "#1a1f2e",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#3a4060",
    padding: 16,
    alignItems: "center",
    minHeight: 96,
    justifyContent: "center",
  },
  tierBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "#2a3050",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tierText: { color: "#8090c0", fontSize: 10, fontWeight: "700" },
  cardName: { color: "#e0e4f0", fontSize: 15, fontWeight: "700", textAlign: "center" },
  cardMeta: { color: "#8090c0", fontSize: 12, marginTop: 4 },
});
