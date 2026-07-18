"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "./brand-logo";

const SESSION_KEY = "viberimenya:home-brand-animation:v1";

export function HomeBrandSignature({ eyebrow }: { eyebrow: string }) {
  const [mode, setMode] = useState<"checking" | "animate" | "settled">("checking");

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let seen = false;

    try {
      seen = window.sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      seen = false;
    }

    if (reducedMotion || seen) {
      setMode("settled");
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setMode("animate");
      try {
        window.sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        // Animation still works when sessionStorage is unavailable.
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className={`vm-home-brand-signature is-${mode}`} aria-label={`Выбери Меня. ${eyebrow}`}>
      <span className="vm-home-brand-signature-mark" aria-hidden="true"><BrandMark /></span>
      <span className="vm-home-brand-signature-copy">
        <strong>Выбери Меня</strong>
        <small>{eyebrow}</small>
      </span>
    </div>
  );
}
