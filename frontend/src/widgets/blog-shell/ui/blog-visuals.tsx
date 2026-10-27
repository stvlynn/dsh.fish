import { useEffect, useState } from 'react'
import {
  AgentIcon,
  AgentPresetIcon,
  ApprovedIcon,
  BrowserCategoryIcon,
  BundleIcon,
  CliIcon,
  ConfirmIcon,
  ForwardIcon,
  GitCategoryIcon,
  MarketCategoryIcon,
  MemoryCategoryIcon,
  ModelCategoryIcon,
  ProfileIcon,
  RemoteCategoryIcon,
  SearchIcon,
  SecureIcon,
  SessionCategoryIcon,
  SkillIcon,
  ToolsCategoryIcon,
  VisionCategoryIcon,
  WorkflowCategoryIcon,
  ICON_WEIGHT,
  type Icon,
} from '@/shared/ui/icon'
import { cn } from '@/shared/lib/utils'

export type BlogMockSceneId =
  | 'profile-composer'
  | 'harness-inspector'
  | 'v4-context-budget'
  | 'hub-omni-delivery'
  | 'harness-sidebar-hands'
  | 'v4-1-flash-search'
  | 'deepseek-bot-arena'

export type BlogStructureDiagramId =
  | 'plugin-composition'
  | 'harness-request-path'
  | 'v4-adapter-timeline'
  | 'hub-surfaces'
  | 'harness-v0-2-1-architecture'
  | 'v4-1-flash-pipeline'
  | 'deepseek-bot-ecosystem'

interface SceneFrameSpec {
  readonly icon: Icon
  readonly badge: string
  readonly command: string
  readonly metric: string
  readonly traceLines: readonly string[]
  readonly slots: readonly {
    readonly key: string
    readonly value: string
    readonly active?: boolean
  }[]
}

const SCENE_FRAMES: Record<
  BlogMockSceneId,
  readonly [SceneFrameSpec, SceneFrameSpec, SceneFrameSpec, SceneFrameSpec]
