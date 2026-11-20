import type { Database, SqlJsStatic } from "sql.js";

type InitSql = (config: { locateFile: (file: string) => string }) => Promise<SqlJsStatic>;

let loading: Promise<SqlJsStatic> | null = null;

/** Carrega o SQLite (WASM) sob demanda, de /sql/, fora do bundle principal. */
export function loadSqlJs(): Promise<SqlJsStatic> {
  if (!loading) {
    loading = new Promise<SqlJsStatic>((resolve, reject) => {
      const existing = (window as unknown as { initSqlJs?: InitSql }).initSqlJs;
      const start = (init: InitSql) => init({ locateFile: (file) => `/sql/${file}` }).then(resolve, reject);
      if (existing) {
        void start(existing);
        return;
      }
      const script = document.createElement("script");
      script.src = "/sql/sql-wasm.js";
      script.onload = () => {
        const init = (window as unknown as { initSqlJs?: InitSql }).initSqlJs;
        if (init) void start(init);
        else reject(new Error("SQLite não carregou."));
      };
      script.onerror = () => reject(new Error("Não consegui carregar o leitor de SQLite."));
      document.head.appendChild(script);
    });
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** Limite prático: o arquivo inteiro precisa caber na memória do navegador. */
export const SQLITE_MAX_BYTES = 1_500_000_000;

export async function openSqlite(file: File): Promise<Database> {
  if (file.size > SQLITE_MAX_BYTES) {
    throw new Error("Arquivo .db acima de 1,5 GB não cabe na memória do navegador. Exporte para CSV/PGN (.zst) e importe esse.");
  }
  const SQL = await loadSqlJs();
  const buffer = await file.arrayBuffer();
  return new SQL.Database(new Uint8Array(buffer));
}

export type TableInfo = { name: string; columns: string[]; rows: number };

export function listTables(db: Database): TableInfo[] {
  const result = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  const names = (result[0]?.values ?? []).map((row) => String(row[0]));
  return names.map((name) => {
    const quoted = `"${name.replace(/"/g, '""')}"`;
    const info = db.exec(`PRAGMA table_info(${quoted})`);
    const columns = (info[0]?.values ?? []).map((row) => String(row[1]));
    const count = db.exec(`SELECT COUNT(*) FROM ${quoted}`);
    return { name, columns, rows: Number(count[0]?.values[0]?.[0] ?? 0) };
  });
}

/** Encontra, entre os nomes de coluna, o primeiro que combina com algum apelido (sem diferenciar maiúsculas). */
export function pickColumn(columns: string[], aliases: string[]): string | null {
  const lower = new Map(columns.map((column) => [column.toLowerCase().replace(/[^a-z0-9]/g, ""), column]));
  for (const alias of aliases) {
    const hit = lower.get(alias.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (hit) return hit;
  }
  return null;
}

/** Lê a tabela em lotes, para não montar tudo de uma vez. */
export function* iterateRows(db: Database, table: string, columns: string[], batch = 5000): Generator<Array<Record<string, unknown>>> {
  const quoted = (name: string) => `"${name.replace(/"/g, '""')}"`;
  const stmt = db.prepare(`SELECT ${columns.map(quoted).join(", ")} FROM ${quoted(table)}`);
  try {
    let rows: Array<Record<string, unknown>> = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as Record<string, unknown>);
      if (rows.length >= batch) {
        yield rows;
        rows = [];
      }
    }
    if (rows.length > 0) yield rows;
  } finally {
    stmt.free();
  }
}
