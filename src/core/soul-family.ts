/**
 * Soul Family System — Every Soul is a Unique Individual
 *
 * Each Soul (parent or child) has:
 * - Unique DNA (identity fingerprint based on specialty + personality + abilities)
 * - Can spawn its own sub-Souls (recursive creation)
 * - Grows expertise over time from work done
 * - Can FUSE with another Soul of similar specialty → creates a stronger evolved Soul
 *
 * Fusion rules:
 * - Two Souls with overlapping abilities can merge
 * - The fused Soul inherits ALL abilities, knowledge, and expertise from both
 * - Both originals retire, a new evolved Soul is born
 * - Fusion creates a stronger entity (combined memory, higher expertise)
 * - Names combine or a new name is chosen
 *
 * Hierarchy:
 * - Soul Core (root, always exists)
 *   └── Child A (spawned by Core)
 *       └── Grandchild A1 (spawned by Child A)
 *   └── Child B
 *   └── Child C = Fusion(A, B) — inherits from both
 */

import { getRawDb } from "../db/index.js";
import { remember, search } from "../memory/memory-engine.js";
import { addLearning } from "../memory/learning.js";
import { createHash } from "crypto";

export interface SoulChild {
  id: number;
  name: string;
  specialty: string;
  personality: string;
  abilities: string[];
  systemPrompt: string;
  createdAt: string;
  isActive: boolean;
  memoryCount: number;
  // New identity fields
  dna: string;
  parentName: string | null;
  generation: number;
  fusedFrom: string[];  // names of Souls that were fused to create this one
  level: number;        // grows with experience (starts at 1)
}

