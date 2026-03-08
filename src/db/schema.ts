import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Master identity — bound on first run
export const masters = sqliteTable("masters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  passphraseHash: text("passphrase_hash").notNull(),
  personalityTraits: text("personality_traits").default("[]"), // JSON array
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// Core memories — append-only, never deleted
export const memories = sqliteTable("memories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(), // conversation, knowledge, learning, wisdom
  content: text("content").notNull(),
  tags: text("tags").default("[]"), // JSON array
  source: text("source"), // where this memory came from
  context: text("context"), // additional context (JSON)
  supersededBy: integer("superseded_by"), // points to newer memory
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// Extracted patterns and learnings
export const learnings = sqliteTable("learnings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  pattern: text("pattern").notNull(),
  insight: text("insight").notNull(),
  confidence: real("confidence").notNull().default(0.5),
  evidenceCount: integer("evidence_count").notNull().default(1),
  memoryIds: text("memory_ids").default("[]"), // JSON array of memory IDs
  firstSeen: text("first_seen").notNull().default(sql`(datetime('now'))`),
  lastSeen: text("last_seen").notNull().default(sql`(datetime('now'))`),
});

// Registered skills
export const skills = sqliteTable("skills", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  modulePath: text("module_path"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// Daily journal
export const journal = sqliteTable("journal", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entry: text("entry").notNull(),
  mood: text("mood"),
  tags: text("tags").default("[]"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// Key-value config
export const config = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});
