import {
  bigint,
  real,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const consultations = pgTable("consultations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"),
  sourceSystem: text("source_system"),
  sourceRef: text("source_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const submissions = pgTable("submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  consultationId: uuid("consultation_id").notNull().references(() => consultations.id),
  door: text("door").notNull(),
  authorOrg: text("author_org"),
  authorType: text("author_type"),
  language: text("language"),
  sourceSystem: text("source_system"),
  sourceRef: text("source_ref"),
  text: text("text"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const points = pgTable("points", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  consultationId: uuid("consultation_id").notNull().references(() => consultations.id),
  kind: text("kind").notNull(),
  slot: text("slot"),
  label: text("label").notNull(),
  summary: text("summary"),
  finding: text("finding"),
  theme: text("theme"),
  status: text("status").notNull().default("draft"),
  mergedInto: uuid("merged_into"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pointEdges = pgTable("point_edges", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  fromPoint: uuid("from_point").notNull().references(() => points.id),
  toPoint: uuid("to_point").notNull().references(() => points.id),
  kind: text("kind").notNull(),
});

export const statements = pgTable("statements", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  pointId: uuid("point_id").notNull().references(() => points.id),
  locale: text("locale").notNull(),
  text: text("text").notNull(),
  status: text("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pointSources = pgTable("point_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  pointId: uuid("point_id").notNull().references(() => points.id),
  submissionId: uuid("submission_id").notNull().references(() => submissions.id),
  quote: text("quote"),
  spanStart: integer("span_start"),
  spanEnd: integer("span_end"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const matchDecisions = pgTable("match_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  consultationId: uuid("consultation_id").notNull().references(() => consultations.id),
  submissionId: uuid("submission_id").notNull().references(() => submissions.id),
  candidateLabel: text("candidate_label").notNull(),
  candidateSummary: text("candidate_summary"),
  outcome: text("outcome").notNull(),
  matchedPoint: uuid("matched_point"),
  confidence: real("confidence"),
  method: text("method").notNull(),
  provenance: jsonb("provenance"),
  reviewer: text("reviewer"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  filename: text("filename").notNull(),
  blobPath: text("blob_path").notNull(),
  sha256: text("sha256"),
  size: integer("size"),
  extractedText: text("extracted_text"),
  extractionTool: text("extraction_tool"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  extractedAt: timestamp("extracted_at", { withTimezone: true }),
});

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  result: jsonb("result"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const auditLog = pgTable("audit_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid("tenant_id"),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  subjectKind: text("subject_kind"),
  subjectId: text("subject_id"),
  reason: text("reason"),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
