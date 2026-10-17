import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

export const destinations = ['inbox', 'reading', 'records', 'blocked'];
export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.db = new DatabaseSync(join(directory, 'letterlane.sqlite'));
    chmodSync(join(directory, 'letterlane.sqlite'), 0o600);
    this.db.exec(`PRAGMA journal_mode=DELETE;
      CREATE TABLE IF NOT EXISTS rules (email TEXT PRIMARY KEY, destination TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, seen INTEGER DEFAULT 0, later INTEGER DEFAULT 0, saved INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS outbox (intent TEXT PRIMARY KEY, status TEXT NOT NULL, gmail_id TEXT, created_at INTEGER NOT NULL);`);
  }
  rules() { return Object.fromEntries(this.db.prepare('SELECT * FROM rules ORDER BY email').all().map(r => [r.email, r.destination])); }
  rule(address, destination) {
    if (destination === 'screen') this.db.prepare('DELETE FROM rules WHERE email=?').run(address);
    else {
      if (!destinations.includes(destination)) throw new Error('Unknown destination.');
      this.db.prepare('INSERT INTO rules VALUES (?,?) ON CONFLICT(email) DO UPDATE SET destination=excluded.destination').run(address, destination);
    }
  }
  states() { return Object.fromEntries(this.db.prepare('SELECT * FROM messages').all().map(s => [s.id, { seen: !!s.seen, later: !!s.later, saved: !!s.saved }])); }
  state(id, field, value) {
    if (!['seen', 'later', 'saved'].includes(field) || typeof value !== 'boolean') throw new Error('Invalid message action.');
    this.db.prepare('INSERT OR IGNORE INTO messages(id) VALUES (?)').run(id);
    this.db.prepare(`UPDATE messages SET ${field}=? WHERE id=?`).run(value ? 1 : 0, id);
  }
  reserveSend(intent) { this.db.prepare('INSERT INTO outbox(intent,status,created_at) VALUES (?, ?, ?)').run(intent, 'uncertain', Date.now()); }
  sent(intent, id) { this.db.prepare('UPDATE outbox SET status=?,gmail_id=? WHERE intent=?').run('sent', id, intent); }
  receipt(intent) { return this.db.prepare('SELECT status,gmail_id FROM outbox WHERE intent=?').get(intent); }
  close() { this.db.close(); }
}
