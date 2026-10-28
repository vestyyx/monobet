import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username, } from "better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
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
  // Phase 7 hardening: explicit session lifetime + rate limits. better-auth's
  // built-in special rules already hold sign-in/sign-up to 3 attempts per 10 s
  // window per IP; the explicit config makes the defaults sticky and slightly
  // wider for everything else (a family-sized app needs no more).
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh the cookie at most once a day
  },
  rateLimit: {
    enabled: true, // default-on in production — pinned explicitly
    window: 60,
    max: 100,
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "user", input: false },
      balanceCents: { type: "number", defaultValue: 100_000, input: false },
      lastClaimAt: { type: "date", required: false, input: false },
      bannedAt: { type: "date", required: false, input: false },
      bannedUntil: { type: "date", required: false, input: false },
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
      squadRole: { type: "string", required: false, input: false },
      squadDebtCents: { type: "number", required: false, input: false },

    },
  },
  // Bans are read-only, not lockouts: suspended users still sign in and
  // browse; every mutating action rejects them via requireUser.
  plugins: [username(), nextCookies()],
  // Registration switch (Phase 6, /admin/settings) — a soft server hook that
  // rejects sign-ups while the switch is closed; members keep signing in.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path.startsWith("/sign-up")) {
        const [cfg] = await db
          .select({ registrationOpen: schema.platformConfig.registrationOpen })
          .from(schema.platformConfig)
          .limit(1);
        if (cfg && !cfg.registrationOpen) throw new APIError("FORBIDDEN", { message: "Registration is closed" });
      }
    }),
  },
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
