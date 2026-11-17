"use client";

import { useEffect } from "react";

/**
 * Pointer-tracked glow and tilt for any element marked `data-spotlight`.
 * Sets `--mx`/`--my` (pointer position in px) and `--rx`/`--ry` (tilt) on the
 * hovered card; CSS does the rest. Skipped for coarse pointers and reduced motion.
 */
export function Spotlight() {
  useEffect(() => {
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !window.matchMedia("(pointer: fine)").matches
    )
      return;
    const onMove = (event: PointerEvent) => {
      const card = (event.target as Element | null)?.closest<HTMLElement>(
        "[data-spotlight]",
      );
      if (!card) return;
      const r = card.getBoundingClientRect();
      const x = event.clientX - r.left;
      const y = event.clientY - r.top;
      card.style.setProperty("--mx", `${x}px`);
      card.style.setProperty("--my", `${y}px`);
      card.style.setProperty("--ry", `${(x / r.width - 0.5) * 7}deg`);
      card.style.setProperty("--rx", `${(0.5 - y / r.height) * 7}deg`);
    };
    const onLeave = (event: PointerEvent) => {
      const card = (event.target as Element | null)?.closest<HTMLElement>(
        "[data-spotlight]",
      );
      if (!card || card.contains(event.relatedTarget as Node | null)) return;
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerout", onLeave, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerout", onLeave);
    };
  }, []);
  return null;
}
