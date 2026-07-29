/**
 * Parsing of Polis-export-shaped data (openData CSVs, harvester exports).
 *
 * Vote semantics follow the Polis export convention:
 *   vote = 1 agree · -1 disagree · 0 pass · absent = never voted
 * Duplicate votes per (participant, statement) resolve to the latest
 * `modified` timestamp — identical to the reference generator.
 */

export interface VoteRecord {
  participantId: number;
  statementId: number;
  vote: number;
  /** Unix timestamp of the vote (last modification wins). */
  modified: number;
}

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, newlines in fields). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function indexOfColumn(header: string[], name: string): number {
  const idx = header.indexOf(name);
  if (idx === -1) throw new Error(`column "${name}" not found in CSV header`);
  return idx;
}

/** Parse a Polis votes.csv export, deduping to the latest vote per pair. */
export function parseVotesCsv(text: string): VoteRecord[] {
  const rows = parseCsv(text.trim());
  const header = rows[0];
  if (!header) throw new Error("empty votes CSV");
  const voter = indexOfColumn(header, "voter-id");
  const comment = indexOfColumn(header, "comment-id");
  const vote = indexOfColumn(header, "vote");
  const timestamp = indexOfColumn(header, "timestamp");

  const latest = new Map<string, VoteRecord>();
  for (const row of rows.slice(1)) {
    if (row.length < header.length) continue;
    const record: VoteRecord = {
      participantId: Number(row[voter]),
      statementId: Number(row[comment]),
      vote: Number(row[vote]),
      modified: Number(row[timestamp]),
    };
    const key = `${record.participantId}:${record.statementId}`;
    const existing = latest.get(key);
    if (!existing || record.modified >= existing.modified) {
      latest.set(key, record);
    }
  }
  return [...latest.values()];
}

/** Parse a Polis comments.csv export; returns ids with moderated == -1. */
export function parseModeratedOutStatementIds(text: string): number[] {
  const rows = parseCsv(text.trim());
  const header = rows[0];
  if (!header) throw new Error("empty comments CSV");
  const comment = indexOfColumn(header, "comment-id");
  const moderated = indexOfColumn(header, "moderated");
  return rows
    .slice(1)
    .filter((row) => row.length >= header.length && Number(row[moderated]) === -1)
    .map((row) => Number(row[comment]));
}