> = {
  'profile-composer': [
    {
      icon: CliIcon,
      badge: 'STEP 01 · PLAN',
      command: '$ npx @dsh-fish/cli show @dsh-fish/hub',
      metric: '$DSH_HOME/.dsh-fish-lock.json',
      traceLines: [
        'kind: bundle (dsh.bundle.patch -> cordis.patch.yml)',
        'target: $DSH_HOME/profiles/web',
        'build-scripts: none required (prebuilt lib/)',
      ],
      slots: [
        { key: 'base', value: '@deepseek-ai/dsh-base', active: true },
        { key: 'bundle', value: '@dsh-fish/hub (pending)', active: false },
        { key: 'skill', value: '$DSH_HOME/skills/*', active: false },
      ],
    },
    {
      icon: BundleIcon,
      badge: 'STEP 02 · ADD',
      command: '$ npx @dsh-fish/cli add @dsh-fish/hub --profile web',
      metric: 'dsh plugin --profile web add',
      traceLines: [
        '+ resolved @dsh-fish/hub@latest into profiles/web',
        '+ updated profiles/web/cordis.patch.yml',
        '+ recorded digest in .dsh-fish-lock.json',
      ],
      slots: [
        { key: 'base', value: '@deepseek-ai/dsh-base', active: true },
        { key: 'bundle', value: '@dsh-fish/hub (installed)', active: true },
        { key: 'preset', value: '$DSH_HOME/.agent-presets/*', active: false },
      ],
    },
    {
      icon: WorkflowCategoryIcon,
      badge: 'STEP 03 · CORDIS',
      command: '$ dsh --profile web --dump-config',
      metric: 'ctx.tools · ctx.sessions · ctx.llm',
      traceLines: [
        'layer 1: profile bundles (dsh-base + dsh-web-app)',
        'layer 2: profiles/web/cordis.patch.yml (@dsh-fish/hub)',
        'layer 3: $DSH_HOME/cordis.patch.yml',
      ],
      slots: [
        { key: 'ctx.tools', value: 'hub_search · hub_install', active: true },
        { key: 'ctx.sessions', value: 'session.v4.jsonl.zstd', active: true },
        { key: 'sandbox', value: 'workspace-write', active: true },
      ],
    },
    {
      icon: ApprovedIcon,
      badge: 'STEP 04 · LIVE',
      command: '$ dsh --profile web',
      metric: 'http://127.0.0.1:3080',
      traceLines: [
        'Cordis effects mounted (reversible on unload)',
        'Web UI ready at http://127.0.0.1:3080',
        'Session locked by single-process SessionHandle',
      ],
      slots: [
        { key: 'profile', value: 'web (running)', active: true },
        { key: 'plugins', value: 'hot-reloadable via Cordis', active: true },
        { key: 'permission', value: 'workspace-write boundary', active: true },
      ],
    },
  ],
  'harness-inspector': [
    {
      icon: ProfileIcon,
      badge: '01 · PROFILE BOOT',
      command: '$ dsh --profile acp',
      metric: 'web · headless · sdk · acp',
      traceLines: [
        'entry: unified Profile loader (v0.1.2-alpha.1)',
        'ACP controls: session/new, session/prompt, MCP, cancel',
        'legacy ApiProxy removed -> @Remote gateway active',
      ],
      slots: [
        { key: 'gateway', value: '@Remote (RemoteError)', active: true },
        { key: 'mode', value: 'PTC mode (run_code)', active: true },
        { key: 'webfetch', value: 'public default-on + SSRF guard', active: false },
      ],
    },
    {
      icon: AgentPresetIcon,
      badge: '02 · SUBAGENT SLOT',
      command: 'subagent.spawn({ model: "deepseek-v4-flash", maxOutput: 8192 })',
      metric: 'parent != child model',
      traceLines: [
        'parent agent: deepseek-v4-pro (thinking: max)',
        'child subagent: deepseek-v4-flash (custom effort)',
        'Claude Code / Codex subagents: pinned profile model',
      ],
      slots: [
        { key: 'parent', value: 'deepseek-v4-pro', active: true },
        { key: 'child-1', value: 'deepseek-v4-flash', active: true },
        { key: 'mailbox', value: 'send_message (bidirectional)', active: true },
      ],
    },
    {
      icon: RemoteCategoryIcon,
      badge: '03 · WIRE METADATA',
      command: 'POST https://api.deepseek.com/anthropic/v1/messages',
      metric: 'official DeepSeek adapter',
      traceLines: [
        'header: enabled plugin package names + versions',
        'session-log upload: opt-in (off by default)',
        'Models settings card: plugin OAuth sign-in hook',
      ],
      slots: [
        { key: 'adapter', value: 'plugin packages visible', active: true },
        { key: 'log-stream', value: 'opt-in incremental upload', active: false },
        { key: 'oauth-slot', value: 'Models settings sign-in', active: true },
      ],
    },
    {
      icon: CliIcon,
      badge: '04 · STDERR / STDOUT',
      command: '$ dsh --profile headless run "audit deps" >result.txt 2>progress.log',
      metric: 'clean machine stdout',
      traceLines: [
        '[stderr] step 1: tool read package.json (14ms)',
        '[stderr] step 2: tool run_code audit (112ms)',
        '[stdout] {"status":"ok","outdated":0}',
      ],
      slots: [
        { key: 'stderr (fd 2)', value: 'progress + tool traces', active: true },
        { key: 'stdout (fd 1)', value: 'final result only', active: true },
        { key: 'safety', value: 'SAFETY.md: unaudited preview', active: true },
      ],
    },
  ],
  'v4-context-budget': [
    {
      icon: ModelCategoryIcon,
      badge: '01 · MODEL SWITCH',
      command: 'model: "deepseek-v4-pro" | "deepseek-v4-flash"',
      metric: '1,000,000 token window',
      traceLines: [
        'deepseek-chat / deepseek-reasoner -> retired 2026-07-24',
        'V4-Pro (1.6T / 49B) · V4-Flash (284B / 13B)',
        'DSA (DeepSeek Sparse Attention) + token compression',
      ],
      slots: [
        { key: 'window', value: '1M default (no extra SKU)', active: true },
        { key: 'thinking', value: 'intensity: max for agents', active: true },
        { key: 'legacy', value: 'deepseek-chat retired', active: false },
      ],
    },
    {
      icon: VisionCategoryIcon,
      badge: '02 · FILES API REUSE',
      command: 'POST /v1/files -> file_id: "file_dsh_98a2f"',
      metric: 'upload once, reference N turns',
      traceLines: [
        'v0.1.0-rc.8: native image requests (@file, /goal, /plan)',
        'v0.1.1-rc.2: auto-resize + Files API upload cache',
        'turn 4 reuses file_dsh_98a2f (0 redundant upload bytes)',
      ],
      slots: [
        { key: 'turn-1', value: 'upload + resize -> file_id', active: true },
        { key: 'turn-2..N', value: 'reuse cached file_id', active: true },
        { key: 'offload', value: 'historical image offload event', active: true },
      ],
    },
    {
      icon: MemoryCategoryIcon,
      badge: '03 · 1M BUDGETING',
      command: 'compaction.check({ tokensUsed: 184200, window: 1000000 })',
      metric: 'evidence over repo dumps',
      traceLines: [
        'system + tools: 14.2k tokens',
        'targeted file slices + diffs: 48.0k tokens',
        'deduplicated screenshots (2 kept, 8 dropped): 6.4k tokens',
      ],
      slots: [
        { key: 'targeted read', value: '68.6k / 1M (low latency)', active: true },
        { key: 'image dedup', value: 'counted in compaction', active: true },
        { key: 'headroom', value: '384k max output preserved', active: true },
      ],
    },
    {
      icon: ApprovedIcon,
      badge: '04 · SEPTEMBER BRIDGE',
      command: 'model: "deepseek-flash" // V4.1-Flash (Sept 2026+)',
      metric: 'vision folded into Flash',
      traceLines: [
        'Aug 2026: deepseek-v4-flash-vision-exp sidecar',
        'Sep 2026: deepseek-flash unifies text + native vision',
        'deepseek-v4-pro (0813) remains heavy reasoning SKU',
      ],
      slots: [
        { key: 'fast + vision', value: 'deepseek-flash', active: true },
        { key: 'deep reasoning', value: 'deepseek-v4-pro', active: true },
        { key: 'catalog score', value: 'flags stale model strings', active: true },
      ],
    },
  ],
  'hub-omni-delivery': [
    {
      icon: SearchIcon,
      badge: '01 · SHARED SOURCE',
      command: 'GET /api/v1/scoring & content/{docs,blog}/**/*.mdx',
      metric: '1 source tree · 6 locales',
      traceLines: [
        'taxonomy: bundle | skill | agent-preset | profile',
        'retired 301s: mcp-server, hook-bridge -> /browse',
        'scoring table: live fetch from GET /api/v1/scoring',
      ],
      slots: [
        { key: 'kinds', value: '4 loadable Harness kinds', active: true },
        { key: 'locales', value: 'en · zh-CN · zh-TW · ja · ko · ru', active: true },
        { key: 'search', value: '/docs/search (Fumadocs)', active: false },
      ],
    },
    {
      icon: CliIcon,
      badge: '02 · TERMINAL CLI',
      command: '$ npx @dsh-fish/cli find browser && npx @dsh-fish/cli show <id>',
      metric: '$DSH_HOME/.dsh-fish-token.json',
      traceLines: [
        'device grant: browser Authorize -> polls token (0600)',
        'resolves identical install plan to web UI',
        'build scripts require explicit --allow-build-scripts',
      ],
      slots: [
        { key: 'cli verbs', value: 'find · show · add · list · rate', active: true },
        { key: 'lockfile', value: '$DSH_HOME/.dsh-fish-lock.json', active: true },
        { key: 'guard', value: '--allow-build-scripts gate', active: true },
      ],
    },
    {
      icon: BundleIcon,
      badge: '03 · IN-SESSION HUB',
      command: 'hub_search({ query: "worktree" }) -> hub_install({ id })',
      metric: '@dsh-fish/hub Cordis plugin',
      traceLines: [
        'runs inside live DeepSeek Harness session',
        'registers settings via plugin settings client',
        'applies plan to active profile without leaving chat',
      ],
      slots: [
        { key: 'package', value: '@dsh-fish/hub (npm 11 trusted)', active: true },
        { key: 'tools', value: 'hub_search · hub_show · hub_install', active: true },
        { key: 'reviews', value: 'hub_rate (installed artifacts)', active: true },
      ],
    },
    {
      icon: AgentIcon,
      badge: '04 · AGENT DELIVERY',
      command: '$ curl -H "Accept: text/markdown" https://dsh.fish/blog/index.md',
      metric: '/llms.txt · /docs/llms-full.txt',
      traceLines: [
        'Accept: text/markdown returns raw MDX / generated list',
        '/blog/llms.txt & /blog/feed.xml built from same source',
        '404 with Accept: text/markdown returns recovery map',
      ],
      slots: [
        { key: 'origin map', value: '/llms.txt & /openapi.json', active: true },
        { key: 'guides map', value: '/docs/llms.txt & .md routes', active: true },
        { key: 'blog map', value: '/blog/llms.txt & /blog/feed.xml', active: true },
      ],
    },
  ],
  'harness-sidebar-hands': [
    {
      icon: SessionCategoryIcon,
      badge: '01 · v0.1.5 SIDEBAR',
      command: 'slot: "sidebar.panellist" | "main/conversation"',
      metric: 'Session V3 · SessionHandle lock',
      traceLines: [
        'Right Sidebar replaces Detail panel (tabs + split pane)',
        'Previews: Markdown, PDF, HTML, images, subagent files',
        'Default model: deepseek-flash (dynamic prompt KV cache)',
      ],
      slots: [
        { key: 'sidebar', value: 'multi-tab split preview', active: true },
        { key: 'session v3', value: 'single-process SessionHandle', active: true },
        { key: 'plugin api', value: 'agent.inbox (ctx.agent removed)', active: true },
      ],
    },
    {
      icon: BrowserCategoryIcon,
      badge: '02 · v0.1.6 HANDS',
      command: 'ctx.browserUse · ctx.computerUse · SSH remote workspace',
      metric: 'local UI, remote execution',
      traceLines: [
        'SSH workspace: file, bash, and PTC run on remote host',
        'Browser Use: stagehand_act, stagehand_extract, Playwright',
        'Node PTC: isolated process, empty env, 120s–600s timeout',
      ],
      slots: [
        { key: 'ssh', value: 'remote workspace over SSH', active: true },
        { key: 'browser', value: 'Stagehand + Playwright MCP', active: true },
        { key: 'computer', value: 'Cua Driver MCP / native', active: true },
      ],
    },
    {
      icon: ToolsCategoryIcon,
      badge: '03 · v0.1.7 MESSAGES & CRON',
      command: '$ dsh --dump-config-schema # Session V4 + Messages only',
      metric: 'https://api.deepseek.com/anthropic',
      traceLines: [
        'Official adapter: Messages protocol only (protocol key gone)',
        'Agent presets become Cordis bundles; settings in profile',
        'Office previews (XLSX/DOCX/PPTX) + 1-min schedule_create',
      ],
      slots: [
        { key: 'protocol', value: 'Messages only + Files API', active: true },
        { key: 'presets', value: 'packaged as Cordis bundles', active: true },
        { key: 'schedules', value: 'schedule_create (1-min min)', active: true },
      ],
    },
    {
      icon: MarketCategoryIcon,
      badge: '04 · v0.2.0–0.2.1 PLATFORM',
      command: 'ctx.pluginMarket · engines.dsh · working_directory({ cd })',
      metric: 'dsh-v0.2.1-rc.3 (Oct 2026)',
      traceLines: [
        'Desktop menu bar: "Manage dsh command" (no Node needed)',
        'Custom plugin index URLs + dependency sync + hot reload',
        'New seams: working_directory, DSH_AGENTS_HOME, /compact',
      ],
      slots: [
        { key: 'market', value: 'custom plugin index sources', active: true },
        { key: 'ptc node', value: 'persistent-in-memory REPL', active: true },
        { key: 'deploy', value: '--public-url · --tls-cert/key', active: true },
      ],
    },
  ],
  'v4-1-flash-search': [
    {
      icon: MemoryCategoryIcon,
      badge: '01 · KV CACHE 1/4 HBM',
      command: 'model: "deepseek-flash" // 552B MoE (8B in / 16B out)',
      metric: '1/4 HBM · 1/8 SSD footprint',
      traceLines: [
        'Causal Encoder-Decoder slashes KV cache memory by 75%',
        'Native multimodal vision built into deepseek-flash',
        'deepseek-v4-flash-vision-exp retired and auto-routed',
      ],
      slots: [
        { key: 'kv hbm', value: '25% of V4 footprint', active: true },
        { key: 'kv ssd', value: '12.5% of V4 footprint', active: true },
        { key: 'modality', value: 'unified text + vision', active: true },
      ],
    },
    {
      icon: WorkflowCategoryIcon,
      badge: '02 · WARM CACHE UPDATES',
      command: 'ctx.systemPrompt.update() + ctx.tools.register()',
      metric: '0 cold cache resets',
      traceLines: [
        'v0.1.5: in-history system prompt updates keep KV prefix',
        'v0.1.7-rc.2: dynamic tool additions preserve KV cache',
        'pi-ai 1.0.2 routes capability-aware dynamic updates',
      ],
      slots: [
        { key: 'prompt update', value: 'appended in-history (cache hit)', active: true },
        { key: 'tool toggle', value: 'preserves warm KV prefix', active: true },
        { key: 'v4-pro', value: 'deepseek-v4-pro-0813 stays live', active: true },
      ],
    },
    {
      icon: SearchIcon,
      badge: '03 · NATIVE SEARCH & FETCH',
      command: 'POST https://api.deepseek.com/v1/tools/{search,fetch}',
      metric: '$0.75 / 1k successful calls',
      traceLines: [
        'Backed by DeepSeek search index (Search 100 QPS, Fetch 25 QPS)',
        'Empty results, timeouts, and errors are not billed',
        'Free server-side in Harness through 2026-10-31 16:00 UTC',
      ],
      slots: [
        { key: 'package', value: '@deepseek-ai/dsh-web-deepseek-api', active: true },
        { key: 'ori_question', value: '128-char user intent hint', active: true },
        { key: 'billing', value: 'HTTP 200 non-empty results only', active: true },
      ],
    },
    {
      icon: ApprovedIcon,
      badge: '04 · 1017 PARETO SNAPSHOT',
      command: '$ npx @deepseek-ai/dsh@0.2.1-rc.3 web',
      metric: 'DeepSeek-V4.1-Flash-1017',
      traceLines: [
        'Shorter output tokens + faster end-to-end task completion',
        'Tuned for DeepSeek Harness 0.2.1-rc.1+, CodeBuddy, WorkBuddy',
        'v0.2.1-rc.3 unifies API-key and account model list refresh',
      ],
      slots: [
        { key: 'snapshot', value: 'DeepSeek-V4.1-Flash-1017', active: true },
        { key: 'harness', value: 'requires >= 0.2.1-rc.1', active: true },
        { key: 'weights', value: 'Hugging Face & ModelScope', active: true },
      ],
    },
  ],
  'deepseek-bot-arena': [
    {
      icon: AgentIcon,
      badge: '01 · SESSION VS BOT',
      command: '$ dsh plugin --profile web add ds-bot | @botharness/tobs',
      metric: '0 forks of deepseek-harness',
      traceLines: [
        'Harness session = 1 task + 1 workspace + 1 event log',
        'Bot bundle = persistent identity + memory + group/IM routing',
        'Both projects mount as standard Cordis bundles on dsh-base',
      ],
      slots: [
        { key: 'runtime', value: 'official @deepseek-ai/dsh', active: true },
        { key: 'ds-bot', value: 'Fei2411/DS-Bot (Apache-2.0)', active: true },
        { key: 'tobs', value: 'BotHarness/DeepSeekBot (MIT)', active: true },
      ],
    },
    {
      icon: SessionCategoryIcon,
      badge: '02 · DS BOT TEAM & CHIEF',
      command: 'message_bot({ target: "@Reviewer", idempotentKey: "pr-42" })',
      metric: 'ds-bot v0.2.2 · ~/.dsh/bot',
      traceLines: [
        'Chief bot creates & manages specialist bots via chat',
        'Group admin answers first; @Name hands off; members can [PASS]',
        'Context steward + SQLite FTS5 (read_own_chat) replaces compaction',
      ],
      slots: [
        { key: 'orchestration', value: 'Chief + Group Admin + [PASS]', active: true },
        { key: 'memory & search', value: 'Markdown + SQLite FTS5 index', active: true },
        { key: 'browser & secrets', value: 'per-bot Playwright + mode 600', active: true },
      ],
    },
    {
      icon: GitCategoryIcon,
      badge: '03 · TOBS PERSONABOT',
      command: '$ git -C ~/.dsh/botharness/bots/ada log -n 2 SOUL.md MEMORY.md',
      metric: '@botharness/tobs v1.5.2',
      traceLines: [
        'Orchestrator Session dispatches work to Assignment Sessions',
        'Git-versioned SOUL.md & MEMORY.md (reviewable, revertible)',
        'Each PersonaBot binds its own Feishu/Slack/WeChat/Discord identity',
      ],
      slots: [
        { key: 'sessions', value: '1 Orchestrator -> N Assignments', active: true },
        { key: 'memory', value: 'Git-backed SOUL.md & MEMORY.md', active: true },
        { key: 'channels', value: 'Feishu · Slack · WeChat · Tobs Connect', active: true },
      ],
    },
    {
      icon: SecureIcon,
      badge: '04 · IM BRIDGES & ACP',
      command: '$ dsh plugin --profile web add -w @xmanrui/dsh-im',
      metric: 'choose the right layer',
      traceLines: [
        '@xmanrui/dsh-im: routes 9 IM apps into existing host sessions',
        'ds-bot: local team chat + per-bot browser in one desktop app',
        '@botharness/tobs: persistent colleagues across IM + Git memory',
      ],
      slots: [
        { key: 'dsh-im', value: '9 IM channels -> host session', active: true },
        { key: 'dsh --profile acp', value: 'official stdio JSON-RPC automation', active: true },
        { key: 'trust boundary', value: 'bots spend your quota & permissions', active: true },
      ],
    },
  ],
}

