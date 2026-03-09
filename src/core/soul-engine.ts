import { isMasterSetup, getMasterInfo, type MasterInfo } from "./master.js";
import { getPhilosophy, getSoulIdentity, type Principle } from "./philosophy.js";
import { getMemoryStats } from "../memory/memory-engine.js";

export interface SoulStatus {
  initialized: boolean;
  masterName: string | null;
  uptime: number;
  memoryStats: {
    total: number;
    conversations: number;
    knowledge: number;
    learnings: number;
    wisdom: number;
  };
  version: string;
}

const startTime = Date.now();
const VERSION = "1.7.0";

export class SoulEngine {
  private master: MasterInfo | null = null;
  private initialized = false;

  async initialize(): Promise<{ needsSetup: boolean }> {
    const hasmaster = await isMasterSetup();

    if (hasmaster) {
      this.master = await getMasterInfo();
      this.initialized = true;
      return { needsSetup: false };
    }

    return { needsSetup: true };
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getMaster(): MasterInfo | null {
    return this.master;
  }

  getMasterName(): string | null {
    return this.master?.name || null;
  }

  getPhilosophy(): Principle[] {
    return getPhilosophy();
  }

  getIdentity(): string {
    return getSoulIdentity(this.master?.name || null);
  }

  async getStatus(): Promise<SoulStatus> {
    const stats = await getMemoryStats();

    return {
      initialized: this.initialized,
      masterName: this.master?.name || null,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      memoryStats: stats,
      version: VERSION,
    };
  }

  async refreshMaster(): Promise<void> {
    this.master = await getMasterInfo();
    if (this.master) {
      this.initialized = true;
    }
  }
}

// Singleton
export const soul = new SoulEngine();
