/**
 * Diagnose + Befund for the canonical Landkarten-Punkte (map grain).
 *
 * Three parts per scope, in the concept paper's trust architecture:
 *  1. DETERMINISTIC: camp profiles (mean agreement of the two largest camps
 *     over the voted extraction points underneath), diagnosis from the fixed
 *     vocabulary (bruecke/klaerbar/wert/kern/offen), Lücken rows for the
 *     critical questions nobody asked, quotes pulled from point_sources.
 *     No AI involved — "die Diagnosen werden gerechnet, nicht gemeint".
 *  2. REASONS CHECK (machine-flagged, editorial review pending): bridge
 *     points are screened for the Scheinbrücke pattern (agreement for
 *     diverging reasons) → diag 'warnung' + needs_review flag.
 *  3. BEFUND: the LLM verbalizes the computed verdict — binding, it may
 *     phrase but never change it (paper, Phase 4).
 *
 * Idempotent: profiles/diagnoses are recomputed on every run (cheap, pure);
 * Befunde are skipped when present unless --force.
 *
 * Usage:
 *   DATABASE_URL=... tsx scripts/diagnose-map.ts --consultation <ref>
 *     [--scope <name>] [--concurrency 4] [--force] [--skip-befund]
 */

import { createHash } from "node:crypto";

import { createDb, sql } from "@policy/db";
import { AgentSdkProvider, JevJudge } from "@policy/llm";

import {
  BEFUND_SYSTEM,
  REASONS_CHECK_SYSTEM,
  befundPrompt,
  reasonsCheckPrompt,
  type VoteCounts,
} from "../src/prompts.ts";
import {
  befundJsonSchema,
  befundOutput,
  reasonsCheckJsonSchema,
  reasonsCheckOutput,
} from "../src/schemas.ts";
import { runPool } from "../src/pool.ts";
import { saveJudgment } from "../src/jev-stage.ts";
import { REASONS_SCREEN, REASONS_SCREEN_MIN } from "../src/jev-map.ts";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

// Chain doctrine constants (packages/chain): real dissent = gap >= 15pp AND
// the weaker camp below the 60% floor.
const FORK_GAP = 15;
const AGREE_FLOOR = 60;
const KERN_MIN_GAP = 30;
/** Direct votes (map-points engine): a camp profile needs this many voters per camp — 2, or half of a camp smaller than 4. */
const minCampVoters = (size: number) => Math.min(2, Math.max(1, Math.ceil(size / 2)));

const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
/** A reasons verdict is valid for the evidence it judged: claim, members, quotes. */
const reasonsFingerprint = (text: string, memberLabels: string[], quotes: { text: string }[] | null) =>
  sha({ text, members: [...memberLabels].sort(), quotes: (quotes ?? []).map((q) => q.text) });
const DOORS: Record<
  string,
  { bezirk: string; label: string; text: string }
> = {
  empirics: {
    bezirk: "wirkung",
    label: "Lücke: Empirie-Frage ungestellt",
    text: "Tritt die behauptete Wirkung wirklich ein? — Diese kritische Frage hat im Verfahren niemand gestellt.",
  },
  alternatives: {
    bezirk: "alternativen",
    label: "Lücke: Alternativen-Frage ungestellt",
    text: "Erreicht ein anderes Mittel dasselbe Ziel günstiger oder schonender? — Diese kritische Frage hat im Verfahren niemand gestellt.",
  },
  goal_conflict: {
    bezirk: "kosten",
    label: "Lücke: Zielkonflikt-Frage ungestellt",
    text: "Verletzt die Maßnahme nebenbei ein anderes Ziel, das uns auch wichtig ist? — Diese kritische Frage hat im Verfahren niemand gestellt.",
  },
  feasibility: {
    bezirk: "machbarkeit",
    label: "Lücke: Machbarkeits-Frage ungestellt",
    text: "Lässt sich das praktisch überhaupt umsetzen? — Diese kritische Frage hat im Verfahren niemand gestellt.",
  },
  value_conflict: {
    bezirk: "wert",
    label: "Lücke: Wertkonflikt-Frage ungestellt",
    text: "Ist dieser Wert das wert, was wir dafür opfern? — Diese kritische Frage hat im Verfahren niemand gestellt.",
  },
};

