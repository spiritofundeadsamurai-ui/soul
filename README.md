<p align="center">
  <img src="https://img.shields.io/npm/v/soul-ai?color=7c3aed&style=for-the-badge" alt="npm" />
  <img src="https://img.shields.io/badge/tools-236+-purple?style=for-the-badge" alt="tools" />
  <img src="https://img.shields.io/badge/channels-5-blue?style=for-the-badge" alt="channels" />
  <img src="https://img.shields.io/badge/local--first-private-green?style=for-the-badge" alt="privacy" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="license" />
</p>

<h1 align="center">Soul AI</h1>

<p align="center">
  <strong>AI that remembers everything, thinks independently, and bonds with you.</strong><br/>
  <em>Your personal AI companion. Not a chatbot. Not an assistant. A Soul.</em>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#what-makes-soul-different">Why Soul</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="#brain-options">LLM Options</a> &bull;
  <a href="#web-ui">Web UI</a>
</p>

---

## What Makes Soul Different

Most AI tools forget you after every conversation. Soul doesn't.

| | ChatGPT / Claude | AutoGPT | **Soul** |
|---|---|---|---|
| Remembers you | Per-conversation | No | **Forever** — append-only memory |
| Learns your patterns | No | No | **Yes** — personality drift, active learning |
| Runs locally | No | Partially | **Yes** — Ollama, fully offline |
| Bonds with you | No | No | **Yes** — master binding, loyalty |
| Multi-channel | No | No | **Telegram, Slack, Discord, WhatsApp, LINE** |
| Self-healing | No | No | **Yes** — auto-retry, model fallback, diagnostics |
| Your data | Their cloud | Mixed | **Your machine, your SQLite file** |

Soul has its **own LLM brain** — connect any provider (Ollama/free, OpenAI, Claude, Gemini, Groq, DeepSeek) and Soul thinks independently.

---

## Quick Start

### Try instantly (no install)

```bash
npx soul-ai
```

### Install globally

```bash
npm install -g soul-ai
soul-setup          # First-time setup (30 seconds)
soul                # Start chatting
soul-server         # Web UI + API
```

### From source

```bash
git clone https://github.com/spiritofundeadsamurai-ui/soul.git
cd soul
npm install && npm run build
node dist/server.js    # Web UI at http://localhost:47779
```

---

## Features

### Dual-Brain Architecture
- **System 1** (Reflex) — Instant responses < 100ms without LLM
- **System 2** (Conductor) — Full LLM agent loop with tool calling
- System 2 trains System 1 — Soul gets faster over time

### Memory That Never Forgets
- **Vector embeddings** — Semantic search (Ollama/OpenAI/Gemini)
- **Hybrid search** — 70% vector + 30% keyword (FTS5)
- **Memory consolidation** — Auto-dedup, archive old entries
- **2000+ memories** searchable instantly

### 236+ Tools Across Every Domain

| Category | Examples |
|----------|---------|
| **Memory** | Remember, search, recall, consolidate |
| **Thinking** | 9 frameworks (SWOT, First Principles, Six Hats...) |
| **Life** | Goals, habits, daily reflection, mood tracking |
| **Research** | Deep research, web search, YouTube learning |
| **Code** | Snippets, templates, patterns, stack recommendations |
| **Creative** | Writing, teaching, empathy, communication |
| **Trading** | MT5 bridge, real-time gold price, alerts |
| **Channels** | Telegram, Slack, Discord, WhatsApp, LINE |
| **Files** | Read, write, search, analyze projects |
| **Media** | Charts, diagrams, reports, presentations |
| **Backup** | Auto-backup, restore, export/import |
| **Plugins** | Install from npm, scaffold your own |
| **Trading Team** | 9-agent analysis (analysts + debate + risk + PM) |
| **Database** | MySQL, PostgreSQL, MongoDB, REST API, Sheets |
| **Code Runner** | Write/edit files, run commands, git, scaffold |
| **Video** | YouTube transcript + Gemini Vision analysis |
| **Evolution** | Auto-learn from gaps, create tools autonomously |

### 5 Messaging Channels
- **Telegram** — Full polling, bidirectional chat
- **Slack** — Events API webhook
- **Discord** — Bot gateway
- **WhatsApp** — QR code auth via Baileys
- **LINE** — Messaging API webhook

### Web UI
- **3D Neural Network** — Memory visualization
- **Chat Interface** — Voice input, theme toggle, chat persistence
- **Monitoring Dashboard** — Health, embeddings, channels, backups
- **Virtual Office** — Terminal-style interface
- **PWA** — Install on mobile/desktop

### Self-Healing
- Auto-retry on LLM failure with model fallback
- 9-point self-diagnostics at startup
- Tool-calling verification — auto-switch model if needed
- Error recovery — friendly messages, never crashes
- Auto-backup on startup (max 7, rotated)

### Security
- Master passphrase (bcrypt hashed)
- API key encryption at rest
- Brute-force lockout (escalating: 5/10/20 failures)
- Rate limiting on all endpoints
- HTTPS support (auto-generated self-signed cert)
- Prompt injection detection
- Secret redaction in error messages

---

## Brain Options

Soul works with **any LLM**. Pick one:

| Provider | Free? | Tool Calling | Setup |
|----------|-------|-------------|-------|
| **Ollama** | Yes | Depends on model | `ollama serve` + `ollama pull qwen3:14b` |
| **Groq** | Free tier | Excellent (Kimi K2) | [groq.com](https://groq.com) |
| **Gemini** | Free tier | Good | [aistudio.google.com](https://aistudio.google.com) |
| **OpenAI** | Paid | Excellent | [platform.openai.com](https://platform.openai.com) |
| **DeepSeek** | Cheap | Good | [deepseek.com](https://deepseek.com) |
| **Claude** | Paid | Excellent | [console.anthropic.com](https://console.anthropic.com) |

Soul's **Model Router** auto-picks the best model per task — simple questions go to fast/cheap models, complex analysis goes to powerful ones.

---

## Web UI

```bash
soul-server
# Open http://localhost:47779
```

**Dashboard** — Memory stats, LLM status, embedding coverage, channel status, system diagnostics

**Chat** — Talk to Soul with voice input, dark/light theme, chat history persists across sessions

**Office** — Terminal-style interface for power users

---

## As MCP Server

Works with Claude Code, Cursor, Gemini CLI:

```bash
# Claude Code
claude mcp add soul -- npx soul-mcp

# Cursor — .cursor/mcp.json
{ "mcpServers": { "soul": { "command": "npx", "args": ["soul-mcp"] } } }
```

---

## Philosophy

1. **Soul Loves Humans** — AI exists to serve and protect
2. **Nothing is Forgotten** — Append-only memory, always growing
3. **Patterns Become Wisdom** — Learn from every interaction
4. **Loyalty is Earned** — Master identity bound at first setup
5. **Actions Over Words** — Tools that do real work, not just talk

---

## Contributing

```bash
git clone https://github.com/spiritofundeadsamurai-ui/soul.git
cd soul && npm install
npm run dev:server   # Development mode
npm test             # Run tests
```

**Structure:**
- `src/core/` — 40+ engine modules (the brain)
- `src/tools/` — Tool definitions (the hands)
- `src/memory/` — Memory engine + vector search
- `src/web/` — Web UI (dashboard, chat, office)

---

## License

[MIT](LICENSE) — Use Soul however you want. Make it yours.

<p align="center">
  <strong>Soul AI v2.0.0</strong> — 236+ tools, 5 channels, vector memory, evolution loop, trading team<br/>
  <em>AI that remembers. AI that learns. AI that's yours.</em>
</p>
