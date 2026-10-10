##Advance Roleplay Studio

A multi-provider AI roleplay, character-creation, and interactive storytelling studio.

Advance Roleplay Studio is a web-based AI workspace for creating characters, building fictional worlds, managing persistent roleplay sessions, and interacting with AI models through configurable provider connections. It combines character-focused storytelling tools with configurable prompts, lorebooks, personas, memory summaries, and AI-assisted writing.

Live app: https://advance-roleplay-studio.vercel.app
Source code: https://github.com/Sam-Program-362/Advance-Roleplay-Studio-

Features

🎭 Character Creation & Roleplay

- Create, edit, organize, favorite, and manage AI characters.
- Define character personalities, scenarios, first messages, alternate greetings, example dialogue, and creator notes.
- Configure dedicated context blocks, character-specific system prompts, and post-history instructions.
- Customize character avatars and chat backgrounds.
- Switch between character roleplay and a standalone assistant mode.
- Use generation actions to send messages, regenerate replies, continue responses, elaborate, and impersonate the user persona.

🧠 Story Memory & Lorebooks

- Maintain persistent chat transcripts and separate conversation sessions.
- Generate and edit story summaries to preserve important events and continuity.
- Customize memory-summary instructions and configure automatic summarization.
- Create lorebooks containing world facts, locations, characters, objects, and other contextual information.
- Use keyword-triggered lorebook entries, secondary keywords, constant entries, priorities, case-sensitivity settings, and token budgets.
- Associate lorebooks with characters and inject relevant lore into AI prompts.
- Use context budgeting to prioritize essential character instructions, story memory, lore, and recent conversation history.

👤 Multiple Personas

- Create and manage reusable user personas.
- Give each persona a name and description.
- Switch the active persona for roleplay sessions.
- Include the active persona's details in the generated prompt to improve continuity.

🔌 Multiple AI Providers

Configure connections to supported AI services and compatible endpoints, including:

- OpenAI-compatible APIs
- Anthropic Claude
- Google Gemini
- DeepSeek
- Mistral AI
- Groq
- Together AI
- KoboldCpp / Oobabooga
- LM Studio / Ollama-compatible local endpoints
- AI Horde
- Custom OpenAI-compatible providers

Connection settings include model selection where supported, API credentials, temperature, token limits, context size, sampling parameters, penalties, and extra headers.

Provider availability, supported models, API access, and pricing depend on the service you configure.

⏳ AI Horde Queue Handling

- Submit asynchronous text-generation requests to AI Horde.
- Display queue position, estimated wait time, processing status, and elapsed time.
- Cancel active generation requests where supported by the queue workflow.
- Use a dedicated queue interface instead of the ordinary streaming-generation indicator.
- Select specific Horde models or provide a list of acceptable models.

AI Horde relies on community-provided workers. Queue times, model availability, and generation speed can vary.

🖼️ Scene Image Generation

- Generate an illustration of the current roleplay scene.
- Build image prompts from recent conversation turns, character details, scenario information, and the active persona.
- Configure an image connection, model, and aspect ratio.
- Preview the generated image without adding it to the chat database.

Scene images are temporary in the current implementation; they are not saved as persistent chat records.

✍️ AI Writer

Generate content for individual character and world-building fields, including:

- Character names and personalities
- Scenarios and world context
- Greetings and example dialogue
- Character context instructions
- Lorebook entries and keyword suggestions
- Other supported character-sheet fields

The writer uses field-specific instructions to keep generated content focused on the selected field.

📦 Import & Export

- Export characters, lorebooks, and chat sessions.
- Import supported character-card, lorebook, and chat data.
- Preserve supported character details, lorebook entries, conversation history, summaries, and checkpoints.
- Use portable JSON-based formats for application data.

Compatibility depends on the input format and the fields provided by the source file.

💬 Chat Management

- Maintain separate sessions for characters and assistant conversations.
- Edit messages and manage conversation checkpoints.
- Regenerate or continue responses.
- Summarize and preserve story progress.
- Use a responsive chat interface designed for interactive storytelling.

📱 Installable Web App

- Progressive Web App (PWA) support.
- Web app manifest and service-worker registration.
- Installable experience on compatible mobile and desktop browsers.
- Application icons and standalone display configuration.

Installation availability and behavior depend on the browser and device.

Technology Stack

- Framework: Next.js 16
- Language: TypeScript
- UI: React 19 and Tailwind CSS 4
- Database: PostgreSQL
- Database ORM: Drizzle ORM
- Database driver: node-postgres ("pg")
- Deployment: Vercel
- PWA: Web app manifest and service worker

Getting Started

Prerequisites

- Node.js compatible with the project's Next.js version
- npm
- A PostgreSQL database
- API credentials for at least one supported AI provider

1. Clone the repository

git clone https://github.com/Sam-Program-362/Advance-Roleplay-Studio-.git
cd Advance-Roleplay-Studio-

2. Install dependencies

npm install

3. Configure the database

Create a local ".env.local" file in the project root and configure your PostgreSQL connection:

DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE

Replace the placeholders with your actual database credentials.

The application requires "DATABASE_URL" to initialize its database connection. Ensure the database has the required application schema before using the application.

Security: Never commit ".env", ".env.local", database passwords, or private API keys to GitHub. Configure production environment variables in your deployment platform.

4. Start the development server

npm run dev

Open http://localhost:3000 in your browser.

5. Configure an AI connection

Once the application is running:

1. Open Settings → Connections.
2. Add a connection for your preferred AI provider.
3. Configure its endpoint, credentials, and model as applicable.
4. Test the connection where supported.
5. Select the appropriate connection and start a chat.

Some providers require an API subscription or usage-based payment. AI Horde and locally hosted models have different availability and operating requirements.

Development Commands

Command| Purpose
"npm run dev"| Start the development server
"npm run build"| Create a production build
"npm run start"| Start the production server
"npm run lint"| Run ESLint
"npm run typecheck"| Run TypeScript type checking

Deployment

The application is deployed through Vercel.

To deploy your own instance:

1. Fork or clone the repository.
2. Configure a PostgreSQL database.
3. Import the repository into Vercel.
4. Add "DATABASE_URL" to the appropriate Vercel environment.
5. Ensure the database schema is initialized and compatible with the application.
6. Deploy and configure your AI connections through the application.

AI provider credentials are configured through the application's connection settings. Keep database credentials and other private secrets out of source control.

Data & Privacy Considerations

- Character data, conversations, settings, personas, and lorebooks use the application's PostgreSQL database.
- Scene-image generation is designed not to persist generated images in the database.
- Configured AI providers receive the prompts and conversation context required to perform their requests.
- Review each provider's data handling, retention, and privacy policies before sending sensitive content.
- Protect your database credentials and any API keys you configure.

Project Status

Advance Roleplay Studio is an evolving personal software project. Features, integrations, compatibility, and deployment requirements may change as development continues.

Not every provider or model supports every generation capability in exactly the same way.

Contributing & Feedback

Bug reports, feature suggestions, and improvements are welcome through the repository's GitHub Issues and Pull Requests.

When reporting an issue, include the relevant steps to reproduce it, expected behavior, actual behavior, and any non-sensitive error messages.

License

No license is currently specified in the repository. Unless a license is added, the source code should not be assumed to be available for unrestricted reuse or redistribution.
