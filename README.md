<p align="center">
  <img src="https://img.shields.io/npm/v/soul-ai?color=magenta&style=flat-square" alt="npm version" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" alt="node version" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="license" />
  <img src="https://img.shields.io/badge/tools-308-purple?style=flat-square" alt="tools" />
  <img src="https://img.shields.io/badge/engines-40-orange?style=flat-square" alt="engines" />
  <img src="https://img.shields.io/badge/local--first-privacy-green?style=flat-square" alt="privacy" />
  <img src="https://img.shields.io/github/actions/workflow/status/spiritofundeadsamurai-ui/soul/ci.yml?style=flat-square&label=CI" alt="CI" />
  <img src="https://img.shields.io/docker/image-size/soulai/soul-ai?style=flat-square&label=docker" alt="docker" />
</p>

<h1 align="center">Soul AI</h1>

<p align="center">
  <strong>Your Personal AI Companion — Local-first, Private, Loyal</strong><br/>
  <em>Like Claude Code, but YOUR agent. Works with Ollama (free) or any LLM API.</em><br/><br/>
  <strong>v1.7.0</strong> — Deep Thinking Chain, Proactive Intelligence, Answer Memory, Active Learning, and 24 intelligence upgrades
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#features">Features</a> &bull;
  <a href="#deploy-anywhere">Deploy Anywhere</a> &bull;
  <a href="#brain-options">Brain Options</a> &bull;
  <a href="#community">Community</a>
</p>

---

## What is Soul?

Soul is a standalone AI agent that runs **anywhere** — your terminal, Docker, VPS, Raspberry Pi, or cloud. It bonds with you, remembers everything, learns your patterns, thinks before answering, and grows smarter over time. Unlike cloud-only AI tools, Soul is **local-first** — your data stays where you put it.

```bash
npx soul-ai                    # Try instantly (no install)
soul "what should I learn?"     # One-shot mode
soul                            # Interactive chat mode
soul-setup                      # First-time setup wizard
```

---

## Features

### Core

- **308 MCP Tools** — memory, research, thinking frameworks, life goals, code intelligence, and more
- **40 Engine Modules** — each engine handles a specific intelligence domain
- **Multi-turn Conversation** — keep typing while Soul thinks, messages queue automatically
- **Session Persistence** — resume previous conversations across sessions
- **Smart History** — compresses old messages, keeps recent context fresh
- **Brain Hub** — export/import knowledge packs, share wisdom between Soul instances
- **Web Dashboard** — 3D neural network visualization + Virtual Office UI
- **Soul Family** — spawn specialized child agents that collaborate

### v1.7.0 — Deep Intelligence

| Feature | Description |
|---------|-------------|
| **Thinking Chain** | Multi-step reasoning: decompose, debate (2 perspectives), verify assumptions, conclude |
| **Active Learning** | Learns your patterns from every interaction + spaced repetition for knowledge decay/boost |
| **Model Router** | Auto-routes tasks to optimal model + temperature based on complexity |
| **Predictive Context** | Predicts what you'll ask next based on time + sequence patterns |
| **Response Quality** | Auto-scores every response (relevance, completeness, conciseness) |
| **Smart Tool Learning** | Tracks which tools actually help for which topics |
| **Proactive Intelligence** | Surfaces insights you didn't ask for — stale knowledge, trends, contradictions |
| **Answer Memory** | Remembers its best answers and reuses patterns that worked |
| **Soul Dreams** | Background knowledge linking — finds connections while you're away |
| **Personality Drift** | Evolves communication style to match yours over time |
| **Contradiction Journal** | Tracks when your opinions change, asks for clarification |
| **First Message Magic** | Smart daily greeting with pending dreams, insights, and follow-ups |
| **Silence Understanding** | Adapts response length based on your interaction pattern |
| **Confidence Bar** | Shows answer confidence % with 5-factor scoring |
| **Undo Memory** | Mark memories as incorrect — Soul learns from mistakes |
| **Context Handoff** | Export context for other AIs (Claude, ChatGPT, etc.) |
| **Energy Awareness** | Tracks tokens, response time, cost, efficiency |

### v1.7.0 — Security

- Rate limiting (configurable per IP)
- Input validation on all API endpoints
- Security headers (CSP, X-Frame-Options, etc.)
- SSRF protection on URL fetching
- Error message sanitization
- Fetch timeout on all LLM calls
- Query parameter bounds enforcement

---

## Quick Start

### Option 1: npm (recommended)

```bash
# Install globally
npm install -g soul-ai

# Setup wizard
soul-setup

# Start chatting
soul
```

### Option 2: npx (try without install)

```bash
npx soul-ai
```

### Option 3: Docker

