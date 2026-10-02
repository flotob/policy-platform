import type { Bezirk, Diag, Door, Typ } from "../vocab.ts";
import type { Verdict } from "../verdict.ts";

export interface Org {
  submissionId: string;
  participantId: string | null;
  name: string;
  short: string;
  type: string | null;
  chars: number;
  /** Released points this organisation's statement contributed. */
  points: number;
  /** Analysis group of this organisation, null when it was not clustered. */
  camp: number | null;
}

export interface Camp {
  group: number;
  name: string;
  summary: string | null;
  size: number;
  orgs: string[];
  /** The organisations among `orgs` (by name) and how many private persons the camp has. */
  named: string[];
  people: number;
  /** "a" = the larger camp (solid ink), "b" = the other (hatched grey). */
  side: "a" | "b";
}

export interface CampCount {
  agree: number;
  disagree: number;
  size: number;
}

export interface MeasureSummary {
  scope: string;
  display: string;
  slug: string;
  /** What the bill says about this measure (propose-measures-bill). */
  description: string | null;
  paragraphs: number[];
  /** Landkarten-Punkte without Lücken. */
  points: number;
  withNumbers: number;
  counts: Partial<Record<Diag, number>>;
  verdict: Verdict;
  /** Extraction points sorted under this measure. */
  extractionPoints: number;
  /** Extraction points on no Landkarten-Punkt. */
  singles: number;
  kern: { id: string; label: string; question: string | null } | null;
}

export interface Overview {
  id: string;
  ref: string;
  title: string;
  /** What the procedure is called in the interface: a hearing (Bundestag) or a consultation (ministry). Both "die …". */
  procedure: "Anhörung" | "Konsultation";
  /** The draft under consultation: a law (sections) or a strategy (fields of action). */
  draft: { kind: "law" | "strategy"; title: string };
  orgs: Org[];
  camps: Camp[];
  /** Smaller groups beyond the two largest camps (k > 2): named and shown, not part of the diagnoses. */
  otherCamps: Omit<Camp, "side">[];
  measures: MeasureSummary[];
  stats: {
    statements: number;
    /** Statements by private persons ("Privatperson N"). */
    privatePersons: number;
    /** Statements not (yet) decomposed into arguments; their stances are still inferred from the text. */
    undecomposed: number;
    chars: number;
    /** Rough page count of the statements (2,500 characters per page). */
    pages: number;
    points: number;
    mapPoints: number;
    singles: number;
    votes: number;
    relations: number;
    crossRelations: number;
    silhouette: number | null;
  };
}

export interface Quote {
  quelle: string;
  text: string;
  lager?: string;
  submission?: string;
}

export interface MapPoint {
  id: string;
  scope: string;
  ord: number;
  typ: Typ;
  bezirk: Bezirk;
  question: string | null;
  text: string;
  label: string;
  diag: Diag | null;
  pa: number | null;
  pb: number | null;
  nVoted: number;
  befund: string | null;
  votes: { a: CampCount; b: CampCount } | null;
  reasons: string | null;
  reasonsRationale: string | null;
  quotes: Quote[];
  /** Extraction points underneath. */
  members: number;
  /** Organisations that said one of them. */
  orgs: number;
  /** Most common critical question among the members (for instruments: which question they answer). */
  door: Door | null;
}

export interface SinglePoint {
  id: string;
  label: string;
  summary: string | null;
  orgs: string[];
  /** Organisations (other than the authors) that agree / disagree, inferred by Jev. */
  agree: string[];
  disagree: string[];
}
