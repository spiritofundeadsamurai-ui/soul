import bcryptjs from "bcryptjs";
import { getDb } from "../db/index.js";
import { masters } from "../db/schema.js";
import { eq } from "drizzle-orm";

const SALT_ROUNDS = 12;

export interface MasterInfo {
  id: number;
  name: string;
  personalityTraits: string[];
  createdAt: string;
}

export async function isMasterSetup(): Promise<boolean> {
  const db = getDb();
  const result = db.select().from(masters).limit(1).all();
  return result.length > 0;
}

export async function setupMaster(
  name: string,
  passphrase: string,
  personalityTraits: string[] = []
): Promise<MasterInfo> {
  const db = getDb();

  // Check if master already exists
  if (await isMasterSetup()) {
    throw new Error("Master already exists. Soul is bound to one master.");
  }

  const hash = bcryptjs.hashSync(passphrase, SALT_ROUNDS);

  const result = db
    .insert(masters)
    .values({
      name,
      passphraseHash: hash,
      personalityTraits: JSON.stringify(personalityTraits),
    })
    .returning()
    .get();

  return {
    id: result.id,
    name: result.name,
    personalityTraits,
    createdAt: result.createdAt,
  };
}

export async function verifyMaster(passphrase: string): Promise<boolean> {
  const db = getDb();
  const master = db.select().from(masters).limit(1).get();

  if (!master) return false;

  return bcryptjs.compareSync(passphrase, master.passphraseHash);
}

export async function getMasterInfo(): Promise<MasterInfo | null> {
  const db = getDb();
  const master = db.select().from(masters).limit(1).get();

  if (!master) return null;

  return {
    id: master.id,
    name: master.name,
    personalityTraits: JSON.parse(master.personalityTraits || "[]"),
    createdAt: master.createdAt,
  };
}

export function getMasterPassphraseHash(): string | null {
  const db = getDb();
  const master = db.select().from(masters).limit(1).get();
  return master?.passphraseHash || null;
}
