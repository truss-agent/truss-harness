"use client";

import { useEffect, useRef, useState } from "react";

function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * The hero's three.js scene. three.js loads after hydration so it never
 * delays the headline. Without WebGL the CSS backdrop stays; with reduced
 * motion a single still frame is drawn.
 */
export function HeroScene() {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!webglAvailable()) return;
    let disposed = false;
    let dispose: (() => void) | undefined;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    import("./truss-scene")
      .then(({ createTrussScene }) => {
        if (disposed || !host.current) return;
        dispose = createTrussScene(host.current, { reduced }).dispose;
        setReady(true);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      dispose?.();
    };
  }, []);

  return (
    <div
      ref={host}
      className="holo-scene"
      data-ready={ready ? "" : undefined}
      aria-hidden="true"
    />
  );
}

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