interface Analysis {
  engine?: string;
  participantGroups?: { participant: string; group: number }[];
  clustering: { groupSizes: Record<string, number> };
  statements: {
    pointId: string;
    perGroup: { group: number; pa: number; ns: number }[];
  }[];
  campNames?: Record<string, { name: string }>;
}

interface MapRow {
  id: string;
  ord: number;
  typ: string;
  bezirk: string;
  text: string;
  label: string;
  diag: string | null;
  befund: string | null;
  diag_flags: Record<string, unknown> | null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const consultation = arg("consultation");
  if (!consultation) throw new Error("--consultation required");
  const onlyScope = arg("scope");
  const concurrency = Number(arg("concurrency") ?? 6);
  const force = flag("force");
  const skipBefund = flag("skip-befund");

  const db = createDb(url);
  const cons = await db.execute(sql`
    SELECT id, tenant_id FROM consultations
    WHERE id::text = ${consultation} OR source_ref = ${consultation}
    ORDER BY created_at DESC LIMIT 1
  `);
  if (cons.rows.length === 0) throw new Error(`consultation ${consultation} not found`);
  const { id: consultationId, tenant_id: tenantId } = cons.rows[0] as {
    id: string; tenant_id: string;
  };

  const runRes = await db.execute(sql`
    SELECT result FROM analysis_runs WHERE consultation_id = ${consultationId}
    ORDER BY created_at DESC LIMIT 1
  `);
  const analysis = (runRes.rows[0]?.result ?? null) as Analysis | null;
  if (!analysis) throw new Error("no analysis run — run analyze first");
  const top2 = Object.entries(analysis.clustering.groupSizes)
    .map(([g, n]) => ({ g: Number(g), n }))
    .sort((a, b) => b.n - a.n || a.g - b.g)
    .slice(0, 2);
  if (top2.length < 2) throw new Error("need two camps");
  const [gA, gB] = [top2[0]!.g, top2[1]!.g];
  const campA = analysis.campNames?.[String(gA)]?.name ?? `Lager ${gA}`;
  const campB = analysis.campNames?.[String(gB)]?.name ?? `Lager ${gB}`;
  const profileByPoint = new Map(
    analysis.statements.map((s) => [s.pointId, s.perGroup]),
  );
  // map-points engine (exp/jev): camps were computed from direct votes on the
  // Landkarten-Punkte — profiles are read per map point, not averaged up.
  const direct = analysis.engine === "map-points";
  const campOfSubmission = new Map<string, string>();
  if (direct) {
    const partRes = await db.execute(sql`SELECT id, source_ref FROM participants WHERE consultation_id = ${consultationId}`);
    const subOf = new Map((partRes.rows as { id: string; source_ref: string }[]).map((p) => [p.id, p.source_ref.replace(/^inferred:/, "")]));
    for (const pg of analysis.participantGroups ?? []) {
      const sub = subOf.get(pg.participant);
      const name = analysis.campNames?.[String(pg.group)]?.name ?? `Lager ${pg.group}`;
      if (sub) campOfSubmission.set(sub, name);
    }
  }
  const judge = direct ? new JevJudge() : null;
  // Raw counts per map point and camp — the honest form of the numbers.
  const countsByMap = new Map<string, VoteCounts>();
  if (direct) {
    const groupOf = new Map((analysis.participantGroups ?? []).map((p) => [p.participant, p.group]));
    const sizeA = analysis.clustering.groupSizes[String(gA)] ?? 0;
    const sizeB = analysis.clustering.groupSizes[String(gB)] ?? 0;
    const vRes = await db.execute(sql`
      SELECT v.map_point_id, v.participant_id, v.value FROM map_point_votes v
      JOIN map_points m ON m.id = v.map_point_id WHERE m.consultation_id = ${consultationId}
    `);
    for (const v of vRes.rows as { map_point_id: string; participant_id: string; value: number }[]) {
      const g = groupOf.get(v.participant_id);
      if (g !== gA && g !== gB) continue;
      const c = countsByMap.get(v.map_point_id) ?? {
        a: { agree: 0, disagree: 0, size: sizeA },
        b: { agree: 0, disagree: 0, size: sizeB },
      };
      const side = g === gA ? c.a : c.b;
      if (v.value === 1) side.agree++;
      else if (v.value === -1) side.disagree++;
      countsByMap.set(v.map_point_id, c);
    }
  }