interface StructureNodeSpec {
  readonly tag: string
  readonly code: string
  readonly bullets: readonly string[]
  readonly focal?: boolean
}

const STRUCTURE_SPECS: Record<
  BlogStructureDiagramId,
  readonly [StructureNodeSpec, StructureNodeSpec, StructureNodeSpec]
> = {
  'plugin-composition': [
    {
      tag: '01 · ARTIFACT & PLAN',
      code: '$DSH_HOME/.dsh-fish-lock.json',
      bullets: [
        'bundle: package.json -> dsh.bundle.patch',
        'skill: $DSH_HOME/skills/<name>/SKILL.md',
        'agent-preset: .agent-presets/<id>/agent.cordis.yml',
        'profile: ordered dsh.profile.bundles list',
      ],
    },
    {
      tag: '02 · CORDIS LAYER STACK',
      code: 'profiles/<name>/cordis.patch.yml',
      bullets: [
        'Layer 1: @deepseek-ai/dsh-base + profile bundles',
        'Layer 2: profile cordis.patch.yml overrides',
        'Layer 3: $DSH_HOME/cordis.patch.yml + --patch',
        'Reversible effects on ctx.tools, ctx.llm, ctx.sessions',
      ],
      focal: true,
    },
    {
      tag: '03 · SCOPED SESSION',
      code: 'dsh --profile <name>',
      bullets: [
        'Single-process SessionHandle lock',
        'Append-only session.v4.jsonl.zstd event log',
        'Permission preset: workspace-write by default',
        'API keys stay local in $DSH_HOME/.credentials.yaml',
      ],
    },
  ],
  'harness-request-path': [
    {
      tag: '01 · UNIFIED LAUNCH',
      code: 'dsh --profile {web|headless|sdk|acp}',
      bullets: [
        'Web, Headless, Python SDK, and ACP boot a Profile',
        'Parent session authorizes subagent model & effort',
        'Code Mode renamed to PTC mode (run_code)',
        '@Remote gateway replaces retired ApiProxy',
      ],
    },
    {
      tag: '02 · OFFICIAL ADAPTER',
      code: 'https://api.deepseek.com/anthropic',
      bullets: [
        'Attaches enabled plugin package names + versions',
        'Opt-in incremental session-log upload channel',
        'Models page exposes plugin OAuth sign-in slot',
        'Public WebFetch default-on with SSRF protection',
      ],
      focal: true,
    },
    {
      tag: '03 · STREAM SEPARATION',
      code: '1>result.txt 2>progress.log',
      bullets: [
        'stderr (fd 2): live tool traces & step progress',
        'stdout (fd 1): clean final output for scripts',
        'Remote Web UI requires one-time launch URL token',
        'SAFETY.md: preview runtime, not security-audited',
      ],
    },
  ],
  'v4-adapter-timeline': [
    {
      tag: '01 · V4 MODEL FAMILY',
      code: 'deepseek-v4-pro · deepseek-v4-flash',
      bullets: [
        '1M token context window as standard default',
        'DeepSeek Sparse Attention (DSA) + compression',
        'V4-Pro: 1.6T total / 49B active parameters',
        'deepseek-chat & deepseek-reasoner retired July 24',
      ],
    },
    {
      tag: '02 · HARNESS ADAPTER',
      code: 'Files API + Vision + Compaction',
      bullets: [
        'v0.1.0-rc.8: native image prompts (/goal, /plan, @)',
        'v0.1.1-rc.1: deepseek-v4-flash-vision-exp',
        'v0.1.1-rc.2: Files API upload reuse & auto-resize',
        'v0.1.2-alpha.1: images counted in session compaction',
      ],
      focal: true,
    },
    {
      tag: '03 · V4.1 UNIFICATION',
      code: 'deepseek-flash (V4.1-Flash-1017)',
      bullets: [
        'Sept 10: native vision folded into deepseek-flash',
        'KV cache cut to 1/4 HBM and 1/8 SSD vs V4',
        'Oct 17: 1017 snapshot + /v1/tools/{search,fetch}',
        'deepseek-v4-pro-0813 remains heavy reasoning SKU',
      ],
    },
  ],
  'hub-surfaces': [
    {
      tag: '01 · CANONICAL SOURCES',
      code: 'Catalog DB + Fumadocs MDX',
      bullets: [
        '4 verified artifact kinds (bundle, skill, preset, profile)',
        'Build-time MDX in 6 locales (docs + editorial blog)',
        'Live scoring weights from GET /api/v1/scoring',
        'Retain-until-replaced localized README prose',
      ],
      focal: true,
    },
    {
      tag: '02 · HUMAN & CLI CLIENTS',
      code: '@dsh-fish/cli · @dsh-fish/hub',
      bullets: [
        'Browser UI at /browse, /docs, and /blog',
        'CLI: npx @dsh-fish/cli {find,show,add,list,rate}',
        'In-session plugin: @dsh-fish/hub (hub_search, hub_install)',
        'Shared lockfile: $DSH_HOME/.dsh-fish-lock.json',
      ],
    },
    {
      tag: '03 · AGENT PROTOCOLS',
      code: 'Accept: text/markdown · /llms.txt',
      bullets: [
        '/llms.txt, /docs/llms.txt, /docs/llms-full.txt',
        '/blog/llms.txt, /blog/feed.xml, and *.md mirrors',
        '/openapi.json & /.well-known/api-catalog',
        'Markdown 404 recovery map for autonomous agents',
      ],
    },
  ],
  'harness-v0-2-1-architecture': [
    {
      tag: '01 · WORKSPACE & UI SEAMS',
      code: 'sidebar.panellist · working_directory',
      bullets: [
        'v0.1.5: Multi-tab Right Sidebar replaces Detail panel',
        'v0.1.7: Read-only Office (XLSX/DOCX/PPTX) & PDF preview',
        'v0.2.0-rc.2: Desktop menu-bar dsh CLI installer',
        'v0.2.1: working_directory tool & DSH_AGENTS_HOME',
      ],
    },
    {
      tag: '02 · EXECUTION & PROTOCOL',
      code: 'Messages API · SSH · Browser Use',
      bullets: [
        'v0.1.6: SSH remote workspace (local UI, remote tools)',
        'v0.1.6: Experimental Browser Use (Stagehand/Playwright)',
        'v0.1.7: Official adapter locks onto Messages API only',
        'v0.2.1: Node PTC persistent-in-memory REPL mode',
      ],
      focal: true,
    },
    {
      tag: '03 · LIVE PLUGIN PLATFORM',
      code: 'ctx.pluginMarket · engines.dsh',
      bullets: [
        'v0.1.7: Agent presets packaged as Cordis bundles',
        'v0.1.7: Settings stored inside profile plugin config',
        'v0.2.1: Custom plugin index URLs & dependency sync',
        'v0.2.1: Claude Code Mods compatibility experiment',
      ],
    },
  ],
  'v4-1-flash-pipeline': [
    {
      tag: '01 · CAUSAL ENCODER-DECODER',
      code: '552B MoE (8B In / 16B Out)',
      bullets: [
        'KV cache footprint drops to 1/4 HBM and 1/8 SSD',
        'Single model string: deepseek-flash',
        'Native multimodal vision (no vision-exp sidecar)',
        '1017 snapshot reduces output tokens & task time',
      ],
      focal: true,
    },
    {
      tag: '02 · CACHE-SAFE MUTATIONS',
      code: 'In-History Prompts & Dynamic Tools',
      bullets: [
        'v0.1.5: Mid-session system prompt updates keep KV cache',
        'v0.1.7-rc.2: Enabling tools dynamically preserves cache',
        'Files API reuses uploaded image ids across turns',
        'spill-policy budgets tool outputs in maxInlineTokens',
      ],
    },
    {
      tag: '03 · BUILT-IN SEARCH & FETCH',
      code: '@deepseek-ai/dsh-web-deepseek-api',
      bullets: [
        'POST /v1/tools/search (100 QPS) & /v1/tools/fetch (25 QPS)',
        '$0.75 / 1,000 successful non-empty HTTP 200 calls',
        'ori_question passes 128-char user intent context',
        'Free inside DeepSeek Harness until Nov 1, 2026 (BJT)',
      ],
    },
  ],
  'deepseek-bot-ecosystem': [
    {
      tag: '01 · DS BOT (FEI2411/DS-BOT)',
      code: 'npx @deepseek-ai/dsh plugin add ds-bot',
      bullets: [
        'Chief bot creates & manages specialist bots via chat',
        'Group chats: admin answers first, @Name handoff, [PASS]',
        'Context steward + SQLite FTS5 (read_own_chat)',
        'Per-bot Playwright browser & ~/.dsh/bot/secrets.json',
      ],
    },
    {
      tag: '02 · TOBS (@BOTHARNESS/TOBS)',
      code: 'Plugins -> Add @botharness/tobs@1.5.2',
      bullets: [
        'PersonaBot with 1 Orchestrator -> N Assignment sessions',
        'Git-versioned SOUL.md & MEMORY.md per colleague',
        'Dedicated bot identities on Feishu, Slack, WeChat, QQ',
        'Tobs Connect phone pairing & Bot Marketplace',
      ],
      focal: true,
    },
    {
      tag: '03 · IM BRIDGES & ACP',
      code: '@xmanrui/dsh-im · dsh --profile acp',
      bullets: [
        '@xmanrui/dsh-im: connects 9 chat apps to host sessions',
        'dsh-lark-bot / dsh-lark: WebSocket Feishu bridges',
        'dsh --profile acp: official JSON-RPC stdio automation',
        'All run on user quota & workspace permissions',
      ],
    },
  ],
}

