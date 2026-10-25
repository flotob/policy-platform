import type { Metadata } from "next";
import { Public_Sans, Source_Serif_4 } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";
import "./components.css";

const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-serif", axes: ["opsz"], display: "swap" });
const sans = Public_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Landkarte des Streits", template: "%s – Landkarte des Streits" },
  description: "Bürgerbeteiligung für Kommunen: Worüber eine Stadt wirklich streitet, was ein Gutachten klären kann und was der Rat entscheiden muss.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
