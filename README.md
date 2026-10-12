# Roleplay Studio

**A self-hosted, multi-provider AI roleplay, character-creation and interactive-storytelling studio.**

Roleplay Studio is a web app for creating characters, building fictional worlds and running
persistent AI-assisted roleplay sessions. It is a single Next.js application backed by a
PostgreSQL database **that you own**: bring your own database and your own AI provider keys, and
you get a completely empty, working studio.

It ships with **no demo content**. There are no seeded characters, no sample lorebook, no default
connection and no default chat session — a fresh install opens on empty screens that guide you to
create your first character and add your first AI connection. Nothing is written to your database
until you actually create something (the one exception is the single `settings` row, created on
first load to hold your global preferences).

## Features

**Characters & roleplay**

- Character sheets with name, avatar, personality/character details, scenario & world context,
  first message, alternate greetings, example dialogue, creator notes, tags, SFW/NSFW flag, a
  per-character context block, a per-character system-prompt override and post-history instructions.
- Per-character chat backgrounds with adjustable blur and opacity.
- Character card import/export, including Tavern (chara_card_v2/v3) cards and SillyTavern
  world-info files, plus a portable JSON bundle of character + lorebooks + sessions.
- Two modes: **Roleplay** (in character) and **Assistant** (a plain general-purpose chat).

**Story memory & lorebooks**

- Multiple chat sessions per character, each with its own history.
- **Story memory**: an AI-written, editable narrative summary of the story so far, with custom
  summary instructions and optional auto-summarisation every *N* new messages.
- **Lorebooks**: keyword-triggered world-info entries with secondary (AND) keywords, constant
  (always-on) entries, case sensitivity, priority ordering and a per-entry enable toggle. Entries
  are scanned against the recent chat window and inserted into the prompt inside a token budget.
  Lorebooks can be attached to characters.
- Context budgeting: pinned character instructions can never be evicted, history and lore are
  trimmed to fit the connection's context size, and the live token breakdown is shown in the chat.

**Personas**

- Multiple reusable roleplayer identities (name + description). The active persona replaces the
  `{{user}}` macro across every prompt; personas can be saved, edited, switched and deleted.

**Many AI providers**

Every provider is just a *connection* you add in Settings. Built-in presets:

- OpenAI-compatible APIs (OpenAI, OpenRouter, DeepSeek, Mistral, Groq, Together, and any custom
  OpenAI-compatible endpoint such as KoboldCpp, Oobabooga, LM Studio or Ollama)
- Anthropic (Claude)
- Google Gemini
- **AI Horde** — free, community-powered generation, with a dedicated queue card showing queue
  position, estimated wait, elapsed time and processing state, plus an optional
  "trusted/anonymous key" and multi-model list.

Per connection: base URL, API key, model, temperature, max tokens, top-p, frequency/presence
penalties, context size and extra headers. Keys are stored server-side and are **never** returned to
the browser — the UI only ever learns whether a key is saved.

**Scene images**

- Generate a temporary illustration of the current scene from recent turns, the character, the
  scenario and your persona, using a chosen image connection, model and aspect ratio.
- Scene images are **not** persisted: they are returned to the browser for preview/download and
  never stored in the database.

**AI Writer**

A dedicated writer endpoint that generates the content of exactly one character/lorebook field at a
time (name, personality, scenario, greeting, example dialogue, context block, lorebook entry,
lorebook keywords, system prompt, creator notes) with strict per-field scope rules.

**Chat tools**

- Send, regenerate, continue, elaborate, impersonate (draft your own reply), edit and delete
  messages, delete-from-here, and checkpoints you can revert to.
- Streaming responses (toggleable) and a Stop button; AI Horde requests can be cancelled while
  queued or processing.

**Security & PWA**

- The whole app — every page, every `/api/*` route — is gated behind a single app password
  (`APP_PASSWORD`) with a signed, `httpOnly` session cookie, constant-time password comparison and
  brute-force lockout. Unauthenticated API calls get `401`; pages redirect to `/login`.
- Installable as a PWA (web app manifest + service worker). The service worker caches nothing and
  never touches `/api/*` or `/login`.

## Requirements

