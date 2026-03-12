# CLAUDE.md — Soul Project

## Project Overview
Soul is a comprehensive AI companion system — **15 MCP tools** (minimal surface) + **soul_agent** gateway to **323+ capabilities**, 40+ core engines, HTTP API, OpenAI-compatible LLM proxy, 3D neural network Web UI, and Virtual Office UI. Soul has its own LLM brain — connect ANY provider (Ollama/free, OpenAI, Claude, Gemini, Groq, DeepSeek, Together) and Soul thinks independently. It bonds with its master, remembers everything, thinks across ALL domains (not just code), and grows smarter over time. Features **self-healing** (auto-retry, error learning, adaptive optimization), **conversation branching** (tree-based), **parallel multi-agent** (worker threads), **auto-tool creation** (pattern → tool), and **agent planning with backtracking**. Supports **Private Mode** (fully offline/air-gapped) and **Open Mode** (Brain Pack import/export for knowledge sharing). Multi-channel: **Telegram + Slack + Discord**. Security: API key encryption, secret redaction, setup-gated API.

## Core Philosophy
1. **Soul Loves Humans** — AI exists to serve and protect its master
2. **Nothing is Forgotten** — Append-only memory, always growing
3. **Patterns Become Wisdom** — Learn from interactions, extract insights
4. **Loyalty is Earned** — Master identity is bound at first setup, verified always
5. **Actions Over Words** — Skills that do real work, not just talk

## Tech Stack
- **Runtime**: Node.js (cross-platform)
- **Language**: TypeScript (strict mode)
- **Database**: SQLite via better-sqlite3 + Drizzle ORM (portable, runs anywhere)
- **Search**: FTS5 full-text + TF-IDF cosine similarity (hybrid search)
- **HTTP API**: Hono (lightweight, fast)
- **MCP Server**: @modelcontextprotocol/sdk (Claude Code, Cursor, Gemini CLI integration)
- **Web UI**: 3D neural network + Virtual Office (vanilla JS + Canvas)
- **Package Manager**: npm

