// Ask Pique app-layer SQL validator (UI spec §10.2/§10.3). This is
// defense-in-depth, not the real guarantee - that's the ask_pique_ro
// Postgres role (SELECT-only, see the ask_pique_backend migration) that
// ask_pique_run_sql always executes as regardless of what slips past this
// check. This layer exists to fail fast with a clear message instead of
// making a round trip for something the DB would reject anyway, and to cap
// result size before the DB's own LIMIT wrapper even runs.

const DENYLIST =
  /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|reindex|refresh|lock|call|do|pg_read_file|pg_read_binary_file|pg_write|pg_ls_dir|dblink|lo_import|lo_export|set)\b/i;

export interface ValidationResult {
  ok: boolean;
  error?: string;
  sql?: string;
}

export function validateSql(input: string): ValidationResult {
  const sql = input.trim().replace(/;+\s*$/, "");

  if (!sql) return { ok: false, error: "Empty query." };

  if (sql.includes(";")) {
    return { ok: false, error: "Only a single statement is allowed." };
  }

  if (!/^(select|with)\b/i.test(sql)) {
    return { ok: false, error: "Only SELECT (or a read-only WITH) queries are allowed." };
  }

  const denied = sql.match(DENYLIST);
  if (denied) {
    return { ok: false, error: `Query contains a disallowed keyword: "${denied[0]}".` };
  }

  const hasLimit = /\blimit\s+\d+/i.test(sql);
  const bounded = hasLimit ? sql : `${sql} LIMIT 500`;

  return { ok: true, sql: bounded };
}
