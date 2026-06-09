import { auth, firestore } from "../lib/firebaseAdmin.js";

const defaultPassword = "Test1234!";

// Seed data is intentionally small but cross-tenant, so evaluators can test isolation quickly.
const organizations = [
  {
    id: "acme",
    name: "Acme Corp",
    slug: "acme",
    users: [
      { email: "sarah@acme.test", displayName: "Sarah", role: "admin" },
      { email: "mike@acme.test", displayName: "Mike", role: "member" },
      { email: "lisa@acme.test", displayName: "Lisa", role: "member" }
    ],
    rooms: [
      {
        id: "engineering",
        name: "engineering",
        description: "API and platform decisions",
        messages: [
          { senderEmail: "sarah@acme.test", content: "We need to decide on the caching strategy for our API." },
          { senderEmail: "mike@acme.test", content: "I'm thinking Redis, but worried about costs at scale." },
          { senderEmail: "lisa@acme.test", content: "We're already on GCP, should we consider Memorystore?" }
        ]
      },
      {
        id: "general",
        name: "general",
        description: "Company-wide chat",
        messages: [
          { senderEmail: "sarah@acme.test", content: "Welcome to TeamChat AI." }
        ]
      }
    ]
  },
  {
    id: "globex",
    name: "Globex",
    slug: "globex",
    users: [
      { email: "ana@globex.test", displayName: "Ana", role: "admin" },
      { email: "diego@globex.test", displayName: "Diego", role: "member" },
      { email: "carla@globex.test", displayName: "Carla", role: "member" }
    ],
    rooms: [
      {
        id: "product",
        name: "product",
        description: "Product strategy",
        messages: [
          { senderEmail: "ana@globex.test", content: "Let's compare options for onboarding flows." },
          { senderEmail: "diego@globex.test", content: "@Gemini summarize the tradeoffs for a wizard versus checklist." }
        ]
      }
    ]
  }
] as const;

async function getOrCreateUser(email: string, displayName: string) {
  try {
    return await auth.getUserByEmail(email);
  } catch {
    // Re-running the seed should be safe; only missing users are created.
    return auth.createUser({
      email,
      displayName,
      password: defaultPassword,
      emailVerified: true
    });
  }
}

async function seed() {
  for (const org of organizations) {
    await firestore.collection("organizations").doc(org.id).set({
      name: org.name,
      slug: org.slug
    });

    const usersByEmail = new Map<string, { uid: string; displayName: string }>();

    for (const user of org.users) {
      const firebaseUser = await getOrCreateUser(user.email, user.displayName);
      usersByEmail.set(user.email, {
        uid: firebaseUser.uid,
        displayName: user.displayName
      });

      const profile = {
        uid: firebaseUser.uid,
        orgId: org.id,
        displayName: user.displayName,
        email: user.email,
        role: user.role
      };

      // userProfiles is a convenience lookup for the signed-in user; tenant-scoped users remain canonical.
      await firestore.collection("organizations").doc(org.id).collection("users").doc(firebaseUser.uid).set(profile);
      await firestore.collection("userProfiles").doc(firebaseUser.uid).set(profile);
    }

    // Room documents carry memberIds for efficient client-side room listing.
    // The members subcollection is still used for stricter access checks.
    const memberIds = [...usersByEmail.values()].map((user) => user.uid);

    for (const room of org.rooms) {
      const roomRef = firestore.collection("organizations").doc(org.id).collection("rooms").doc(room.id);

      await roomRef.set({
        orgId: org.id,
        name: room.name,
        description: room.description,
        memberIds,
        createdAt: new Date()
      });

      for (const member of usersByEmail.values()) {
        await roomRef.collection("members").doc(member.uid).set({
          uid: member.uid,
          displayName: member.displayName,
          joinedAt: new Date()
        });
      }

      for (const message of room.messages) {
        const sender = usersByEmail.get(message.senderEmail);
        if (!sender) {
          continue;
        }

        await roomRef.collection("messages").add({
          orgId: org.id,
          roomId: room.id,
          senderId: sender.uid,
          senderName: sender.displayName,
          type: "user",
          content: message.content,
          createdAt: new Date()
        });
      }
    }
  }
}

seed()
  .then(() => {
    console.log(`Seed completed. Default password: ${defaultPassword}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
