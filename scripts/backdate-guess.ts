// One-off dev helper: backdate every open closest-guess round so its reveal
// button unlocks in /admin/guess (testing convenience only).
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED,
  ssl: { rejectUnauthorized: false },
});

pool
  .query("UPDATE guess_round SET close_at = now() - interval '1 minute' WHERE status = 'open'")
  .then((r: { rowCount: number | null }) => {
    console.log("backdated rows:", r.rowCount);
    process.exit(0);
  })
  .catch((e: Error) => {
    console.error("failed:", e.message);
    process.exit(1);
  });