- Node.js 20 or newer, and npm
- A PostgreSQL database you control (Neon's free tier is plenty)
- One or more AI provider credentials — or a free AI Horde connection, which needs no key

## Self-hosting in five minutes

### 1. Fork and clone

Fork this repository on GitHub, then clone your fork:

```bash
git clone <your-fork-url> roleplay-studio
cd roleplay-studio
```

### 2. Create your own database

Create a **free PostgreSQL database of your own** — for example a free Neon project (Neon, like most
providers, has its own free-tier limits: project count, storage, compute hours and cold starts).
Any Postgres will do, as long as *you* control it.

### 3. Configure your environment

Copy the committed template and fill it in:

```bash
cp env.example .env
```

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | Your own Postgres connection string (Neon gives you one; keep `?sslmode=require`). |
| `APP_PASSWORD` | The password for **your** deployment's login screen. Any long random string. It also signs your session cookies, so changing it logs everyone out. |

`.env` (and `.env.local`) are git-ignored. The template is committed as `env.example` so it can
never be confused with a live secret file. Never commit real credentials.

`npm run db:push` reads `.env` and `.env.local`, so either filename works.

### 4. Install and create the schema

```bash
npm install
npm run db:push
```

`db:push` creates every table and column the app uses (connections, settings, personas, characters,
lorebooks, lorebook entries, character↔lorebook links, chats, messages and checkpoints). It is
idempotent and safe to re-run. It only ever touches the database in *your* `DATABASE_URL`.

If you skip this step the app still starts, but every screen shows
**"Database is empty. Run npm run db:push once against your database."** — so you can't get stuck
wondering why nothing works.

### 5. Run it

```bash
npm run dev
```

Open `http://localhost:3000`, sign in with `APP_PASSWORD`, then go to
**Settings → Connections → + Add** and add your own AI provider (or pick **AI Horde** for a
free, key-less option). Now create a character or switch to **Assistant** and start writing.

With no connection configured, the chat screen tells you **"Add a connection in Settings first."**

## Deploying your own instance (Vercel)

1. Push your fork and import it into your own Vercel account.
2. Add the environment variables `DATABASE_URL` and `APP_PASSWORD` to your Vercel project
   (Production, and Preview if you use previews).
3. **Run `npm run db:push` once against that production database before the first deploy** —
   the first request otherwise lands on the empty-database screen.
4. Deploy. Any further deploys just need the two variables to stay in place.

There is nothing else to configure: no cron jobs, no seeding step, no external services.

## Please do not use someone else's deployment

The author's own live deployment is **private** and is not a public service. It is not an API, it is
not a backend for your app, and it must never be used as anyone's database, provider proxy or
storage. Your data belongs in *your* database and your keys belong in *your* deployment. Deploy your
own instance as described above.

## Provider and service limits

AI providers, hosting and database services each have their own quotas and terms:

- Neon (and other Postgres hosts) limit storage, compute time and concurrent projects on their free
  tiers, and databases may suspend when idle.
- Hosted AI providers (OpenAI, Anthropic, Google, OpenRouter, Groq, Mistral, Together, DeepSeek…)
  require your own account and may charge per token; free tiers are limited and change over time.
- Local model servers (KoboldCpp, Oobabooga, LM Studio, Ollama) must be reachable from wherever the
  app runs; a hosted deployment cannot reach `127.0.0.1` on your machine.
- AI Horde is community-powered and free, but queues can be long and model availability varies.

## Development

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run db:push` | Create/update the schema in `DATABASE_URL` |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm run lint` | ESLint |

### Project layout

```
src/app/api/*        Route handlers (characters, chats, messages, connections, settings,
                     personas, lorebooks, entries, export/import, generate, summarize,
                     writer, image, health, auth)
src/app/login        Login page
src/proxy.ts         App-password gate for every page and /api/* route
src/components/*     Studio shell, chat view, character editor, lorebook panel, settings, personas
src/db/schema.ts     Drizzle schema — the single source of truth for the database
src/lib/             auth, provider/LLM client, prompt builder, portable import/export, defaults
public/sw.js         No-cache service worker (PWA installability only)
```

## Data & privacy

- Characters, chats, messages, checkpoints, personas, lorebooks and your connections live in **your**
  PostgreSQL database. Provider API keys are stored in that database (in the `connections` table) and
  are never sent to the browser.
- Scene images are generated on request and returned directly to the browser; they are not stored.
- Prompts and recent conversation context are sent to whichever provider you configured. Review that
  provider's retention and training policies before sending sensitive text.

## License

No license is currently specified in this repository. Until one is added, do not assume the source
code may be reused, modified or redistributed.
