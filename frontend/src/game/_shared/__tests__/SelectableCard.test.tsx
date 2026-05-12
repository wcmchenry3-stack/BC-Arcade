import React from "react";
import { render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { CardDeckProvider } from "../decks/CardDeckContext";
import SelectableCard from "../SelectableCard";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <CardDeckProvider>{children}</CardDeckProvider>
    </ThemeProvider>
  );
}

describe("SelectableCard", () => {
  it("snapshot: unselected", () => {
    const { toJSON } = render(
      <Wrapper>
        <SelectableCard suit="spades" rank={1} width={52} height={74} selected={false} />
      </Wrapper>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("snapshot: selected", () => {
    const { toJSON } = render(
      <Wrapper>
        <SelectableCard suit="spades" rank={1} width={52} height={74} selected />
      </Wrapper>
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders without error when selected changes", () => {
    const { rerender, toJSON } = render(
      <Wrapper>
        <SelectableCard suit="hearts" rank={13} width={52} height={74} selected={false} />
      </Wrapper>
    );
    rerender(
      <Wrapper>
        <SelectableCard suit="hearts" rank={13} width={52} height={74} selected />
      </Wrapper>
    );
    expect(toJSON()).not.toBeNull();
  });

  it("renders face-down card without error", () => {
    const { toJSON } = render(
      <Wrapper>
        <SelectableCard suit="clubs" rank={7} width={52} height={74} faceDown selected={false} />
      </Wrapper>
    );
    expect(toJSON()).not.toBeNull();
  });
});
