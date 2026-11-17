// @ts-ignore
import initSqlJs from 'sql.js/dist/sql-wasm-inline.js';
import type { Database, SqlJsStatic } from 'sql.js';
import { DEFAULT_HABITS } from './constants';
import { Habit, HabitLog } from './types';

const DB_NAME = 'executive_notion_sqlite_v1';
const STORE_NAME = 'sqlite_data';
const KEY_NAME = 'binary_snapshot';

let sqlPromise: Promise<SqlJsStatic> | null = null;
let dbInstance: Database | null = null;
let dbInitPromise: Promise<Database> | null = null;
let lastPersistenceError: string | null = null;
const listeners = new Set<() => void>();

export function getPersistenceError(): string | null {
  return lastPersistenceError;
}

function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = (initSqlJs as any)();
  }
  return sqlPromise!;
}

function openIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadSnapshotFromIndexedDB(): Promise<Uint8Array | null> {
  let idb: IDBDatabase | null = null;
  try {
    idb = await openIndexedDB();
    return await new Promise<Uint8Array | null>((resolve) => {
      const tx = idb!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(KEY_NAME);
      req.onsuccess = () => {
        if (req.result instanceof Uint8Array) {
          resolve(req.result);
        } else if (req.result instanceof ArrayBuffer) {
          resolve(new Uint8Array(req.result));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
      tx.oncomplete = () => idb?.close();
      tx.onerror = () => idb?.close();
      tx.onabort = () => idb?.close();
    });
  } catch (err) {
    console.warn('Failed to load SQLite from IndexedDB:', err);
    idb?.close();
    return null;
  }
}

async function persistSnapshotToIndexedDB(data: Uint8Array): Promise<boolean> {
  let idb: IDBDatabase | null = null;
  try {
    idb = await openIndexedDB();
    await new Promise<void>((resolve, reject) => {
      const tx = idb!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(data, KEY_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => idb?.close();
      tx.onerror = () => idb?.close();
      tx.onabort = () => idb?.close();
    });
    lastPersistenceError = null;
    return true;
  } catch (err: any) {
    console.warn('Failed to persist SQLite to IndexedDB:', err);
    lastPersistenceError = err?.message || 'Unable to save to browser storage. Use Export .sqlite to back up your data.';
    idb?.close();
    return false;
  }
}

function parseActiveDays(raw: unknown): number[] | null {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return null;
    const valid = Array.from(
      new Set(
        parsed
          .map((d) => Number(d))
          .filter((d) => Number.isInteger(d) && d >= 1 && d <= 31)
      )
    ).sort((a, b) => a - b);
    return valid;
  } catch {
    return null;
  }
}

function serializeActiveDays(activeDays?: number[] | null): string | null {
  if (!activeDays) return null;
  const cleaned = Array.from(
    new Set(
      activeDays
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d >= 1 && d <= 31)
    )
  ).sort((a, b) => a - b);
  return JSON.stringify(cleaned);
}

function initTables(db: Database) {
  // Check if habits table needs migration to composite primary key (id, month_key)
  try {
    const tableInfo = db.exec("PRAGMA table_info(habits)");
    if (tableInfo.length > 0 && tableInfo[0].values) {
      // Find PK columns: each row is [cid, name, type, notnull, dflt_value, pk]
      const columns = tableInfo[0].values.map((col: any) => String(col[1]));
      const pkColumns = tableInfo[0].values.filter((col: any) => Number(col[5]) > 0).map((col: any) => col[1]);
      if (pkColumns.length === 1 && pkColumns[0] === 'id') {
        const hasActiveDays = columns.includes('active_days');
        db.run(`
          CREATE TABLE habits_temp (
            id TEXT NOT NULL,
            month_key TEXT NOT NULL,
            name TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            active_days TEXT DEFAULT NULL,
            PRIMARY KEY (id, month_key)
          );
          INSERT OR IGNORE INTO habits_temp (id, month_key, name, sort_order, active_days)
          SELECT id, month_key, name, sort_order, ${hasActiveDays ? 'active_days' : 'NULL'} FROM habits;
          DROP TABLE habits;
          ALTER TABLE habits_temp RENAME TO habits;
        `);
      } else if (!columns.includes('active_days')) {
        db.run(`ALTER TABLE habits ADD COLUMN active_days TEXT DEFAULT NULL;`);
      }
    }
  } catch (e) {
    console.warn('Migration check error:', e);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS habits (
      id TEXT NOT NULL,
      month_key TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      active_days TEXT DEFAULT NULL,
      PRIMARY KEY (id, month_key)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS habit_logs (
      habit_id TEXT NOT NULL,
      date_key TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (habit_id, date_key)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS db_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function seedDefaultHabits(db: Database, monthKey: string) {
  const stmt = db.prepare('INSERT OR REPLACE INTO habits (id, month_key, name, sort_order) VALUES (?, ?, ?, ?)');
  try {
    DEFAULT_HABITS.forEach((name, idx) => {
      const id = 'h_' + Math.random().toString(36).substring(2, 9);
      stmt.run([id, monthKey, name, idx]);
    });
  } finally {
    stmt.free();
  }
}

function markMonthInitialized(db: Database, monthKey: string) {
  const stmt = db.prepare('INSERT OR REPLACE INTO db_metadata (key, value) VALUES (?, ?)');
  try {
    stmt.run([`initialized_month:${monthKey}`, '1']);
  } finally {
    stmt.free();
  }
}

function isMonthInitialized(db: Database, monthKey: string): boolean {
  const stmt = db.prepare('SELECT value FROM db_metadata WHERE key = ?');
  try {
    stmt.bind([`initialized_month:${monthKey}`]);
    if (stmt.step()) {
      return stmt.getAsObject().value === '1';
    }
    return false;
  } finally {
    stmt.free();
  }
}

export async function getDatabase(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  if (dbInitPromise) {
    return dbInitPromise;
  }

  dbInitPromise = (async () => {
    try {
      const SQL = await getSql();
      const existingBinary = await loadSnapshotFromIndexedDB();

      if (existingBinary && existingBinary.length > 0) {
        try {
          const restored = new SQL.Database(existingBinary);
          restored.exec('PRAGMA schema_version;');
          initTables(restored);
          dbInstance = restored;
          return dbInstance;
        } catch (e) {
          console.error('Error restoring existing SQLite snapshot, creating clean db:', e);
        }
      }

      const fresh = new SQL.Database();
      initTables(fresh);
      const now = new Date();
      const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      seedDefaultHabits(fresh, currentMonthKey);
      markMonthInitialized(fresh, currentMonthKey);
      dbInstance = fresh;
      await saveDatabase(false);
      return dbInstance;
    } finally {
      dbInitPromise = null;
    }
  })();

  return dbInitPromise;
}

export async function saveDatabase(shouldNotify = false): Promise<boolean> {
  if (!dbInstance) return false;
  const binary = dbInstance.export();
  const persisted = await persistSnapshotToIndexedDB(binary);
  if (shouldNotify) {
    notifyChange();
  }
  return persisted;
}

export function subscribeToDatabaseChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyChange() {
  listeners.forEach((fn) => fn());
}

export async function getHabitsForMonth(monthKey: string): Promise<Habit[]> {
  const db = await getDatabase();
  const stmt = db.prepare('SELECT id, name, active_days FROM habits WHERE month_key = ? ORDER BY sort_order ASC');
  stmt.bind([monthKey]);
  const habits: Habit[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    habits.push({
      id: String(row.id),
      name: String(row.name),
      activeDays: parseActiveDays(row.active_days)
    });
  }
  stmt.free();

  if (habits.length > 0) {
    if (!isMonthInitialized(db, monthKey)) {
      markMonthInitialized(db, monthKey);
      await saveDatabase(false);
    }
    return habits;
  }

  // If this month was explicitly initialized before (e.g. user deleted all habits), keep it empty
  if (isMonthInitialized(db, monthKey)) {
    return [];
  }

  // Otherwise fork from the most recent prior month or seed defaults
  const checkStmt = db.prepare('SELECT DISTINCT month_key FROM habits WHERE month_key < ? ORDER BY month_key DESC LIMIT 1');
  checkStmt.bind([monthKey]);
  let priorMonthKey: string | null = null;
  if (checkStmt.step()) {
    const res = checkStmt.getAsObject();
    priorMonthKey = String(res.month_key);
  }
  checkStmt.free();

  if (priorMonthKey) {
    const priorStmt = db.prepare('SELECT id, name, active_days FROM habits WHERE month_key = ? ORDER BY sort_order ASC');
    priorStmt.bind([priorMonthKey]);
    const priorHabits: Habit[] = [];
    while (priorStmt.step()) {
      const row = priorStmt.getAsObject();
      priorHabits.push({
        id: String(row.id),
        name: String(row.name),
        activeDays: parseActiveDays(row.active_days)
      });
    }
    priorStmt.free();

    const insertStmt = db.prepare('INSERT OR REPLACE INTO habits (id, month_key, name, sort_order, active_days) VALUES (?, ?, ?, ?, ?)');
    try {
      for (let i = 0; i < priorHabits.length; i++) {
        const ph = priorHabits[i];
        insertStmt.run([ph.id, monthKey, ph.name, i, serializeActiveDays(ph.activeDays)]);
        habits.push({ id: ph.id, name: ph.name, activeDays: ph.activeDays ?? null });
      }
    } finally {
      insertStmt.free();
    }
    markMonthInitialized(db, monthKey);
    await saveDatabase(false);
  } else {
    seedDefaultHabits(db, monthKey);
    markMonthInitialized(db, monthKey);
    await saveDatabase(false);
    const freshStmt = db.prepare('SELECT id, name, active_days FROM habits WHERE month_key = ? ORDER BY sort_order ASC');
    freshStmt.bind([monthKey]);
    while (freshStmt.step()) {
      const row = freshStmt.getAsObject();
      habits.push({
        id: String(row.id),
        name: String(row.name),
        activeDays: parseActiveDays(row.active_days)
      });
    }
    freshStmt.free();
  }

  return habits;
}

export async function addHabitToMonth(
  monthKey: string,
  name: string,
  activeDays: number[] | null = null
): Promise<Habit> {
  const db = await getDatabase();
  const orderStmt = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM habits WHERE month_key = ?');
  orderStmt.bind([monthKey]);
  orderStmt.step();
  const nextOrder = Number(orderStmt.getAsObject().next_order ?? 0);
  orderStmt.free();

  const serializedDays = serializeActiveDays(activeDays);
  const normalizedDays = parseActiveDays(serializedDays);

  const id = 'h_' + Math.random().toString(36).substring(2, 9);
  const insertStmt = db.prepare(
    'INSERT OR REPLACE INTO habits (id, month_key, name, sort_order, active_days) VALUES (?, ?, ?, ?, ?)'
  );
  try {
    insertStmt.run([id, monthKey, name, nextOrder, serializedDays]);
  } finally {
    insertStmt.free();
  }
  markMonthInitialized(db, monthKey);

  await saveDatabase(false);
  return { id, name, activeDays: normalizedDays };
}

export async function updateHabitSchedule(
  habitId: string,
  monthKey: string,
  activeDays: number[] | null
): Promise<number[] | null> {
  const db = await getDatabase();
  const serializedDays = serializeActiveDays(activeDays);
  const normalizedDays = parseActiveDays(serializedDays);
  const stmt = db.prepare('UPDATE habits SET active_days = ? WHERE id = ? AND month_key = ?');
  try {
    stmt.run([serializedDays, habitId, monthKey]);
  } finally {
    stmt.free();
  }
  await saveDatabase(false);
  return normalizedDays;
}

export async function updateHabitName(habitId: string, monthKey: string, newName: string): Promise<void> {
  const db = await getDatabase();
  const stmt = db.prepare('UPDATE habits SET name = ? WHERE id = ? AND month_key = ?');
  try {
    stmt.run([newName, habitId, monthKey]);
  } finally {
    stmt.free();
  }
  await saveDatabase(false);
}

export async function deleteHabitFromMonth(habitId: string, monthKey: string): Promise<void> {
  const db = await getDatabase();
  const stmt = db.prepare('DELETE FROM habits WHERE id = ? AND month_key = ?');
  try {
    stmt.run([habitId, monthKey]);
  } finally {
    stmt.free();
  }
  markMonthInitialized(db, monthKey);
  await saveDatabase(false);
}

export async function getAllHabitLogs(): Promise<HabitLog> {
  const db = await getDatabase();
  const stmt = db.prepare('SELECT habit_id, date_key, completed FROM habit_logs WHERE completed = 1');
  const logs: HabitLog = {};
  while (stmt.step()) {
    const row = stmt.getAsObject();
    const habitId = String(row.habit_id);
    const dateKey = String(row.date_key);
    if (!logs[habitId]) {
      logs[habitId] = {};
    }
    logs[habitId][dateKey] = true;
  }
  stmt.free();
  return logs;
}

export async function toggleHabitDate(habitId: string, dateKey: string): Promise<boolean> {
  const db = await getDatabase();
  const checkStmt = db.prepare('SELECT completed FROM habit_logs WHERE habit_id = ? AND date_key = ?');
  checkStmt.bind([habitId, dateKey]);
  let isCurrentlyCompleted = false;
  if (checkStmt.step()) {
    const res = checkStmt.getAsObject();
    isCurrentlyCompleted = Number(res.completed) === 1;
  }
  checkStmt.free();

  if (isCurrentlyCompleted) {
    const delStmt = db.prepare('DELETE FROM habit_logs WHERE habit_id = ? AND date_key = ?');
    try {
      delStmt.run([habitId, dateKey]);
    } finally {
      delStmt.free();
    }
    await saveDatabase(false);
    return false;
  } else {
    const insStmt = db.prepare('INSERT OR REPLACE INTO habit_logs (habit_id, date_key, completed) VALUES (?, ?, 1)');
    try {
      insStmt.run([habitId, dateKey]);
    } finally {
      insStmt.free();
    }
    await saveDatabase(false);
    return true;
  }
}

export async function exportDatabaseFile(): Promise<void> {
  const db = await getDatabase();
  const binary = db.export();
  const blob = new Blob([binary], { type: 'application/x-sqlite3' });
  const url = URL.createObjectURL(blob);
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const filename = `notion_habits_${dateStr}.sqlite`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function importDatabaseFile(file: File): Promise<{ success: boolean; message: string }> {
  try {
    if (dbInitPromise) {
      await dbInitPromise.catch(() => {});
    }

    const buffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(buffer);
    if (uint8.length === 0) {
      return { success: false, message: 'Selected file is empty' };
    }

    const SQL = await getSql();
    const testDb = new SQL.Database(uint8);

    try {
      // Force SQLite header validation before running table creation/migrations
      testDb.exec('PRAGMA schema_version;');
      initTables(testDb);

      const testStmt = testDb.prepare('SELECT count(*) as count FROM habits');
      testStmt.step();
      testStmt.free();
    } catch (innerErr) {
      try {
        testDb.close();
      } catch {
        // ignore close errors
      }
      throw innerErr;
    }

    // Persist migrated binary snapshot rather than raw upload bytes
    const migratedBinary = testDb.export();

    if (dbInstance) {
      try {
        dbInstance.close();
      } catch {
        // ignore close errors
      }
    }
    dbInstance = testDb;
    await persistSnapshotToIndexedDB(migratedBinary);
    notifyChange();

    return { success: true, message: 'Database imported successfully!' };
  } catch (err: any) {
    console.error('Failed to import SQLite database file:', err);
    return { success: false, message: err?.message || 'Invalid SQLite file format' };
  }
}

export async function resetDatabaseWithDefaults(): Promise<void> {
  if (dbInitPromise) {
    await dbInitPromise.catch(() => {});
  }

  const SQL = await getSql();
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore
    }
  }

  const fresh = new SQL.Database();
  initTables(fresh);

  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  seedDefaultHabits(fresh, currentMonthKey);
  markMonthInitialized(fresh, currentMonthKey);
  dbInstance = fresh;

  const binary = dbInstance.export();
  await persistSnapshotToIndexedDB(binary);
  notifyChange();
}
