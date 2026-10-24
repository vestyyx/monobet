// One-off dev cleanup: remove batch-2 test artifacts (test users + all
// poll/emoji rounds), leaving the shared dev/prod DB with fresh demo content
// only. Run: npx tsx scripts/cleanup-fun-test.ts
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  // 1) test users — cascade removes their sessions, ledger rows, votes,
  //    attempts and trivia answers
  const u = await pool.query(
    'delete from "user" where username in (\'panna\', \'admtest\') returning username'
  );
  console.log("deleted users:", JSON.stringify(u.rows));

  // 2) all family games batch-2 round data will be re-seeded fresh
  const p = await pool.query("delete from poll_round");
  const e = await pool.query("delete from emoji_round");
  console.log("poll_rounds deleted:", p.rowCount, "emoji_rounds deleted:", e.rowCount);

  process.exit(0);
})().catch((err: Error) => {
  console.error("cleanup failed:", err.message);
  process.exit(1);
});
