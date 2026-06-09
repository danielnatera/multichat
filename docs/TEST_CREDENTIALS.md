# Test Credentials and Verification Guide

This document contains the seeded demo accounts used to evaluate TeamChat AI.

## Login Credentials

All demo users share the same password:

```text
Test1234!
```

## Acme Tenant

| Name | Email | Role |
| --- | --- | --- |
| Sarah | `sarah@acme.test` | Admin |
| Mike | `mike@acme.test` | Member |
| Lisa | `lisa@acme.test` | Member |

## Globex Tenant

| Name | Email | Role |
| --- | --- | --- |
| Ana | `ana@globex.test` | Admin |
| Diego | `diego@globex.test` | Member |
| Carla | `carla@globex.test` | Member |

## Verification Steps

### Tenant Isolation

1. Open two browsers, or one normal window and one incognito window.
2. Log in as `sarah@acme.test` in one window.
3. Log in as `ana@globex.test` in the other window.
4. Confirm Sarah only sees Acme rooms, users, messages, presence, and member lists.
5. Confirm Ana only sees Globex rooms, users, messages, presence, and member lists.

### Room Membership

1. Log in as an admin, for example `sarah@acme.test`.
2. Create a new room.
3. Add only Sarah and one other Acme member, for example `mike@acme.test`.
4. Log in as `lisa@acme.test`.
5. Confirm Lisa cannot see the new room.

### Gemini Access Control

1. Log in as a valid room member.
2. Send a message containing `@Gemini`.
3. Confirm Gemini replies in the room.
4. If testing manually through network tools, changing the request payload to another tenant or unauthorized room should return `403 Forbidden`.

The backend validates the Firebase ID token and room membership before sending any room context to Vertex AI.
