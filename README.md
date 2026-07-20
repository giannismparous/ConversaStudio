# ConversaStudio

Local multi-tenant platform to upload PDFs/URLs, build a Gemini embedding index, theme a Simasia-style chat widget, test in-app, and drop an embed script on any page.

## Stack

| Piece | Local now | Swap later |
|-------|-----------|------------|
| Dashboard | Vite + React (`apps/web`) | Netlify |
| API | Fastify (`apps/api`) | Render |
| Vectors + metadata | **PGlite + pgvector** (default, no Docker) or Docker Postgres | Supabase Postgres |
| Files | Local `data/uploads` | Supabase Storage / S3 |
| LLM | Gemini (`.env` key) | same |

Interfaces live in `@dialogos-forge/core` (`VectorStore`, `ObjectStore`, `Embedder`, `ChatModel`).

## Quick start

```bash
cd dialogos-forge
cp .env.example .env
# set GEMINI_API_KEY=...

npm install
npx playwright install chromium   # once — needed for React/JS website scraping
npm run db:migrate
npm run dev
```

- Web: http://localhost:5173  
- API: http://localhost:8787  

1. Enter a username (stored in `localStorage`)  
2. Create a bot → add PDFs/URLs → **Adaptive** or **Full** rebuild  
3. **Test in platform** or open **Embed demo**

### Optional: Docker Postgres

```bash
docker compose up -d
# in .env:
# DATABASE_URL=postgresql://forge:forge@127.0.0.1:5433/dialogos_forge
npm run db:migrate
```

Default `DATABASE_URL=pglite:./data/pglite` needs no Docker.

## Scripts

| Command | What it does |
|---------|----------------|
| `npm run dev` | API + web together |
| `npm run db:migrate` | Apply `data/migrations/001_init.sql` |
| `docker compose up -d` | Optional Postgres 16 + pgvector on port **5433** |

## Env

See [`.env.example`](.env.example). The browser never sees `GEMINI_API_KEY`.

Defaults that work with current Gemini APIs:

- `GEMINI_EMBED_MODEL=gemini-embedding-001` (768 dims)
- `GEMINI_CHAT_MODEL=gemini-flash-lite-latest`

## Project layout

```
apps/web               dashboard + playground
apps/api               REST + ingest jobs + embed.js
packages/core          ports + Gemini/pgvector/fs adapters
packages/chat-widget   Simasia v3–style themable widget
data/migrations        SQL schema
data/uploads           PDF / icon files
data/pglite            embedded DB (gitignored)
```
