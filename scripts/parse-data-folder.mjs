/**
 * parse-data-folder.mjs
 *
 * Parses all .docx files under data/ and writes scripts/generated/parsed-questions.json.
 *
 * SUPPORTED FORMAT (Graduation Exam Tests — [x] inline correct-answer style):
 *   Question line:  "1.   CS. Tick the ECG sign of sinus bradycardia:"
 *                   "4. CM Choose complications..."
 *   Answer lines:   "a) [x] Correct answer text"   ← [x] marks correct
 *                   "a) [ ] Wrong answer text"
 *                   "a.) [x] Correct answer text"  ← a.) variant also handled
 *
 * Run: node scripts/parse-data-folder.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const OUTPUT_DIR = path.join(ROOT, 'scripts', 'generated');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'parsed-questions.json');

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

// Matches question lines in these variants (case-insensitive):
//   "1.CS text"   "1. CS text"   "1.   CS. text"   "1. CM. text"
//   "4. CM Choose ..."   "282.CS Capitol: ..."
// Group 1 = question number, Group 2 = CM|CS (optional), Group 3 = question text
const QUESTION_PATTERN =
  /^(\d+)\.\s*(?:(CM|CS)\.?\s+)?(\S.+)$/i;

// Matches answer lines in these variants:
//   "a) [x] text"   "a) [ ] text"
//   "a.) [x] text"  "a.) [ ] text"
//   "A) [x] text"   "A. [x] text"
// Group 1 = letter (a-e), Group 2 = bracket content (x or space), Group 3 = answer text
const ANSWER_BRACKET_PATTERN =
  /^([A-Ea-e])[.)]{1,2}\s*\[([^\]]*)\]\s*(.+)$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Returns true when the bracket content indicates a correct answer.
 * Handles ASCII x, Cyrillic х (U+0445), × (U+00D7), checkmark variants.
 */
function isBracketCorrect(bracketContent) {
  const c = bracketContent.trim();
  if (c.length === 0) return false;
  // Whitespace-only (i.e. "[ ]") → wrong
  if (/^\s+$/.test(c)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Core parser — handles [x] inline format
// ---------------------------------------------------------------------------

function parseDocText(rawText, moduleName, filePath) {
  const lines = rawText
    .split('\n')
    .map((line) => line.trim())
    // Drop pure separator lines (dashes, underscores, equals, dots — any length ≥ 3)
    .filter((line) => Boolean(line) && !/^[-–—_=.]{3,}$/.test(line));

  const questions = [];
  let currentQuestion = null;
  let currentAnswer = null;
  const warnings = [];

  const flushQuestion = () => {
    if (!currentQuestion) return;

    if (currentQuestion.answers.length === 0) {
      warnings.push(
        `Q${currentQuestion.question_number}: no answers detected — skipped`
      );
      currentQuestion = null;
      currentAnswer = null;
      return;
    }

    const correctCount = currentQuestion.answers.filter((a) => a.is_correct).length;
    if (correctCount === 0) {
      warnings.push(
        `Q${currentQuestion.question_number}: no correct answer detected — skipped`
      );
      currentQuestion = null;
      currentAnswer = null;
      return;
    }

    currentQuestion.type = correctCount > 1 ? 'multiple' : 'single';
    questions.push(currentQuestion);
    currentQuestion = null;
    currentAnswer = null;
  };

  for (const line of lines) {
    const qMatch = line.match(QUESTION_PATTERN);
    const aMatch = line.match(ANSWER_BRACKET_PATTERN);

    if (qMatch && !aMatch) {
      flushQuestion();

      const questionNumber = Number(qMatch[1]);
      const questionText = normalizeText(qMatch[3]);

      // Skip lines that look like question numbers but are too short to be real questions
      if (questionText.length < 5) continue;

      currentQuestion = {
        module: moduleName,
        question_number: questionNumber,
        type: 'single',
        question_text: questionText,
        answers: [],
      };
      currentAnswer = null;
      continue;
    }

    if (aMatch && currentQuestion) {
      const letter = aMatch[1].toUpperCase();
      const isCorrect = isBracketCorrect(aMatch[2]);
      const answerText = normalizeText(aMatch[3]);

      const answer = { letter, text: answerText, is_correct: isCorrect };
      currentQuestion.answers.push(answer);
      currentAnswer = answer;
      continue;
    }

    // Continuation line: append to answer text or question text
    if (currentQuestion) {
      if (currentAnswer) {
        currentAnswer.text = normalizeText(`${currentAnswer.text} ${line}`);
      } else {
        // Only append if it doesn't look like the start of a new section
        if (!/^\d+\./.test(line)) {
          currentQuestion.question_text = normalizeText(
            `${currentQuestion.question_text} ${line}`
          );
        }
      }
    }
  }

  flushQuestion();

  return { questions, warnings };
}

// ---------------------------------------------------------------------------
// File traversal
// ---------------------------------------------------------------------------

function getDocxFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...getDocxFiles(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.docx')) {
      files.push(fullPath);
    }
  }
  return files;
}

function moduleFromPath(filePath) {
  const rel = path.relative(DATA_DIR, filePath);
  const parts = rel.split(path.sep);
  // Use subfolder name as module (e.g. "Graduation Exam Tests" or "Pediatrics")
  // then the filename stem as sub-module for more precision
  const stem = path.basename(filePath, path.extname(filePath));
  if (parts.length > 1) {
    return stem; // use filename stem so each file gets its own module name
  }
  return stem;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function parseSingleFile(filePath) {
  const moduleName = moduleFromPath(filePath);
  const { value } = await mammoth.extractRawText({ path: filePath });
  const { questions, warnings } = parseDocText(value, moduleName, filePath);
  return {
    file: path.relative(ROOT, filePath),
    module: moduleName,
    questionCount: questions.length,
    warningCount: warnings.length,
    warnings,
    questions,
  };
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    throw new Error(`Missing data folder at ${DATA_DIR}`);
  }

  const docxFiles = getDocxFiles(DATA_DIR).sort((a, b) => a.localeCompare(b));
  if (docxFiles.length === 0) {
    throw new Error(`No .docx files found in ${DATA_DIR}`);
  }

  console.log(`Found ${docxFiles.length} .docx file(s). Parsing...\n`);

  const files = [];
  for (const filePath of docxFiles) {
    const result = await parseSingleFile(filePath);
    files.push(result);

    const status = result.questionCount > 0 ? '✓' : '✗';
    console.log(
      `${status} ${path.relative(ROOT, filePath)}: ${result.questionCount} questions` +
        (result.warningCount > 0 ? ` (${result.warningCount} warnings)` : '')
    );
    if (result.warningCount > 0 && result.questionCount === 0) {
      result.warnings.slice(0, 3).forEach((w) => console.log(`    ⚠ ${w}`));
    }
  }

  const totalQuestions = files.reduce((acc, f) => acc + f.questionCount, 0);
  const totalWarnings = files.reduce((acc, f) => acc + f.warningCount, 0);

  console.log(`\n--- Summary ---`);
  console.log(`Files:     ${files.length}`);
  console.log(`Questions: ${totalQuestions}`);
  console.log(`Warnings:  ${totalWarnings}`);
  console.log(
    `Files with 0 questions: ${files.filter((f) => f.questionCount === 0).length}`
  );

  // Strip warnings from output payload (keep questions only)
  const payload = {
    generatedAt: new Date().toISOString(),
    sourceFolder: 'data',
    totalFiles: files.length,
    totalQuestions,
    files: files.map(({ warnings: _w, warningCount: _wc, ...rest }) => rest),
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\nOutput written to: ${path.relative(ROOT, OUTPUT_FILE)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
