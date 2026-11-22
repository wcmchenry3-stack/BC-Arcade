import React from "react";
import BcCardFace from "../bc/BcCardFace";
import type { CardFaceProps } from "../types";

export default function ParlorCardFace(props: CardFaceProps) {
  return <BcCardFace deck="parlor" {...props} />;
}