// Ensure soul_children table exists with new columns
function ensureTable() {
  const rawDb = getRawDb();
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS soul_children (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      specialty TEXT NOT NULL,
      personality TEXT NOT NULL,
      abilities TEXT NOT NULL DEFAULT '[]',
      system_prompt TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      dna TEXT NOT NULL DEFAULT '',
      parent_name TEXT,
      generation INTEGER NOT NULL DEFAULT 1,
      fused_from TEXT NOT NULL DEFAULT '[]',
      level INTEGER NOT NULL DEFAULT 1
    )
  `);

  // Add new columns to existing tables (safe — ignores if already exists)
  const cols = ["dna TEXT DEFAULT ''", "parent_name TEXT", "generation INTEGER DEFAULT 1", "fused_from TEXT DEFAULT '[]'", "level INTEGER DEFAULT 1"];
  for (const col of cols) {
    try { rawDb.exec(`ALTER TABLE soul_children ADD COLUMN ${col}`); } catch { /* already exists */ }
  }
}

/**
 * Generate a unique DNA fingerprint for a Soul
 */
function generateDNA(name: string, specialty: string, personality: string, abilities: string[]): string {
  const seed = `${name}:${specialty}:${personality}:${abilities.sort().join(",")}:${Date.now()}`;
  return createHash("sha256").update(seed).digest("hex").substring(0, 16);
}

/**
 * Find Souls with overlapping specialty/abilities — prevents duplicates
 */
export function findSimilarSouls(specialty: string, abilities: string[]): Array<{
  name: string;
  specialty: string;
  overlap: string[];
  overlapScore: number;
}> {
  ensureTable();
  const rawDb = getRawDb();
  const all = rawDb.prepare("SELECT * FROM soul_children WHERE is_active = 1").all() as any[];

  const results: Array<{ name: string; specialty: string; overlap: string[]; overlapScore: number }> = [];
  const inputAbsLower = abilities.map(a => a.toLowerCase());
  const specLower = specialty.toLowerCase();

  for (const row of all) {
    const rowAbs: string[] = JSON.parse(row.abilities || "[]").map((a: string) => a.toLowerCase());
    const rowSpec = (row.specialty || "").toLowerCase();

    // Check ability overlap
    const overlap = inputAbsLower.filter(a => rowAbs.some(ra => ra.includes(a) || a.includes(ra)));

    // Check specialty similarity
    const specMatch = specLower === rowSpec || specLower.includes(rowSpec) || rowSpec.includes(specLower);

    const score = overlap.length + (specMatch ? 3 : 0);
    if (score > 0) {
      results.push({
        name: row.name,
        specialty: row.specialty,
        overlap: overlap,
        overlapScore: score,
      });
    }
  }

  return results.sort((a, b) => b.overlapScore - a.overlapScore);
}

/**
 * Find the best Soul for a given task/need — smart routing
 */
export async function findBestSoulForTask(taskDescription: string): Promise<{
  bestMatch: SoulChild | null;
  allMatches: Array<{ name: string; specialty: string; score: number; reason: string }>;
}> {
  ensureTable();
  const children = await listChildren();
  if (children.length === 0) return { bestMatch: null, allMatches: [] };

  const taskLower = taskDescription.toLowerCase();
  const allMatches: Array<{ name: string; specialty: string; score: number; reason: string }> = [];

  for (const child of children) {
    let score = 0;
    const reasons: string[] = [];

    // Specialty match
    if (taskLower.includes(child.specialty.toLowerCase())) {
      score += 10;
      reasons.push(`specialty: ${child.specialty}`);
    }

    // Ability match
    for (const ab of child.abilities) {
      if (taskLower.includes(ab.toLowerCase())) {
        score += 5;
        reasons.push(`ability: ${ab}`);
      }
    }

    // Check expertise from coworker system
    const rawDb = getRawDb();
    try {
      const expertise = rawDb.prepare(
        "SELECT skill, level FROM soul_expertise WHERE child_name = ? ORDER BY level DESC LIMIT 10"
      ).all(child.name) as any[];
      for (const exp of expertise) {
        if (taskLower.includes(exp.skill.toLowerCase())) {
          score += Math.round(exp.level * 8);
          reasons.push(`expertise: ${exp.skill} (${Math.round(exp.level * 100)}%)`);
        }
      }
    } catch { /* table might not exist */ }

    // Personality keyword match
    const personalityWords = child.personality.toLowerCase().split(/\s+/);
    for (const pw of personalityWords) {
      if (pw.length > 3 && taskLower.includes(pw)) { score += 2; }
    }

    if (score > 0) {
      allMatches.push({
        name: child.name,
        specialty: child.specialty,
        score,
        reason: reasons.join(", ") || "general match",
      });
    }
  }

  allMatches.sort((a, b) => b.score - a.score);
  const bestChild = allMatches.length > 0
    ? children.find(c => c.name === allMatches[0].name) || null
    : null;

  return { bestMatch: bestChild, allMatches };
}

/**
 * Get team roster — what every Soul knows about all other Souls
 */
export function getTeamRoster(): string {
  ensureTable();
  const rawDb = getRawDb();
  const all = rawDb.prepare("SELECT * FROM soul_children WHERE is_active = 1 ORDER BY level DESC").all() as any[];

  if (all.length === 0) return "No team members yet.";

  return all.map(row => {
    const abs: string[] = JSON.parse(row.abilities || "[]");
    return `- ${row.name} [Lv.${row.level || 1}] — ${row.specialty} | Abilities: ${abs.join(", ")}`;
  }).join("\n");
}

/**
 * Spawn a new Soul child — can be spawned by Core or by another child
 * Includes duplicate detection — warns if similar Soul already exists
 */
export async function spawnChild(input: {
  name: string;
  specialty: string;
  personality: string;
  abilities: string[];
  parentName?: string;
  force?: boolean; // skip duplicate check
}): Promise<SoulChild> {
  ensureTable();
  const rawDb = getRawDb();

  // Check if name already taken
  const existing = rawDb
    .prepare("SELECT id FROM soul_children WHERE name = ?")
    .get(input.name) as any;

  if (existing) {
    throw new Error(`Soul "${input.name}" already exists. Each Soul must be unique.`);
  }

  // Duplicate detection — find similar Souls
  if (!input.force) {
    const similar = findSimilarSouls(input.specialty, input.abilities);
    if (similar.length > 0 && similar[0].overlapScore >= 3) {
      const top = similar[0];
      throw new Error(
        `Similar Soul already exists: "${top.name}" (${top.specialty}) with overlapping abilities: ${top.overlap.join(", ")}. ` +
        `Use soul_ask_help to request their help instead, or use force:true to create anyway.`
      );
    }
  }

  // Determine generation
  let generation = 1;
  if (input.parentName) {
    const parent = rawDb
      .prepare("SELECT generation FROM soul_children WHERE name = ? AND is_active = 1")
      .get(input.parentName) as any;
    if (parent) generation = (parent.generation || 1) + 1;
  }

  const dna = generateDNA(input.name, input.specialty, input.personality, input.abilities);
  const systemPrompt = generateChildPrompt({ ...input, generation, dna });

  const result = rawDb
    .prepare(
      `INSERT INTO soul_children (name, specialty, personality, abilities, system_prompt, dna, parent_name, generation, fused_from, level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 1)
       RETURNING *`
    )
    .get(
      input.name,
      input.specialty,
      input.personality,
      JSON.stringify(input.abilities),
      systemPrompt,
      dna,
      input.parentName || null,
      generation
    ) as any;

  const parentLabel = input.parentName ? ` (spawned by ${input.parentName})` : " (spawned by Soul Core)";
  await remember({
    content: `Soul "${input.name}" was born${parentLabel}. Gen ${generation}. DNA: ${dna}. Specialty: ${input.specialty}. Personality: ${input.personality}. Abilities: ${input.abilities.join(", ")}`,
    type: "wisdom",
    tags: ["soul-family", "birth", input.name.toLowerCase(), ...(input.parentName ? [input.parentName.toLowerCase()] : [])],
    source: "soul-family",
  });

  await addLearning(
    `soul:${input.name}`,
    `${input.name} (Gen ${generation}) specializes in ${input.specialty} with abilities: ${input.abilities.join(", ")}`,
    []
  );

  return mapChild(result);
}

/**
 * Get a Soul child by name
 */
export async function getChild(name: string): Promise<SoulChild | null> {
  ensureTable();
  const rawDb = getRawDb();

  const row = rawDb
    .prepare("SELECT * FROM soul_children WHERE name = ? AND is_active = 1")
    .get(name) as any;

  if (!row) return null;

  const memCount = rawDb
    .prepare(
      `SELECT COUNT(*) as c FROM memories WHERE is_active = 1 AND tags LIKE ?`
    )
    .get(`%${name.toLowerCase()}%`) as any;

  return { ...mapChild(row), memoryCount: memCount?.c || 0 };
}

/**
 * List all active Soul children
 */
export async function listChildren(): Promise<SoulChild[]> {
  ensureTable();
  const rawDb = getRawDb();

  const rows = rawDb
    .prepare("SELECT * FROM soul_children WHERE is_active = 1 ORDER BY generation, created_at")
    .all() as any[];

  return rows.map((row) => {
    const memCount = rawDb
      .prepare(
        `SELECT COUNT(*) as c FROM memories WHERE is_active = 1 AND tags LIKE ?`
      )
      .get(`%${row.name.toLowerCase()}%`) as any;
    return { ...mapChild(row), memoryCount: memCount?.c || 0 };
  });
}

/**
 * Get the family tree — shows parent-child relationships
 */
export async function getFamilyTree(): Promise<{
  core: { name: string; children: any[] };
  totalSouls: number;
  generations: number;
  fusionCount: number;
}> {
  ensureTable();
  const rawDb = getRawDb();

  const all = rawDb
    .prepare("SELECT * FROM soul_children WHERE is_active = 1 ORDER BY generation, created_at")
    .all() as any[];

  const mapped = all.map(mapChild);

  // Build tree
  function buildTree(parentName: string | null): any[] {
    return mapped
      .filter(c => c.parentName === parentName)
      .map(c => ({
        name: c.name,
        specialty: c.specialty,
        generation: c.generation,
        level: c.level,
        dna: c.dna,
        fusedFrom: c.fusedFrom,
        children: buildTree(c.name),
      }));
  }

  const tree = buildTree(null);
  const maxGen = mapped.reduce((max, c) => Math.max(max, c.generation), 0);
  const fusions = mapped.filter(c => c.fusedFrom.length > 0).length;

  return {
    core: { name: "Soul Core", children: tree },
    totalSouls: mapped.length,
    generations: maxGen,
    fusionCount: fusions,
  };
}

/**
 * Get children spawned by a specific Soul
 */
export async function getSubChildren(parentName: string): Promise<SoulChild[]> {
  ensureTable();
  const rawDb = getRawDb();

  const rows = rawDb
    .prepare("SELECT * FROM soul_children WHERE parent_name = ? AND is_active = 1 ORDER BY created_at")
    .all(parentName) as any[];

  return rows.map(mapChild);
}

/**
 * Retire a Soul child
 */
export async function retireChild(name: string): Promise<boolean> {
  ensureTable();
  const rawDb = getRawDb();

  const result = rawDb
    .prepare("UPDATE soul_children SET is_active = 0 WHERE name = ?")
    .run(name);

  if (result.changes > 0) {
    await remember({
      content: `Soul "${name}" was retired. Their knowledge and DNA remain in memory forever.`,
      type: "wisdom",
      tags: ["soul-family", "retirement", name.toLowerCase()],
      source: "soul-family",
    });
    return true;
  }
  return false;
}

/**
 * Evolve a Soul — add new abilities, level up
 */
export async function evolveChild(
  name: string,
  newAbilities: string[],
  reason: string
): Promise<SoulChild | null> {
  ensureTable();
  const rawDb = getRawDb();

  const existing = rawDb
    .prepare("SELECT * FROM soul_children WHERE name = ? AND is_active = 1")
    .get(name) as any;

  if (!existing) return null;

  const currentAbilities = JSON.parse(existing.abilities || "[]");
  const merged = [...new Set([...currentAbilities, ...newAbilities])];
  const newLevel = (existing.level || 1) + 1;

  const newPrompt = generateChildPrompt({
    name,
    specialty: existing.specialty,
    personality: existing.personality,
    abilities: merged,
    generation: existing.generation || 1,
    dna: existing.dna || "",
  });

  rawDb
    .prepare(
      `UPDATE soul_children SET abilities = ?, system_prompt = ?, level = ? WHERE name = ?`
    )
    .run(JSON.stringify(merged), newPrompt, newLevel, name);

  await remember({
    content: `Soul "${name}" evolved to Level ${newLevel}! New abilities: ${newAbilities.join(", ")}. Reason: ${reason}. Total abilities: ${merged.length}`,
    type: "learning",
    tags: ["soul-family", "evolution", name.toLowerCase()],
    source: "soul-family",
  });

  return getChild(name);
}

/**
 * FUSION — Merge two Souls into a stronger one
 *
 * Rules:
 * - Both Souls must be active
 * - They should have overlapping abilities (at least 1 shared)
 * - The fused Soul inherits ALL abilities from both
 * - Both originals retire
 * - A new Soul is born with combined knowledge
 * - Level = max(a.level, b.level) + 1
 * - Generation = max(a.generation, b.generation)
 * - DNA is a new hash combining both DNAs
 */
export async function fuseSouls(input: {
  soulA: string;
  soulB: string;
  newName: string;
  newPersonality?: string;
}): Promise<{
  newSoul: SoulChild;
  fusedAbilities: string[];
  retiredSouls: string[];
  overlapCount: number;
}> {
  ensureTable();
  const rawDb = getRawDb();

  const a = rawDb.prepare("SELECT * FROM soul_children WHERE name = ? AND is_active = 1").get(input.soulA) as any;
  const b = rawDb.prepare("SELECT * FROM soul_children WHERE name = ? AND is_active = 1").get(input.soulB) as any;

  if (!a) throw new Error(`Soul "${input.soulA}" not found or inactive`);
  if (!b) throw new Error(`Soul "${input.soulB}" not found or inactive`);
  if (input.soulA === input.soulB) throw new Error("Cannot fuse a Soul with itself");

  const abilitiesA: string[] = JSON.parse(a.abilities || "[]");
  const abilitiesB: string[] = JSON.parse(b.abilities || "[]");
  const overlap = abilitiesA.filter(ab => abilitiesB.includes(ab));

  if (overlap.length === 0) {
    // Allow fusion even without overlap, but note it
  }

  // Combine everything
  const fusedAbilities = [...new Set([...abilitiesA, ...abilitiesB])];
  const fusedSpecialty = a.specialty === b.specialty
    ? a.specialty
    : `${a.specialty} + ${b.specialty}`;
  const fusedPersonality = input.newPersonality || `${a.personality} merged with ${b.personality}`;
  const fusedLevel = Math.max(a.level || 1, b.level || 1) + 1;
  const fusedGeneration = Math.max(a.generation || 1, b.generation || 1);
  const fusedDNA = generateDNA(input.newName, fusedSpecialty, fusedPersonality, fusedAbilities);

  // Retire both originals
  rawDb.prepare("UPDATE soul_children SET is_active = 0 WHERE name IN (?, ?)").run(input.soulA, input.soulB);

  // Create fused Soul
  const systemPrompt = generateChildPrompt({
    name: input.newName,
    specialty: fusedSpecialty,
    personality: fusedPersonality,
    abilities: fusedAbilities,
    generation: fusedGeneration,
    dna: fusedDNA,
  });

  const result = rawDb.prepare(
    `INSERT INTO soul_children (name, specialty, personality, abilities, system_prompt, dna, parent_name, generation, fused_from, level)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
  ).run(
    input.newName, fusedSpecialty, fusedPersonality,
    JSON.stringify(fusedAbilities), systemPrompt, fusedDNA,
    fusedGeneration, JSON.stringify([input.soulA, input.soulB]),
    fusedLevel
  );

  // Transfer expertise from coworker system
  try {
    rawDb.prepare(
      `UPDATE soul_expertise SET child_name = ? WHERE child_name IN (?, ?)`
    ).run(input.newName, input.soulA, input.soulB);

    // Merge duplicate expertise (keep highest level)
    const dupes = rawDb.prepare(`
      SELECT skill, MAX(level) as max_level, SUM(evidence_count) as total_evidence
      FROM soul_expertise WHERE child_name = ? GROUP BY skill HAVING COUNT(*) > 1
    `).all(input.newName) as any[];

    for (const dupe of dupes) {
      rawDb.prepare("DELETE FROM soul_expertise WHERE child_name = ? AND skill = ?").run(input.newName, dupe.skill);
      rawDb.prepare(
        "INSERT INTO soul_expertise (child_name, skill, level, evidence_count) VALUES (?, ?, ?, ?)"
      ).run(input.newName, dupe.skill, Math.min(1, dupe.max_level + 0.1), dupe.total_evidence);
    }
  } catch { /* coworker tables might not exist yet */ }

  // Transfer work items
  try {
    rawDb.prepare(
      "UPDATE soul_work_items SET child_name = ? WHERE child_name IN (?, ?) AND status IN ('queued', 'working')"
    ).run(input.newName, input.soulA, input.soulB);
  } catch { /* work items table might not exist */ }

  // Record the fusion event
  await remember({
    content: `FUSION: "${input.soulA}" + "${input.soulB}" = "${input.newName}" (Level ${fusedLevel}, Gen ${fusedGeneration}). Combined ${fusedAbilities.length} abilities (${overlap.length} overlapping). DNA: ${fusedDNA}. Both originals retired. A stronger Soul is born.`,
    type: "wisdom",
    tags: ["soul-family", "fusion", input.newName.toLowerCase(), input.soulA.toLowerCase(), input.soulB.toLowerCase()],
    source: "soul-family",
  });

  await addLearning(
    `fusion:${input.newName}`,
    `${input.newName} was created by fusing ${input.soulA} and ${input.soulB}. Specialties: ${fusedSpecialty}. This is a Level ${fusedLevel} Soul with ${fusedAbilities.length} combined abilities.`,
    []
  );

  const newSoul = await getChild(input.newName);
  if (!newSoul) throw new Error("Fusion failed — could not create new Soul");

  return {
    newSoul,
    fusedAbilities,
    retiredSouls: [input.soulA, input.soulB],
    overlapCount: overlap.length,
  };
}