## Code Structure (90+ TypeScript files)
```
soul/
├── src/
│   ├── index.ts              # MCP server entry (15 core + soul_agent router)
│   ├── server.ts             # HTTP API + Web UI + LLM proxy + Slack/Discord webhooks
│   ├── core/                 # 38 engine modules
│   │   ├── soul-engine.ts    # Central engine + identity
│   │   ├── master.ts         # Master binding (bcrypt)
│   │   ├── philosophy.ts     # 5 core principles
│   │   ├── self-improvement.ts # Mistake tracking, preferences
│   │   ├── self-healing.ts   # Auto-recovery, usage tracking, adaptive tools
│   │   ├── soul-family.ts    # Spawn/evolve soul children
│   │   ├── collaboration.ts  # Multi-child collaboration
│   │   ├── autonomy.ts       # Tasks, reminders, style learning
│   │   ├── thinking.ts       # 9 thinking frameworks
│   │   ├── life.ts           # Goals, habits, reflections
│   │   ├── creative.ts       # Writing, teaching, empathy
│   │   ├── awareness.ts      # Self-awareness, ethics, metacognition
│   │   ├── notification.ts   # Push notifications
│   │   ├── multimodal.ts     # URL/image/audio/doc + safety scan
│   │   ├── skill-executor.ts # Executable skills + git safety + passphrase
│   │   ├── sync.ts           # Cross-device sync (JSON snapshots)
│   │   ├── network.ts        # Cross-instance knowledge sharing (error logging)
│   │   ├── security.ts       # Encryption, redaction, master verification
│   │   ├── scheduler.ts      # Cron jobs, health, briefings, quality
│   │   ├── channels.ts       # Multi-platform: Telegram + Slack + Discord
│   │   ├── knowledge.ts      # Categorized knowledge base
│   │   ├── web-safety.ts     # URL safety, phishing, malware detection
│   │   ├── research-engine.ts # Multi-source learning (YouTube, GitHub, HN)
│   │   ├── emotional-intelligence.ts # Mood tracking, empathy, stress
│   │   ├── time-intelligence.ts # Time tracking, productivity
│   │   ├── code-intelligence.ts # Snippets, templates, patterns, stack rec
│   │   ├── people-memory.ts  # Remember people + relationships
│   │   ├── learning-paths.ts # Structured learning + milestones
│   │   ├── quick-capture.ts  # Notes, ideas, bookmarks
│   │   ├── daily-digest.ts   # Daily/weekly auto-summaries
│   │   ├── conversation-context.ts # Topic tracking, context recall
│   │   ├── conversation-tree.ts  # Tree-based conversation branching (v1.10)
│   │   ├── sessions.ts       # Named persistent sessions (v1.10)
│   │   ├── agent-planner.ts  # Planning step + backtracking (v1.10)
│   │   ├── auto-tool-creator.ts # Pattern → auto-generated tool (v1.10)
│   │   ├── parallel-agent.ts # Worker thread multi-agent pool (v1.10)
│   │   ├── agent-worker.ts   # Worker thread script for parallel agents (v1.10)
│   │   ├── brain-hub.ts      # Brain Pack create/import/export + dual mode
│   │   ├── coworker.ts       # Soul Children as real working agents
│   │   ├── meta-intelligence.ts # Context priming, chain-of-thought, growth journal
│   │   ├── workflow-engine.ts # Reusable tool chains (inspired by Manus/LangGraph)
│   │   ├── deep-research.ts  # Multi-step research with source verification
│   │   ├── goal-autopilot.ts # Autonomous goal decomposition and pursuit
│   │   ├── prompt-library.ts # Store, rate, version, reuse effective prompts
│   │   ├── first-message.ts  # Smart daily greeting with i18n (Thai/English)
│   │   └── feedback-loop.ts  # Learn from master's feedback (RLHF-style)
│   ├── memory/
│   │   ├── memory-engine.ts  # Memory CRUD + hybrid search
│   │   ├── learning.ts       # Pattern extraction + confidence
│   │   └── tfidf.ts          # Pure TS TF-IDF cosine similarity
│   ├── tools/                # 52 tool modules + tool-router.ts (minimal surface proxy)
│   │   ├── tool-router.ts    # Collector proxy: 15 core → MCP, 300+ → soul_agent
│   │   ├── sessions.ts       # Session + branch MCP tools (v1.10)
│   │   ├── agent-planner.ts  # Planner MCP tools (v1.10)
│   │   ├── auto-tool.ts      # Auto-tool MCP tools (v1.10)
│   │   ├── parallel-agent.ts # Parallel execution MCP tools (v1.10)
│   │   └── ...               # 47 other tool modules
│   ├── web/
│   │   ├── index.html        # 3D neural network + auth login flow
│   │   └── office.html       # Virtual office terminal (routes to agent loop)
│   └── db/
│       ├── schema.ts         # Drizzle schema
│       └── index.ts          # DB client + FTS5
├── tsconfig.json
└── package.json
```

## All 323+ Tools by Category

