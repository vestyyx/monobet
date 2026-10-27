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
  // 1) test markets from the phase-3 E2E (cascades price points + trades)
  const m = await pool.query(
    "delete from market where slug in ('9xdsszc5', '48sph2dz', 'va3c45kq', 'mgh8b3u9', 'ejr3dg5j') and creator_id in (select id from \"user\" where username in ('panna', 'admtest')) returning slug"
  );
  console.log("deleted markets:", JSON.stringify(m.rows));

  // 2) the E2E squad (members keep their accounts)
  await pool.query(
    'update "user" set squad_id = null, squad_role = null where squad_id in (select id from squad where name = \'Rodina Test\')'
  );
  const sq = await pool.query("delete from squad where name = 'Rodina Test'");
  console.log("deleted squad:", sq.rowCount);

  // 3) test users — cascade removes their sessions, ledger rows, votes,
  //    attempts, quest_claims and trivia answers
  const u = await pool.query(
    'delete from "user" where username in (\'panna\', \'admtest\') returning username'
  );
  console.log("deleted users:", JSON.stringify(u.rows));

  // 4) audit rows the E2E produced stay — the audit log is append-only history

  process.exit(0);
})().catch((err: Error) => {
  console.error("cleanup failed:", err.message);
  process.exit(1);
});
