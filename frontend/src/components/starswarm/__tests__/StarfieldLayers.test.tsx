/**
 * #2963: the starfield's Pictures are native objects — each recorded set is disposed once nothing
 * draws it any more: after a re-record (layout change) has been committed, and on unmount.
 */
import React from "react";
import { render } from "@testing-library/react-native";

type FakePicture = { id: number; dispose: jest.Mock };
const mockPictures: FakePicture[] = [];

jest.mock("@shopify/react-native-skia", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement, Fragment } = require("react");
  return {
    Group: ({ children }: { children?: React.ReactNode }) =>
      createElement(Fragment, null, children),
    Picture: () => null,
    createPicture: (draw: (canvas: object) => void) => {
      draw({ drawColor: () => {}, drawCircle: () => {} });
      const pic = { id: mockPictures.length, dispose: jest.fn() };
      mockPictures.push(pic);
      return pic;
    },
    Skia: {
      Paint: () => ({ setAntiAlias: () => {}, setColor: () => {} }),
      Color: (c: number) => c,
    },
  };
});

import StarfieldLayers from "../StarfieldLayers";
import { initStarfield } from "../../../game/starswarm/starfield";

const clock = { value: 0 } as React.ComponentProps<typeof StarfieldLayers>["clock"];
const disposed = (pics: FakePicture[]) => pics.map((p) => p.dispose.mock.calls.length);

beforeEach(() => {
  mockPictures.length = 0;
});

describe("StarfieldLayers (#2963)", () => {
  it("records the background and three layers once, and keeps them across re-renders", async () => {
    const layout = initStarfield(400, 700);
    const { rerender } = await render(<StarfieldLayers layout={layout} clock={clock} />);
    expect(mockPictures).toHaveLength(4);
    await rerender(<StarfieldLayers layout={layout} clock={clock} />);
    expect(mockPictures).toHaveLength(4);
    expect(disposed(mockPictures)).toEqual([0, 0, 0, 0]);
  });

  it("disposes the previous set after a re-record, and the current one on unmount", async () => {
    const { rerender, unmount } = await render(
      <StarfieldLayers layout={initStarfield(400, 700)} clock={clock} />
    );
    const first = mockPictures.slice();
    await rerender(<StarfieldLayers layout={initStarfield(700, 400)} clock={clock} />);
    const second = mockPictures.slice(4);
    expect(second).toHaveLength(4);
    expect(disposed(first)).toEqual([1, 1, 1, 1]);
    expect(disposed(second)).toEqual([0, 0, 0, 0]);
    await unmount();
    expect(disposed(second)).toEqual([1, 1, 1, 1]);
    expect(disposed(first)).toEqual([1, 1, 1, 1]); // never twice
  });
});
