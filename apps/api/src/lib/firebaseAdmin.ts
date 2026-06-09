import "dotenv/config";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) {
  // Local development uses gcloud Application Default Credentials; Cloud Run will use its service account.
  initializeApp({
    projectId: process.env.GOOGLE_CLOUD_PROJECT
  });
}

export const auth = getAuth();
export const firestore = getFirestore();
