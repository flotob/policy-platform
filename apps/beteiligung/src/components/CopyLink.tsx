"use client";

import { useState } from "react";

/** Copies the address of the page it sits on (a Laufzettel, for another device or a note). */
export function CopyLink({ label = "Link kopieren" }: { label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-quiet btn-small"
      onClick={() => {
        void navigator.clipboard?.writeText(window.location.href.split("?")[0]!).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        });
      }}
    >
      {copied ? "Kopiert" : label}
    </button>
  );
}
