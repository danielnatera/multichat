# TeamChat AI

Multi-tenant collaborative AI chat platform built with React, Vite, TypeScript, Node.js, Firebase, Firestore, Cloud Run, and Vertex AI Gemini.

## Live Demo

- Frontend: `https://multichat-ai-b5cea.web.app`
- Backend health: `https://multichat-api-436954625005.us-central1.run.app/health`
- Firebase / Google Cloud project: `multichat-ai-b5cea`
- Backend runtime: Cloud Run, region `us-central1`
- Firestore location: `nam5`
- Gemini model: `gemini-2.5-flash-lite`

## Demo Users

There is no signup flow. The app is evaluated with seeded Firebase Auth users.

All seeded users use this password:

```text
Test1234!
```

ACME:

- `sarah@acme.test` - admin
- `mike@acme.test` - member
- `lisa@acme.test` - member

GLOBEX:

- `ana@globex.test` - admin
- `diego@globex.test` - member
- `carla@globex.test` - member

## Features

- Multi-tenant organizations identified by unique slugs: `acme`, `globex`.
- Firebase Auth email/password login with seeded users.
- Admin/member roles.
- Admins can create rooms and manage room members.
- Rooms support optional descriptions and custom Gemini persona prompts.
- Only room members can see and send messages.
- Realtime messages through Firestore listeners.
- Sender name, role, timestamp, and message content on every message.
- Typing indicators and room-level online presence.
- Lightweight message threading with inline replies.
- Gemini responds when explicitly mentioned with `@Gemini`, `@AI`, or `@IA`.
- Gemini responses stream to Firestore in chunks so all room members see updates.
- Backend validates Firebase ID tokens, organization access, and room membership before calling Gemini.
- Backend retries transient Gemini failures with exponential backoff.
- Definitive Gemini failures are logged and shown as clear error states.

## Tech Stack

- Frontend: React, Vite, TypeScript, Tailwind CSS, Firebase Web SDK.
- Backend: Node.js, Express, TypeScript, Firebase Admin SDK.
- Realtime data: Cloud Firestore.
- Authentication: Firebase Auth.
- AI: Vertex AI Gemini REST streaming.
- Hosting: Firebase Hosting.
- API runtime: Cloud Run.
- Container build: Cloud Build + Artifact Registry.

## Repository Structure

```text
multichat/
  apps/
    web/                 React + Vite frontend
    api/                 Node + Express backend
  packages/
    shared/              Shared TypeScript types
  docs/
    billing-vertex-ai.md
    deploy-cloud-run.md
    TEST_CREDENTIALS.md
  Dockerfile             Cloud Run container image
  firebase.json          Firebase Hosting + Firestore config
  firestore.indexes.json Firestore indexes
  firestore.rules        Firestore security rules
  package.json           Monorepo scripts
```

## Architecture

The frontend handles Firebase Auth and Firestore realtime subscriptions. Sensitive AI work stays on the backend.

```text
React app
  -> Firebase Auth login
  -> Firestore realtime listeners
  -> rooms, messages, typing, presence, read states

React app
  -> POST /api/ai/stream with Firebase ID token
  -> Cloud Run API
  -> verify token, tenant, room, and membership
  -> build bounded Gemini context
  -> call Vertex AI Gemini
  -> write AI chunks back to Firestore
  -> all room members receive updates through Firestore listeners
```

## Firestore Data Model

```text
organizations/{orgSlug}
organizations/{orgSlug}/users/{uid}
organizations/{orgSlug}/rooms/{roomId}
organizations/{orgSlug}/rooms/{roomId}/members/{uid}
organizations/{orgSlug}/rooms/{roomId}/messages/{messageId}
organizations/{orgSlug}/rooms/{roomId}/presence/{uid}
organizations/{orgSlug}/rooms/{roomId}/typing/{uid}
organizations/{orgSlug}/rooms/{roomId}/readStates/{uid}
userProfiles/{uid}
```

Security model:

- Organization document ids are tenant slugs, for example `organizations/acme`.
- Users can only read their own `userProfiles/{uid}` document.
- Users can only list rooms where `memberIds` contains their Firebase UID.
- Users can only read/write messages in rooms where they are members.
- Only admins can create rooms and manage room members.
- Each user can only write their own typing, presence, and read-state documents.
- The backend repeats access checks before Gemini receives any room context.

## Gemini Context

Gemini receives a bounded room context:

- Room name, room description, and optional room persona prompt.
- Last `40` eligible messages.
- Maximum context size of `20000` characters.
- User attribution in the format `[User Name] message`.
- Thread context when replying to a specific message.
- Empty, failed, streaming, and system messages are excluded.

