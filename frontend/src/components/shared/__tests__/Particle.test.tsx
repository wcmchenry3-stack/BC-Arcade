import React from "react";
import { render } from "@testing-library/react-native";
import { Particle, useParticleGroup, type ParticleGroup, type ParticleMotion } from "../Particle";

const RAY: ParticleMotion = { kind: "ray", angle: 30 };
const CENTERED_RAY: ParticleMotion = { kind: "ray", angle: 60, centerOrigin: true };
const POP: ParticleMotion = { kind: "pop", x: -90, y: 80 };

let group: ParticleGroup;

function Burst({ motions, glyph }: { motions: readonly ParticleMotion[]; glyph?: string }) {
  group = useParticleGroup();
  return (
    <>
      {motions.map((motion, i) => (
        <Particle
          key={i}
          index={i}
          group={group}
          motion={motion}
          style={{ position: "absolute" }}
          glyph={glyph}
        />
      ))}
    </>
  );
}

function flatStyles(view: Awaited<ReturnType<typeof render>>) {
  const json = view.toJSON();
  // Several particles render as a fragment: a wrapper node holding them.
  const nodes = json && !Array.isArray(json) && json.type === "" ? (json.children ?? []) : [json];
  return nodes.map((n) =>
    Object.assign({}, ...[(n as { props: { style: unknown } }).props.style].flat(Infinity))
  );
}

describe("Particle", () => {
  it("registers one value per particle, in index order", async () => {
    await render(<Burst motions={[RAY, RAY, RAY]} />);
    const values = group.all();
    expect(values).toHaveLength(3);
    expect(new Set(values).size).toBe(3);
    values.forEach((v) => expect(v.value).toBe(0));
  });

  it("drops a particle's value when it unmounts", async () => {
    const view = await render(<Burst motions={[RAY, RAY, RAY]} />);
    const [first, second] = group.all();
    await view.rerender(<Burst motions={[RAY, RAY]} />);
    expect(group.all()).toEqual([first, second]);
  });

  it("draws a ray growing along its angle", async () => {
    const view = await render(<Burst motions={[RAY, CENTERED_RAY]} />);
    group.all().forEach((v) => {
      v.value = 0.5;
    });
    await view.rerender(<Burst motions={[RAY, CENTERED_RAY]} />);
    const [ray, centered] = flatStyles(view);
    expect(ray).toMatchObject({
      transform: [{ rotate: "30deg" }, { scaleX: 0.5 }],
      opacity: 0.5,
    });
    expect(ray.transformOrigin).toBeUndefined();
    expect(centered).toMatchObject({
      transform: [{ rotate: "60deg" }, { scaleX: 0.5 }],
      transformOrigin: "center",
    });
  });

  it("pops a glyph in at its offset", async () => {
    const view = await render(<Burst motions={[POP]} glyph="★" />);
    expect(view.getByText("★")).toBeTruthy();
    group.all()[0].value = 1;
    await view.rerender(<Burst motions={[POP]} glyph="★" />);
    expect(flatStyles(view)[0]).toMatchObject({
      transform: [{ translateX: -90 }, { translateY: 80 }, { scale: 1 }],
      opacity: 1,
    });
  });
});