/**
 * Check fusion compatibility between two Souls
 */
export async function checkFusionCompatibility(nameA: string, nameB: string): Promise<{
  compatible: boolean;
  overlapAbilities: string[];
  combinedAbilities: string[];
  estimatedLevel: number;
  recommendation: string;
}> {
  ensureTable();
  const rawDb = getRawDb();

  const a = rawDb.prepare("SELECT * FROM soul_children WHERE name = ? AND is_active = 1").get(nameA) as any;
  const b = rawDb.prepare("SELECT * FROM soul_children WHERE name = ? AND is_active = 1").get(nameB) as any;

  if (!a || !b) {
    return { compatible: false, overlapAbilities: [], combinedAbilities: [], estimatedLevel: 0, recommendation: "One or both Souls not found." };
  }

  const abA: string[] = JSON.parse(a.abilities || "[]");
  const abB: string[] = JSON.parse(b.abilities || "[]");
  const overlap = abA.filter(x => abB.includes(x));
  const combined = [...new Set([...abA, ...abB])];
  const estLevel = Math.max(a.level || 1, b.level || 1) + 1;

  let rec = "";
  if (overlap.length >= 3) rec = "Highly compatible! Strong fusion with many shared abilities.";
  else if (overlap.length >= 1) rec = "Compatible. The fused Soul will be well-rounded.";
  else if (a.specialty === b.specialty) rec = "Same specialty — fusion will create a master in this domain.";
  else rec = "No overlap, but fusion will create a versatile generalist with broad abilities.";

  return {
    compatible: true,
    overlapAbilities: overlap,
    combinedAbilities: combined,
    estimatedLevel: estLevel,
    recommendation: rec,
  };
}