This keeps long conversations manageable without scanning the full room history.

## Error Handling

- Transient Gemini errors are retried automatically with backoff.
- Definitive errors, such as invalid model names or permission failures, are not retried.
- Backend errors are logged with request, tenant, and room metadata.
- Users see a graceful Gemini error message instead of a broken UI.
- Failed Gemini messages cannot be replied to.

## Local Setup

Install dependencies:

```powershell
npm.cmd install
```

Create frontend env:

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
```

Fill `apps/web/.env.local` with the Firebase web app config.

Create backend env:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
```

Recommended local backend values:

```env
PORT=8080
GOOGLE_CLOUD_PROJECT=multichat-ai-b5cea
GOOGLE_CLOUD_LOCATION=global
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_MAX_OUTPUT_TOKENS=512
GEMINI_HISTORY_LIMIT=40
GEMINI_CONTEXT_CHAR_LIMIT=20000
WEB_ORIGIN=http://localhost:5173
MOCK_GEMINI=false
AI_DEBUG_LOGS=true
AI_DEBUG_LOG_FILE=logs/ai-debug.log
```

Authenticate local Google credentials:

```powershell
gcloud auth application-default login
gcloud auth application-default set-quota-project multichat-ai-b5cea
```

Run frontend:

```powershell
npm.cmd run dev
```

Run backend:

```powershell
npm.cmd run dev:api
```

Open:

```text
http://localhost:5173
```

## Seed Data

Run this after Firebase Admin credentials are available:

```powershell
npm.cmd run seed --workspace @multichat/api
```

The seed creates:

- 2 organizations: `acme`, `globex`.
- 3 users per organization.
- Initial rooms, memberships, and sample messages.

## AI Flow

1. User sends a message containing `@Gemini`, `@AI`, or `@IA`.
2. Frontend writes the user message to Firestore.
3. Frontend calls `POST /api/ai/stream` with the Firebase ID token.
4. Backend verifies auth and room access.
5. Backend builds bounded Gemini context.
6. Backend calls Vertex AI Gemini.
7. Backend creates a Gemini message in Firestore.
8. Backend updates that message as response chunks arrive.
9. Firestore pushes updates to every room participant.

## Production Deployment

### Backend

Detailed backend deployment steps are in:

```text
docs/deploy-cloud-run.md
```

Current Cloud Run URL:

```text
https://multichat-api-436954625005.us-central1.run.app
```

Production backend env:

```env
GOOGLE_CLOUD_PROJECT=multichat-ai-b5cea
GOOGLE_CLOUD_LOCATION=global
GEMINI_MODEL=gemini-2.5-flash-lite
GEMINI_MAX_OUTPUT_TOKENS=512
GEMINI_HISTORY_LIMIT=40
GEMINI_CONTEXT_CHAR_LIMIT=20000
WEB_ORIGIN=https://multichat-ai-b5cea.web.app
MOCK_GEMINI=false
AI_DEBUG_LOGS=false
```

### Frontend

Create local production env:

```powershell
Set-Content -LiteralPath apps/web/.env.production -Value "VITE_API_BASE_URL=https://multichat-api-436954625005.us-central1.run.app"
```

Build:

```powershell
npm.cmd run build --workspace @multichat/web
```

Deploy:

```powershell
npx.cmd firebase-tools deploy --only hosting --project multichat-ai-b5cea
```

Current Firebase Hosting URL:

```text
https://multichat-ai-b5cea.web.app
```

## Validation

Run tests:

```powershell
npm.cmd run test
```

Run typecheck:

```powershell
npm.cmd run typecheck
```

Build all workspaces:

```powershell
npm.cmd run build
```

Run lint:

```powershell
npm.cmd run lint
```

Check backend health:

```powershell
Invoke-WebRequest -UseBasicParsing "https://multichat-api-436954625005.us-central1.run.app/health"
```

## Security Notes

- `.env`, `.env.local`, and `.env.production` are ignored by Git.
- Firestore rules enforce tenant and room boundaries.
- The backend does not trust client-provided membership.
- Gemini only receives context after backend access validation.
- `AI_DEBUG_LOGS=false` is used in production to avoid logging full prompts.
- Cloud Run uses Google Cloud service account permissions for Firestore and Vertex AI.

## Known Notes

- Firestore-based presence uses heartbeat + expiration because Firestore does not provide browser `onDisconnect`.
- Frontend chunks are split into `firebase`, `react`, `vendor`, and app bundles.
- `npm audit` may report moderate advisories from transitive Google Cloud packages used by Firebase Admin.
