<p align="center">
  <img src="https://img.shields.io/npm/v/soul-ai?color=magenta&style=flat-square" alt="npm version" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" alt="node version" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="license" />
  <img src="https://img.shields.io/badge/tools-308-purple?style=flat-square" alt="tools" />
  <img src="https://img.shields.io/badge/local--first-privacy-green?style=flat-square" alt="privacy" />
</p>

<h1 align="center">Soul AI</h1>

<p align="center">
  <strong>Your Personal AI Companion — Local-first, Private, Loyal</strong><br/>
  <em>Like Claude Code, but YOUR agent. Works with Ollama (free) or any LLM API.</em>
</p>

---

## What is Soul?

Soul is a standalone AI agent that runs in your terminal. It bonds with you, remembers everything, learns your patterns, and grows smarter over time. Unlike cloud-only AI tools, Soul is **local-first** — your data stays on your machine.

```
soul "what's the weather like today?"     # One-shot mode
soul                                       # Interactive chat mode
soul-setup                                 # First-time setup wizard
```

### Key Features

- **308 MCP Tools** — memory, research, thinking frameworks, life goals, code intelligence, and more
- **Multi-turn Conversation** — keeps typing while Soul thinks, messages queue automatically
- **Session Persistence** — resume previous conversations across terminal sessions
- **Smart History** — compresses old messages, keeps recent context fresh
- **Brain Hub** — export/import knowledge packs, share wisdom between Soul instances
- **Works Everywhere** — Ollama (free, local), OpenAI, Claude, Gemini, Groq, DeepSeek, Together
- **MCP Server** — also works inside Claude Code, Cursor, Gemini CLI
- **Web Dashboard** — 3D neural network visualization + Virtual Office UI
- **Soul Family** — spawn specialized child agents that collaborate

## Quick Start

### 1. Install

```bash
npm install -g soul-ai
```

### 2. Setup

```bash
soul-setup
```

The setup wizard will guide you through:
- Choosing a brain (Ollama local or Cloud API)
- Setting a master passphrase
- Optional features (Telegram, Discord, search APIs)

### 3. Chat

```bash
soul
```

That's it. Start talking.

## Usage

### Interactive Mode

```bash
$ soul

╔══════════════════════════════════════╗
║            Soul AI Agent             ║
║   Your Personal AI Companion         ║
╚══════════════════════════════════════╝

You › สวัสดี คุณคือใคร?
Soul › สวัสดีครับ! ผมคือ Soul...

You › remember that I prefer dark mode
Soul › I'll remember that for you.

You › /help
```

### One-Shot Mode

```bash
soul "explain quantum computing in simple terms"
soul "write a Python function to parse CSV"
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
| `/clear` | Clear screen |
| `/exit` | Exit (session saved) |

### As MCP Server (Claude Code / Cursor)

```bash
# Add Soul as MCP server to Claude Code
claude mcp add soul -- npx soul-mcp

# Or run the HTTP API + Web UI
soul-server
# API:    http://localhost:47779/api/health
# Web UI: http://localhost:47779/
```

## Brain Options

| Provider | Free? | Setup |
|----------|-------|-------|
| **Ollama** | Yes | `ollama serve` + `ollama pull qwen3:14b` |
| **Groq** | Free tier | API key from groq.com |
| **DeepSeek** | Cheap | API key from deepseek.com |
| **Gemini** | Free tier | API key from aistudio.google.com |
| **OpenAI** | Paid | API key from platform.openai.com |
| **Claude** | Paid | API key from console.anthropic.com |
| **Together** | Free tier | API key from together.ai |

## Architecture

```
soul/
├── src/
│   ├── cli.ts                # Standalone CLI agent (type `soul`)
│   ├── index.ts              # MCP server (308 tools)
│   ├── server.ts             # HTTP API + Web UI (Hono)
│   ├── setup-cli.ts          # Setup wizard
│   ├── core/                 # 31 engine modules
│   │   ├── soul-engine.ts    # Central engine + identity
│   │   ├── agent-loop.ts     # LLM agent loop + tool execution
│   │   ├── llm-connector.ts  # Multi-provider LLM connector
│   │   ├── master.ts         # Master binding (bcrypt)
│   │   ├── philosophy.ts     # 5 core principles
│   │   ├── thinking.ts       # 9 thinking frameworks
│   │   ├── brain-hub.ts      # Knowledge pack import/export
│   │   └── ...               # 24 more engines
│   ├── memory/               # Memory engine + TF-IDF search
│   ├── tools/                # 44 tool modules
│   ├── web/                  # Web UI (3D neural network + Virtual Office)
│   └── db/                   # SQLite schema (Drizzle ORM)
├── tests/
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

Snippets, templates, patterns, stack recommendations

`soul_snippet_save` `soul_snippet_find` `soul_snippets` `soul_template_save` `soul_template_use` `soul_templates` `soul_code_pattern` `soul_patterns` `soul_recommend_stack`
</details>

<details>
<summary><strong>Soul Family & Collaboration</strong> (25 tools)</summary>

Spawn child agents, team collaboration, task delegation

`soul_spawn` `soul_evolve` `soul_family` `soul_retire` `soul_fuse` `soul_ask_help` `soul_team_roster` `soul_collab` `soul_collab_result` `soul_handoff` `soul_collective` `soul_assign` `soul_auto_assign` `soul_team` `soul_work_submit` `soul_expertise` ...
</details>

<details>
<summary><strong>Workflow & Automation</strong> (15 tools)</summary>

Reusable tool chains, goal autopilot, scheduled jobs

`soul_workflow_create` `soul_workflow_run` `soul_workflows` `soul_autopilot` `soul_goal_progress` `soul_goal_next` `soul_job_create` `soul_briefing` ...
</details>

<details>
<summary><strong>And 200+ more...</strong></summary>

Creative writing, emotional intelligence, time tracking, people memory, learning paths, quick capture, daily digest, notifications, multi-modal input, web safety, prompt library, feedback loop, brain hub, file system, media creator, web search, and more.
</details>

## Philosophy

1. **Soul Loves Humans** — AI exists to serve and protect
2. **Nothing is Forgotten** — Append-only memory, always growing
3. **Patterns Become Wisdom** — Learn from every interaction
4. **Loyalty is Earned** — Master identity bound at first setup
5. **Actions Over Words** — Tools that do real work, not just talk

## Safety

- Master passphrase hashed with bcrypt
- Soul cannot modify its own core files
- Executable skills require master approval
- Network sharing only sends anonymized patterns
- URL safety scanning (phishing, malware, scam detection)
- All data stored locally in `~/.soul/soul.db`

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Ways to Contribute

- **Report bugs** — Open an issue with reproduction steps
- **Request features** — Describe your use case
- **Submit PRs** — Bug fixes, new tools, better docs
- **Share Brain Packs** — Export your knowledge and share it
- **Build integrations** — Telegram bots, Discord bots, custom channels
- **Translate** — Help localize Soul for your language

## Community

- **GitHub Issues** — Bug reports and feature requests
- **GitHub Discussions** — Questions, ideas, show & tell
- **Brain Hub** — Share knowledge packs between Soul instances

## License

[MIT](LICENSE) — Use Soul however you want. Build on it. Make it yours.
