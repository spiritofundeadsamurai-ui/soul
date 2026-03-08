# Contributing to Soul AI

Thank you for your interest in contributing to Soul! This guide will help you get started.

## Getting Started

### Prerequisites

- Node.js >= 18
- npm
- Ollama (optional, for local LLM testing)

### Development Setup

```bash
# Clone the repo
git clone https://github.com/soul-ai-project/soul.git
cd soul

# Install dependencies
npm install

# Run in development mode
npm run dev              # MCP server
npm run dev:server       # HTTP API + Web UI

# Build
npm run build

# Run tests
npm test

# Link for local CLI testing
npm link
soul                     # Now available globally
```

### Project Structure

```
src/
├── cli.ts               # CLI agent entry point
├── index.ts             # MCP server entry point
├── server.ts            # HTTP API + Web UI
├── setup-cli.ts         # Setup wizard
├── core/                # Engine modules (business logic)
├── memory/              # Memory engine + search
├── tools/               # MCP tool definitions
├── web/                 # Web UI files
└── db/                  # Database schema
```

## How to Contribute

### Reporting Bugs

1. Check existing issues first
2. Open a new issue with:
   - What happened vs. what you expected
   - Steps to reproduce
   - Node.js version, OS, LLM provider
   - Error messages / logs

### Suggesting Features

1. Open a GitHub Discussion or Issue
2. Describe the use case (why, not just what)
3. If possible, suggest how it might work

### Submitting Code

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Build: `npm run build`
6. Commit with clear messages
7. Push and open a Pull Request

### Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Add tests for new functionality
- Update README if adding user-facing features
- Follow existing code style (TypeScript strict mode)
- All MCP tools must be prefixed with `soul_`

## Code Conventions

- **TypeScript strict mode** — no `any` unless necessary
- **camelCase** for TypeScript, **snake_case** for database columns
- **ISO 8601** for all timestamps
- **Lazy table creation** — use `ensureXxxTable()` pattern
- Tools go in `src/tools/`, engines go in `src/core/`
- Memory is append-only — never delete, only supersede

## Adding a New Tool

1. Create or edit a file in `src/tools/`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerMyTools(server: McpServer) {
  server.tool(
    "soul_my_tool",
    "Description of what this tool does",
    {
      param1: z.string().describe("What this param is for"),
    },
    async ({ param1 }) => {
      // Implementation
      return {
        content: [{ type: "text", text: "Result" }],
      };
    }
  );
}
```

2. Register in `src/index.ts`:
```typescript
import { registerMyTools } from "./tools/my-tools.js";
registerMyTools(server);
```

3. If the tool should work in CLI agent mode, also register in `src/core/agent-loop.ts`.

## Adding a New Engine

1. Create `src/core/my-engine.ts` with your logic
2. Export functions that tools can call
3. If it needs a database table, use lazy creation:

```typescript
function ensureMyTable() {
  db.exec(`CREATE TABLE IF NOT EXISTS my_table (...)`);
}
```

## Brain Pack Contributions

You can contribute knowledge packs that other Soul instances can import:

1. Use `soul_brain_create` to create a knowledge pack
2. Export it with `soul_brain_export`
3. Share via GitHub Discussions or a dedicated repo

## Community Guidelines

- Be respectful and constructive
- Help newcomers — we were all beginners once
- Focus on the work, not the person
- When in doubt, ask questions
- Have fun building AI that serves humans

## Questions?

Open a GitHub Discussion — we're happy to help!