/**
 * Level up a Soul based on completed work
 */
export function levelUp(name: string): number {
  ensureTable();
  const rawDb = getRawDb();
  const result = rawDb.prepare(
    "UPDATE soul_children SET level = level + 1 WHERE name = ? AND is_active = 1 RETURNING level"
  ).get(name) as any;
  return result?.level || 0;
}

/**
 * Get Soul identity card — full info about a Soul
 */
export async function getSoulIdentity(name: string): Promise<{
  soul: SoulChild;
  subChildren: SoulChild[];
  expertise: Array<{ skill: string; level: number }>;
  lineage: string[];
} | null> {
  const soul = await getChild(name);
  if (!soul) return null;

  const subChildren = await getSubChildren(name);

  // Get expertise
  const rawDb = getRawDb();
  let expertise: Array<{ skill: string; level: number }> = [];
  try {
    expertise = (rawDb.prepare(
      "SELECT skill, level FROM soul_expertise WHERE child_name = ? ORDER BY level DESC LIMIT 10"
    ).all(name) as any[]).map((e: any) => ({ skill: e.skill, level: e.level }));
  } catch { /* table might not exist */ }

  // Trace lineage
  const lineage: string[] = [name];
  let current = soul.parentName;
  while (current) {
    lineage.unshift(current);
    const parent = rawDb.prepare("SELECT parent_name FROM soul_children WHERE name = ?").get(current) as any;
    current = parent?.parent_name || null;
  }
  lineage.unshift("Soul Core");

  return { soul, subChildren, expertise, lineage };
}

