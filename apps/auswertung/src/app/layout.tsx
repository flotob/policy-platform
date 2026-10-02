import type { Metadata } from "next";
import { IBM_Plex_Sans, Literata } from "next/font/google";
import type { ReactNode } from "react";

import "@policy/landkarte/styles.css";
import "./globals.css";

const serif = Literata({ subsets: ["latin"], variable: "--font-serif", display: "swap" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Landkarte des Streits — Auswertung",
  description: "Auswertung einer Anhörung oder Konsultation: was zu klären ist, von wem, und wo die Lager übereinstimmen.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
