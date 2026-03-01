"use no memo";

import { useEffect, useCallback } from "react";
import { Platform } from "react-native";

interface Props {
  onPress: () => void;
}

export default function WebFAB({ onPress }: Props) {
  const handleClick = useCallback(() => {
    onPress();
  }, [onPress]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof document === "undefined") return;

    const prev = document.querySelector("[data-testid='host-fab']");
    if (prev) prev.remove();

    const btn = document.createElement("button");
    btn.setAttribute("data-testid", "host-fab");
    btn.setAttribute("aria-label", "Host a Run");
    btn.style.cssText = [
      "position:fixed",
      "bottom:100px",
      "right:20px",
      "width:56px",
      "height:56px",
      "border-radius:50%",
      "background:#00D97E",
      "border:none",
      "cursor:pointer",
      "z-index:99999",
      "font-size:26px",
      "font-weight:bold",
      "color:#080F0C",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "box-shadow:none",
      "line-height:56px",
    ].join(";");
    btn.textContent = "+";
    btn.addEventListener("click", handleClick);
    document.body.appendChild(btn);

    return () => {
      btn.removeEventListener("click", handleClick);
      if (document.body.contains(btn)) document.body.removeChild(btn);
    };
  }, [handleClick]);

  return null;
}