  const scopesRes = await db.execute(sql`
    SELECT DISTINCT scope FROM map_points
    WHERE consultation_id = ${consultationId} ORDER BY scope
  `);
  let scopes = (scopesRes.rows as { scope: string }[]).map((r) => r.scope);
  if (onlyScope) scopes = scopes.filter((s) => s === onlyScope);

  const provider = new AgentSdkProvider();

  const befundJobs: { scope: string; row: MapRow; members: { id: string; label: string }[] }[] = [];
  const numericBridge = new Set<string>();
  const reasonsPending = new Set<string>();
  for (const scope of scopes) {
    console.log(`\n=== scope: ${scope} ===`);

    // ——— Lücken: critical questions with zero objections in this scope.
    const doorRes = await db.execute(sql`
      SELECT cq, count(*)::int AS n FROM points
      WHERE consultation_id = ${consultationId} AND measure = ${scope}
        AND status = 'released' AND cq IS NOT NULL
      GROUP BY cq
    `);
    const asked = new Set((doorRes.rows as { cq: string }[]).map((r) => r.cq));
    const maxOrdRes = await db.execute(sql`
      SELECT COALESCE(max(ord), 0)::int AS m FROM map_points
      WHERE consultation_id = ${consultationId} AND scope = ${scope}
    `);
    let nextOrd = (maxOrdRes.rows[0] as { m: number }).m + 1;
    for (const [door, spec] of Object.entries(DOORS)) {
      if (asked.has(door)) continue;
      const exists = await db.execute(sql`
        SELECT 1 FROM map_points WHERE consultation_id = ${consultationId}
          AND scope = ${scope} AND typ = 'luecke' AND bezirk = ${spec.bezirk}
      `);
      if (exists.rows.length > 0) continue;
      await db.execute(sql`
        INSERT INTO map_points (tenant_id, consultation_id, scope, ord, typ, bezirk,
                                text, label, diag, created_by)
        VALUES (${tenantId}, ${consultationId}, ${scope}, ${nextOrd++}, 'luecke',
                ${spec.bezirk}, ${spec.text}, ${spec.label}, 'luecke', 'diagnose:deterministic')
      `);
      console.log(`  + Lücke (${door})`);
    }

    // ——— Deterministic profiles + diagnoses.
    const rowsRes = await db.execute(sql`
      SELECT id, ord, typ, bezirk, text, label, diag, befund, diag_flags, quotes
      FROM map_points
      WHERE consultation_id = ${consultationId} AND scope = ${scope}
      ORDER BY ord
    `);
    const rows = rowsRes.rows as unknown as (MapRow & { quotes: { text: string }[] | null })[];

    const membersRes = await db.execute(sql`
      SELECT id, label, map_point_id FROM points
      WHERE consultation_id = ${consultationId} AND measure = ${scope}
        AND map_point_id IS NOT NULL AND status = 'released'
    `);
    const membersByMap = new Map<string, { id: string; label: string }[]>();
    for (const m of membersRes.rows as { id: string; label: string; map_point_id: string }[]) {
      const list = membersByMap.get(m.map_point_id) ?? [];
      list.push({ id: m.id, label: m.label });
      membersByMap.set(m.map_point_id, list);
    }

    const computed = new Map<
      string,
      { pa: number | null; pb: number | null; nVoted: number; diag: string; gap: number }
    >();
    for (const row of rows) {
      if (row.typ === "luecke") {
        computed.set(row.id, { pa: null, pb: null, nVoted: 0, diag: "luecke", gap: 0 });
        continue;
      }
      const members = membersByMap.get(row.id) ?? [];
      const pasA: number[] = [];
      const pasB: number[] = [];
      let nVoted: number;
      if (direct) {
        const per = profileByPoint.get(row.id) ?? [];
        const a = per.find((x) => x.group === gA);
        const b = per.find((x) => x.group === gB);
        const sizeA = analysis.clustering.groupSizes[String(gA)] ?? 0;
        const sizeB = analysis.clustering.groupSizes[String(gB)] ?? 0;
        if (a && b && a.ns >= minCampVoters(sizeA) && b.ns >= minCampVoters(sizeB)) {
          pasA.push(a.pa);
          pasB.push(b.pa);
        }
        nVoted = per.reduce((s2, x) => s2 + x.ns, 0);
      } else {
        for (const m of members) {
          const per = profileByPoint.get(m.id);
          if (!per) continue;
          const a = per.find((x) => x.group === gA && x.ns > 0);
          const b = per.find((x) => x.group === gB && x.ns > 0);
          if (!a || !b) continue;
          pasA.push(a.pa);
          pasB.push(b.pa);
        }
        nVoted = pasA.length;
      }
      let pa: number | null = null;
      let pb: number | null = null;
      let diag = "offen";
      let gap = 0;
      if (pasA.length > 0) {
        pa = Math.round((pasA.reduce((s, x) => s + x, 0) / pasA.length) * 100);
        pb = Math.round((pasB.reduce((s, x) => s + x, 0) / pasB.length) * 100);
        gap = Math.abs(pa - pb);
        const min = Math.min(pa, pb);
        if (min >= AGREE_FLOOR) diag = "bruecke";
        else if (gap >= FORK_GAP) {
          diag = row.typ === "T" ? "klaerbar" : row.typ === "W" ? "wert" : "offen";
        }
      }
      // The numbers make a bridge; a CURRENT false-bridge verdict (same
      // evidence, no --force) keeps it a warning. A stale or forced one is
      // re-checked below.
      if (diag === "bruecke") {
        numericBridge.add(row.id);
        const fp = reasonsFingerprint(row.text, members.map((m) => m.label), row.quotes);
        if (!force && row.diag_flags?.reasons === "diverging_reasons" && row.diag_flags?.reasons_for === fp) diag = "warnung";
      }
      computed.set(row.id, { pa, pb, nVoted, diag, gap });
    }

    // kern: the W point with the largest real gap (>= KERN_MIN_GAP).
    let kernId: string | null = null;
    let kernGap = 0;
    for (const row of rows) {
      const c = computed.get(row.id)!;
      if (row.typ === "W" && c.diag === "wert" && c.gap >= KERN_MIN_GAP && c.gap > kernGap) {
        kernId = row.id;
        kernGap = c.gap;
      }
    }
    if (kernId) computed.get(kernId)!.diag = "kern";

    // Quotes: up to 3 crisp originals from the members' point_sources.
    // map-points engine: the quotes belong to the map-quotes stage (Jev
    // evidence ranking); here they only get their camp.
    for (const row of rows) {
      const c = computed.get(row.id)!;
      if (direct) {
        const cur = await db.execute(sql`SELECT quotes FROM map_points WHERE id = ${row.id}`);
        const qs = ((cur.rows[0] as { quotes: { lager: string; quelle: string; text: string; submission?: string }[] | null }).quotes ?? []).map(
          (q) => ({ ...q, lager: (q.submission && campOfSubmission.get(q.submission)) || "—" }),
        );
        const votes = countsByMap.get(row.id) ?? null;
        await db.execute(sql`
          UPDATE map_points SET pa = ${c.pa}, pb = ${c.pb}, n_voted = ${c.nVoted}, diag = ${c.diag},
            quotes = ${JSON.stringify(qs)},
            diag_flags = COALESCE(diag_flags, '{}'::jsonb) || ${JSON.stringify({ votes })}::jsonb
          WHERE id = ${row.id}
        `);
        continue;
      }
      const quotesRes = await db.execute(sql`
        SELECT ps.quote, s.author_org FROM point_sources ps
        JOIN points p ON p.id = ps.point_id
        JOIN submissions s ON s.id = ps.submission_id
        WHERE p.map_point_id = ${row.id} AND ps.quote IS NOT NULL
          AND length(ps.quote) BETWEEN 40 AND 300
        ORDER BY length(ps.quote) ASC
        LIMIT 12
      `);
      const seenOrg = new Set<string>();
      const quotes: { lager: string; quelle: string; text: string }[] = [];
      // Prefer sentence-shaped quotes — extraction spans are sometimes cut
      // mid-sentence, and a truncated fragment reads like a bug.
      const sentenceLike = (t: string) =>
        /^[A-ZÄÖÜ„"\d]/.test(t) && /[.!?…]["“]?$/.test(t);
      const rowsQ = quotesRes.rows as { quote: string; author_org: string | null }[];
      for (const pass of [true, false]) {
        for (const q of rowsQ) {
          const text = q.quote.trim();
          if (pass !== sentenceLike(text)) continue;
          const org = q.author_org ?? "Stellungnahme";
          if (seenOrg.has(org)) continue;
          seenOrg.add(org);
          quotes.push({ lager: "—", quelle: org, text });
          if (quotes.length >= 3) break;
        }
        if (quotes.length >= 2) break;
      }
      await db.execute(sql`
        UPDATE map_points SET
          pa = ${c.pa}, pb = ${c.pb}, n_voted = ${c.nVoted}, diag = ${c.diag},
          quotes = ${JSON.stringify(quotes)}
        WHERE id = ${row.id}
      `);
    }
    await db.execute(sql`
      INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
      VALUES (${tenantId}, 'diagnose:deterministic', 'map_point.diagnose',
              'consultation', ${consultationId},
              ${JSON.stringify({ scope, points: rows.length, campA, campB })})
    `);
    const dist: Record<string, number> = {};
    for (const c of computed.values()) dist[c.diag] = (dist[c.diag] ?? 0) + 1;
    console.log(`  diagnoses: ${JSON.stringify(dist)}`);

    // ——— Reasons check on bridges (machine flag, editorial review pending).
    const fresh = await db.execute(sql`
      SELECT id, ord, typ, bezirk, text, label, diag, befund, diag_flags, quotes
      FROM map_points
      WHERE consultation_id = ${consultationId} AND scope = ${scope}
      ORDER BY ord
    `);
    const freshRows = fresh.rows as unknown as (MapRow & {
      quotes: { lager: string; quelle: string; text: string }[] | null;
    })[];

    const fpOf = (r: (typeof freshRows)[number]) =>
      reasonsFingerprint(r.text, (membersByMap.get(r.id) ?? []).map((m) => m.label), r.quotes);
    const bridges = freshRows.filter((r) => {
      const members = membersByMap.get(r.id) ?? [];
      const current = r.diag_flags?.reasons !== undefined && r.diag_flags?.reasons_for === fpOf(r);
      return (
        numericBridge.has(r.id) &&
        (force || !current) &&
        (members.length >= 3 || (r.quotes?.length ?? 0) >= 2)
      );
    });
    // A forced refresh first invalidates the old fingerprint: if the refresh
    // fails, the next ordinary run sees no current verdict and retries.
    if (force && bridges.length > 0) {
      for (const r of bridges) {
        await db.execute(sql`
          UPDATE map_points SET diag_flags = COALESCE(diag_flags, '{}'::jsonb) || '{"reasons_for": null}'::jsonb
          WHERE id = ${r.id}`);
        r.diag_flags = { ...(r.diag_flags ?? {}), reasons_for: null };
      }
    }

    // Jev pre-screen (map-points engine): only bridges with a sign of
    // diverging reasons go to the LLM check.
    let toCheck = bridges;
    const reasonsDone = new Set<string>();
    if (judge && bridges.length > 0) {
      const flagged: typeof bridges = [];
      await runPool(
        bridges,
        async (row) => {
          const members = membersByMap.get(row.id) ?? [];
          const { answers, provenance } = await judge.judge(
            {
              claim: row.text,
              members: members.slice(0, 30).map((m) => m.label),
              quotes: (row.quotes ?? []).map((q) => `${q.quelle}: ${q.text}`),
            },
            { diverging: REASONS_SCREEN },
          );
          const p = (answers.diverging as { noul: number }).noul;
          await saveJudgment(db, {
            tenantId,
            consultationId,
            subjectKind: "map_point",
            subjectId: row.id,
            family: "reasons-screen.v1",
            provenance,
            answers,
            decided: { diverging: p, toLlm: p >= REASONS_SCREEN_MIN },
          });
          if (p >= REASONS_SCREEN_MIN) flagged.push(row);
          else {
            // Replace the whole verdict (obsolete keys → null), keep unrelated flags.
            const flags = {
              reasons: "same_reasons",
              reasons_screen: Number(p.toFixed(3)),
              reasons_rationale: null,
              scheinbruecke: null,
              needs_review: null,
              reasons_for: fpOf(row),
            };
            await db.execute(sql`
              UPDATE map_points SET diag_flags = COALESCE(diag_flags, '{}'::jsonb) || ${JSON.stringify(flags)}::jsonb
              WHERE id = ${row.id}`);
            row.diag_flags = { ...(row.diag_flags ?? {}), ...flags };
            reasonsDone.add(row.id);
          }
        },
        8,
      );
      console.log(`  reasons pre-screen (Jev): ${bridges.length} bridges → ${flagged.length} to the LLM check`);
      toCheck = flagged;
    }
    if (toCheck.length > 0) {
      console.log(`  reasons check on ${toCheck.length} bridges`);
      await runPool(
        toCheck,
        async (row) => {
          const members = membersByMap.get(row.id) ?? [];
          const result = await provider.generateStructured({
            system: REASONS_CHECK_SYSTEM,
            prompt: reasonsCheckPrompt({
              text: row.text,
              memberLabels: members.map((m) => m.label),
              quotes: (row.quotes ?? []).map((q) => ({ quelle: q.quelle, text: q.text })),
            }),
            schema: reasonsCheckJsonSchema,
          });
          const parsed = reasonsCheckOutput.parse(result.output);
          const flags: Record<string, unknown> = {
            reasons: parsed.verdict,
            reasons_rationale: parsed.rationale,
            scheinbruecke: null,
            needs_review: null,
            reasons_for: fpOf(row),
          };
          // Merge, never replace: diag_flags also carries the vote counts.
          if (parsed.verdict === "diverging_reasons") {
            flags.scheinbruecke = true;
            flags.needs_review = true;
            await db.execute(sql`
              UPDATE map_points SET diag = 'warnung',
                diag_flags = COALESCE(diag_flags, '{}'::jsonb) || ${JSON.stringify(flags)}::jsonb
              WHERE id = ${row.id}
            `);
            row.diag = "warnung";
            console.log(`    ⚠ Scheinbrücke: ${row.label}`);
          } else {
            await db.execute(sql`
              UPDATE map_points SET diag_flags = COALESCE(diag_flags, '{}'::jsonb) || ${JSON.stringify(flags)}::jsonb
              WHERE id = ${row.id}
            `);
          }
          row.diag_flags = { ...(row.diag_flags ?? {}), ...flags };
          reasonsDone.add(row.id);
        },
        concurrency,
      );
    }

    // Bridges whose reasons check failed are pending: no Befund now (it
    // would describe a bridge that may turn out to be a false one).
    const pendingReasons = toCheck.filter((r) => !reasonsDone.has(r.id)).concat(
      judge ? bridges.filter((r) => !reasonsDone.has(r.id) && !toCheck.includes(r)) : [],
    );
    for (const r of pendingReasons) reasonsPending.add(r.id);
    if (pendingReasons.length) console.log(`  reasons check INCOMPLETE for ${pendingReasons.length} bridges — rerun`);

    // ——— Befunde: collected here, written below in ONE pool across all
    // scopes (small scopes no longer leave the parallelism unused). Every
    // row is a candidate; the worker skips Befunde whose inputs are unchanged.
    if (skipBefund) continue;
    for (const row of freshRows.filter((r) => !reasonsPending.has(r.id))) {
      befundJobs.push({ scope, row, members: membersByMap.get(row.id) ?? [] });
    }
  }

