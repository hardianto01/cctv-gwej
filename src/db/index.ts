import { Database } from 'bun:sqlite';
import { Camera, CameraEvent } from '../core/types';

const db = new Database('cctv.db', { create: true });

// Schema Migrations
db.run(`
  CREATE TABLE IF NOT EXISTS cameras (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    ip TEXT NOT NULL,
    port INTEGER DEFAULT 2020,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    rtspUrl TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    personDetection INTEGER DEFAULT 1,
    status TEXT DEFAULT 'offline'
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    cameraId TEXT NOT NULL,
    cameraName TEXT NOT NULL,
    type TEXT NOT NULL,
    timestamp TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Repository: Settings
export const SettingsRepo = {
  get(key: string, defaultValue: string = ''): string {
    const row = db.query('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | null;
    return row ? row.value : defaultValue;
  },
  set(key: string, value: string) {
    db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  },
  getAll(): Record<string, string> {
    const rows = db.query('SELECT key, value FROM settings').all() as { key: string, value: string }[];
    const res: Record<string, string> = {};
    for (const r of rows) res[r.key] = r.value;
    return res;
  }
};

// Seed default settings if empty
if (!SettingsRepo.get('admin_username')) {
  SettingsRepo.set('admin_username', 'admin');
  SettingsRepo.set('admin_password_hash', Bun.password.hashSync('admin123'));
  SettingsRepo.set('telegram_bot_token', process.env.TELEGRAM_BOT_TOKEN || '');
  SettingsRepo.set('telegram_chat_id', process.env.TELEGRAM_CHAT_ID || '');
}

// Repository: Cameras
export const CameraRepo = {
  getAll(): Camera[] {
    const rows = db.query('SELECT * FROM cameras').all() as any[];
    return rows.map(r => ({
      ...r,
      enabled: Boolean(r.enabled),
      personDetection: Boolean(r.personDetection)
    }));
  },
  getById(id: string): Camera | null {
    const r = db.query('SELECT * FROM cameras WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      ...r,
      enabled: Boolean(r.enabled),
      personDetection: Boolean(r.personDetection)
    };
  },
  upsert(cam: Camera) {
    db.run(`
      INSERT INTO cameras (id, name, ip, port, username, password, rtspUrl, enabled, personDetection, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        ip = excluded.ip,
        port = excluded.port,
        username = excluded.username,
        password = excluded.password,
        rtspUrl = excluded.rtspUrl,
        enabled = excluded.enabled,
        personDetection = excluded.personDetection,
        status = excluded.status
    `, [
      cam.id, cam.name, cam.ip, cam.port, cam.username, cam.password,
      cam.rtspUrl, cam.enabled ? 1 : 0, cam.personDetection ? 1 : 0, cam.status || 'offline'
    ]);
  },
  updateStatus(id: string, status: 'online' | 'offline') {
    db.run('UPDATE cameras SET status = ? WHERE id = ?', [status, id]);
  },
  delete(id: string) {
    db.run('DELETE FROM cameras WHERE id = ?', [id]);
  }
};

// Repository: Events
export const EventRepo = {
  add(event: CameraEvent) {
    db.run(`
      INSERT INTO events (id, cameraId, cameraName, type, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `, [event.id, event.cameraId, event.cameraName, event.type, event.timestamp]);
  },
  getLatest(limit: number = 50): CameraEvent[] {
    return db.query('SELECT * FROM events ORDER BY timestamp DESC LIMIT ?').all(limit) as CameraEvent[];
  }
};
