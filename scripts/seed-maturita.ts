// Maturitní seed: removes test/personal markets, creates the academic
// categories and six showcase markets (4 binary, 2 multiple-choice) using the
// same LMSR seeding as createMarket in lib/actions.ts.
//   npx tsx scripts/seed-maturita.ts          # dry run — reports, no writes
//   npx tsx scripts/seed-maturita.ts --apply  # executes
import { config } from "dotenv";
config({ path: ".env.local" });
config();

const APPLY = process.argv.includes("--apply");

const BANNED_WORDS = ["developer", "Franko", "Juraj", "Fischer", "Němeček", "Covered"];
const BANNED_CATEGORY = "SGaSOŠ";
const CATEGORIES = ["Ekonomika", "Technologie & AI", "Věda", "Politika", "Sport"];

// Standard liquidity tier (see components/market-form.tsx).
const B = 1000;

type BinarySeed = { kind: "binary"; question: string; category: string; prob: number; closesAt: string; description: string };
type GroupSeed = { kind: "group"; question: string; category: string; options: { label: string; prob: number }[]; closesAt: string; description: string };

const MARKETS: (BinarySeed | GroupSeed)[] = [
  {
    kind: "binary",
    question: "Překoná cena Bitcoinu hranici 150 000 USD do konce roku 2026?",
    category: "Ekonomika",
    prob: 0.32,
    closesAt: "2026-12-31T22:59:00Z",
    description: "Trh se vyhodnotí jako ANO, pokud cena BTC/USD na některé z hlavních burz (např. Coinbase, Kraken, Bitstamp) dosáhne nebo překoná 150 000 USD kdykoli před koncem roku 2026.",
  },
  {
    kind: "binary",
    question: "Vydá společnost OpenAI model GPT-6 do konce roku 2026?",
    category: "Technologie & AI",
    prob: 0.41,
    closesAt: "2026-12-31T22:59:00Z",
    description: "ANO, pokud OpenAI do 31. 12. 2026 veřejně zpřístupní (API nebo ChatGPT) model oficiálně pojmenovaný GPT-6.",
  },
  {
    kind: "binary",
    question: "Přijme Česká republika společnou měnu euro do roku 2030?",
    category: "Politika",
    prob: 0.07,
    closesAt: "2029-12-31T22:59:00Z",
    description: "ANO, pokud se euro stane zákonným platidlem v České republice nejpozději 31. 12. 2029 (zdroj: ČNB, Evropská komise).",
  },
  {
    kind: "binary",
    question: "Přistane lidská posádka mise Artemis na povrchu Měsíce do konce roku 2028?",
    category: "Věda",
    prob: 0.38,
    closesAt: "2028-12-31T22:59:00Z",
    description: "ANO, pokud astronauti v rámci programu NASA Artemis přistanou na povrchu Měsíce do 31. 12. 2028 (zdroj: NASA).",
  },
  {
    kind: "group",
    question: "Jaká bude průměrná roční míra inflace v ČR za rok 2026 podle ČSÚ?",
    category: "Ekonomika",
    options: [
      { label: "Pod 2,0 %", prob: 0.18 },
      { label: "2,0 % – 2,9 %", prob: 0.44 },
      { label: "3,0 % – 4,0 %", prob: 0.28 },
      { label: "Nad 4,0 %", prob: 0.1 },
    ],
    closesAt: "2026-12-31T22:59:00Z",
    description: "Vyhodnocuje se podle průměrné roční míry inflace za rok 2026, kterou zveřejní Český statistický úřad (ČSÚ) v lednu 2027.",
  },
  {
    kind: "group",
    question: "Jakého nejlepšího výsledku dosáhne česká reprezentace na příštím MS v ledním hokeji?",
    category: "Sport",
    options: [
      { label: "Zlato", prob: 0.2 },
      { label: "Stříbro", prob: 0.17 },
      { label: "Bronz", prob: 0.23 },
      { label: "4. místo a horší", prob: 0.4 },
    ],
    closesAt: "2027-05-14T22:59:00Z",
    description: "Vyhodnocuje se podle konečného umístění české mužské reprezentace na nejbližším mistrovství světa IIHF v ledním hokeji (2027).",
  },
];

const SLUG_ABC = "abcdefghjkmnpqrstuvwxyz23456789";
function newSlug(len = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => SLUG_ABC[b % SLUG_ABC.length]).join("");
}

