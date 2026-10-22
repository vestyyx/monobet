// Seed demo content for the family-games corner (batch 1: trivia + guess).
//   npx tsx scripts/seed-fun.ts          # shows what it would add (dry run)
//   npx tsx scripts/seed-fun.ts --apply  # writes
// Adds a small starter bank + an open guess round unless they already exist
// (idempotent: reruns skip).
import { db, schema } from "@/lib/db";
import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";

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
        qEn: "Roughly how many lines of code does an unchecked graduation project usually have?",        optionsCs: ["210", "2 100", "21 000", "milion"],
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

  // ---------- guess round ----------
  const openRounds = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.guessRound)
    .where(eq(schema.guessRound.status, "open"));
  if ((openRounds[0]?.n ?? 0) === 0) {
    console.log("[seed] adding 1 open closest-guess round (45 min)");
    if (apply) {
      await db.insert(schema.guessRound).values({
        promptCs: "Kolik papanců sní celá rodina o nedělní snídani?",
        promptEn: "How many pancakes does the whole family demolish at Sunday breakfast?",
        unitCs: "papanců",
        unitEn: "pancakes",
        closeAt: new Date(Date.now() + 45 * 60_000),
        rewardCents: 20_000,
        consolationCents: 5_000,
      });
    }
  } else {
    console.log(`[seed] an open guess round already exists — skipping`);
  }

  if (!apply) console.log("[seed] dry run — rerun with --apply to write");
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed] failed:", e);
  process.exit(1);
});
