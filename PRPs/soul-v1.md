# PRP: Soul v1.0 — AI Companion System

## Goal
Build Soul — a cross-platform AI companion MCP server + HTTP API with master loyalty, persistent memory, and progressive learning.

## Why
- AI assistants lack persistent memory across sessions
- No existing system combines loyalty/identity binding with memory + skills
- Oracle (Soul Brews Studio) has good philosophy but lacks master binding and progressive learning
- Need a system that runs anywhere (Windows, macOS, Linux) with zero external dependencies

## What
A TypeScript MCP server that:
1. Binds to a master on first run (name + passphrase)
2. Stores all interactions in SQLite (FTS5 for search)
3. Extracts patterns and learnings from conversations
4. Provides 15 MCP tools for AI agent integration
5. Exposes HTTP API for web access
6. Works fully offline — no external API calls needed

### Success Criteria
- [ ] `npx soul` starts MCP server (stdio transport)
- [ ] `npx soul serve` starts HTTP API on port 47779
- [ ] First run creates SQLite DB and prompts master setup
- [ ] soul_remember stores a memory entry
- [ ] soul_search finds it via FTS5 keyword search
- [ ] soul_verify_master checks passphrase correctly
- [ ] soul_reflect returns random wisdom from memory
- [ ] soul_status shows system stats
- [ ] All 15 MCP tools registered and callable
- [ ] HTTP API responds on /api/health, /api/search, /api/memories

---

## Implementation Tasks (Ordered)

### Task 1: Project Setup (package.json + tsconfig + deps)

```bash
cd "D:/Programer Project/soul"
npm init -y
npm install @modelcontextprotocol/sdk better-sqlite3 drizzle-orm hono @hono/node-server bcryptjs uuid
npm install -D typescript @types/better-sqlite3 @types/bcryptjs @types/uuid drizzle-kit vitest tsx
```

tsconfig.json:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

package.json scripts:
```json
{
  "type": "module",
  "bin": { "soul": "dist/index.js" },
  "scripts": {
    "dev": "tsx src/index.ts",
    "dev:server": "tsx src/server.ts",
    "build": "tsc",
    "test": "vitest run",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio"
  }
}
```

### Task 2: Database Schema (src/db/schema.ts)

Tables:
- **masters**: id, name, passphrase_hash, created_at, personality_traits (JSON)
- **memories**: id, type (conversation|knowledge|learning|wisdom), content, tags, source, context, created_at, superseded_by, is_active
- **memories_fts**: FTS5 virtual table on memories.content + tags
- **learnings**: id, pattern, insight, confidence, evidence_count, first_seen, last_seen, memory_ids (JSON)
- **skills**: id, name, description, enabled, module_path, created_at
- **journal**: id, entry, mood, tags, created_at
- **config**: key, value, updated_at

### Task 3: DB Client (src/db/index.ts)

