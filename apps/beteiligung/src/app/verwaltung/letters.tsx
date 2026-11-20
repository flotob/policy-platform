"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export interface LetterInfo {
  town: string;
  question: string;
  measure: string;
  /** "31. Januar 2027", or null when open-ended. */
  end: string | null;
  /** https://streit.bar/musterstadt/solarpflicht */
  url: string;
  /** Codes for the cross-check by lot (open procedure) or invitations (access "einladung"). */
  drawn: boolean;
}

const withCode = (url: string, code: string) => `${url}?code=${encodeURIComponent(code)}`;

/** One A4 letter per code, printed straight from the browser ("Als PDF sichern" works too). Nothing is stored. */
function Letter({ info, code, qr }: { info: LetterInfo; code: string; qr: string }) {
  return (
    <article className="print-letter">
      <p className="print-letter-from">{info.town}</p>
      <div className="print-letter-window">Platz für die Anschrift</div>
      <h1>{info.drawn ? "Sie wurden ausgelost. Ihre Meinung zählt." : "Ihre Einladung zur Beteiligung"}</h1>
      <p>Guten Tag,</p>
      <p>
        {info.town} stellt eine Maßnahme zur Diskussion: <strong>{info.question}</strong>
      </p>
      <p className="print-letter-measure">{info.measure}</p>
      {info.drawn ? (
        <p>
          Damit nicht nur diejenigen mitreden, die sich ohnehin melden, haben wir Einwohnerinnen und Einwohner zufällig ausgelost. Sie sind eine
          oder einer davon. Ihre Stimmen zählen wie alle anderen und werden zusätzlich getrennt ausgewertet. So sieht die Stadt, ob das Bild der
          Beteiligung auch bei Menschen trägt, die nicht von sich aus mitmachen.
        </p>
      ) : (
        <p>Mit diesem Brief laden wir Sie ein, an der Beteiligung teilzunehmen. Der Code unten öffnet sie für Sie.</p>
      )}
      <p>
        Mitmachen dauert etwa zehn Minuten. Sie sehen kurze Aussagen und sagen zu jeder, ob Sie zustimmen oder ablehnen. Fehlt Ihnen ein Punkt,
        schreiben Sie ihn dazu. Ohne Anmeldung; Ihre Stimmen bleiben anonym.
      </p>
      <div className="print-letter-code">
        <div className="print-letter-qr" dangerouslySetInnerHTML={{ __html: qr }} />
        <div>
          <p>Scannen Sie den Code mit dem Handy, oder öffnen Sie</p>
          <p className="print-letter-url">{info.url.replace(/^https?:\/\//, "")}</p>
          <p>und geben Sie Ihren persönlichen Code ein:</p>
          <p className="print-letter-pin">{code}</p>
        </div>
      </div>
      <p>{info.end ? `Die Beteiligung läuft bis zum ${info.end}. ` : ""}Der Code gilt einmal.</p>
      <p>
        Mit freundlichen Grüßen
        <br />
        {info.town}
      </p>
    </article>
  );
}

export function Letters({ info, codes }: { info: LetterInfo; codes: string[] }) {
  const [qrs, setQrs] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || qrs) return;
    let gone = false;
    void Promise.all(codes.map((c) => QRCode.toString(withCode(info.url, c), { type: "svg", margin: 0, errorCorrectionLevel: "M" }))).then((x) => {
      if (!gone) setQrs(x);
    });
    return () => {
      gone = true;
    };
  }, [open, qrs, codes, info.url]);

  useEffect(() => {
    if (open && qrs) {
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
  }, [open, qrs]);

  const csv = () => {
    const rows = [["code", "link"], ...codes.map((c) => [c, withCode(info.url, c)])].map((r) => r.join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`﻿${rows}\n`], { type: "text/csv;charset=utf-8" }));
    a.download = `codes-${info.drawn ? "gelost" : "einladung"}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <div className="letters-actions">
        <button type="button" className="btn btn-small" onClick={() => (qrs ? window.print() : setOpen(true))} disabled={open && !qrs}>
          {open && !qrs ? "Briefe werden vorbereitet …" : `${codes.length === 1 ? "Brief" : `${codes.length} Briefe`} drucken`}
        </button>
        <button type="button" className="btn btn-quiet btn-small" onClick={csv}>
          Codes als Tabelle (für Serienbriefe)
        </button>
      </div>
      {open && qrs
        ? createPortal(
            <div className="letters-print">
              {codes.map((c, i) => (
                <Letter key={c} info={info} code={c} qr={qrs[i]!} />
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
