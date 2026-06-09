import type { NextFunction, Request, Response } from "express";
import { auth } from "../lib/firebaseAdmin.js";

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email?: string;
  };
}

export async function requireAuth(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  const authorization = request.header("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;

  if (!token) {
    response.status(401).json({ error: "Missing bearer token." });
    return;
  }

  try {
    // Every protected backend route starts by trusting Firebase Auth, not client-provided user data.
    const decoded = await auth.verifyIdToken(token);
    request.user = {
      uid: decoded.uid,
      email: decoded.email
    };
    next();
  } catch {
    response.status(401).json({ error: "Invalid bearer token." });
  }
}
