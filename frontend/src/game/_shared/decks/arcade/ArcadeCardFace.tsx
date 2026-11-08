import React from "react";
import BcCardFace from "../bc/BcCardFace";
import type { CardFaceProps } from "../types";

export default function ArcadeCardFace(props: CardFaceProps) {
  return <BcCardFace deck="arcade" {...props} />;
}