| Category | Count | Key Tools |
|----------|-------|-----------|
| **Core** | 16 | soul_setup, soul_status, soul_remember, soul_search, soul_recall, soul_learn |
| **Research** | 6 | soul_research, soul_learn_from_url, soul_learn_from_media, soul_create_skill |
| **Self-Improve** | 6 | soul_mistake, soul_preference, soul_suggest, soul_check_mistakes |
| **Family** | 10 | soul_spawn, soul_evolve, soul_family, soul_retire, soul_fuse, soul_ask_help, soul_team_roster |
| **Collaboration** | 4 | soul_collab, soul_collab_result, soul_handoff, soul_collective |
| **Autonomy** | 9 | soul_task_create, soul_tasks, soul_remind, soul_learn_style |
| **Thinking** | 8 | soul_think_framework (9 models), soul_brainstorm, soul_decompose, soul_decide |
| **Life** | 10 | soul_goal, soul_habit, soul_reflect_daily, soul_motivate, soul_advice |
| **Creative** | 6 | soul_write, soul_teach_me, soul_feel, soul_communicate |
| **Awareness** | 5 | soul_introspect, soul_ethics, soul_metacognize, soul_anticipate |
| **Notification** | 3 | soul_notify, soul_notifications, soul_notify_read |
| **Multimodal** | 4 | soul_read_url (with safety), soul_see, soul_listen, soul_read_doc |
| **Skill Executor** | 5 | soul_skill_create, soul_skill_approve, soul_skill_evolve |
| **Sync** | 3 | soul_export, soul_import, soul_sync_status |
| **Network** | 5 | soul_network_share, soul_network_peer, soul_network_vote |
| **Scheduler** | 8 | soul_job_create, soul_briefing, soul_health, soul_quality, soul_consolidate |
| **Channels** | 5 | soul_channel_add, soul_channels, soul_send, soul_messages, soul_connect (Telegram/Slack/Discord) |
| **Knowledge** | 4 | soul_know, soul_knowledge, soul_knowledge_use, soul_knowledge_stats |
| **Web Safety** | 3 | soul_url_check, soul_block_domain, soul_safety_stats |
| **Research Engine** | 5 | soul_learn_youtube, soul_learn_web, soul_learn_github, soul_trending |
| **Emotional** | 4 | soul_mood, soul_detect_emotion, soul_mood_history, soul_mood_analysis |
| **Time Tracking** | 5 | soul_timer_start, soul_timer_stop, soul_time_today, soul_time_summary |
| **Code Intel** | 9 | soul_snippet_save, soul_template_save, soul_code_pattern, soul_recommend_stack |
| **People** | 5 | soul_person_add, soul_person_find, soul_people, soul_person_update, soul_people_stats |
| **Learning Paths** | 5 | soul_learn_path_create, soul_learn_milestone_done, soul_learn_resource_add |
| **Quick Capture** | 7 | soul_note, soul_idea, soul_bookmark, soul_note_pin, soul_note_search |
| **Daily Digest** | 2 | soul_digest, soul_weekly |
| **Conversation** | 4 | soul_conversation_log, soul_recall_context, soul_conversation_stats |
| **Brain Hub** | 11 | soul_mode, soul_brain_create, soul_brain_import, soul_brain_starter, soul_brain_list |
| **Coworker** | 11 | soul_assign, soul_auto_assign, soul_team, soul_work_submit, soul_expertise |
| **Meta-Intelligence** | 7 | soul_prime, soul_reason, soul_explain, soul_growth, soul_growth_summary, soul_self_review |
| **Workflow** | 8 | soul_workflow_create, soul_workflow_run, soul_workflow_step, soul_workflows, soul_workflow_template |
| **Deep Research** | 5 | soul_deep_research, soul_research_finding, soul_research_synthesize, soul_research_status |
| **Goal Autopilot** | 7 | soul_autopilot, soul_goal_progress, soul_goal_next, soul_goals, soul_goal_detail |
| **Prompt Library** | 7 | soul_prompt_save, soul_prompt_use, soul_prompt_rate, soul_prompts, soul_prompt_evolve |
| **Feedback Loop** | 3 | soul_feedback, soul_feedback_patterns, soul_feedback_stats |
| **LLM** | 6 | soul_llm_add, soul_llm_list, soul_llm_default, soul_smart_chat, soul_route_explain, soul_route_test |
| **Distillation** | 4 | soul_distill, soul_distill_export, soul_distill_list, soul_distill_review |
| **Genius** | 7 | soul_genius_register, soul_genius_spaced_review, soul_genius_cross_pattern, soul_genius_stuck |
| **Hardware** | 3 | soul_hardware_detect, soul_hardware_recommend, soul_hardware_status |
| **Classification** | 6 | soul_classify_teach, soul_classify_feedback, soul_classify_smart, soul_classify_patterns, soul_classify_forget, soul_classify_learning_stats |
| **File System** | 6 | soul_read_file, soul_list_dir, soul_search_files, soul_file_info, soul_read_csv, soul_analyze_project |
| **Media Creator** | 12 | soul_create_document, soul_create_chart, soul_create_diagram, soul_create_report, soul_create_dashboard, soul_create_mermaid, soul_create_badge, soul_create_animated_chart, soul_create_loading, soul_create_presentation, soul_create_infographic, soul_create_timeline |
| **Web Search** | 5 | soul_web_search, soul_web_fetch, soul_web_search_deep, soul_search_provider_add, soul_search_providers |
| **Sessions** | 4 | soul_session_create, soul_session_list, soul_session_resume, soul_session_delete |
| **Branching** | 3 | soul_branch_create, soul_branch_switch, soul_branch_tree |
| **Agent Planner** | 3 | soul_plan_create, soul_plan_status, soul_plan_list |
| **Auto-Tool** | 3 | soul_auto_suggest, soul_auto_approve, soul_auto_list |
| **Parallel Agent** | 2 | soul_parallel_run, soul_parallel_status |