async function main() {
  const { db, schema, pool } = await import("../lib/db");
  const { eq, ilike, inArray, or, sql } = await import("drizzle-orm");
  const { qForProb, multiQForProb, houseSeedCents } = await import("../lib/lmsr");
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

  const uniqueSlug = async (tx: Tx): Promise<string> => {
    for (let i = 0; i < 8; i++) {
      const s = newSlug();
      const [hit] = await tx.select({ id: schema.market.id }).from(schema.market).where(eq(schema.market.slug, s)).limit(1);
      if (!hit) return s;
    }
    throw new Error("Could not allocate a slug");
  };

  // a) Markets to delete — matching question/category, plus the whole group
  // when only an option matches (children cascade with the parent).
  const matched = await db
    .select({ id: schema.market.id, parentId: schema.market.parentId, question: schema.market.question, category: schema.market.category })
    .from(schema.market)
    .where(
      or(
        eq(schema.market.category, BANNED_CATEGORY),
        ...BANNED_WORDS.map((w) => ilike(schema.market.question, `%${w}%`))
      )
    );
  const deleteIds = [...new Set(matched.map((m) => m.parentId ?? m.id))];
  console.log(`markets to delete: ${deleteIds.length} (matched rows: ${matched.length})`);
  for (const m of matched.filter((m) => !m.parentId || !deleteIds.includes(m.id))) console.log(`  [${m.category}] ${m.question}`);

  const existingQuestions = new Set(
    (await db.select({ q: schema.market.question }).from(schema.market).where(inArray(schema.market.question, MARKETS.map((m) => m.question)))).map((r) => r.q)
  );
  const toCreate = MARKETS.filter((m) => !existingQuestions.has(m.question));
  console.log(`categories to ensure: ${CATEGORIES.join(", ")}`);
  console.log(`markets to create: ${toCreate.length} (already present: ${MARKETS.length - toCreate.length})`);

  if (!APPLY) {
    console.log("\ndry run — pass --apply to execute");
    await pool.end();
    return;
  }

  const superEmail = (process.env.SUPER_ADMIN_EMAIL ?? "").toLowerCase();
  const [creator] = superEmail
    ? await db.select({ id: schema.user.id }).from(schema.user).where(sql`lower(${schema.user.email}) = ${superEmail}`).limit(1)
    : [];

  const result = await db.transaction(async (tx) => {
    const deleted = deleteIds.length
      ? (await tx.delete(schema.market).where(inArray(schema.market.id, deleteIds)).returning({ id: schema.market.id })).length
      : 0;
    // Anything still filed under the banned category (shouldn't remain) moves to "Other".
    await tx.update(schema.market).set({ category: "Other" }).where(eq(schema.market.category, BANNED_CATEGORY));
    await tx.delete(schema.category).where(eq(schema.category.name, BANNED_CATEGORY));

    // b) Categories
    const [max] = await tx.select({ n: sql<number>`coalesce(max(${schema.category.sortIndex}),0)::int` }).from(schema.category);
    for (const [i, name] of CATEGORIES.entries()) {
      await tx.insert(schema.category).values({ name, sortIndex: (max?.n ?? 0) + i + 1, creatorId: creator?.id ?? null }).onConflictDoNothing();
    }

    // c) Markets — same shape as createMarket().
    for (const m of toCreate) {
      const common = {
        description: m.description,
        category: m.category,
        status: "live" as const,
        creatorId: creator?.id ?? null,
        b: B,
        closesAt: new Date(m.closesAt),
      };
      if (m.kind === "binary") {
        const [row] = await tx
          .insert(schema.market)
          .values({ ...common, slug: await uniqueSlug(tx), question: m.question, qYes: qForProb(m.prob, B).toFixed(6), qNo: "0", volumeCents: houseSeedCents(B), seedCents: houseSeedCents(B) })
          .returning({ id: schema.market.id });
        await tx.insert(schema.pricePoint).values({ marketId: row.id, yesPrice: m.prob.toFixed(5) });
        continue;
      }
      const [parent] = await tx
        .insert(schema.market)
        .values({ ...common, slug: await uniqueSlug(tx), question: m.question, kind: "group" })
        .returning({ id: schema.market.id });
      const base = m.question.replace(/[?？!.\s]+$/g, "");
      const wSum = m.options.reduce((s, o) => s + o.prob, 0);
      for (const [i, opt] of m.options.entries()) {
        const p = opt.prob / wSum;
        const [child] = await tx
          .insert(schema.market)
          .values({
            ...common,
            slug: await uniqueSlug(tx),
            question: `${base} — ${opt.label}?`,
            kind: "option",
            parentId: parent.id,
            label: opt.label,
            sortIndex: i,
            qYes: multiQForProb(p, B).toFixed(6),
            qNo: "0",
            volumeCents: houseSeedCents(B),
            seedCents: houseSeedCents(B),
          })
          .returning({ id: schema.market.id });
        await tx.insert(schema.pricePoint).values({ marketId: child.id, yesPrice: p.toFixed(5) });
      }
    }
    return { deleted, created: toCreate.length };
  });

  console.log(`\nmarkets deleted: ${result.deleted}`);
  console.log(`markets created: ${result.created}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
