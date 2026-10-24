// Seed demo content for the family-games corner (batch 1: trivia + guess).
//   npx tsx scripts/seed-fun.ts          # shows what it would add (dry run)
//   npx tsx scripts/seed-fun.ts --apply  # writes
// Adds a small starter bank + an open guess round unless they already exist
// (idempotent: reruns skip).
import { db, schema } from "@/lib/db";
import { config } from "dotenv";
import { eq, and, sql } from "drizzle-orm";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");

async function main() {
  const apply = APPLY;

  // ---------- trivia bank ----------
  const existingTrivia = await db.select({ n: sql<number>`count(*)::int` }).from(schema.triviaQuestion);
  if ((existingTrivia[0]?.n ?? 0) === 0) {
    const seed = [
      {
        qCs: "Kolik hodin denně průměrný Čech tráví čuměním do mobilu?",
        qEn: "How many hours a day does the average Czech spend staring at their phone?",
        optionsCs: ["3 hodiny", "5 hodin", "7 hodin", "10 hodin"],
        optionsEn: ["3 hours", "5 hours", "7 hours", "10 hours"],
        correctIdx: 1, // ~5 hours per recent surveys — the scary truth
        difficulty: 2,
      },
      {
        qCs: "Které zvíře prospí nejdéle za den?",
        qEn: "Which animal sleeps the longest per day?",
        optionsCs: ["Slon", "Mravenečník", "Koala", "Vlk"],
        optionsEn: ["Elephant", "Anteater", "Koala", "Wolf"],
        correctIdx: 2, // koala — ~20+ hours of napping
        difficulty: 1,
      },
      {
        qCs: "Kolik řádků zdrojového kódu má typicky maturitní projekt, který nikdo nekontroluje?",
        qEn: "Roughly how many lines of code does an unchecked graduation project usually have?",
        optionsCs: ["210", "2 100", "21 000", "milion"],
        optionsEn: ["210", "2,100", "21,000", "a million"],
        correctIdx: 1,
        difficulty: 3,
      },
    ];
    console.log(`[seed] adding ${seed.length} trivia bank questions`);
    if (apply) await db.insert(schema.triviaQuestion).values(seed);
  } else {
    console.log(`[seed] trivia bank already has ${existingTrivia[0]?.n} rows — skipping`);
  }

  // ---------- group poll ----------
  const openPolls = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.pollRound)
    .where(eq(schema.pollRound.status, "open"));
  if ((openPolls[0]?.n ?? 0) === 0) {
    console.log("[seed] adding 1 open family poll (3 days)");
    if (apply) {
      await db.insert(schema.pollRound).values({
        qCs: "Kdo v domácnosti ovládá televizní ovladač?",
        qEn: "Who rules the TV remote in this household?",
        aCs: "Táta (oficiálně)",
        aEn: "Dad (officially)",
        bCs: "Malý tyran — prostě to vlastní",
        bEn: "The tiny tyrant — it just owns it",
        closeAt: new Date(Date.now() + 2 * 24 * 3_600_000),
        rewardCents: 10_000,
        consolationCents: 0,
      });
    }
  } else {
    console.log("[seed] an open poll already exists — skipping");
  }

  // Extra: a second poll for testing (safe to rerun; guarded by prompt match)
  const existingP2 = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.pollRound)
    .where(and(eq(schema.pollRound.status, "open"), eq(schema.pollRound.qCs, "Co na snídani v neděli?")));
  if ((existingP2[0]?.n ?? 0) === 0) {
    console.log("[seed] adding test poll #2 (open, 1 day)");
    if (apply) {
      await db.insert(schema.pollRound).values({
        qCs: "Co na snídani v neděli?",
        qEn: "Sunday breakfast — what is it?",
        aCs: "Papance s marmeládou",
        aEn: "Pancakes with jam",
        bCs: "Chleba s Nutellou",
        bEn: "Bread with Nutella",
        closeAt: new Date(Date.now() + 24 * 3_600_000),
        rewardCents: 10_000,
        consolationCents: 0,
      });
    }
  }

  // ---------- emoji riddle ----------
  const openRiddles = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.emojiRound)
    .where(eq(schema.emojiRound.status, "open"));
  if ((openRiddles[0]?.n ?? 0) === 0) {
    console.log("[seed] adding 1 open emoji riddle (2 days)");
    if (apply) {
      await db.insert(schema.emojiRound).values({
        emoji: "🍕🌧️",
        answerCs: "pizzeria večer když prší",
        answerEn: "pizza night when it rains",
        hintCs: "Jídlo + počasí + večerní pohoda.",
        hintEn: "Food + weather + cozy evening.",
        hintAt: new Date(Date.now() + 8 * 3_600_000),
        closeAt: new Date(Date.now() + 2 * 24 * 3_600_000),
        rewardCents: 15_000,
      });
    }
  } else {
    console.log("[seed] an open emoji riddle already exists — skipping");
  }

  if (!apply) console.log("[seed] dry run — rerun with --apply to write");
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed] failed:", e);
  process.exit(1);
});
