import { loadConfig } from "./config.js";
import { createPool } from "./db.js";

// Read-only connectivity + schema check. Does NOT modify any data.
async function main(): Promise<void> {
  const cfg = loadConfig();
  console.log(
    `Connecting to ${cfg.pg.user}@${cfg.pg.host}:${cfg.pg.port}/${cfg.pg.database} (sslmode=${cfg.pg.sslmode})...`,
  );
  const pool = createPool(cfg);

  try {
    // 1. Basic connectivity + server info.
    const ping = await pool.query("SELECT version() AS version, now() AS now;");
    console.log("\n✅ Connected.");
    console.log("  Server:", String(ping.rows[0].version).split(",")[0]);
    console.log("  Server time:", ping.rows[0].now);

    const sp = await pool.query("SHOW search_path;");
    console.log("  search_path:", sp.rows[0].search_path);

    // 2. Verify the columns we rely on exist in the active schema's tables.
    const checks: Array<{ table: string; columns: string[] }> = [
      { table: "accounts", columns: ["id", "emailAssociated"] },
      {
        table: "subscriptions",
        columns: [
          "id",
          "accountId",
          "status",
          "renewalDateTime",
          "deletedAt",
          "subscriptionId",
          "pauseCollection",
          "createdAt",
        ],
      },
    ];

    for (const { table, columns } of checks) {
      // Resolve the table via the active search_path (matches how the app queries it).
      const reg = await pool.query("SELECT to_regclass($1) AS oid;", [table]);
      if (!reg.rows[0].oid) {
        console.log(`\n❌ Table "${table}" not resolvable via search_path.`);
        continue;
      }
      const res = await pool.query(
        `SELECT a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS data_type
         FROM pg_attribute a
         WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attnum;`,
        [table],
      );
      const present = new Set(res.rows.map((r) => String(r.column_name)));
      console.log(`\nTable "${table}" (${reg.rows[0].oid}) — ${res.rows.length} columns.`);
      for (const col of columns) {
        const type = res.rows.find((r) => String(r.column_name) === col)?.data_type;
        console.log(`  ${present.has(col) ? "✅" : "❌ MISSING"}  ${col}${type ? ` (${type})` : ""}`);
      }
    }

    console.log("\nDone. (No data was modified.)");
  } catch (err) {
    console.error("\n❌ DB check failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main();
