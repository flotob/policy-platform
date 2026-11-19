import Link from "next/link";

/** On every page: the operator's imprint and privacy notice. */
export function LegalFooter() {
  return (
    <footer className="legal-foot">
      <div className="wrap">
        <span>streit.bar</span>
        <Link href="/impressum">Impressum</Link>
        <Link href="/datenschutz">Datenschutz</Link>
      </div>
    </footer>
  );
}
