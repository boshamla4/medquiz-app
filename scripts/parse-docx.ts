/**
 * parse-docx.ts
 * Usage:
 *   npx ts-node scripts/parse-docx.ts <path-to-docx> <module-name> [--promote]
 */

import mammoth from 'mammoth';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

interface ParsedAnswer {
  letter: string;
  text: string;
  is_correct: boolean;
}

interface ParsedQuestion {
  number: number;
  question_text: string;
  type: 'single' | 'multiple';
  answers: ParsedAnswer[];
}

function parseQcmText(text: string): ParsedQuestion[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const questions: ParsedQuestion[] = [];
  let currentQuestion: Partial<ParsedQuestion> | null = null;
  let qNumber = 0;

  // Matches: "1.", "Q1.", "Question 1:", "1)"
  const questionPattern = /^(?:Q(?:uestion)?\s*)?(\d+)[.):\s]/i;
  // Matches: "A.", "a.", "A)", "(A)"
  const answerPattern = /^(?:\()?([A-Ea-e])[.)]\s*(.*)/;

  for (const line of lines) {
    const qMatch = questionPattern.exec(line);
    const aMatch = answerPattern.exec(line);

    if (qMatch && !aMatch) {
      // Save previous question
      if (currentQuestion?.question_text && currentQuestion.answers?.length) {
        const correctCount = currentQuestion.answers.filter((a) => a.is_correct).length;
        currentQuestion.type = correctCount > 1 ? 'multiple' : 'single';
        questions.push(currentQuestion as ParsedQuestion);
      }

      qNumber++;
      const questionText = line
        .replace(questionPattern, '')
        .replace(/\*\*/g, '')
        .trim();

      currentQuestion = {
        number: qNumber,
        question_text: questionText,
        type: 'single',
        answers: [],
      };
    } else if (aMatch && currentQuestion) {
      const letter = aMatch[1].toUpperCase();
      const rawText = aMatch[2].trim();

      // Correct answer: starts with *, ends with *, contains "(correct)", or surrounded by **
      let isCorrect = false;
      let answerText = rawText;

      if (
        answerText.startsWith('*') ||
        answerText.toLowerCase().includes('(correct)') ||
        answerText.startsWith('**') ||
        answerText.endsWith('**')
      ) {
        isCorrect = true;
        answerText = answerText
          .replace(/^\*+/, '')
          .replace(/\*+$/, '')
          .replace(/\(correct\)/i, '')
          .trim();
      }

      currentQuestion.answers = currentQuestion.answers ?? [];
      currentQuestion.answers.push({ letter, text: answerText, is_correct: isCorrect });
    } else if (currentQuestion && !aMatch && line.length > 0) {
      // Continuation of question text
      if (!questionPattern.test(line)) {
        const extra = line.replace(/\*\*/g, '').trim();
        if (extra) {
          currentQuestion.question_text =
            (currentQuestion.question_text ?? '') + ' ' + extra;
        }
      }
    }
  }

  // Save last question
  if (currentQuestion?.question_text && currentQuestion.answers?.length) {
    const correctCount = (currentQuestion.answers ?? []).filter((a) => a.is_correct).length;
    currentQuestion.type = correctCount > 1 ? 'multiple' : 'single';
    questions.push(currentQuestion as ParsedQuestion);
  }

  return questions;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: npx ts-node scripts/parse-docx.ts <path-to-docx> <module-name> [--promote]');
    process.exit(1);
  }

  const docxPath = args[0];
  const moduleName = args[1];
  const shouldPromote = args.includes('--promote');

  if (!fs.existsSync(docxPath)) {
    console.error(`File not found: ${docxPath}`);
    process.exit(1);
  }

  console.log(`Parsing: ${docxPath}`);
  console.log(`Module: ${moduleName}`);

  const { value: text } = await mammoth.extractRawText({ path: docxPath });
  const questions = parseQcmText(text);

  console.log(`Found ${questions.length} questions`);

  const db = new Database(path.join(process.cwd(), 'medquiz.db'));
  db.pragma('foreign_keys = ON');

  db.exec(`
  CREATE TABLE IF NOT EXISTS parse_staging (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    imported_at DATETIME,
    status TEXT NOT NULL DEFAULT 'pending'
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('single','multiple')),
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
  `);

  const rawJson = JSON.stringify(questions, null, 2);

  const stagingResult = db
    .prepare('INSERT INTO parse_staging (module, raw_json, status) VALUES (?, ?, ?)')
    .run(moduleName, rawJson, 'pending') as { lastInsertRowid: number | bigint };

  const stagingId = Number(stagingResult.lastInsertRowid);
  console.log(`Saved to parse_staging with id=${stagingId}`);

  if (shouldPromote) {
    console.log('Promoting to questions/answers tables...');

    const insertQuestion = db.prepare(
      'INSERT INTO questions (module, type, question_text) VALUES (?, ?, ?)'
    );
    const insertAnswer = db.prepare(
      'INSERT INTO answers (question_id, answer_text, is_correct) VALUES (?, ?, ?)'
    );
    const markImported = db.prepare(
      "UPDATE parse_staging SET status = 'imported', imported_at = CURRENT_TIMESTAMP WHERE id = ?"
    );

    let promoted = 0;

    const promoteAll = db.transaction(() => {
      for (const q of questions) {
        const qResult = insertQuestion.run(moduleName, q.type, q.question_text) as {
          lastInsertRowid: number | bigint;
        };
        const questionId = Number(qResult.lastInsertRowid);

        for (const a of q.answers) {
          insertAnswer.run(questionId, a.text, a.is_correct ? 1 : 0);
        }

        promoted++;
      }

      markImported.run(stagingId);
    });

    promoteAll();
    console.log(`Promoted ${promoted} questions to the database.`);
  } else {
    console.log('Run with --promote flag to import questions into the database.');
    console.log('\nPreview (first 3 questions):');
    questions.slice(0, 3).forEach((q, i) => {
      console.log(`\n[${i + 1}] (${q.type}) ${q.question_text}`);
      q.answers.forEach((a) => {
        const mark = a.is_correct ? '✓' : ' ';
        console.log(`  [${mark}] ${a.letter}. ${a.text}`);
      });
    });
  }

  db.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