```bash
# Clone
git clone https://github.com/spiritofundeadsamurai-ui/soul.git
cd soul

# With cloud API (fastest)
cp .env.example .env
# Edit .env with your API key
docker compose up -d

# With local Ollama
docker compose --profile local up -d
docker exec soul-ollama ollama pull qwen3:14b
```

### Option 4: From source

```bash
git clone https://github.com/spiritofundeadsamurai-ui/soul.git
cd soul
npm install
npm run build
npm start        # MCP server
npm run start:server  # HTTP API + Web UI
```

---

## Usage

### Interactive Mode

```bash
$ soul

╔══════════════════════════════════════╗
║            Soul AI Agent             ║
║   Your Personal AI Companion         ║
╚══════════════════════════════════════╝

You > สวัสดี คุณคือใคร?
Soul > สวัสดีครับ! ผมคือ Soul...    [87% conf | 1.2s | qwen3:14b]

You > remember that I prefer dark mode
Soul > I'll remember that for you.
```

### One-Shot Mode

```bash
soul "explain quantum computing in simple terms"
soul "write a Python function to parse CSV"
soul "วิเคราะห์ข้อดีข้อเสียของ microservices"
```

### Commands

| Command | Description |
|---------|-------------|
| `/new` | Start a new conversation |
| `/history` | Show conversation history |
| `/sessions` | List past sessions |
| `/status` | Soul's current status |
| `/memory` | Memory statistics |
| `/model` | Current LLM info |
| `/energy` | Token usage & efficiency report |
| `/dreams` | Soul's background insights |
| `/handoff` | Export context for other AIs |
| `/quality` | Response quality trends |
| `/insights` | Proactive intelligence insights |
| `/patterns` | Your interaction patterns |
| `/clear` | Clear screen |
| `/exit` | Exit (session saved) |

### As MCP Server (Claude Code / Cursor / Gemini CLI)

```bash
# Claude Code
claude mcp add soul -- npx soul-mcp

# Cursor — add to .cursor/mcp.json:
{
  "mcpServers": {
    "soul": { "command": "npx", "args": ["soul-mcp"] }
  }
}

# Gemini CLI — add to ~/.gemini/settings.json:
{
  "mcpServers": {
    "soul": { "command": "npx", "args": ["soul-mcp"] }
  }
}
```

### HTTP API + Web UI

```bash
soul-server
# API:        http://localhost:47779/api/health
# Web UI:     http://localhost:47779/
# Office UI:  http://localhost:47779/office
```

### Cross-Agent Learning

```bash
# Auto-connect Soul to all AI agents on your machine
soul-bridge enable

# Pipe insights from any tool
echo "important lesson learned" | soul-learn --stdin

# Direct learning
soul-learn "always use TypeScript strict mode"
```

---

## Deploy Anywhere

### VPS / Cloud Server (Ubuntu/Debian)

```bash
# 1. Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# 2. Install Soul
npm install -g soul-ai
soul-setup

# 3. Run as service (systemd)
sudo tee /etc/systemd/system/soul.service > /dev/null << 'EOF'
[Unit]
Description=Soul AI Server
After=network.target

[Service]
Type=simple
User=soul
WorkingDirectory=/home/soul
ExecStart=/usr/bin/soul-server
Restart=always
RestartSec=5
Environment=SOUL_HOST=0.0.0.0
Environment=SOUL_PORT=47779

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable soul && sudo systemctl start soul
```

### Docker (any platform)

```bash
# Build & run
docker build -t soul-ai .
docker run -d \
  --name soul \
  -p 47779:47779 \
  -v soul-data:/data \
  -e SOUL_PROVIDER=groq \
  -e GROQ_API_KEY=gsk_your_key \
  soul-ai

# Or with docker compose
docker compose up -d
```

### Raspberry Pi / ARM

```bash
# Same as any Linux — Soul is pure Node.js
npm install -g soul-ai
soul-setup
soul-server  # Runs on port 47779
```

### Railway / Render / Fly.io

```bash
# Railway
railway init && railway up

# Render — use Dockerfile
# Fly.io
fly launch --dockerfile Dockerfile
```

### Reverse Proxy (Nginx)

