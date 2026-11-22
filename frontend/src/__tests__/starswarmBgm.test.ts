/**
 * #3637/#3638: the Star Swarm background track ships byte for byte as the owner approved it (Round
 * 46 with the loop edit from `tools/assets/make_starswarm_bgm_loop.py`), and its starting points sit
 * inside the track and outside the loop crossfade.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { STARSWARM_BGM } from "../game/starswarm/bgmCues";

const FILE = path.join(__dirname, "../../assets/sounds/starswarm-bgm.mp3");
const EXPECTED_SHA256 = "85950430fbfaf0ed9c6425e7b79ee238a44fd6be40c99de934709f661a13426c";
// The four replaced Pixabay tracks' combined size: the epic's (#3635) ceiling for the new file.
const MAX_BYTES = 11_284_237;

describe("Star Swarm background track (#3637, #3638)", () => {
  it("exists", () => {
    expect(fs.existsSync(FILE)).toBe(true);
  });

  it("is within the size budget", () => {
    expect(fs.statSync(FILE).size).toBeLessThanOrEqual(MAX_BYTES);
  });

  it("is byte for byte the approved Round 46 loop edit", () => {
    const sha = crypto.createHash("sha256").update(fs.readFileSync(FILE)).digest("hex");
    expect(sha).toBe(EXPECTED_SHA256);
  });
});

describe("Star Swarm background track starting points (#3637)", () => {
  const { cuesMs, durationMs, loopCrossfadeMs } = STARSWARM_BGM;

  it("start at 0 and are sorted and unique", () => {
    expect(cuesMs[0]).toBe(0);
    for (let i = 1; i < cuesMs.length; i++) {
      expect(cuesMs[i]!).toBeGreaterThan(cuesMs[i - 1]!);
    }
  });

  it("fall before the loop crossfade", () => {
    for (const cue of cuesMs) {
      expect(cue).toBeLessThan(durationMs - loopCrossfadeMs);
    }
  });
});
