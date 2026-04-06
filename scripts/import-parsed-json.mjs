import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const ROOT = process.cwd();
const INPUT_FILE = path.join(ROOT, 'scripts', 'generated', 'parsed-questions.json');
const DB_FILE = path.join(ROOT, 'medquiz.db');
const IMPORT_TAG = 'data-folder-json-v1';
const VALID_QUESTION_TYPES = ['single', 'multiple'];

function ensureTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('${VALID_QUESTION_TYPES[0]}','${VALID_QUESTION_TYPES[1]}')),
      question_text TEXT NOT NULL,
      deleted_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      answer_text TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      deleted_at DATETIME,
      FOREIGN KEY (question_id) REFERENCES questions(id)
    );

    CREATE TABLE IF NOT EXISTS import_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag TEXT NOT NULL UNIQUE,
      source_file TEXT NOT NULL,
      imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      notes TEXT
    );
  `);
}

function validatePayload(payload) {
  if (!payload || !Array.isArray(payload.files)) {
    throw new Error('Invalid parsed JSON: missing files array.');
  }

  for (const file of payload.files) {
    if (!Array.isArray(file.questions)) {
      throw new Error(`Invalid parsed JSON in ${file.file}: missing questions array.`);
    }
    for (const q of file.questions) {
      if (typeof q.module !== 'string' || typeof q.question_text !== 'string') {
        throw new Error(`Invalid question in ${file.file}.`);
      }
      if (!Array.isArray(q.answers) || q.answers.length === 0) {
        throw new Error(`Question "${q.question_text}" in ${file.file} has no answers.`);
      }
    }
  }
}

function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Missing parsed JSON file: ${INPUT_FILE}. Run npm run parse:data first.`);
  }

  const raw = fs.readFileSync(INPUT_FILE, 'utf8');
  const payload = JSON.parse(raw);
  validatePayload(payload);

  const db = new Database(DB_FILE);
  db.pragma('foreign_keys = ON');
  ensureTables(db);

  const existingRun = db
    .prepare('SELECT id, imported_at FROM import_runs WHERE tag = ?')
    .get(IMPORT_TAG);

  if (existingRun) {
    console.log(
      `Import already executed once (tag: ${IMPORT_TAG}, at: ${existingRun.imported_at}). Skipping.`
    );
    db.close();
    return;
  }

  const insertQuestion = db.prepare(
    'INSERT INTO questions (module, type, question_text) VALUES (?, ?, ?)'
  );
  const insertAnswer = db.prepare(
    'INSERT INTO answers (question_id, answer_text, is_correct) VALUES (?, ?, ?)'
  );
  const markRun = db.prepare(
    'INSERT INTO import_runs (tag, source_file, notes) VALUES (?, ?, ?)'
  );

  let totalQuestions = 0;
  let totalAnswers = 0;

  const runImport = db.transaction(() => {
    for (const file of payload.files) {
      for (const q of file.questions) {
        if (!VALID_QUESTION_TYPES.includes(q.type)) {
          throw new Error(`Invalid question type "${q.type}" in ${file.file}`);
        }

        const type = q.type;
        const questionResult = insertQuestion.run(q.module, type, q.question_text);
        const questionId = Number(questionResult.lastInsertRowid);

        for (const answer of q.answers) {
          insertAnswer.run(questionId, answer.text, answer.is_correct ? 1 : 0);
          totalAnswers += 1;
        }

        totalQuestions += 1;
      }
    }

    markRun.run(
      IMPORT_TAG,
      path.relative(ROOT, INPUT_FILE),
      `files=${payload.files.length},questions=${totalQuestions},answers=${totalAnswers}`
    );
  });

  runImport();
  db.close();

  console.log(`Imported ${totalQuestions} questions and ${totalAnswers} answers.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