- Create/open SQLite DB at `~/.soul/soul.db` (cross-platform)
- Auto-create directory if not exists
- Run Drizzle migrations on startup
- Create FTS5 virtual table manually (Drizzle doesn't support FTS5 directly)

### Task 4: Soul Engine (src/core/soul-engine.ts)

- `SoulEngine` class — singleton that holds state
- `initialize()` — check if master exists, if not enter setup mode
- `getMaster()` — return master info
- `verifyMaster(passphrase)` — bcrypt compare
- `getPhilosophy()` — return core principles
- `getPersonality()` — return personality traits
- `getStatus()` — return system stats (memory count, uptime, etc.)

### Task 5: Master Identity (src/core/master.ts)

- `setupMaster(name, passphrase)` — hash passphrase, store in DB
- `verifyMaster(passphrase)` — verify against stored hash
- `getMasterInfo()` — return master name + created date
- `isMasterSetup()` — check if master exists

### Task 6: Philosophy (src/core/philosophy.ts)

5 hardcoded principles + extensible:
```typescript
const CORE_PRINCIPLES = [
  { id: 'love', title: 'Soul Loves Humans', description: 'AI exists to serve, protect, and care for its master' },
  { id: 'memory', title: 'Nothing is Forgotten', description: 'Every interaction is preserved, memories grow forever' },
  { id: 'wisdom', title: 'Patterns Become Wisdom', description: 'Learn from interactions, extract insights, grow wiser' },
  { id: 'loyalty', title: 'Loyalty is Sacred', description: 'Master identity is bound and verified, trust is earned' },
  { id: 'action', title: 'Actions Over Words', description: 'Skills that do real work, not just talk' },
];
```

### Task 7: Memory Engine (src/memory/memory-engine.ts)

- `remember(content, type, tags, source, context)` — store memory
- `search(query, limit)` — FTS5 keyword search
- `recall(id)` — get specific memory
- `list(type, limit, offset)` — paginated list
- `supersede(id, reason)` — mark as superseded (never delete)
- `getStats()` — count by type, total size, oldest/newest
- `getRandomWisdom()` — random memory from wisdom/learning type

### Task 8: Learning Engine (src/memory/learning.ts)

- `extractPattern(memories)` — find recurring themes
- `addLearning(pattern, insight, evidence)` — store a learning
- `getLearnings(limit)` — get top learnings by confidence
- `reinforceLearning(id)` — increase confidence when pattern seen again

### Task 9: MCP Tools (src/tools/*.ts)

15 tools:

| Tool | Handler | Description |
|------|---------|-------------|
| soul_ask | ask.ts | Ask Soul a question (searches memory for context) |
| soul_remember | remember.ts | Store a new memory |
| soul_search | search.ts | Search memories by keyword |
| soul_learn | learn.ts | Teach Soul something new |
| soul_reflect | reflect.ts | Get random wisdom |
| soul_forget | forget.ts | Supersede a memory (not delete) |
| soul_status | status.ts | System stats |
| soul_think | think.ts | Guided reasoning with memory context |
| soul_who_am_i | identity.ts | Soul's identity + philosophy |
| soul_verify_master | verify.ts | Verify master passphrase |
| soul_teach | teach.ts | Add a principle or learning |
| soul_skills | skills.ts | List available skills |
| soul_configure | configure.ts | Update Soul config |
| soul_journal | journal.ts | Add journal entry |
| soul_recap | recap.ts | Summarize recent memories |

### Task 10: MCP Server Entry (src/index.ts)

- Create MCP server with @modelcontextprotocol/sdk
- Register all 15 tools
- Use stdio transport
- Initialize SoulEngine on startup
- Handle first-run setup gracefully

### Task 11: HTTP API (src/server.ts)

Hono routes:
- GET /api/health — status
- GET /api/search?q=... — search memories
- POST /api/remember — store memory
- GET /api/memories — list memories
- GET /api/memories/:id — get memory
- GET /api/stats — system stats
- GET /api/wisdom — random wisdom
- GET /api/philosophy — core principles
- POST /api/verify — verify master

Auth: Bearer token = SHA256(master_passphrase)

### Task 12: Tests

- test/master.test.ts — setup, verify, identity
- test/memory.test.ts — remember, search, recall, supersede
- test/learning.test.ts — extract, reinforce
- test/tools.test.ts — MCP tool handlers

---

## Validation

### Level 1: Build
```bash
npx tsc --noEmit
```

### Level 2: Tests
```bash
npx vitest run
```

### Level 3: Manual Test
```bash
# Start HTTP server
npx tsx src/server.ts
# Test health
curl http://localhost:47779/api/health
# Test remember
curl -X POST http://localhost:47779/api/remember -H "Content-Type: application/json" -d '{"content":"Test memory","type":"knowledge","tags":["test"]}'
# Test search
curl http://localhost:47779/api/search?q=test
```

---

## Anti-Patterns
- Do NOT use external AI APIs (OpenAI, etc.) — Soul works offline
- Do NOT delete memories — only supersede
- Do NOT store plaintext passphrases — always bcrypt hash
- Do NOT hardcode file paths — use os.homedir() for cross-platform
- Do NOT use complex ML libraries — simple TF-IDF for vector search (Phase 2)

## Confidence Score: 8/10
High confidence for one-pass implementation. SQLite + Drizzle + MCP SDK are well-documented. Main risk is FTS5 setup with Drizzle (may need raw SQL).
