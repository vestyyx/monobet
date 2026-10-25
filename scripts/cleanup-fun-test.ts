// One-off dev cleanup: remove the fun-games test artifacts (test users +
// batch-3 quest/photo test rows), leaving the shared dev/prod DB with fresh
// demo content only — re-run scripts/seed-fun.ts --apply afterwards.
// Run: npx tsx scripts/cleanup-fun-test.ts
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  // 1) test users — cascade removes their sessions, ledger rows, votes,
  //    attempts, quest_claims and trivia answers
  const u = await pool.query(
    'delete from "user" where username in (\'panna\', \'admtest\') returning username'
  );
  console.log("deleted users:", JSON.stringify(u.rows));

  // 2) all family-games round/quest data cleared; the seeder re-adds demo
  //    content the moment the tables are empty again
  const p = await pool.query("delete from poll_round");
  const e = await pool.query("delete from emoji_round");
  const ph = await pool.query("delete from photo_round"); // tries/claims leave with the users anyway
  const q = await pool.query("delete from quest_claim");
  const qs = await pool.query("delete from quest");
  console.log(
    "deleted — poll_rounds:", p.rowCount, "emoji_rounds:", e.rowCount,
    "photo_rounds:", ph.rowCount, "quest_claims:", q.rowCount, "quests:", qs.rowCount
  );

  // 3) trivia bank keeps its rows; the daily pinning only needs <bank rows>

  process.exit(0);
})().catch((err: Error) => {
  console.error("cleanup failed:", err.message);
  process.exit(1);
});
