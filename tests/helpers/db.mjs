import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
// Executes the production SQL against SQLite, including transactional D1 batches.
export function database(t) {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync(new URL('../../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL('../../drizzle/' + file, import.meta.url), 'utf8'));
  t.after(() => sql.close());
  const db = {
    sql, beforeBatch: null,
    prepare(query) {
      const statement = { query, args: [], bind(...args) { this.args = args; return this; },
        async first() { return sql.prepare(query).get(...this.args) || null; },
        async all() { return { results: sql.prepare(query).all(...this.args) }; },
        async run() { return { success: true, meta: { changes: Number(sql.prepare(query).run(...this.args).changes) } }; },
      }; return statement;
    },
    async batch(statements) {
      if (this.beforeBatch) { const hook = this.beforeBatch; this.beforeBatch = null; hook(); }
      sql.exec('BEGIN');
      try { const results = []; for (const st of statements) results.push(await st.run()); sql.exec('COMMIT'); return results; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  }; return db;
}
