import Database from 'better-sqlite3';
import path from 'path';
import { randomBytes } from 'crypto';

const TOKEN_LENGTH = 8;
const TOKEN_COUNT = 25;

function generateToken(): string {
  // Use crypto.randomBytes for cryptographically secure tokens.
  // base64url gives ~1.33 chars/byte; slice to TOKEN_LENGTH after uppercasing.
  return randomBytes(16).toString('base64url').toUpperCase().slice(0, TOKEN_LENGTH);
}

const db = new Database(path.join(process.cwd(), 'medquiz.db'));

db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  active_session_id TEXT
);
`);

const insert = db.prepare('INSERT OR IGNORE INTO users (token) VALUES (?)');

const tokens: string[] = [];
const insertAll = db.transaction(() => {
  while (tokens.length < TOKEN_COUNT) {
    const token = generateToken();
    const result = insert.run(token) as { changes: number };
    if (result.changes > 0) {
      tokens.push(token);
    }
  }
});

insertAll();

console.log('Seeded tokens (distribute securely):');
console.log('--------------------------------------');
tokens.forEach((t, i) => console.log(`${String(i + 1).padStart(2, '0')}. ${t}`));
console.log('--------------------------------------');
console.log(`Total: ${tokens.length} tokens`);

db.close();
