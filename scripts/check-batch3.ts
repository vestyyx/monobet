// Dev check for fun-games batches: recent ledger (photo/quest/poll/emoji),
// balances of the test users, quests + claims, photo rounds + attempts.
import { Pool } from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const l = await pool.query(
    "select u.username, l.kind, l.amount_cents, l.memo from ledger l left join \"user\" u on u.id = l.user_id where l.kind in ('photo','quest') order by l.created_at desc limit 8"
  );
  console.log("ledger:", JSON.stringify(l.rows));
  const b = await pool.query('select username, balance_cents, role from "user" order by username');
  console.log("users:", JSON.stringify(b.rows));
  const q = await pool.query("select qc.id, u.username, qc.status, qc.reward_cents, left(q.title_cs, 30) as quest from quest_claim qc left join \"user\" u on u.id = qc.user_id left join quest q on q.id = qc.quest_id order by qc.created_at desc limit 8");
  console.log("claims:", JSON.stringify(q.rows));
  const pr = await pool.query("select id, status, winner_user_id, revealed_by, reward_cents from photo_round order by created_at desc limit 5");
  console.log("photoRounds:", JSON.stringify(pr.rows));
  const pa = await pool.query("select pa.round_id, u.username, pa.guess, pa.correct from photo_attempt pa left join \"user\" u on u.id = pa.user_id");
  console.log("attempts:", JSON.stringify(pa.rows));
  const a = await pool.query("select action, reason, left(target_id, 8) as target from admin_audit where action like 'game.%' order by created_at desc limit 8");
  console.log("audit:", JSON.stringify(a.rows));
  await pool.end();
})();
