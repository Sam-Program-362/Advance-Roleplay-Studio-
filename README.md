# Roleplay Studio

**A multi-provider AI roleplay, character-creation, and interactive storytelling studio.**

Roleplay Studio is a web-based workspace for creating characters, building fictional worlds, and running persistent AI-assisted roleplay sessions. It brings together configurable AI connections, custom prompts, user personas, lorebooks, story summaries, and AI-assisted writing tools.

**Live app:** https://advance-roleplay-studio.vercel.app  
**GitHub repository:** https://github.com/Sam-Program-362/Advance-Roleplay-Studio-

## Features

### Character creation and roleplay

- Create and manage characters with personalities, scenarios, first messages, alternate greetings, example dialogue, creator notes, and custom instructions.
- Configure character-specific context blocks, system prompt overrides, and post-history instructions.
- Customize character avatars and chat backgrounds.
- Switch between character roleplay and standalone assistant conversations.
- Send messages, regenerate replies, continue responses, elaborate on a reply, and impersonate the active user persona.

### Story memory and lorebooks

- Keep conversation history in separate chat sessions.
- Generate and edit story summaries to help preserve important events and continuity.
- Customize summary instructions and configure automatic summarization.
- Create lorebooks for world facts, locations, characters, objects, and other contextual details.
- Use keyword-triggered entries, secondary keywords, constant entries, priorities, case-sensitivity options, and token budgets.
- Associate lorebooks with characters and include relevant entries in AI prompts.
- Budget context so character instructions, story memory, lore, and recent conversation can be considered together.

### Multiple personas

- Create, edit, delete, and switch between reusable roleplaying personas.
- Give each persona a name and description.
- Apply the active persona to prompts across the application.

### AI provider connections

Configure connections to supported services and compatible endpoints, including:

- OpenAI-compatible APIs
- Anthropic Claude
- Google Gemini
- DeepSeek
- Mistral AI
- Groq
- Together AI
- KoboldCpp / Oobabooga-compatible endpoints
- LM Studio / Ollama-compatible local endpoints
- AI Horde
- Custom OpenAI-compatible providers

Connection settings include provider endpoint, credentials, model, temperature, output-token limit, context size, sampling parameters, penalties, and extra headers where applicable. Actual capabilities, available models, access requirements, and pricing depend on the provider.

### AI Horde queue handling

- Submit asynchronous text-generation jobs to AI Horde.
- View queue position, estimated wait time, processing state, and elapsed time.
- Stop an active request where supported by the current queue workflow.
- Choose a specific model or provide multiple acceptable model names.
- Use a dedicated queue interface for Horde requests.

AI Horde relies on community-provided workers, so model availability and queue times can vary.

### Temporary scene-image generation

- Generate an illustration based on the current roleplay scene.
- Build image prompts from recent conversation turns, character details, scenario information, and the active persona.
- Configure the image connection, model, and aspect ratio.
- Preview or download a generated image.

Generated scene images are temporary in the current implementation and are not saved to the chat database. Image generation depends on the selected provider and its supported API features.

### AI Writer

Use the AI Writer to generate content for supported character and world-building fields, such as character names, personality details, scenarios, greetings, example dialogue, context instructions, and lorebook content. Field-specific instructions help keep generated text focused on the selected field.

### Chat management and data portability

- Manage separate character and assistant sessions.
- Edit messages and create or use conversation checkpoints.
- Import and export supported characters, lorebooks, and chat sessions.
- Use portable JSON-based files for supported data formats.

Import compatibility depends on the input file format and the data it contains.

### Installable web app

Roleplay Studio includes Progressive Web App (PWA) support through a web app manifest and service-worker registration. It can be installed from compatible browsers on supported mobile and desktop devices. Availability and behavior depend on the browser and platform.

## Technology stack

- **Framework:** Next.js 16
- **Language:** TypeScript
- **UI:** React 19 and Tailwind CSS 4
- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **Database driver:** `pg` (node-postgres)
- **Deployment:** Vercel
- **PWA:** Web app manifest and service worker

## Getting started

### Prerequisites

- A Node.js version compatible with the dependencies in `package.json`
- npm
- A PostgreSQL database
- Credentials for at least one supported AI provider, unless using a provider that does not require a personal key

### 1. Clone the repository

```bash
git clone https://github.com/Sam-Program-362/Advance-Roleplay-Studio-.git
cd Advance-Roleplay-Studio-
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure the database

Create a local `.env.local` file in the project root and set `DATABASE_URL` to your PostgreSQL connection string:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
```

Replace the placeholders with your actual database credentials. Ensure your PostgreSQL database has the base application schema before using the app. The application performs a small set of idempotent schema upgrades at startup, but this should not be treated as a replacement for setting up the base schema.

**Security:** Never commit `.env`, `.env.local`, database passwords, or private API credentials. Configure production secrets through your hosting provider's environment settings.

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 5. Add an AI connection

1. Open **Settings → Connections**.
2. Add a connection for your chosen provider.
3. Enter the endpoint, credentials, and model information required by that provider.
4. Test the connection when a test option is available.
5. Start an assistant conversation or create a character and begin roleplaying.

Some providers require paid API access. Local model endpoints must be reachable from the environment where the application is running. AI Horde availability and waiting times depend on its community workers.

## Development commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Build the application for production |
| `npm run start` | Start the production server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checking |

## Deployment

The hosted application uses Vercel. To deploy your own instance:

1. Fork or clone the repository.
2. Provision a PostgreSQL database and initialize the required schema.
3. Import the repository into Vercel.
4. Add `DATABASE_URL` to the required Vercel environment(s).
5. Deploy the application and check the deployment logs.
6. Configure AI provider connections in the app.

Keep database credentials and any other secrets out of source control. Verify that the production database is initialized and that the deployed app can read and write characters and chats.

## Data and privacy

- Characters, conversations, settings, personas, and lorebooks are stored in the application's PostgreSQL database.
- Scene-image generation is designed not to persist the generated image in the database.
- Configured AI providers receive the prompts and conversation context needed to process requests.
- Review each provider's privacy, retention, and data-handling policies before sending sensitive content.
- Keep database credentials and provider API keys secure.

## Project status

Roleplay Studio is an evolving project. Features, provider compatibility, and deployment requirements may change over time. Provider-specific capabilities may differ even when the application presents similar connection settings.

## Contributing and feedback

Bug reports, feature requests, and improvements can be submitted through [GitHub Issues](https://github.com/Sam-Program-362/Advance-Roleplay-Studio-/issues) and Pull Requests. When reporting a bug, include the steps to reproduce it, the expected behavior, the actual behavior, and any relevant non-sensitive error messages.

## License

No license is currently specified in this repository. Until a license is added, do not assume the source code is available for unrestricted reuse, modification, or redistribution.
