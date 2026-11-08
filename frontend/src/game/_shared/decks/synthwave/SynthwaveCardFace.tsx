import React from "react";
import BcCardFace from "../bc/BcCardFace";
import type { CardFaceProps } from "../types";

export default function SynthwaveCardFace(props: CardFaceProps) {
  return <BcCardFace deck="synthwave" {...props} />;
}
