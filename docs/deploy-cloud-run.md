# Deploy backend to Cloud Run

This guide deploys the Node/Express API in `apps/api` using the root `Dockerfile`.

## 1. Confirm local build

```powershell
npm.cmd run build:api
```

## 2. Set project variables

```powershell
$PROJECT_ID = "multichat-ai-b5cea"
$REGION = "us-central1"
$REPOSITORY = "multichat"
$SERVICE = "multichat-api"
$IMAGE = "$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$SERVICE"
```

## 3. Enable required Google Cloud APIs

```powershell
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com aiplatform.googleapis.com --project $PROJECT_ID
```

## 4. Create Artifact Registry repository

Run this once. If the repository already exists, continue to the next step.

```powershell
gcloud artifacts repositories create $REPOSITORY --repository-format=docker --location=$REGION --description="Docker images for TeamChat AI" --project $PROJECT_ID
```

## 5. Grant Cloud Run runtime permissions

Cloud Run needs permission to call Vertex AI and read/write Firestore through Firebase Admin.

```powershell
$PROJECT_NUMBER = gcloud projects describe $PROJECT_ID --format="value(projectNumber)"
$RUNTIME_SERVICE_ACCOUNT = "$PROJECT_NUMBER-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$RUNTIME_SERVICE_ACCOUNT" --role="roles/aiplatform.user"
gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$RUNTIME_SERVICE_ACCOUNT" --role="roles/datastore.user"
```

## 6. Build and push the container

Run from the repository root.

```powershell
gcloud builds submit --tag $IMAGE --project $PROJECT_ID
```

## 7. Deploy Cloud Run

Set `WEB_ORIGIN` to the Firebase Hosting URL after frontend deploy. During first backend deploy, the default Firebase URL is a reasonable placeholder.

```powershell
gcloud run deploy $SERVICE `
  --image $IMAGE `
  --project $PROJECT_ID `
  --region $REGION `
  --allow-unauthenticated `
  --port 8080 `
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GOOGLE_CLOUD_LOCATION=global,GEMINI_MODEL=gemini-2.5-flash-lite,GEMINI_MAX_OUTPUT_TOKENS=512,GEMINI_HISTORY_LIMIT=40,GEMINI_CONTEXT_CHAR_LIMIT=20000,WEB_ORIGIN=https://multichat-ai-b5cea.web.app,MOCK_GEMINI=false,AI_DEBUG_LOGS=false"
```

## 8. Verify deployment

```powershell
$API_URL = gcloud run services describe $SERVICE --project $PROJECT_ID --region $REGION --format="value(status.url)"
Invoke-WebRequest "$API_URL/health"
```

Expected response:

```json
{
  "ok": true,
  "ai": {
    "mock": false,
    "model": "gemini-2.5-flash-lite",
    "debugLogs": false
  }
}
```

Save the `$API_URL` value. The frontend production env will use it as `VITE_API_BASE_URL`.
