import type { ChainPoint } from "@policy/chain";

/** A point as Common Ground renders it — safe to import from client code. */
export interface CGPoint extends ChainPoint {
  label: string;
  summary: string | null;
  finding: string | null;
  theme: string | null;
  measure: string | null;
  status: string;
}

export interface CampRef {
  group: number;
  name: string;
}
