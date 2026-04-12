/**
 * audit-ground-truth.mjs — Independent question counter (READ-ONLY diagnostic)
 *
 * Does NOT reuse any parser logic. Uses raw text scanning with different heuristics
 * to independently estimate the actual question count in each .docx file.
 *
 * Approach:
 *   - Bracket format: count distinct question-number lines OR count [x]/[X] groups
 *   - Explicit correct: count "Correct answer:" occurrences
 *   - Answer-key format: count answer letters in the key section
 *   - Nested OL format (Nephrology): count OL items that contain sub-OLs
 */

import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');

function getDocxFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) files.push(...getDocxFiles(fullPath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.docx')) files.push(fullPath);
  }
  return files;
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Method A: count bracket-answered questions
// A question = one or more [x] or [X] bracket answers
// Count by finding lines that are numbered question stems
function countByNumberedQLines(text) {
  const lines = text.split(/\n|(?<=\.)\s+(?=\d+\.)/).map(l => l.trim()).filter(Boolean);
  let count = 0;
  let inQuestion = false;
  for (const line of lines) {
    if (/^\d{1,3}[.)]\s*(CS|CM)?\s*.{5,}/i.test(line)) {
      count++;
      inQuestion = true;
    }
  }
  return count;
}

// Method B: count correct-answer markers (one per question)
function countByCorrectAnswerMarkers(text) {
  return (text.match(/Correct\s+answers?\s*[:\-]?\s*[A-E]/gi) || []).length;
}

// Method C: count bracket-marked correct answers (each [x]/[X] is in one question)
// Count distinct "groups" separated by new question starts
function countByBracketGroups(text, html) {
  // Each question = one group of bracket answers following a question line
  // Count transitions from non-bracket to bracket area
  const lines = html.split(/(?=<p>)|(?=<li>)/).map(l => {
    const t = l.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return t;
  }).filter(Boolean);

  let count = 0;
  let inAnswerBlock = false;

  for (const line of lines) {
    const hasBracket = /\[[xX×хХ✓ ]\]/.test(line);
    const isQuestion = /^\d{1,3}[.)]\s*(CS|CM)?\s*.{5,}/.test(line) ||
                       /^(CS|CM)[.):]?\s+.{5,}/.test(line);

    if (isQuestion && !hasBracket) {
      inAnswerBlock = false;
    }
    if (hasBracket && !inAnswerBlock) {
      // New bracket group started → new question
      // Check if previous line was a question
      count++;
      inAnswerBlock = true;
    }
    if (!hasBracket && inAnswerBlock) {
      inAnswerBlock = false;
    }
  }
  return count;
}

// Method D: count answer key letters for text-format keys
function countByAnswerKeyLength(text) {
  // Find the answer key section (last 40% of doc)
  const tail = text.slice(Math.floor(text.length * 0.6));

  // Try to find a run of answer letters
  // Look for patterns like "1. A 2. B 3. C" or "ABCDE..." or "SC: A, B, C..."

  const numberedMatches = [...tail.matchAll(/\d+\s*[.)]\s*([A-Ea-e])/g)];
  if (numberedMatches.length >= 5) return numberedMatches.length;

  // Try extracting a dense run of A-E letters
  const cleanTail = tail.replace(/[^A-Ea-e,\s.;]/g, ' ');
  const letterRuns = cleanTail.match(/\b([A-E])\b/g) || [];
  return letterRuns.length;
}

// Method E: count OL blocks in HTML (for nested-OL format like Nephrology)
function countNestedOlItems(html) {
  // Count <li> items that contain a nested <ol> — each represents one Q+answers block
  const nestedOlMatches = [...html.matchAll(/<li>[^<]*(?:<(?!ol|\/ol)[^>]+>[^<]*)*<ol>/g)];
  return nestedOlMatches.length;
}

// Method F: count by CS/CM prefixes (per line)
function countByCsCmPrefixes(text) {
  return (text.match(/^(CS|CM)[.):\s]/gim) || []).length;
}

// Method G: count answer-key OL items in Surgery 5th format
function countSurgery5thAnswers(html) {
  // Find bold OL blocks after "KEY answers" markers
  let total = 0;
  const keyRe = /KEY\s+answers[\s\S]*?<ol>([\s\S]*?)<\/ol>/gi;
  let km;
  while ((km = keyRe.exec(html)) !== null) {
    const items = [...km[1].matchAll(/<li>/g)].length;
    total += items;
  }
  return total;
}