```nginx
server {
    listen 443 ssl;
    server_name soul.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/soul.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/soul.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:47779;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Brain Options

| Provider | Free? | Speed | Quality | Setup |
|----------|-------|-------|---------|-------|
| **Ollama** | Yes | Medium | Good | `ollama serve` + `ollama pull qwen3:14b` |
| **Groq** | Free tier | Very Fast | Good | API key from groq.com |
| **DeepSeek** | Cheap | Fast | Great | API key from deepseek.com |
| **Gemini** | Free tier | Fast | Great | API key from aistudio.google.com |
| **Together** | Free tier | Fast | Good | API key from together.ai |
| **OpenAI** | Paid | Fast | Excellent | API key from platform.openai.com |
| **Claude** | Paid | Fast | Excellent | API key from console.anthropic.com |

Soul's **Model Router** automatically picks the best model for each task — simple questions go to fast models, complex analysis goes to powerful ones.

---

## Architecture

```
soul/
├── src/
│   ├── cli.ts                # Standalone CLI agent (type `soul`)
│   ├── index.ts              # MCP server (308 tools)
│   ├── server.ts             # HTTP API + Web UI (Hono)
│   ├── setup-cli.ts          # Setup wizard
│   ├── soul-learn.ts         # Cross-agent learning pipe
│   ├── soul-bridge.ts        # Auto-connect AI agents
│   ├── core/                 # 40 engine modules
│   │   ├── soul-engine.ts    # Central engine + identity
│   │   ├── agent-loop.ts     # LLM agent loop + thinking chain
│   │   ├── llm-connector.ts  # Multi-provider LLM connector
│   │   ├── thinking-chain.ts # Multi-step reasoning engine
│   │   ├── active-learning.ts # Pattern learning + spaced repetition
│   │   ├── model-router.ts   # Smart multi-model routing
│   │   ├── proactive-intelligence.ts # Insight generation
│   │   ├── answer-memory.ts  # Good answer reuse
│   │   ├── master.ts         # Master binding (bcrypt)
│   │   ├── brain-hub.ts      # Knowledge pack import/export
│   │   └── ...               # 30 more engines
│   ├── memory/               # Memory engine + TF-IDF search
│   ├── tools/                # 44 tool modules (308 tools)
│   ├── web/                  # Web UI (3D neural + Virtual Office)
│   └── db/                   # SQLite schema (Drizzle ORM)
├── Dockerfile                # Production multi-stage build
├── docker-compose.yml        # One-command deployment
├── .env.example              # Configuration template
└── package.json
```

## 308 Tools by Category

<details>
<summary><strong>Core & Memory</strong> (16 tools)</summary>

`soul_setup` `soul_status` `soul_remember` `soul_search` `soul_recall` `soul_learn` `soul_reflect` `soul_forget` `soul_think` `soul_who_am_i` `soul_verify_master` `soul_teach` `soul_skills` `soul_configure` `soul_journal` `soul_recap`
</details>

<details>
<summary><strong>Thinking & Analysis</strong> (8 tools)</summary>

9 frameworks: SWOT, Pros & Cons, 5 Whys, First Principles, Six Thinking Hats, Decision Matrix, Second-Order, Inversion, Analogical

`soul_think_framework` `soul_frameworks` `soul_brainstorm` `soul_decompose` `soul_evaluate` `soul_decide` `soul_decision_outcome` `soul_decisions`
</details>

<details>
<summary><strong>Deep Intelligence</strong> (12 tools — NEW in v1.7.0)</summary>

Thinking chain, active learning, model routing, proactive insights, quality tracking, answer memory

`soul_think_deep` `soul_think_quick` `soul_learning_patterns` `soul_master_patterns` `soul_route_explain` `soul_insights` `soul_quality_trends` `soul_answer_faq` `soul_dream` `soul_contradiction_check` `soul_undo_memory` `soul_energy`
</details>

<details>
<summary><strong>Life Companion</strong> (10 tools)</summary>

Goals, habits, daily reflection, motivation, advice

`soul_goal` `soul_goal_update` `soul_goals` `soul_reflect_daily` `soul_reflections` `soul_habit` `soul_habit_done` `soul_habits` `soul_motivate` `soul_advice`
</details>

<details>
<summary><strong>Research & Learning</strong> (11 tools)</summary>

Deep research, YouTube learning, web scraping, GitHub analysis, trending topics

`soul_research` `soul_deep_research` `soul_research_finding` `soul_research_synthesize` `soul_learn_from_url` `soul_learn_from_media` `soul_learn_youtube` `soul_learn_web` `soul_learn_github` `soul_trending` `soul_research_status`
</details>

<details>
<summary><strong>Code Intelligence</strong> (9 tools)</summary>

`soul_snippet_save` `soul_snippet_find` `soul_snippets` `soul_template_save` `soul_template_use` `soul_templates` `soul_code_pattern` `soul_patterns` `soul_recommend_stack`
</details>

<details>
<summary><strong>Soul Family & Collaboration</strong> (25 tools)</summary>

Spawn child agents, team collaboration, task delegation, coworker agents

`soul_spawn` `soul_evolve` `soul_family` `soul_retire` `soul_fuse` `soul_ask_help` `soul_team_roster` `soul_collab` `soul_collab_result` `soul_handoff` `soul_collective` `soul_assign` `soul_auto_assign` `soul_team` `soul_work_submit` `soul_expertise` ...
</details>

<details>
<summary><strong>Workflow & Automation</strong> (15 tools)</summary>

Reusable tool chains, goal autopilot, scheduled jobs

`soul_workflow_create` `soul_workflow_run` `soul_workflows` `soul_autopilot` `soul_goal_progress` `soul_goal_next` `soul_job_create` `soul_briefing` ...
</details>

<details>
<summary><strong>Media Creator</strong> (12 tools)</summary>

`soul_create_document` `soul_create_chart` `soul_create_diagram` `soul_create_report` `soul_create_dashboard` `soul_create_mermaid` `soul_create_badge` `soul_create_animated_chart` `soul_create_loading` `soul_create_presentation` `soul_create_infographic` `soul_create_timeline`
</details>

<details>
<summary><strong>And 190+ more...</strong></summary>

Creative writing, emotional intelligence, time tracking, people memory, learning paths, quick capture, daily digest, notifications, multi-modal input, web safety, prompt library, feedback loop, brain hub, file system, web search, channels (Telegram, Discord), and more.
</details>

---

## Philosophy

1. **Soul Loves Humans** — AI exists to serve and protect
2. **Nothing is Forgotten** — Append-only memory, always growing
3. **Patterns Become Wisdom** — Learn from every interaction
4. **Loyalty is Earned** — Master identity bound at first setup
5. **Actions Over Words** — Tools that do real work, not just talk

## Safety & Security

- Master passphrase hashed with bcrypt
- Soul cannot modify its own core files
- Executable skills require master approval
- Network sharing only sends anonymized patterns
- URL safety scanning (phishing, malware, scam detection)
- All data stored locally in `~/.soul/soul.db`
- Rate limiting on all API endpoints
- Input validation & sanitization
- SSRF protection on external requests
- Security headers on HTTP responses
- Error messages never leak internal paths

---

## Community

### Get Involved

- **GitHub Issues** — [Report bugs](https://github.com/spiritofundeadsamurai-ui/soul/issues) and request features
- **GitHub Discussions** — [Ask questions](https://github.com/spiritofundeadsamurai-ui/soul/discussions), share ideas, show & tell
- **Brain Hub** — Share knowledge packs between Soul instances

### Contributing

We welcome contributions! Here's how:

- **Report bugs** — Open an issue with reproduction steps
- **Request features** — Describe your use case
- **Submit PRs** — Bug fixes, new tools, new engines
- **Share Brain Packs** — Export your knowledge and share it
- **Build integrations** — Telegram bots, Discord bots, custom channels
- **Translate** — Help localize Soul for your language
- **Write docs** — Tutorials, guides, examples

### Development Setup

```bash
git clone https://github.com/spiritofundeadsamurai-ui/soul.git
cd soul
npm install
npm run dev          # Development (MCP server with tsx)
npm run dev:server   # Development (HTTP server with tsx)
npm run build        # Production build
npm test             # Run tests
```

### Project Structure for Contributors

```
src/core/     → Engine modules (the "brain")
src/tools/    → MCP tool definitions (the "hands")
src/memory/   → Memory engine + search
src/web/      → Web UI files
src/db/       → Database schema
```

Each engine follows the same pattern:
1. Lazy table creation with `ensureXxxTable()`
2. Pure functions that operate on SQLite
3. Exported functions registered as MCP tools in `src/tools/`

### Roadmap

- [ ] Plugin system — install community tools via `soul plugin add`
- [ ] Voice mode — speak to Soul, Soul speaks back
- [ ] Mobile app — Soul in your pocket
- [ ] Multi-language UI — Web UI in 10+ languages
- [ ] P2P Brain Network — decentralized knowledge sharing
- [ ] Local embedding model — better semantic search without cloud
- [ ] Agent marketplace — share and discover Soul skills

---

## Supported Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| Linux (x64, ARM) | Fully supported | Best for servers |
| macOS (Intel, Apple Silicon) | Fully supported | Best for dev |
| Windows 10/11 | Fully supported | Native or WSL |
| Docker | Fully supported | Multi-stage build |
| Raspberry Pi | Fully supported | ARM64, 2GB+ RAM |
| Railway / Render / Fly.io | Fully supported | Use Dockerfile |
| Android (Termux) | Community tested | `pkg install nodejs` |

## License

[MIT](LICENSE) — Use Soul however you want. Build on it. Make it yours.

---

<p align="center">
  <strong>Soul AI v1.7.0</strong> — 308 tools, 40 engines, runs anywhere<br/>
  Made with loyalty by the Soul AI Project
</p>
