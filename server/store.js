import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(dir) {
    fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, 'missions.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS events_run ON events(run_id, seq);');
  }
  save(run) { this.db.prepare('INSERT INTO runs VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(run.id, JSON.stringify(run)); }
  get(id) { const row = this.db.prepare('SELECT body FROM runs WHERE id=?').get(id); return row ? JSON.parse(row.body) : null; }
  list() { return this.db.prepare('SELECT body FROM runs ORDER BY rowid DESC').all().map(r => JSON.parse(r.body)); }
  deleteRun(id) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM events WHERE run_id=?').run(id);
      this.db.prepare('DELETE FROM runs WHERE id=?').run(id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  event(run, event) {
    this.db.exec('BEGIN');
    try {
      this.save(run);
      const result = this.db.prepare('INSERT INTO events(run_id, body) VALUES (?, ?)').run(run.id, JSON.stringify(event));
      this.db.exec('COMMIT');
      return { ...event, seq: Number(result.lastInsertRowid) };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  events(id, after = 0) { return this.db.prepare('SELECT seq, body FROM events WHERE run_id=? AND seq>? ORDER BY seq LIMIT 3000').all(id, after).map(r => ({ ...JSON.parse(r.body), seq: r.seq })); }
  recover() {
    for (const run of this.list()) {
      if (['planning', 'executing', 'reviewing', 'waiting_confirmation', 'waiting_assignment', 'queued'].includes(run.status)) {
        run.status = 'interrupted'; run.error = '本地服务已重启。点击继续以恢复，已完成的任务将保留。';
        run.activeCalls=[];
        run.tasks.forEach(t => { if (t.status === 'running') t.status = 'interrupted'; });
        run.approvals.forEach(a => { if (a.status === 'pending') a.status = 'expired'; });
        this.save(run);
      }
    }
  }
  close() { this.db.close(); }
}
