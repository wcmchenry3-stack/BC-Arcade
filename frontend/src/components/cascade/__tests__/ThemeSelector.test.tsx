/**
 * #2956: Cascade's fruit-set picker — a radio group with one radio per set in FRUIT_SETS,
 * backed by the real FruitSetProvider (and the in-memory AsyncStorage mock from jest.setup.ts).
 */
import React from "react";
import { StyleSheet, Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import ThemeSelector from "../ThemeSelector";
import { FruitSetProvider, useFruitSet } from "../../../theme/FruitSetContext";
import { FRUIT_SETS } from "../../../theme/fruitSets";
import { dark } from "../../../theme/ThemeContext";

const STORAGE_KEY = "gaming_app_fruit_set";

function ActiveSet() {
  const { activeFruitSet } = useFruitSet();
  return <Text>{`active:${activeFruitSet.id}`}</Text>;
}

async function mount() {
  return render(
    <FruitSetProvider>
      <ThemeSelector />
      <ActiveSet />
    </FruitSetProvider>
  );
}

const radio = (label: string) => screen.getByRole("radio", { name: label });
const bg = (label: string) => StyleSheet.flatten(radio(label).props.style).backgroundColor;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe("Cascade ThemeSelector", () => {
  it("is a labelled radio group with one radio per fruit set", async () => {
    await mount();
    expect(screen.getByLabelText("Fruit set theme")).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(Object.keys(FRUIT_SETS).length);
    expect(radio("Fruits theme")).toBeTruthy();
    expect(radio("Cosmos theme")).toBeTruthy();
    expect(screen.getByText("Fruits")).toBeTruthy();
    expect(screen.getByText("Cosmos")).toBeTruthy();
    expect(screen.getByText("🍒")).toBeTruthy();
    expect(screen.getByText("🌙")).toBeTruthy();
  });

  it("checks and highlights the active set (Fruits by default)", async () => {
    await mount();
    expect(radio("Fruits theme")).toBeChecked();
    expect(radio("Cosmos theme")).not.toBeChecked();
    expect(bg("Fruits theme")).toBe(dark.accent);
    expect(bg("Cosmos theme")).toBeUndefined();
  });

  it("pressing a set selects it and remembers the choice", async () => {
    await mount();
    await fireEvent.press(radio("Cosmos theme"));
    expect(radio("Cosmos theme")).toBeChecked();
    expect(radio("Fruits theme")).not.toBeChecked();
    expect(screen.getByText("active:cosmos")).toBeTruthy();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, "cosmos");
  });

  it("restores a stored set, migrating the legacy 'planets' id to cosmos", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, "planets");
    await mount();
    await waitFor(() => expect(radio("Cosmos theme")).toBeChecked());
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(STORAGE_KEY, "cosmos");
  });
});