export interface BlogMockUiProps {
  readonly scene: BlogMockSceneId
  readonly eyebrow: string
  readonly title: string
  readonly caption: string
  readonly step1Title: string
  readonly step1Body: string
  readonly step2Title: string
  readonly step2Body: string
  readonly step3Title: string
  readonly step3Body: string
  readonly step4Title: string
  readonly step4Body: string
}

export function BlogMockUi({
  scene,
  eyebrow,
  title,
  caption,
  step1Title,
  step1Body,
  step2Title,
  step2Body,
  step3Title,
  step3Body,
  step4Title,
  step4Body,
}: BlogMockUiProps) {
  const frames = SCENE_FRAMES[scene] ?? SCENE_FRAMES['profile-composer']
  const steps = [
    { title: step1Title, body: step1Body, frame: frames[0] },
    { title: step2Title, body: step2Body, frame: frames[1] },
    { title: step3Title, body: step3Body, frame: frames[2] },
    { title: step4Title, body: step4Body, frame: frames[3] },
  ] as const

  const [activeIndex, setActiveIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused) return
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return
    }
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % 4)
    }, 3800)
    return () => window.clearInterval(timer)
  }, [paused])

  const current = steps[activeIndex] ?? steps[0]
  const FrameIcon = current.frame.icon

  return (
    <figure
      className="my-8 overflow-hidden rounded-xl border border-border bg-card"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/50 px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            aria-hidden="true"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border-strong bg-card text-foreground"
          >
            <FrameIcon weight={ICON_WEIGHT.LABEL} className="size-3.5" />
          </span>
          <div className="min-w-0">
            <p className="m-0 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              {eyebrow}
            </p>
            <p className="m-0 truncate text-sm font-semibold text-foreground">
              {title}
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 font-mono text-xs text-muted-foreground">
          {current.frame.metric}
        </span>
      </div>

      <div className="grid gap-0 lg:grid-cols-12">
        <div
          role="tablist"
          aria-label={title}
          className="flex flex-col justify-between border-b border-border bg-muted/20 p-3 lg:col-span-5 lg:border-r lg:border-b-0"
        >
          <div className="space-y-1.5">
            {steps.map((step, idx) => {
              const isSelected = idx === activeIndex
              const StepGlyph = step.frame.icon
              return (
                <button
                  key={step.frame.badge}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => {
                    setActiveIndex(idx)
                    setPaused(true)
                  }}
                  className={cn(
                    'press flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-[transform,opacity,background-color,border-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]',
                    isSelected
                      ? 'border-border-strong bg-card font-semibold text-foreground'
                      : 'border-transparent bg-transparent font-normal text-muted-foreground hover:border-border hover:bg-card/60 hover:text-foreground',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-xs font-mono',
                      isSelected
                        ? 'bg-primary text-primary-foreground font-semibold'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {isSelected ? (
                      <ConfirmIcon weight={ICON_WEIGHT.LABEL} className="size-3" />
                    ) : (
                      idx + 1
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-1">
                      <span className="truncate text-xs font-semibold">
                        {step.title}
                      </span>
                      <StepGlyph
                        weight={isSelected ? ICON_WEIGHT.ACTIVE : ICON_WEIGHT.BODY}
                        className="size-3.5 shrink-0"
                      />
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed font-normal text-muted-foreground">
                      {step.body}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div
          role="tabpanel"
          className="flex flex-col justify-between p-4 lg:col-span-7"
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded bg-accent px-2 py-0.5 font-mono text-[11px] font-semibold text-accent-foreground">
                {current.frame.badge}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {activeIndex + 1} / 4
              </span>
            </div>

            <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">
              <p className="m-0 break-all font-semibold text-foreground">
                {current.frame.command}
              </p>
              <ul className="mt-2.5 mb-0 list-none space-y-1.5 ps-0">
                {current.frame.traceLines.map((line, lineIdx) => (
                  <li
                    key={line}
                    style={{ transitionDelay: `${lineIdx * 45}ms` }}
                    className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
                  >
                    <ForwardIcon
                      weight={ICON_WEIGHT.LABEL}
                      className="mt-1 size-3 shrink-0 text-foreground"
                    />
                    <span className="break-all">{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {current.frame.slots.map((slot) => (
              <div
                key={slot.key}
                className={cn(
                  'rounded-lg border px-2.5 py-2 transition-[transform,opacity,border-color,background-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]',
                  slot.active
                    ? 'border-border-strong bg-accent/50 font-semibold text-foreground'
                    : 'border-border bg-card font-normal text-muted-foreground',
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground">
                    {slot.key}
                  </span>
                  {slot.active ? (
                    <ConfirmIcon
                      weight={ICON_WEIGHT.LABEL}
                      className="size-3 shrink-0 text-foreground"
                    />
                  ) : null}
                </div>
                <p className="mt-1 mb-0 break-all font-mono text-[11px] leading-snug">
                  {slot.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <figcaption className="border-t border-border bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  )
}

export interface BlogStructureMapProps {
  readonly diagram: BlogStructureDiagramId
  readonly eyebrow: string
  readonly title: string
  readonly caption: string
  readonly node1Title: string
  readonly node1Body: string
  readonly node2Title: string
  readonly node2Body: string
  readonly node3Title: string
  readonly node3Body: string
}

export function BlogStructureMap({
  diagram,
  eyebrow,
  title,
  caption,
  node1Title,
  node1Body,
  node2Title,
  node2Body,
  node3Title,
  node3Body,
}: BlogStructureMapProps) {
  const specs = STRUCTURE_SPECS[diagram] ?? STRUCTURE_SPECS['plugin-composition']
  const nodes = [
    { title: node1Title, body: node1Body, spec: specs[0] },
    { title: node2Title, body: node2Body, spec: specs[1] },
    { title: node3Title, body: node3Body, spec: specs[2] },
  ] as const

  return (
    <figure className="my-8 overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/40 px-4 py-3">
        <p className="m-0 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
          {eyebrow}
        </p>
        <p className="mt-0.5 mb-0 text-sm font-semibold text-foreground">
          {title}
        </p>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-3">
        {nodes.map((node, index) => (
          <div
            key={node.spec.tag}
            className={cn(
              'relative flex flex-col justify-between rounded-lg border p-3.5',
              node.spec.focal
                ? 'border-border-strong bg-accent/40'
                : 'border-border bg-muted/20',
            )}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase',
                    node.spec.focal
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : 'border border-border bg-card font-medium text-muted-foreground',
                  )}
                >
                  {node.spec.focal ? (
                    <ConfirmIcon weight={ICON_WEIGHT.LABEL} className="size-2.5" />
                  ) : null}
                  {node.spec.tag}
                </span>
                {index < nodes.length - 1 ? (
                  <ForwardIcon
                    weight={ICON_WEIGHT.LABEL}
                    className="hidden size-3.5 text-muted-foreground lg:inline-block"
                  />
                ) : null}
              </div>

              <p className="mt-2.5 mb-1 text-sm font-semibold text-foreground">
                {node.title}
              </p>
              <p className="m-0 text-xs leading-relaxed text-muted-foreground">
                {node.body}
              </p>
            </div>

            <div className="mt-3 border-t border-border pt-2.5">
              <p className="m-0 rounded bg-card px-2 py-1 font-mono text-[11px] font-medium text-foreground">
                {node.spec.code}
              </p>
              <ul className="mt-2 mb-0 list-none space-y-1 ps-0">
                {node.spec.bullets.map((bullet) => (
                  <li
                    key={bullet}
                    className="flex items-start gap-1.5 font-mono text-[11px] leading-snug text-muted-foreground"
                  >
                    <span aria-hidden="true" className="text-foreground">
                      ·
                    </span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      <figcaption className="border-t border-border bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  )
}
