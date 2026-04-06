import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const OUTPUT_DIR = path.join(ROOT, 'scripts', 'generated');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'parsed-questions.json');

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function parseKeyAnswers(rawText) {
  const lines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const startIdx = lines.findIndex((line) => /^KEY answers/i.test(line));
  if (startIdx === -1) {
    return new Map();
  }

  const answerMap = new Map();

  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^(\d+)\s*[-–—]\s*([A-E](?:\s*,\s*[A-E])*)\.?$/i);
    if (!match) {
      continue;
    }
    const qNum = Number(match[1]);
    const letters = match[2]
      .split(',')
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean);
    answerMap.set(qNum, new Set(letters));
  }

  return answerMap;
}

function parseDocText(rawText, moduleName) {
  const lines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const keyAnswers = parseKeyAnswers(rawText);
  const questions = [];
  const questionPattern = /^(\d+)\.(CM|CS)\s+(.+)$/i;
  const answerPattern = /^([A-E])\.\s*(.*)$/i;

  let currentQuestion = null;
  let currentAnswer = null;

  const flushQuestion = () => {
    if (!currentQuestion || currentQuestion.answers.length === 0) {
      return;
    }
    const correctCount = currentQuestion.answers.filter((a) => a.is_correct).length;
    currentQuestion.type = correctCount > 1 ? 'multiple' : 'single';
    questions.push(currentQuestion);
  };

  for (const line of lines) {
    if (/^KEY answers/i.test(line)) {
      break;
    }

    const qMatch = line.match(questionPattern);
    if (qMatch) {
      flushQuestion();
      const questionNumber = Number(qMatch[1]);
      const sourceType = qMatch[2].toUpperCase();
      const questionText = normalizeText(qMatch[3]);
      const correctSet = keyAnswers.get(questionNumber) ?? new Set();

      currentQuestion = {
        module: moduleName,
        question_number: questionNumber,
        source_type: sourceType,
        type: sourceType === 'CM' ? 'multiple' : 'single',
        question_text: questionText,
        answers: [],
      };
      currentAnswer = null;
      continue;
    }

    if (!currentQuestion) {
      continue;
    }

    const aMatch = line.match(answerPattern);
    if (aMatch) {
      const letter = aMatch[1].toUpperCase();
      const answerText = normalizeText(aMatch[2]);
      const isCorrect = (keyAnswers.get(currentQuestion.question_number) ?? new Set()).has(letter);

      const answer = {
        letter,
        text: answerText,
        is_correct: isCorrect,
      };
      currentQuestion.answers.push(answer);
      currentAnswer = answer;
      continue;
    }

    if (currentAnswer) {
      currentAnswer.text = normalizeText(`${currentAnswer.text} ${line}`);
    } else {
      currentQuestion.question_text = normalizeText(`${currentQuestion.question_text} ${line}`);
    }
  }

  flushQuestion();
  return questions;
}

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
  if (parts.length > 1) {
    return parts[0];
  }
  return path.basename(filePath, path.extname(filePath));
}

async function parseSingleFile(filePath) {
  const moduleName = moduleFromPath(filePath);
  const { value } = await mammoth.extractRawText({ path: filePath });
  const questions = parseDocText(value, moduleName);
  return {
    file: path.relative(ROOT, filePath),
    module: moduleName,
    questionCount: questions.length,
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

  const files = [];
  for (const filePath of docxFiles) {
    const parsed = await parseSingleFile(filePath);
    files.push(parsed);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceFolder: 'data',
    totalFiles: files.length,
    totalQuestions: files.reduce((acc, file) => acc + file.questionCount, 0),
    files,
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`Parsed ${payload.totalFiles} file(s), ${payload.totalQuestions} questions.`);
  console.log(`Output written to: ${path.relative(ROOT, OUTPUT_FILE)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