async function analyzeFile(filePath) {
  const filename = path.basename(filePath);
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');

  const { value: html } = await mammoth.convertToHtml({ path: filePath });
  const text = stripHtml(html);

  // Detect format
  const hasBracket = /\[[xX×хХ✓ ]\]/.test(text);
  const hasExplicitCorrect = /Correct\s+answer/i.test(text);
  const isSurgery5th = filename === 'Surgery_5th year_Timis.docx';
  const isSurgery3rd = filename === 'Surgery_3rd year_Vescu.docx';

  // Check for Nephrology-style nested OL
  const nestedOlCount = countNestedOlItems(html);
  const hasNestedOl = nestedOlCount > 5;

  // Check for OL-key format (Pediatrics)
  const olMatches = [...html.matchAll(/<ol>([\s\S]*?)<\/ol>/g)];

  let format = '';
  let groundTruth = 0;
  const methods = {};

  if (isSurgery5th) {
    format = 'Surgery5th (per-section key)';
    methods.keyAnswerCount = countSurgery5thAnswers(html);
    groundTruth = methods.keyAnswerCount;
  } else if (isSurgery3rd) {
    format = 'Surgery3rd (underline markers)';
    // Count by numbered question lines in XML — approximate via numbered lines
    methods.numberedLines = countByNumberedQLines(text);
    groundTruth = methods.numberedLines;
  } else if (hasBracket) {
    format = 'Bracket [x]/[ ]';
    // Count bracket question groups
    methods.bracketGroups = countByBracketGroups(text, html);
    // Also count CS/CM prefixes
    methods.csCmPrefixes = countByCsCmPrefixes(text);
    // Count numbered question lines
    methods.numberedLines = countByNumberedQLines(text);
    // Use the most reliable: bracket groups or numbered lines
    groundTruth = Math.max(methods.bracketGroups, methods.numberedLines, methods.csCmPrefixes);
  } else if (hasNestedOl) {
    format = 'Nested OL (Nephrology)';
    methods.nestedOlItems = nestedOlCount;
    // Also check Correct answer: count
    methods.correctMarkers = countByCorrectAnswerMarkers(text);
    groundTruth = methods.nestedOlItems;
  } else if (hasExplicitCorrect) {
    format = 'Explicit correct answer';
    methods.correctMarkers = countByCorrectAnswerMarkers(text);
    methods.numberedLines = countByNumberedQLines(text);
    groundTruth = methods.correctMarkers;
  } else {
    format = 'Answer key at end';
    // Check for OL-format key (Pediatrics)
    if (olMatches.length >= 2) {
      // Check last OL block for single-letter answer key
      const lastOl = olMatches[olMatches.length - 1];
      const items = [...lastOl[1].matchAll(/<li>([\s\S]*?)<\/li>/g)]
        .map(m => m[1].replace(/<[^>]+>/g, '').trim());
      const isAnswerKey = items.every(it => /^[A-Ea-eА-ЕА-Д]/.test(it));
      if (isAnswerKey) {
        methods.olKeyItems = items.length;
        // Also count by text key length
        methods.textKeyCount = countByAnswerKeyLength(text);
        // Count numbered question lines in body (before key)
        methods.numberedLines = countByNumberedQLines(text);
        groundTruth = items.length;
      } else {
        methods.textKeyCount = countByAnswerKeyLength(text);
        methods.numberedLines = countByNumberedQLines(text);
        groundTruth = methods.textKeyCount || methods.numberedLines;
      }
    } else {
      methods.textKeyCount = countByAnswerKeyLength(text);
      methods.numberedLines = countByNumberedQLines(text);
      groundTruth = methods.textKeyCount || methods.numberedLines;
    }
  }

  return { file: rel, filename, format, groundTruth, methods, olCount: olMatches.length };
}

async function main() {
  const docxFiles = getDocxFiles(DATA_DIR).sort((a, b) => a.localeCompare(b));
  console.log(`\nGROUND TRUTH ANALYSIS — ${docxFiles.length} files\n`);

  const results = [];
  for (const filePath of docxFiles) {
    try {
      const r = await analyzeFile(filePath);
      results.push(r);
      const methodsStr = Object.entries(r.methods).map(([k,v]) => `${k}=${v}`).join(', ');
      console.log(`${r.file}`);
      console.log(`  Format: ${r.format}`);
      console.log(`  Ground truth estimate: ${r.groundTruth}`);
      console.log(`  Methods: ${methodsStr}`);
      console.log(`  OL blocks in HTML: ${r.olCount}`);
      console.log('');
    } catch (err) {
      console.log(`ERROR: ${filePath}: ${err.message}`);
    }
  }

  console.log(`\nTotal ground truth estimate: ${results.reduce((a,r) => a + r.groundTruth, 0)}`);

  // Output as JSON for report
  fs.writeFileSync(
    path.join(ROOT, 'scripts', 'generated', 'audit-ground-truth.json'),
    JSON.stringify(results, null, 2),
    'utf8'
  );
  console.log(`\nResults saved to scripts/generated/audit-ground-truth.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