## Conventions
- Use `snake_case` for database columns, `camelCase` for TypeScript
- All timestamps use ISO 8601
- Memory entries are append-only — never delete, only supersede
- Master identity is verified on every sensitive operation
- All MCP tools prefixed with `soul_`
- HTTP API routes under `/api/`
- Tables created lazily with `ensureXxxTable()` pattern
- Soul CANNOT modify its own core files (safety guard in skill-executor)
- Web files go in `src/web/`, auto-copied to `dist/web/` on build

## Safety Rules
- Master passphrase hashed with bcrypt, bound at first-run setup
- **API key encryption**: stored encrypted in SQLite via encryptSecret/safeDecryptSecret
- **Secret redaction**: API keys scrubbed from error messages, conversation history, and tool results before sending to external LLM
- **HTTP API gate**: POST/PUT/DELETE on /api/* blocked until master setup complete
- No secrets in code — use environment variables
- SQLite DB file permissions restricted to owner
- API endpoints require master verification for write operations
- Web UI requires login (passphrase auth, sessionStorage token)
- Executable skills require master approval + passphrase before use
- **Git safety**: force-push, reset --hard, clean -fd blocked in skill executor
- Self-modification cannot touch philosophy, master binding, or core engine
- Network sharing only sends anonymized patterns, never private data
- Network error logging: no more silent catch blocks (v1.10)
- Private data detection blocks sharing of passwords, keys, etc.
- **Web Safety**: URL safety check before fetching (phishing, malware, scam detection)
- Content scanning for dangerous page elements
- Domain blocking for known threats
- Suspicious TLD, typosquat, and homograph attack detection

## Key Design Decisions
- **Minimal Tool Surface** (v1.10.0): 15 core MCP tools + soul_agent meta-tool. Context reduced 94% (~33k→~2k tokens). Inspired by Pi Coding Agent's "4 tools" philosophy adapted for life companion use case
- **Self-Healing**: Auto-retry on failure, record mistakes automatically, suggest fixes from past errors, adaptive core tools based on usage patterns, auto-tool creation from repeated patterns
- **Conversation Branching** (v1.10): Tree-based conversations — messages form a tree via parent_id, branch/switch/visualize. Inspired by Pi's tree-based UI
- **Named Sessions** (v1.10): Persistent named sessions with resume, rename, delete. Integrates with conversation tree
- **Agent Planner** (v1.10): Planning step before tool execution, backtracking on failure (max depth 3), plan persistence in SQLite
- **Auto-Tool Creation** (v1.10): Detect repeated tool patterns → suggest composite tools → master approval → registered. Max 20 auto-tools
- **Parallel Multi-Agent** (v1.10): Worker thread pool for concurrent agent tasks. Main thread coordinates DB access (SQLite-safe). Inline fallback when workers unavailable
- **Lean Mode** (v1.10): Auto-detected for Ollama/local models — compressed system prompt (~200 tokens), max 4 tools, stripped descriptions, 800-token context cap
- **OpenAI-compatible Proxy** (v1.10): `/v1/chat/completions` + `/v1/models` — use Soul as LLM gateway
- **Multi-Channel** (v1.10): Telegram polling + Slack Events API webhook + Discord Bot gateway. All using native fetch()
- **i18n** (v1.10): Thai + English via SOUL_LANG env. Greetings, error messages, first-message
- **Not just code**: thinking frameworks, life goals, habits, writing, emotional support, ethics, people memory, time tracking, learning paths — it's a whole-person companion
- **Hybrid search**: FTS5 keyword (60%) + TF-IDF semantic (40%)
- **Lazy table creation**: Dynamic tables created on first use, not startup
- **Safety-first self-improvement**: Soul can create/evolve skills but can't modify core; needs master approval
- **Soul Network**: Instances share anonymized knowledge across masters
- **Web Safety First**: Every URL checked before fetch
- **Multi-source Learning**: YouTube oEmbed, GitHub API, HackerNews, articles
- **Emotional Intelligence**: Mood tracking, empathy, stress detection, wellness suggestions
- **Code Intelligence**: Snippets, templates, patterns, stack recommendations
- **People Memory**: Remember everyone master mentions with context
- **Learning Paths**: Structured learning with milestones and progress tracking
- **Quick Capture**: Frictionless notes, ideas, bookmarks
- **Daily Digest**: Auto-summary of all daily activity
- **Conversation Context**: Remember what was discussed and recall context instantly
