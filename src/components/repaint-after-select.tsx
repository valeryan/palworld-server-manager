"use client";
import { useEffect, useState } from "react";

// Chromium on Linux (Electron under XWayland) can leave the window showing a stale frame after a
// native <select> popup closes while the content under it changes; the screen only catches up on the
// next large repaint such as a scroll or click. Flipping an invisible full-window layer right after
// every select change gives the compositor that full-window repaint immediately.
export function RepaintAfterSelect() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!window.psmDesktop) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = (event: Event) => {
      if (!(event.target instanceof HTMLSelectElement)) return;
      setTick((value) => value + 1);
      clearTimeout(timer); timer = setTimeout(() => setTick((value) => value + 1), 150);
    };
    document.addEventListener("change", onChange, true);
    return () => { document.removeEventListener("change", onChange, true); clearTimeout(timer); };
  }, []);
  return <div className="repaint-shim" data-tick={tick % 2} aria-hidden="true" />;
}
