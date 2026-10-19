import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

// Site owner — always admin on auth, regardless of the stored role.
export const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL ?? "info@tdvorak.dev").toLowerCase();

export const auth = betterAuth({
  appName: "MonoPredict",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "user", input: false },
      balanceCents: { type: "number", defaultValue: 100_000, input: false },
      lastClaimAt: { type: "date", required: false, input: false },
      bannedAt: { type: "date", required: false, input: false },
      banReason: { type: "string", required: false, input: false },
      commentsBanned: { type: "boolean", required: false, input: false },
      commentBanUntil: { type: "date", required: false, input: false },
      claimStreak: { type: "number", required: false, input: false },
      lastActiveDay: { type: "string", required: false, input: false },
      activityStreak: { type: "number", required: false, input: false },
      lastSeenAt: { type: "date", required: false, input: false },
      debtCents: { type: "number", required: false, input: false },
      debtRateBps: { type: "number", required: false, input: false },
      debtSince: { type: "date", required: false, input: false },
      squadId: { type: "string", required: false, input: false },
      squadDebtCents: { type: "number", required: false, input: false },
      wallPrayerAt: { type: "date", required: false, input: false },
      vowBps: { type: "number", required: false, input: false },
      luckBps: { type: "number", required: false, input: false },
      gameSessionStart: { type: "date", required: false, input: false },
      gameLastPlayAt: { type: "date", required: false, input: false },
      gamePlayedMs: { type: "number", required: false, input: false },
    },
  },
  // Bans are read-only, not lockouts: suspended users still sign in and
  // browse; every mutating action rejects them via requireUser.
  plugins: [username(), nextCookies()],
  databaseHooks: {
    user: {
      create: {
        // First registered user becomes admin; every signup gets a ledger entry
        // so the cash-flow history is complete from day one.
        after: async (u) => {
          const isOwner = (u.email ?? "").toLowerCase() === SUPER_ADMIN_EMAIL;
          const all = isOwner ? [] : await db.select({ id: schema.user.id }).from(schema.user);
          if (isOwner || all.length === 1) {
            await db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.id, u.id));
          }
          await db.insert(schema.ledger).values({
            userId: u.id,
            amountCents: 100_000,
            balanceAfterCents: 100_000,
            kind: "signup",
            memo: "Welcome bonus",
          });
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
