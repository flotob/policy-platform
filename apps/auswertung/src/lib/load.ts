import { cache } from "react";
import { notFound } from "next/navigation";

import { loadOverview } from "@policy/landkarte/data";

import { getDb } from "./db";

/** The consultation overview, once per request; 404 for an unknown ref. */
export const overview = cache(async (ref: string) => {
  const o = await loadOverview(getDb(), ref);
  if (!o) notFound();
  return o;
});