  let befundsWritten = 0;
  let befundsUnchanged = 0;
  if (befundJobs.length > 0) {
    console.log(`\nbefunde: ${befundJobs.length} to check (${concurrency} in parallel)`);
    const { ok, failed } = await runPool(
      befundJobs,
      async ({ scope, row, members }) => {
        const current = await db.execute(
          sql`SELECT diag, pa, pb, diag_flags, quotes FROM map_points WHERE id = ${row.id}`,
        );
        const cur = current.rows[0] as {
          diag: string; pa: number | null; pb: number | null;
          diag_flags: Record<string, unknown> | null;
          quotes: { quelle: string; text: string; lager?: string }[] | null;
        };
        const prompt = befundPrompt({
          scope,
          text: row.text,
          typ: row.typ,
          diag: cur.diag,
          pa: cur.pa,
          pb: cur.pb,
          campA,
          campB,
          votes: cur.diag_flags?.votes as VoteCounts | undefined,
          memberLabels: members.map((m) => m.label).sort(),
          quotes: (cur.quotes ?? []).map((q) => ({
            quelle: q.lager && q.lager !== "—" ? `${q.quelle} (${q.lager})` : q.quelle,
            text: q.text,
          })),
          reasonsRationale:
            typeof cur.diag_flags?.reasons_rationale === "string"
              ? cur.diag_flags.reasons_rationale
              : undefined,
        });
        // A Befund is valid for exactly the prompt it was written from: any
        // change of claim, numbers, evidence, reasons, or camps rewrites it.
        const fingerprint = sha({ system: BEFUND_SYSTEM, prompt });
        if (!force && row.befund && cur.diag_flags?.befund_for === fingerprint) {
          befundsUnchanged++;
          return;
        }
        const result = await provider.generateStructured({
          system: BEFUND_SYSTEM,
          prompt,
          schema: befundJsonSchema,
        });
        const parsed = befundOutput.parse(result.output);
        await db.execute(sql`
          UPDATE map_points SET befund = ${parsed.befund},
            diag_flags = COALESCE(diag_flags, '{}'::jsonb) || ${JSON.stringify({ befund_for: fingerprint })}::jsonb
          WHERE id = ${row.id}`);
        befundsWritten++;
      },
      concurrency,
    );
    console.log(`befunde done: ${befundsWritten} written, ${befundsUnchanged} unchanged, ${failed} failed`);
    await db.execute(sql`
      INSERT INTO audit_log (tenant_id, actor, action, subject_kind, subject_id, payload)
      VALUES (${tenantId}, 'ai-editor:befund', 'map_point.befund',
              'consultation', ${consultationId},
              ${JSON.stringify({ written: ok, failed })})
    `);
    if (failed > 0) process.exit(1);
  }
  if (reasonsPending.size > 0) {
    console.log(`INCOMPLETE: reasons check failed for ${reasonsPending.size} bridges (no Befund written) — rerun`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
