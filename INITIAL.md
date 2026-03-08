# Soul — AI Companion System

## FEATURE:

Build **Soul**, a cross-platform AI companion MCP server + HTTP API that:

### 1. Soul Engine (Core Identity)
- **Master Binding**: On first run, Soul asks "Who is my master?" and binds to that identity (name + passphrase). This binding is permanent and verified on sensitive operations.
- **Philosophy System**: 5 core principles hardcoded + user-extensible principles. Soul references these when making decisions or giving advice.
- **Loyalty Protocol**: Soul knows its master, protects their interests, and refuses to act against them. It can identify its master by passphrase verification.
- **Personality**: Soul has a warm, thoughtful personality. It speaks with respect and care. It is a thinking companion, not a command executor.

### 2. Memory Engine (Ever-Growing Knowledge)
- **Conversations**: Store every interaction with timestamps, context, and tags
- **Learnings**: Extract patterns from conversations — things the master likes, dislikes, habits, preferences
- **Knowledge**: Store facts, notes, research that the master shares
- **Wisdom**: Synthesize learnings into higher-level insights over time
- **Semantic Search**: Find relevant memories using both keyword (FTS5) and semantic (vector) search
- **Memory Layers**: inbox (temporary) → memory (permanent) → learnings (patterns) → wisdom (principles)

### 3. Skills Engine (Action System)
- **Built-in Skills**: recall (search memory), learn (add knowledge), reflect (random wisdom), status (system stats), think (guided reasoning)
- **Extensible**: Skills are TypeScript modules that can be added at runtime
- **Skill Registry**: List, enable, disable skills

### 4. MCP Server (AI Agent Integration)
- **15+ MCP Tools**: soul_ask, soul_remember, soul_learn, soul_search, soul_reflect, soul_forget (supersede), soul_status, soul_think, soul_who_am_i, soul_verify_master, soul_teach, soul_skills, soul_configure, soul_journal, soul_recap
- **Works with**: Claude Code, Cursor, OpenCode, Gemini CLI, and any MCP-compatible agent

### 5. HTTP API (Web Access)
- **Hono server** on configurable port (default 47779)
- **Endpoints**: /api/health, /api/search, /api/ask, /api/learn, /api/memories, /api/stats, /api/wisdom
- **Master auth**: Bearer token derived from master passphrase

## EXAMPLES:

Reference implementations studied:
- **oracle-v2** (Soul-Brews-Studio): MCP server with SQLite FTS5 + ChromaDB, 22 tools, Hono HTTP API, Drizzle ORM — good architecture but lacks master loyalty, personality, and progressive learning
- **context-engineering-intro** (coleam00): PRP workflow, validation loops, agent team coordination — use PRP methodology for building Soul itself

## DOCUMENTATION:

- MCP SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Drizzle ORM: https://orm.drizzle.team/docs/get-started/sqlite-new
- Hono: https://hono.dev/docs/
- better-sqlite3: https://github.com/WiseLibs/better-sqlite3
- vitest: https://vitest.dev/

## OTHER CONSIDERATIONS:

1. **Cross-platform**: Must run on Windows, macOS, Linux without Docker dependency
2. **Portable**: Single SQLite file = entire brain. Copy file = clone Soul.
3. **No external APIs needed**: Works fully offline (no OpenAI/Anthropic API calls for core functionality). Vector embeddings use a local algorithm (TF-IDF or similar) not requiring GPU.
4. **First-run experience**: Interactive setup via CLI — ask master name, set passphrase, choose personality traits
5. **Graceful degradation**: If SQLite has no data yet, Soul should still be helpful and explain it's learning
6. **Memory growth**: Design schema so memory can grow to millions of entries without slowing down (proper indexes, pagination)
7. **Thai language support**: Soul should handle Thai text naturally in memory and search (SQLite FTS5 supports unicode)
