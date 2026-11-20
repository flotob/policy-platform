"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Sizes as people read them: "68 KB", "4,2 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;
}

/**
 * A file field that takes several files at once (a statement and its attachments) and lists what was
 * chosen, so nobody wonders whether the second file came along.
 */
export function FilePicker(props: { id: string; name: string; accept: string; label: string; hint: ReactNode; required?: boolean; together?: string }) {
  const [chosen, setChosen] = useState<{ name: string; size: number }[]>([]);
  const input = useRef<HTMLInputElement>(null);
  // React empties the form after it was sent (also after an error): the list goes with it.
  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    const clear = () => setChosen([]);
    form.addEventListener("reset", clear);
    return () => form.removeEventListener("reset", clear);
  }, []);
  const total = chosen.reduce((n, f) => n + f.size, 0);
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        ref={input}
        id={props.id}
        name={props.name}
        type="file"
        multiple
        className="input file-input"
        accept={props.accept}
        required={props.required}
        onChange={(e) => setChosen([...(e.currentTarget.files ?? [])].map((f) => ({ name: f.name, size: f.size })))}
      />
      {chosen.length > 1 ? (
        <div className="file-chosen">
          <ul>
            {chosen.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <span className="fc-name">{f.name}</span> <span className="fc-size">{fileSize(f.size)}</span>
              </li>
            ))}
          </ul>
          <p>
            {chosen.length} Dateien, zusammen {fileSize(total)}.{props.together ? ` ${props.together}` : ""}
          </p>
        </div>
      ) : null}
      <span className="hint">{props.hint}</span>
    </div>
  );
}
