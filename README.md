# TeamChat AI

Multi-tenant collaborative AI chat platform built with React, Vite, TypeScript, Node.js, Firebase, Firestore, Cloud Run, and Vertex AI Gemini.

## Live Demo

- Frontend: `https://multichat-ai-b5cea.web.app`
- Backend health: `https://multichat-api-436954625005.us-central1.run.app/health`
- Firebase / Google Cloud project: `multichat-ai-b5cea`
- Backend runtime: Cloud Run, region `us-central1`
- Firestore location: `nam5`
- Gemini model: `gemini-2.5-flash-lite`

## Demo Credentials

All seeded demo users use the same password:

```text
Test1234!
```

Acme tenant:

- `sarah@acme.test` - admin
- `mike@acme.test` - member
- `lisa@acme.test` - member

Globex tenant:

- `ana@globex.test` - admin
- `diego@globex.test` - member
- `carla@globex.test` - member

## Main Features

- Firebase Auth email/password login.
- Multi-tenant organization isolation using Firestore rules.
- Room-based chat with admin-managed membership.
- Realtime messages using Firestore listeners.
- Typing indicators and online presence per room.
- Message timestamps and unread room indicators.
- Distinct Gemini AI messages with streaming state.
- `@Gemini` and `@AI` mentions trigger AI responses.
- Backend validates Firebase ID tokens before calling Vertex AI.
- Backend validates organization and room membership before sending context to Gemini.
- Gemini retry UI for failed responses.
- Frontend deployed to Firebase Hosting.
- Backend deployed to Cloud Run.

## Tech Stack

- Frontend: React, Vite, TypeScript, Tailwind CSS, Firebase Web SDK.
- Backend: Node.js, Express, TypeScript, Firebase Admin SDK.
- Realtime data: Cloud Firestore.
- Authentication: Firebase Auth.
- AI: Vertex AI Gemini through Google Cloud REST streaming.
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
    progreso.md
  Dockerfile             Cloud Run container image
  firebase.json          Firebase Hosting + Firestore config
  firestore.rules        Firestore security rules
  package.json           Monorepo scripts
```

## Architecture

The browser handles Firebase Auth and realtime Firestore subscriptions directly. Sensitive operations stay on the backend.

```text
React app
  | Firebase Auth login
  | Firestore realtime listeners
  v
Firestore
  | tenant data, rooms, messages, typing, presence, read states

React app
  | POST /api/ai/stream with Firebase ID token
  v
Cloud Run API
  | verify Firebase token
  | verify org + room membership
  | build bounded conversation context
  | call Vertex AI Gemini
  | write streaming chunks back to Firestore
  v
Firestore realtime listeners update all room members
```

## Firestore Data Model

```text
organizations/{orgId}
organizations/{orgId}/users/{uid}
organizations/{orgId}/rooms/{roomId}
organizations/{orgId}/rooms/{roomId}/members/{uid}
organizations/{orgId}/rooms/{roomId}/messages/{messageId}
organizations/{orgId}/rooms/{roomId}/presence/{uid}
organizations/{orgId}/rooms/{roomId}/typing/{uid}
organizations/{orgId}/rooms/{roomId}/readStates/{uid}
userProfiles/{uid}
```

Important rules:

- Users can only read their own `userProfiles/{uid}` document.
- Users can only list rooms where `memberIds` contains their Firebase UID.
- Users can only read/write messages in rooms where they are members.
- Only admins can create rooms and manage room members.
- Each user can only write their own typing, presence, and read-state documents.
- Backend repeats auth and membership checks before calling Gemini.

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
GEMINI_HISTORY_LIMIT=20
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
npm.cmd run dev --workspace @multichat/web
```

Run backend:

```powershell
npm.cmd run dev --workspace @multichat/api
```

Open:

```text
http://localhost:5173
```

## Seed Data

Run after Firebase Admin credentials are available:

```powershell
npm.cmd run seed --workspace @multichat/api
```

The seed creates:

- 2 organizations: `acme`, `globex`.
- 3 users per organization.
- Initial rooms, memberships, and sample messages.

## AI Flow

Users trigger Gemini by sending a message that contains:

```text
@Gemini
@AI
```

Flow:

1. Frontend writes the user message to Firestore.
2. Frontend calls `POST /api/ai/stream` with the Firebase ID token.
3. Backend verifies the token.
4. Backend verifies room membership.
5. Backend reads recent room messages.
6. Backend filters empty, failed, streaming, and system messages from context.
7. Backend calls Vertex AI Gemini.
8. Backend creates a Gemini message in Firestore.
9. Backend updates that message as chunks arrive.
10. Firestore pushes updates to all room members.

## Production Deployment

### Backend

Backend deployment guide:

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
GEMINI_HISTORY_LIMIT=20
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

## Validation Commands

Typecheck all workspaces:

```powershell
npm.cmd run typecheck
```

Build frontend:

```powershell
npm.cmd run build --workspace @multichat/web
```

Build backend:

```powershell
npm.cmd run build:api
```

Deploy Firestore rules:

```powershell
npx.cmd firebase-tools deploy --only firestore:rules --project multichat-ai-b5cea
```

Check backend health:

```powershell
Invoke-WebRequest -UseBasicParsing "https://multichat-api-436954625005.us-central1.run.app/health"
```

## Security Notes

- `.env`, `.env.local`, and `.env.production` are ignored by Git.
- `AI_DEBUG_LOGS=false` is used in production to avoid logging full conversation prompts.
- Firestore rules enforce tenant and room boundaries.
- The backend does not trust client-provided membership; it rechecks access before calling Gemini.
- Cloud Run uses Google Cloud service account permissions for Firestore and Vertex AI.

## Known Notes

- The frontend bundle is split into `firebase`, `react`, `vendor`, and app chunks to avoid one oversized JavaScript asset.
- `npm audit` still reports moderate advisories from `@google-cloud/storage`, which is a transitive dependency of `firebase-admin`; no direct Storage API is used by this app.
- Firestore-based presence uses heartbeat + expiration because Firestore does not provide browser `onDisconnect`.
