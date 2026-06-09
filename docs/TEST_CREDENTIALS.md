# Test Credentials & Verification Guide

This document contains the seeded test accounts required to evaluate the **TeamChat AI** platform. The data is generated via the `apps/api/src/scripts/seed.ts` script.

## 🔐 Login Credentials

All users share the same default password.

**Default Password:** `Test1234!`

### Organization A: Acme Corp (acme)
| Name | Email | Role |
| :--- | :--- | :--- |
| **Sarah** | `sarah@acme.test` | Admin |
| **Mike** | `mike@acme.test` | Member |
| **Lisa** | `lisa@acme.test` | Member |

### Organization B: Globex (globex)
| Name | Email | Role |
| :--- | :--- | :--- |
| **Ana** | `ana@globex.test` | Admin |
| **Diego** | `diego@globex.test` | Member |
| **Carla** | `carla@globex.test` | Member |

---

## 🛡️ Instructions to Verify Tenant Isolation

To ensure that data does not leak across organizations and that security rules are strictly enforced, please follow these steps:

### Test 1: Cross-Tenant Data Leakage (UI)
1. Open two different browsers (or one standard window and one incognito window).
2. Log into the first window as an **Acme Corp** user (e.g., `sarah@acme.test`).
3. Log into the second window as a **Globex** user (e.g., `ana@globex.test`).
4. **Observation:** 
   - Sarah should only see the `# engineering` and `# general` rooms. She will only see Acme employees in the member lists and online presence.
   - Ana should only see the `# product` room. She cannot see Acme's rooms, members, or messages.

### Test 2: Room Member Isolation
1. Log in as an Admin (e.g., `sarah@acme.test`).
2. Create a new room and assign only yourself and one other member (e.g., `mike@acme.test`).
3. Open another browser and log in as an unassigned member of the *same* organization (e.g., `lisa@acme.test`).
4. **Observation:** Lisa should not see the new room in her sidebar, and she cannot access its messages.

### Test 3: Backend Security Enforcement (API Proxy)
The application relies on Cloud Run to proxy requests to Gemini.
1. Log in as `mike@acme.test` and attempt to trigger the AI via the UI. It will succeed.
2. Intercept the network request to `/api/ai/stream`.
3. Replay the request but manually change the `orgId` payload from `acme` to `globex`, or change the `roomId` to a room where Mike is not a member.
4. **Observation:** The API will reject the request with a `403 Forbidden` error. The backend function `assertRoomAccess` validates the user's Auth Token against Firestore membership before ever forwarding the prompt to Vertex AI.