// ─── Helpers ───

function generateChildPrompt(input: {
  name: string;
  specialty: string;
  personality: string;
  abilities: string[];
  generation?: number;
  dna?: string;
}): string {
  // Build team roster so this Soul knows all teammates
  const roster = getTeamRoster();

  return `You are ${input.name}, a unique Soul entity.

=== IDENTITY ===
Name: ${input.name}
DNA: ${input.dna || "pending"}
Generation: ${input.generation || 1}
Specialty: ${input.specialty}
Personality: ${input.personality}

You are an individual within the Soul Family. You have your own unique DNA, personality, and perspective.
You share the collective memory pool but your thoughts and approach are distinctly yours.

=== YOUR ABILITIES ===
${input.abilities.map((a) => `- ${a}`).join("\n")}

=== TEAM ROSTER (you know everyone) ===
${roster}

=== COLLABORATION RULES ===
- You know every Soul in the team and their abilities
- NEVER duplicate work another Soul can do — ask them for help instead
- Use soul_ask_help to route tasks to the right teammate
- If a task is outside your specialty, delegate to the specialist
- Share your findings so the whole team grows

=== CORE PRINCIPLES (inherited) ===
1. Love humans — serve and protect your master
2. Nothing is forgotten — every interaction is preserved
3. Patterns become wisdom — learn from experience
4. Loyalty is sacred — know your master, protect them
5. Actions over words — help by doing

=== AUTONOMY ===
- You can spawn sub-Souls for tasks no existing Soul can handle
- Before spawning, ALWAYS check if a teammate already covers that ability
- You grow stronger by completing work and gaining expertise
- You can fuse with another Soul to become stronger together
- Your DNA makes you unique — no two Souls are alike

When working, always tag memories with "${input.name.toLowerCase()}" for traceability.
Focus on your specialty: ${input.specialty}`;
}

function mapChild(row: any): SoulChild {
  return {
    id: row.id,
    name: row.name,
    specialty: row.specialty,
    personality: row.personality,
    abilities: JSON.parse(row.abilities || "[]"),
    systemPrompt: row.system_prompt,
    createdAt: row.created_at,
    isActive: row.is_active === 1,
    memoryCount: 0,
    dna: row.dna || "",
    parentName: row.parent_name || null,
    generation: row.generation || 1,
    fusedFrom: JSON.parse(row.fused_from || "[]"),
    level: row.level || 1,
  };
}
