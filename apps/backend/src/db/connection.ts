import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type SqliteDatabase = Database.Database;

export type DatabaseOptions = {
  path?: string;
};

export function defaultDatabasePath(): string {
  if (process.env.TOPOLOGY_DB_PATH) {
    return process.env.TOPOLOGY_DB_PATH;
  }

  const dataDirectory = process.env.TOPOLOGY_DATA_DIR ?? join(process.cwd(), 'data');
  return join(dataDirectory, 'topology.sqlite');
}

export function openDatabase(options: DatabaseOptions = {}): SqliteDatabase {
  const databasePath = options.path ?? defaultDatabasePath();

  if (databasePath !== ':memory:') {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }

  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  initializeSchema(db);

  return db;
}

export function initializeSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS router_connections (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      base_url TEXT NOT NULL,
      username TEXT NOT NULL,
      password_env_var TEXT NOT NULL,
      ssh_host TEXT,
      ssh_port INTEGER,
      identity_file_env_var TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS discovery_snapshots (
      id TEXT PRIMARY KEY,
      captured_at TEXT NOT NULL,
      topology_json TEXT NOT NULL,
      raw_commands_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS snapshot_routers (
      snapshot_id TEXT NOT NULL,
      router_id TEXT NOT NULL,
      label TEXT NOT NULL,
      base_url TEXT NOT NULL,
      username TEXT NOT NULL,
      password_env_var TEXT NOT NULL,
      ssh_host TEXT,
      ssh_port INTEGER,
      identity_file_env_var TEXT,
      PRIMARY KEY (snapshot_id, router_id),
      FOREIGN KEY (snapshot_id) REFERENCES discovery_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS snapshot_devices (
      snapshot_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      mac_address TEXT NOT NULL,
      ip_addresses_json TEXT NOT NULL,
      discovered_hostname TEXT,
      dhcp_hostname TEXT,
      vendor TEXT,
      wifi_associations_json TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (snapshot_id, device_id),
      FOREIGN KEY (snapshot_id) REFERENCES discovery_snapshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS manual_switches (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      port_count INTEGER,
      notes TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS device_overlays (
      device_id TEXT PRIMARY KEY,
      display_name TEXT,
      hidden INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS overlay_edges (
      id TEXT PRIMARY KEY,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      band TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS overlay_node_positions (
      node_id TEXT PRIMARY KEY,
      x REAL NOT NULL,
      y REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS overlay_hidden_nodes (
      node_id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS overlay_hidden_edges (
      edge_id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  addColumnIfMissing(db, 'router_connections', 'ssh_host', 'TEXT');
  addColumnIfMissing(db, 'router_connections', 'ssh_port', 'INTEGER');
  addColumnIfMissing(db, 'router_connections', 'identity_file_env_var', 'TEXT');
  addColumnIfMissing(db, 'discovery_snapshots', 'raw_commands_json', "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(db, 'snapshot_routers', 'ssh_host', 'TEXT');
  addColumnIfMissing(db, 'snapshot_routers', 'ssh_port', 'INTEGER');
  addColumnIfMissing(db, 'snapshot_routers', 'identity_file_env_var', 'TEXT');
  addColumnIfMissing(db, 'manual_switches', 'notes', 'TEXT');
  addColumnIfMissing(db, 'manual_switches', 'tags_json', "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(db, 'manual_switches', 'hidden', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'device_overlays', 'tags_json', "TEXT NOT NULL DEFAULT '[]'");
}

function addColumnIfMissing(db: SqliteDatabase, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((existingColumn) => existingColumn.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
