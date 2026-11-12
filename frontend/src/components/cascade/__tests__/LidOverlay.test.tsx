/**
 * #3694: the lid's drawing. Skia is replaced by host elements named after each primitive, so
 * the test reads what would be drawn (shape and props) without a native canvas.
 */
import React from "react";
import { render, screen } from "@testing-library/react-native";
import type { TestInstance } from "test-renderer";

import { LidLine, OverLidWash, Spawner } from "../LidOverlay";
import { CASCADE_LID_PALETTE } from "../../../theme/theme.cascade";
import { LID_LINE, SPAWNER } from "../../../game/cascade/lidVisuals";

jest.mock("@shopify/react-native-skia", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  const host = (name: string) => {
    const Host = ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(name, props, children);
    Host.displayName = name;
    return Host;
  };
  return {
    BlurMask: host("BlurMask"),
    Circle: host("Circle"),
    DashPathEffect: host("DashPathEffect"),
    Group: host("Group"),
    Image: host("SkiaImage"),
    Line: host("Line"),
    Path: host("Path"),
  };
});

const palette = CASCADE_LID_PALETTE.light;
const piece = { radius: 22, image: null, imageScale: 1, color: "red-ish" };

/** Renders under a host root, so a lone primitive (or nothing) is still queryable. */
const draw = (element: React.ReactElement) => render(React.createElement("Root", null, element));
const all = (type: string): TestInstance[] => screen.root!.queryAll((n) => n.type === type);
const circlesAtSpawner = () =>
  all("Circle").filter((c) => c.props.cx === SPAWNER.cx && c.props.cy === SPAWNER.cy);
const ringCircles = () => circlesAtSpawner().filter((c) => c.props.r === SPAWNER.ringRadius);
const ghostOutline = () =>
  circlesAtSpawner().find((c) => c.props.style === "stroke" && c.props.r !== SPAWNER.ringRadius);

describe("LidLine", () => {
  it("is a solid line across the bin at the lid, calm colour when safe", async () => {
    await draw(<LidLine dangerRatio={0} palette={palette} />);
    const [line] = all("Line");
    expect(line!.props.p1).toEqual({ x: LID_LINE.x1, y: LID_LINE.y });
    expect(line!.props.p2).toEqual({ x: LID_LINE.x2, y: LID_LINE.y });
    expect(line!.props.color).toBe(palette.lid);
    expect(line!.props.strokeWidth).toBeGreaterThanOrEqual(2);
    expect(line!.props.opacity).toBeUndefined();
  });

  it("is red at the end of the countdown", async () => {
    await draw(<LidLine dangerRatio={1} palette={palette} />);
    expect(all("Line")[0]!.props.color).toBe(palette.danger);
  });
});

describe("OverLidWash", () => {
  it("draws nothing while calm", async () => {
    await draw(<OverLidWash x={100} y={40} radius={20} dangerRatio={0} palette={palette} />);
    expect(all("Circle")).toHaveLength(0);
  });

  it("draws a red wash and outline on a piece over the lid while the count runs", async () => {
    await draw(<OverLidWash x={100} y={40} radius={20} dangerRatio={0.5} palette={palette} />);
    const circles = all("Circle");
    expect(circles).toHaveLength(2);
    expect(circles.every((c) => c.props.color === palette.danger)).toBe(true);
    expect(circles.some((c) => c.props.style === "stroke")).toBe(true);
  });

  it("draws nothing on a piece under the lid", async () => {
    await draw(<OverLidWash x={100} y={400} radius={20} dangerRatio={0.9} palette={palette} />);
    expect(all("Circle")).toHaveLength(0);
  });
});

describe("Spawner", () => {
  it("calm and ready: the piece at full opacity inside a full cyan ring, no ghost", async () => {
    await draw(<Spawner dangerRatio={0} canDrop palette={palette} piece={piece} />);
    const fill = circlesAtSpawner().find((c) => c.props.color === piece.color)!;
    expect(fill.props.opacity).toBe(1);
    expect(ghostOutline()).toBeUndefined();
    expect(all("DashPathEffect")).toHaveLength(0);
    // Track + full ring, no arc.
    expect(ringCircles().map((c) => c.props.color)).toEqual([palette.ink, palette.ringSafe]);
    expect(all("Path")).toHaveLength(0);
  });

  it("waiting (canDrop false): a dashed, faded ghost", async () => {
    await draw(<Spawner dangerRatio={0} canDrop={false} palette={palette} piece={piece} />);
    const fill = circlesAtSpawner().find((c) => c.props.color === piece.color)!;
    expect(fill.props.opacity).toBeLessThan(0.5);
    expect(ghostOutline()).toBeDefined();
    expect(all("DashPathEffect")).toHaveLength(1);
  });

  it("danger 0.5: half the ring left as a clockwise arc, no glow", async () => {
    await draw(<Spawner dangerRatio={0.5} canDrop palette={palette} piece={piece} />);
    const [arc] = all("Path");
    expect(arc).toBeDefined();
    expect(arc!.props.path).toMatch(/^M /);
    expect(ringCircles()).toHaveLength(1); // only the track
    expect(all("BlurMask")).toHaveLength(0);
  });

  it("danger 0.9: a short red arc with a glow", async () => {
    await draw(<Spawner dangerRatio={0.9} canDrop={false} palette={palette} piece={piece} />);
    const [arc] = all("Path");
    expect(arc!.props.color).toBe(palette.danger);
    expect(all("BlurMask")).toHaveLength(1);
  });

  it("game over: only the empty track", async () => {
    await draw(<Spawner dangerRatio={1} canDrop={false} palette={palette} piece={piece} />);
    expect(all("Path")).toHaveLength(0);
    expect(ringCircles()).toHaveLength(1);
  });

  it("draws a decoded sprite instead of the plain circle, sized by imageScale", async () => {
    const image = { width: 1, height: 1 } as never;
    await draw(
      <Spawner
        dangerRatio={0}
        canDrop
        palette={palette}
        piece={{ ...piece, image, imageScale: 1.5 }}
      />
    );
    const [sprite] = all("SkiaImage");
    expect(sprite!.props.width).toBe(22 * 1.5 * 2);
    expect(circlesAtSpawner().find((c) => c.props.color === piece.color)).toBeUndefined();
  });
});
