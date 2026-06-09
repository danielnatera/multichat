import { auth, firestore } from "../lib/firebaseAdmin.js";

const defaultPassword = "Test1234!";

// Seed data is intentionally small but cross-tenant, so evaluators can test isolation quickly.
const organizations = [
  {
    name: "Acme Corp",
    slug: "acme",
    users: [
      { email: "sarah@acme.test", displayName: "Sarah", role: "admin" },
      { email: "mike@acme.test", displayName: "Mike", role: "member" },
      { email: "lisa@acme.test", displayName: "Lisa", role: "member" },
      { email: "james@acme.test", displayName: "James", role: "member" },
      { email: "olivia@acme.test", displayName: "Olivia", role: "member" }
    ],
    rooms: [
      {
        id: "engineering",
        name: "engineering",
        description: "API and platform decisions",
        aiPersonaPrompt: "Act as a concise senior backend architect. Focus on tradeoffs, operational risk, cloud cost, and concrete next steps.",
        messages: [
          { senderEmail: "sarah@acme.test", content: "We need to decide on the caching strategy for our API." },
          { senderEmail: "mike@acme.test", content: "I'm thinking Redis, but worried about costs at scale." },
          { senderEmail: "lisa@acme.test", content: "We're already on GCP, should we consider Memorystore?" },
          { senderEmail: "james@acme.test", content: "Latency matters most for the dashboard endpoints." },
          { senderEmail: "olivia@acme.test", content: "Can we start with short TTLs and monitor cache hit rate?" }
        ]
      },
      {
        id: "general",
        name: "general",
        description: "Company-wide chat",
        aiPersonaPrompt: "Act as a friendly team facilitator. Keep answers short, inclusive, and action-oriented.",
        messages: [
          { senderEmail: "sarah@acme.test", content: "Welcome to TeamChat AI." },
          { senderEmail: "james@acme.test", content: "I'll use this room for rollout updates." },
          { senderEmail: "olivia@acme.test", content: "Great, I'll post customer feedback summaries here." }
        ]
      }
    ]
  },
  {
    name: "Globex",
    slug: "globex",
    users: [
      { email: "ana@globex.test", displayName: "Ana", role: "admin" },
      { email: "diego@globex.test", displayName: "Diego", role: "member" },
      { email: "carla@globex.test", displayName: "Carla", role: "member" },
      { email: "marco@globex.test", displayName: "Marco", role: "member" },
      { email: "nina@globex.test", displayName: "Nina", role: "member" }
    ],
    rooms: [
      {
        id: "product",
        name: "product",
        description: "Product strategy",
        aiPersonaPrompt: "Act as a pragmatic product strategist. Compare options through user impact, implementation effort, and measurable outcomes.",
        messages: [
          { senderEmail: "ana@globex.test", content: "Let's compare options for onboarding flows." },
          { senderEmail: "diego@globex.test", content: "@Gemini summarize the tradeoffs for a wizard versus checklist." },
          { senderEmail: "carla@globex.test", content: "The checklist might be easier to iterate on for the first release." },
          { senderEmail: "marco@globex.test", content: "A wizard could reduce confusion for new users if we keep it short." },
          { senderEmail: "nina@globex.test", content: "Let's measure completion rate and time-to-first-action either way." }
        ]
      }
    ]
  }
] as const;

function assertUniqueOrganizationSlugs() {
  const slugs = new Set<string>();

  for (const org of organizations) {
    if (slugs.has(org.slug)) {
      throw new Error(`Duplicate organization slug in seed data: ${org.slug}`);
    }

    slugs.add(org.slug);
  }
}

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
  assertUniqueOrganizationSlugs();

  for (const org of organizations) {
    // The organization slug is the tenant identifier and the Firestore document id.
    await firestore.collection("organizations").doc(org.slug).set({
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
        orgId: org.slug,
        displayName: user.displayName,
        email: user.email,
        role: user.role
      };

      // userProfiles is a convenience lookup for the signed-in user; tenant-scoped users remain canonical.
      await firestore.collection("organizations").doc(org.slug).collection("users").doc(firebaseUser.uid).set(profile);
      await firestore.collection("userProfiles").doc(firebaseUser.uid).set(profile);
    }

    // Room documents carry memberIds for efficient client-side room listing.
    // The members subcollection is still used for stricter access checks.
    const memberIds = [...usersByEmail.values()].map((user) => user.uid);

    for (const room of org.rooms) {
      const roomRef = firestore.collection("organizations").doc(org.slug).collection("rooms").doc(room.id);

      await roomRef.set({
        orgId: org.slug,
        name: room.name,
        description: room.description,
        aiPersonaPrompt: room.aiPersonaPrompt,
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
          orgId: org.slug,
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
