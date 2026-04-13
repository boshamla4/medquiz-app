/**
 * parse-data-folder.mjs  —  Comprehensive multi-format parser
 *
 * Supports all 25 .docx files across three format families:
 *   A) [x] / [ ] inline bracket markers
 *   B) Explicit "Correct answer: X" lines after each question
 *   C) Answer-key section at the end of the document
 *
 * Run: node scripts/parse-data-folder.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import mammoth from 'mammoth';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const OUTPUT_DIR = path.join(ROOT, 'scripts', 'generated');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'parsed-questions.json');
const PER_FILE_OUTPUT_DIR = path.join(OUTPUT_DIR, 'per-file');
const WRITE_PER_FILE_JSON = process.argv.includes('--per-file-json');

function getPerFileOutputPath(fileRelativePath) {
  const normalized = fileRelativePath.replace(/\\/g, '/');
  const withoutDataPrefix = normalized.replace(/^data\//, '');
  const parsed = path.parse(withoutDataPrefix);
  return path.join(PER_FILE_OUTPUT_DIR, parsed.dir, `${parsed.name}.json`);
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8209;/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeXmlText(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractParagraphsFromDocumentXml(xml) {
  const paragraphs = [];
  const paragraphRe = /<w:p\b[\s\S]*?<\/w:p>/g;
  let paragraphMatch;

  while ((paragraphMatch = paragraphRe.exec(xml)) !== null) {
    const paragraphXml = paragraphMatch[0];
    const runRe = /<w:r\b[\s\S]*?<\/w:r>/g;
    let runMatch;
    let text = '';
    let isUnderlined = false;

    while ((runMatch = runRe.exec(paragraphXml)) !== null) {
      const runXml = runMatch[0];
      if (/<w:u\b[^>]*\/>/.test(runXml) || /<w:u\b[^>]*w:val="single"[^>]*>/.test(runXml)) {
        isUnderlined = true;
      }

      const runText = [...runXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
        .map((textMatch) => decodeXmlText(textMatch[1]))
        .join('');
      text += runText;
    }

    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized) {
      paragraphs.push({ text: normalized, isUnderlined });
    }
  }

  return paragraphs;
}

async function extractDocumentXml(filePath) {
  const buffer = await fs.promises.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) return null;
  return documentFile.async('string');
}

function isBracketCorrect(bracketContent) {
  const c = bracketContent.trim();
  if (!c || /^\s+$/.test(c)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Token extraction from HTML
// ---------------------------------------------------------------------------

/**
 * Returns a flat list of text segments from HTML.
 * Each segment: { text: string, bold: string[], isList: boolean, rawHtml: string }
 *
 * Special handling for Nephrology-style nested <ol>:
 *   <ol><li>QUESTION<ol><li>A</li><li>B</li></ol></li></ol>
 * → emits question segment then A/B/... as list segments with letter prefix added.
 */
function extractSegments(html) {
  const segments = [];

  // Pre-process: flatten nested OL (Nephrology format)
  // Pattern: <li>QUESTION<ol><li>A</li>...</ol></li>
  // The questionPart must NOT cross any </li> or </ol> boundary (use negative lookahead).
  const flatHtml = html.replace(
    /<li>((?:(?!<\/li>|<\/ol>|<li)[\s\S])*?)<ol>([\s\S]*?)<\/ol>\s*<\/li>/g,
    (_, questionPart, innerOl) => {
      const qText = stripTags(questionPart).trim();
      const answers = [...innerOl.matchAll(/<li>([\s\S]*?)<\/li>/g)];
      const letters = ['A', 'B', 'C', 'D', 'E'];
      const answerPs = answers
        .map((m, i) => `<p>${letters[i] || String.fromCharCode(65 + i)}. ${stripTags(m[1]).trim()}</p>`)
        .join('');
      return `<p>${qText}</p>${answerPs}`;
    }
  );

  // Process block elements: headings, paragraphs, list items
  const blockRe = /<(h[1-6]|p|li)(\s[^>]*)?>[\s\S]*?<\/\1>/gi;
  let match;

  while ((match = blockRe.exec(flatHtml)) !== null) {
    const rawHtml = match[0];
    const tag = match[1].toLowerCase();
    const isList = tag === 'li';

    // Extract bold text within this block
    const boldTexts = [];
    const boldRe = /<strong>([\s\S]*?)<\/strong>/gi;
    let bm;
    while ((bm = boldRe.exec(rawHtml)) !== null) {
      const b = stripTags(bm[1]).trim();
      if (b) boldTexts.push(b);
    }

    // Split on <br> — each line is a separate segment
    const innerHtml = rawHtml.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>$/, '');
    const parts = innerHtml.split(/<br\s*\/?>/i);

    for (const part of parts) {
      const text = stripTags(part).trim();
      if (!text) continue;
      segments.push({ text, bold: boldTexts, isList, rawHtml: part });
    }
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Answer letter normalisation
// ---------------------------------------------------------------------------

const CYRILLIC_TO_LATIN = {
  'А': 'A', 'а': 'a',
  'В': 'B', 'в': 'b',
  'С': 'C', 'с': 'c',
  'Д': 'D', 'д': 'd',
  'Е': 'E', 'е': 'e',
};

function normLetter(ch) {
  return (CYRILLIC_TO_LATIN[ch] || ch).toUpperCase();
}

// ---------------------------------------------------------------------------
// STRATEGY A — Bracket format  [x] / [ ]
// ---------------------------------------------------------------------------

const QUESTION_P = /^(\d+)[.)]\s*(?:(CM|CS)[.):]?\s+)?(\S[\s\S]+)$/i;
// Accepts: "1. CS text", "1) CS. text", "1. text"

// Accepts Latin a-e AND Cyrillic а-е as answer-option letter prefix (Neonatology)
const ANSWER_BRACKET_P =
  /^([A-Ea-eаАвВсСдДеЕ])[.)]{1,2}\s*\[([^\]]*)\]\s*(.+)$/;

// Regex for OL-list items that start directly with a bracket marker (no letter prefix).
// Surgery_Ped_Jalba uses: <li>[ ] answer text</li>  or  <li>[x ] bold answer</li>
const LIST_BRACKET_P = /^\[([^\]]*)\]\s*(.+)$/;

function parseBracket(html) {
  const segments = extractSegments(html);
  const questions = [];
  let current = null;
  let lastAnswer = null;
  let autoNum = 0;

  function flush() {
    if (!current) return;
    if (current.answers.length === 0 || !current.answers.some((a) => a.is_correct)) {
      current = null;
      lastAnswer = null;
      return;
    }
    const correct = current.answers.filter((a) => a.is_correct).length;
    current.type = correct > 1 ? 'multiple' : 'single';
    questions.push(current);
    current = null;
    lastAnswer = null;
  }

  let pendingNumber = null;

  for (const seg of segments) {
    const { text, isList } = seg;

    // Skip separator lines
    if (/^[-–—_=.]{3,}$/.test(text)) continue;

    // Pure question number line (e.g. "1." or "2.")
    if (/^\d+[.)]\s*$/.test(text)) {
      pendingNumber = parseInt(text);
      continue;
    }

    // Answer with bracket (letter-prefixed, including Cyrillic labels)
    const aMatch = text.match(ANSWER_BRACKET_P);
    if (aMatch && current) {
      const isCorrect = isBracketCorrect(aMatch[2]);
      // Normalize Cyrillic letter labels to Latin A-E
      const rawLetter = aMatch[1];
      const letter = (CYRILLIC_TO_LATIN[rawLetter] || rawLetter).toUpperCase();
      // If the answer letter is already taken (Cyrillic а=A collides with Latin a=A),
      // fall through to auto-assign only if we already have that letter.
      const ans = {
        letter,
        text: aMatch[3].replace(/\s+/g, ' ').trim(),
        is_correct: isCorrect,
      };
      current.answers.push(ans);
      lastAnswer = ans;
      continue;
    }

    // OL list-item that starts directly with a bracket marker — no letter prefix.
    // Surgery_Ped_Jalba answers inside <ol><li>[ ] text</li> or <li>[x ] text</li>.
    const listBracketMatch = isList ? text.match(LIST_BRACKET_P) : null;
    if (listBracketMatch && current) {
      const isCorrect = isBracketCorrect(listBracketMatch[1]);
      const letter = String.fromCharCode(65 + current.answers.length);
      if (letter <= 'E') {
        const ans = { letter, text: listBracketMatch[2].replace(/\s+/g, ' ').trim(), is_correct: isCorrect };
        current.answers.push(ans);
        lastAnswer = ans;
      }
      continue;
    }

    // Question line (numbered)
    const qMatch = text.match(QUESTION_P);
    if (qMatch && !aMatch) {
      const questionText = qMatch[3].trim();
      if (questionText.length < 5) continue;

      flush();
      autoNum = parseInt(qMatch[1]);
      pendingNumber = null;
      current = {
        question_number: autoNum,
        type: qMatch[2]?.toUpperCase() || 'unknown',
        question_text: questionText,
        answers: [],
      };
      lastAnswer = null;
      continue;
    }

    // Unnumbered CS/CM question (e.g., Pneumology: "CS Select the range...")
    const csMatch = text.match(/^(CS|CM)[.):]?\s+(.{5,})$/i);
    if (csMatch) {
      flush();
      autoNum++;
      current = {
        question_number: autoNum,
        type: csMatch[1].toUpperCase(),
        question_text: csMatch[2].trim(),
        answers: [],
      };
      lastAnswer = null;
      continue;
    }

    // Pending number + CS/CM question (Surgery_Ped_Jalba style)
    if (pendingNumber !== null) {
      const pendMatch = text.match(/^(?:(CS|CM)[.):]?\s+)?(.{5,})$/i);
      if (pendMatch) {
        flush();
        current = {
          question_number: pendingNumber,
          type: pendMatch[1]?.toUpperCase() || 'unknown',
          question_text: pendMatch[2].trim(),
          answers: [],
        };
        pendingNumber = null;
        lastAnswer = null;
        continue;
      }
    }

    // Continuation text
    if (current) {
      // Pneumology: some question stems appear without a CS/CM prefix or number.
      // They arrive as plain text after the previous question's last answer.
      // Detect them via isQuestion() so they start a new question rather than
      // being appended to the last answer's text.
      if (
        lastAnswer
        && current.answers.length >= 3
        && isQuestion(text)
        && !ANSWER_BRACKET_P.test(text)
        && !LIST_BRACKET_P.test(text)
      ) {
        flush();
        autoNum++;
        current = { question_number: autoNum, type: 'unknown', question_text: text, answers: [] };
        lastAnswer = null;
        continue;
      }
      if (lastAnswer) {
        lastAnswer.text = (lastAnswer.text + ' ' + text).replace(/\s+/g, ' ').trim();
      } else {
        current.question_text = (current.question_text + ' ' + text).replace(/\s+/g, ' ').trim();
      }
    }
  }

  flush();
  return questions;
}

// ---------------------------------------------------------------------------
// STRATEGY B — Explicit "Correct answer: X" lines
// ---------------------------------------------------------------------------

const CORRECT_ANSWER_P = /^Correct\s+answers?\s*[:\-]?\s*(.+)$/i;
const ANSWER_LETTER_P = /^([A-Ea-e])[.):\-]\s*(.+)$/;

function parseExplicit(html) {
  const segments = extractSegments(html);
  const questions = [];
  let current = null;
  let autoNum = 0;
  // Track the current section type set by <h2>CS</h2> or <h2>CM</h2> markers.
  // Nephrology embeds section headers between question groups; questions in that
  // section carry no CS/CM prefix of their own.
  let pendingSectionType = null;
  // When a csMatch fires on a list-item segment (Obstetrics format), subsequent
  // list-items are unlabeled answer options that get auto-assigned A–E letters.
  let autoLetterMode = false;

  function flush() {
    if (!current) return;
    if (current.answers.length === 0 || !current.answers.some((a) => a.is_correct)) {
      current = null;
      autoLetterMode = false;
      return;
    }
    const correct = current.answers.filter((a) => a.is_correct).length;
    current.type = correct > 1 ? 'multiple' : 'single';
    questions.push(current);
    current = null;
    autoLetterMode = false;
  }

  for (const seg of segments) {
    const { text, isList } = seg;
    if (!text || /^[-–—_=.]{3,}$/.test(text)) continue;
    // Skip exam-metadata headers (Gastro scoring annotations)
    if (/^(Capitol\s*:|Mod de punctare\s*:|Punctajul\s*:)/i.test(text)) continue;

    // Correct answer line
    const caMatch = text.match(CORRECT_ANSWER_P);
    if (caMatch && current) {
      const raw = caMatch[1].trim();
      // Extract letters (A-E, a-e, possibly comma/space separated).
      // Works for both named letters ("Correct answer: B") and position-based
      // lowercase ("Correct answer: a, b, d") because auto-assigned letters
      // A=1st, B=2nd … match positional a=1st, b=2nd … after normLetter().
      const letters = new Set(
        [...raw.matchAll(/[A-Ea-e]/g)].map((m) => normLetter(m[0]))
      );
      for (const ans of current.answers) {
        if (letters.has(ans.letter.toUpperCase())) {
          ans.is_correct = true;
        }
      }
      flush();
      continue;
    }

    // Question line (numbered)
    const qMatch = text.match(QUESTION_P);
    if (qMatch) {
      let questionText = qMatch[3].trim();
      if (questionText.length < 5) continue;
      flush();
      autoNum = parseInt(qMatch[1]);
      current = {
        question_number: autoNum,
        type: qMatch[2]?.toUpperCase() || pendingSectionType || 'unknown',
        question_text: questionText,
        answers: [],
      };
      pendingSectionType = null;

      // Reumatology: some paragraphs contain the question AND all five answers
      // in one <p> with no <br> between them, e.g.:
      //   "38. Phalangeal involvement…: A. "Sausage finger" B. "Telescoped…" …"
      // Split inline answers out so "Correct answer: X" can mark them correctly.
      const inlineIdx = questionText.search(/\s[A-E][.)]\s/);
      if (inlineIdx > 0) {
        current.question_text = questionText.slice(0, inlineIdx).trim();
        const answersPart = questionText.slice(inlineIdx + 1);
        for (const am of answersPart.matchAll(/([A-E])[.)]\s+(.+?)(?=\s+[A-E][.)]\s|$)/g)) {
          current.answers.push({ letter: am[1], text: am[2].trim(), is_correct: false });
        }
      }
      continue;
    }

    // Unnumbered CS/CM question (e.g. "CM Which of the following…")
    const csMatch = text.match(/^(CS|CM)[.):]?\s+(.{5,})$/i);
    if (csMatch) {
      flush();
      autoNum++;
      // If the match came from inside an OL list item (Obstetrics), subsequent
      // list-item siblings are unlabeled answer options → enable auto-letter mode.
      autoLetterMode = isList;
      current = {
        question_number: autoNum,
        type: csMatch[1].toUpperCase(),
        question_text: csMatch[2].trim(),
        answers: [],
      };
      pendingSectionType = null;
      continue;
    }

    // CS/CM type-only line — e.g. <h2>CS</h2> in Nephrology.
    // Instead of discarding, record the section type so the next unnumbered
    // paragraph that looks like a question stem can be picked up correctly.
    if (/^(CS|CM)$/i.test(text)) {
      pendingSectionType = text.toUpperCase();
      continue;
    }

    // Unnumbered question stem detected via heuristic (Nephrology CS questions).
    // Only fires when a section type was established by a preceding h2 marker
    // and the current segment is not an answer-option line.
    if (
      pendingSectionType
      && isQuestion(text)
      && !ANSWER_LETTER_P.test(text)
      && (!current || current.answers.length > 0)
    ) {
      flush();
      autoNum++;
      current = {
        question_number: autoNum,
        type: pendingSectionType,
        question_text: text,
        answers: [],
      };
      // Keep pendingSectionType alive — multiple questions share the same h2 section.
      continue;
    }

    // Answer line (letter prefix)
    if (current) {
      const aMatch = text.match(ANSWER_LETTER_P);
      if (aMatch) {
        current.answers.push({
          letter: aMatch[1].toUpperCase(),
          text: aMatch[2].trim(),
          is_correct: false,
        });
        continue;
      }

      // Unlabeled list-item answer (Obstetrics format):
      // The question was the first <li>; remaining <li>s are answer options.
      if (isList && autoLetterMode && current.answers.length < 5) {
        const letter = String.fromCharCode(65 + current.answers.length);
        current.answers.push({ letter, text, is_correct: false });
        continue;
      }

      // Continuation text — only append to question stem before any answers collected.
      if (current.answers.length === 0 && text.length > 3) {
        current.question_text = (current.question_text + ' ' + text).replace(/\s+/g, ' ').trim();
      }
    }
  }

  flush();
  return questions;
}

// ---------------------------------------------------------------------------
// STRATEGY C — Answer key at end of document
// ---------------------------------------------------------------------------

/**
 * Locate the answer key section within text (last 35% of document).
 * Returns the index within `text` where the key section starts, or -1.
 */
function findAnswerKeyStart(text) {
  const startSearch = Math.floor(text.length * 0.5);
  const tail = text.slice(startSearch);

  const markers = [
    /answers?\s*[:;]?\s*(simple|single|cs|sc)\s*choice/i,
    /(simple|single|cs|sc)\s*choice\s*(answers?|tests?)/i,
    /correct\s+answers?\s*(simple|single|cs|sc)/i,
    /correct\s+answer\s*[:\n]/i,
    /answers?:\s*idiopath/i,
    /[a-z]\s+SC[A-E]/,
    /\bSC\b.*[A-E]{3}/,
  ];

  for (const pat of markers) {
    const m = tail.search(pat);
    if (m >= 0) return startSearch + m;
  }

  // Fallback: look for a run of 5+ capital letters A-E (the answer string)
  const fallbackPat = /(?<![A-Za-z])([A-EABCDE]{5,})/;
  const fm = tail.search(fallbackPat);
  if (fm >= 0) return startSearch + fm;

  return -1;
}

/**
 * Parse the answer key text into:
 *   csAnswers: string[] of single letters (A-E) for single-choice questions
 *   cmGroups: string[][] of letter arrays for multiple-choice questions
 */
function parseAnswerKeyText(keyText) {
  // Normalize Cyrillic
  let t = keyText;
  for (const [cyr, lat] of Object.entries(CYRILLIC_TO_LATIN)) {
    t = t.split(cyr).join(lat);
  }

  const upper = t.toUpperCase();
  const multipleIdx = upper.search(/\bMULTIPLE\b|\bMC\b|\bCM\b/i);

  const csPart = multipleIdx > 0 ? upper.slice(0, multipleIdx) : upper;
  const cmPart = multipleIdx > 0 ? upper.slice(multipleIdx) : '';

  const cleanCs = csPart.replace(/[^A-E0-9,\.\s]/g, ' ').toUpperCase();
  const cleanCm = cmPart.replace(/[^A-E0-9,\.\s]/g, ' ').toUpperCase();

  // --- Parse CS answers ---
  const csAnswers = [];

  // Check if numbered format: "1. D 2. C 3. A" or "1.D2.C3.A"
  const numberedMatches = [...cleanCs.matchAll(/\d+\s*\.\s*([A-E])/g)];
  if (numberedMatches.length >= 3) {
    for (const m of numberedMatches) {
      csAnswers.push(m[1]);
    }
  } else {
    // Sequential format: extract individual capital letters A-E
    // Remove number sequences and dots first
    const seq = cleanCs.replace(/\d+\s*\.\s*/g, ' ');
    for (const m of seq.matchAll(/\b([A-E])\b/g)) {
      csAnswers.push(m[1]);
    }
    // Also handle runs like "CDCCAABEB"
    if (csAnswers.length < 3) {
      csAnswers.length = 0;
      for (const m of cleanCs.matchAll(/[A-E]/g)) {
        csAnswers.push(m[0]);
      }
    }
  }

  // --- Parse CM answers ---
  const cmGroups = [];

  if (cmPart) {
    // Check if numbered: "1. A, B, C 2. D, E"
    const numberedCm = [...cleanCm.matchAll(/\d+\s*\.\s*([A-E,\s]+?)(?=\d+\.|$)/g)];
    if (numberedCm.length >= 2) {
      for (const m of numberedCm) {
        const letters = [...m[1].matchAll(/[A-E]/g)].map((x) => x[0]);
        if (letters.length > 0) cmGroups.push(letters);
      }
    } else {
      // Split groups by boundary between groups (where a letter follows
      // another letter without comma separator)
      // Remove "MULTIPLE CHOICE" text first
      const cleaned = cleanCm.replace(/MULTIPLE\s+CHOICE[^A-E]*/i, '').replace(/\bMC\b/i, '').replace(/\bCM\b/i, '');
      cmGroups.push(...splitCmGroups(cleaned));
    }
  }

  return { csAnswers, cmGroups };
}

/**
 * Split a run of CM answer groups.
 * Input: "A, B, CA, B, D, EB, C" → [["A","B","C"], ["A","B","D","E"], ["B","C"]]
 */
function splitCmGroups(text) {
  const groups = [];
  let current = [];
  let lastWasLetter = false;

  const chars = text.toUpperCase();
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (/[A-E]/.test(c)) {
      if (lastWasLetter) {
        // Two letters in a row → new group starts
        if (current.length > 0) groups.push(current);
        current = [];
      }
      current.push(c);
      lastWasLetter = true;
    } else if (c === ',') {
      lastWasLetter = false;
    } else {
      // space or other — reset
      lastWasLetter = false;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups.filter((g) => g.length > 0);
}

// ---------------------------------------------------------------------------
// Shared heuristic: does this segment text look like a question stem?
// Used by both extractQuestionsFromHtml and parseExplicit.
// ---------------------------------------------------------------------------
function isQuestion(text) {
  if (text.length < 10) return false;
  if (ANSWER_LETTER_P.test(text)) return false;
  if (/^[A-E][.)]\s/.test(text)) return false;
  // Ends with ? or : → likely question
  if (/[?:]$/.test(text.trim())) return true;
  // Contains question words
  if (/\b(which|what|choose|select|indicate|identify|specify|name|note|mark|determine|define|enumerate)\b/i.test(text)) return true;
  // Long enough to be a question (but not a bullet-point answer option).
  // This is an intentional heuristic — needed for unnumbered question stems in
  // bracket-format Pediatrics files. False positives (long answer options without
  // bracket markers) are subsequently filtered at the output stage (< 2 answers).
  if (text.length > 60) return true;
  return false;
}

/**
 * Parse all questions and their answer options from the HTML body.
 * Returns: Array<{ question_number, type, question_text, answers: [{letter, text}] }>
 */
function extractQuestionsFromHtml(html) {
  const questions = [];

  // Obtain flat list of items (paragraphs and list items)
  const allSegments = extractSegments(html);

  let current = null;
  let autoNum = 0;

  function flush() {
    if (!current || current.answers.length === 0) { current = null; return; }
    questions.push(current);
    current = null;
  }

  // Detect if question has a number prefix
  function extractNumberedQuestion(text) {
    const m = text.match(/^(\d+)[.):\-]?\s*(?:(CM|CS)[.):]?\s+)?(.{5,})$/i);
    if (!m) return null;
    return { num: parseInt(m[1]), type: m[2]?.toUpperCase() || '', text: m[3].trim() };
  }

  let i = 0;
  while (i < allSegments.length) {
    const seg = allSegments[i];
    const { text } = seg;

    if (!text || /^[-–—_=.]{3,}$/.test(text)) { i++; continue; }
    // Skip CS/CM markers alone
    if (/^(CS|CM)$/i.test(text)) { i++; continue; }
    // Skip section headers
    if (/^(single|multiple|simple)\s*(choice|test)/i.test(text)) { i++; continue; }

    // Check for numbered question
    const nq = extractNumberedQuestion(text);
    if (nq) {
      flush();
      autoNum = nq.num;
      current = { question_number: nq.num, type: nq.type, question_text: nq.text, answers: [] };
      i++;
      continue;
    }

    // Check for answer line (A. text / a) text)
    const aMatch = text.match(ANSWER_LETTER_P);
    if (aMatch && current) {
      current.answers.push({ letter: aMatch[1].toUpperCase(), text: aMatch[2].trim(), is_correct: false });
      i++;
      continue;
    }

    // For list items: first item in a group may be a question
    if (seg.isList && !aMatch) {
      if (isQuestion(text) && (!current || current.answers.length > 0)) {
        flush();
        autoNum++;
        current = { question_number: autoNum, type: 'unknown', question_text: text, answers: [] };
        i++;
        continue;
      }

      // Otherwise it's an answer option (unlabeled, use auto-letter)
      if (current) {
        const letter = String.fromCharCode(65 + current.answers.length); // A, B, C...
        if (letter <= 'E') {
          current.answers.push({ letter, text, is_correct: false });
        }
        i++;
        continue;
      }
    }

    i++;
  }

  flush();
  return questions;
}

function parseAnswerKey(html) {
  // --- Try OL-block answer key first (Chronic lung, Malabsorbtion, etc.) ---
  const olResult = tryOlAnswerKey(html);
  if (olResult !== null) return olResult;

  const text = stripTags(html).replace(/\s+/g, ' ');

  // Find answer key section
  const keyStart = findAnswerKeyStart(text);
  if (keyStart < 0) {
    // No key found — try bold detection as last resort
    return parseBoldCorrect(html);
  }

  const keyText = text.slice(keyStart);
  const { csAnswers, cmGroups } = parseAnswerKeyText(keyText);

  // Extract questions from full HTML
  const questions = extractQuestionsFromHtml(html);
  return applyAnswerKeyToQuestions(questions, csAnswers, cmGroups);
}

/**
 * Detect OL-format answer key where last 1-3 <ol> blocks contain only
 * single letters or comma-separated letter groups (not question text).
 * Returns parsed questions or null if not applicable.
 */
function tryOlAnswerKey(html) {
  const olMatches = [...html.matchAll(/<ol>([\s\S]*?)<\/ol>/g)];
  if (olMatches.length < 2) return null;

  // Check the last 3 OL blocks for answer-key patterns
  let csAnswers = [];
  let cmGroups = [];
  const keyOlIndexes = new Set();

  for (let i = olMatches.length - 1; i >= Math.max(0, olMatches.length - 3); i--) {
    const items = [...olMatches[i][1].matchAll(/<li>([\s\S]*?)<\/li>/g)]
      .map((m) => stripTags(m[1]).replace(/\s+/g, ' ').trim());

    if (items.length === 0) continue;

    // Single-letter CS key: each item is exactly one letter A-E
    const isCSKey = items.length >= 3 && items.every((it) => /^[A-Ea-eА-ЕА-Д]{1,2}$/.test(it.replace(/[.\s]/g, '')));
    // CM key: each item is comma-separated letters like "A, B, C, D"
    const isCMKey = items.length >= 3 && items.every((it) => /^[A-Ea-eА-Е][,\s A-Ea-eА-Е]*$/.test(it) && it.length > 1);

    if (isCSKey && csAnswers.length === 0) {
      csAnswers = items.map((it) => normLetter(it.replace(/[.\s]/g, '')));
      keyOlIndexes.add(i);
    } else if (isCMKey && cmGroups.length === 0) {
      cmGroups = items.map((it) =>
        [...it.matchAll(/[A-Ea-e]/g)].map((m) => normLetter(m[0]))
      );
      keyOlIndexes.add(i);
    }
  }

  if (keyOlIndexes.size === 0) return null;

  // Preserve full context for question parsing and only remove the OL key blocks.
  const keyRanges = [...keyOlIndexes]
    .map((idx) => {
      const start = olMatches[idx].index;
      if (typeof start !== 'number') return null;
      return { start, end: start + olMatches[idx][0].length };
    })
    .filter((range) => range !== null)
    .sort((a, b) => a.start - b.start);

  let htmlWithoutKey = '';
  let cursor = 0;
  for (const range of keyRanges) {
    htmlWithoutKey += html.slice(cursor, range.start);
    cursor = range.end;
  }
  htmlWithoutKey += html.slice(cursor);

  const questions = extractQuestionsFromHtml(htmlWithoutKey);
  return applyAnswerKeyToQuestions(questions, csAnswers, cmGroups);
}

async function parseUnderlinedDocx(filePath) {
  const xml = await extractDocumentXml(filePath);
  if (!xml) return [];

  const paragraphs = extractParagraphsFromDocumentXml(xml);
  const questions = [];
  let current = null;
  let autoNum = 0;

  function flush() {
    if (!current || current.answers.length === 0) {
      current = null;
      return;
    }

    const correct = current.answers.filter((answer) => answer.is_correct).length;
    current.type = correct > 1 ? 'multiple' : 'single';
    questions.push(current);
    current = null;
  }

  for (const paragraph of paragraphs) {
    const text = paragraph.text;

    if (!text || /^[-–—_=.]{3,}$/.test(text)) continue;

    const questionMatch = text.match(/^(\d+)\.?\s*(?:(CM|CS)[.):]?\s+)?(.{5,})$/i);
    if (questionMatch) {
      flush();
      autoNum = parseInt(questionMatch[1], 10);
      current = {
        question_number: autoNum,
        type: questionMatch[2]?.toUpperCase() || 'unknown',
        question_text: questionMatch[3].trim(),
        answers: [],
      };
      continue;
    }

    const answerMatch = text.match(/^([A-Ea-e])[.)]\s*(.{2,})$/);
    if (answerMatch && current) {
      current.answers.push({
        letter: answerMatch[1].toUpperCase(),
        text: answerMatch[2].trim(),
        is_correct: paragraph.isUnderlined,
      });
      continue;
    }

    if (current) {
      if (current.answers.length === 0) {
        current.question_text = (current.question_text + ' ' + text).replace(/\s+/g, ' ').trim();
      } else {
        const lastAnswer = current.answers[current.answers.length - 1];
        lastAnswer.text = (lastAnswer.text + ' ' + text).replace(/\s+/g, ' ').trim();
      }
    }
  }

  flush();
  return questions;
}

function applyAnswerKeyToQuestions(questions, csAnswers, cmGroups) {
  let csQuestions = questions.filter((q) => q.type !== 'CM' && q.type !== 'multiple');
  let cmQuestions = questions.filter((q) => q.type === 'CM' || q.type === 'multiple');

  // Some files provide separate CS/CM key sections but question stems don't label CM/CS.
  // If that happens, infer the split by key lengths and question order.
  if (
    cmGroups.length > 0
    && cmQuestions.length === 0
    && questions.length >= csAnswers.length + cmGroups.length
  ) {
    csQuestions = questions.slice(0, csAnswers.length);
    cmQuestions = questions.slice(csAnswers.length, csAnswers.length + cmGroups.length);
  }

  for (let i = 0; i < csQuestions.length && i < csAnswers.length; i++) {
    const q = csQuestions[i];
    const letter = csAnswers[i].toUpperCase();
    for (const ans of q.answers) {
      if (ans.letter === letter) { ans.is_correct = true; break; }
    }
    const idx = letter.charCodeAt(0) - 65;
    if (!q.answers.some((a) => a.is_correct) && q.answers[idx]) {
      q.answers[idx].is_correct = true;
    }
  }

  for (let i = 0; i < cmQuestions.length && i < cmGroups.length; i++) {
    const q = cmQuestions[i];
    const letters = new Set(cmGroups[i].map((l) => l.toUpperCase()));
    for (const ans of q.answers) {
      if (letters.has(ans.letter)) ans.is_correct = true;
    }
    if (!q.answers.some((a) => a.is_correct)) {
      for (const l of letters) {
        const idx = l.charCodeAt(0) - 65;
        if (q.answers[idx]) q.answers[idx].is_correct = true;
      }
    }
  }

  return questions.filter((q) => q.answers.length > 0 && q.answers.some((a) => a.is_correct));
}

// ---------------------------------------------------------------------------
// STRATEGY D — Bold = correct answer (last resort)
// ---------------------------------------------------------------------------

function parseBoldCorrect(html) {
  // For files where the correct answer <p> has more bold text than others
  // (very imprecise — currently unused but kept as fallback)
  const segments = extractSegments(html);
  const questions = [];
  let current = null;
  let autoNum = 0;

  function flush() {
    if (!current || current.answers.length === 0) { current = null; return; }
    if (!current.answers.some((a) => a.is_correct)) { current = null; return; }
    const correct = current.answers.filter((a) => a.is_correct).length;
    current.type = correct > 1 ? 'multiple' : 'single';
    questions.push(current);
    current = null;
  }

  for (const seg of segments) {
    const { text, bold } = seg;
    if (!text || /^[-–—_=.]{3,}$/.test(text)) continue;

    const nq = text.match(/^(\d+)[.)]\s*(?:(CM|CS)[.):]?\s+)?(.{5,})$/i);
    if (nq) {
      flush();
      autoNum = parseInt(nq[1]);
      current = { question_number: autoNum, type: nq[2]?.toUpperCase() || '', question_text: nq[3].trim(), answers: [] };
      continue;
    }

    const aMatch = text.match(ANSWER_LETTER_P);
    if (aMatch && current) {
      // Check if the full answer text appears in bold
      const isCorrect = bold.some((b) => b.includes(aMatch[2].slice(0, 10)));
      current.answers.push({ letter: aMatch[1].toUpperCase(), text: aMatch[2].trim(), is_correct: isCorrect });
      continue;
    }
  }

  flush();
  return questions;
}

// ---------------------------------------------------------------------------
// Surgery 4th year — per-section answer keys: "Section (answers)" + <ol> block
// ---------------------------------------------------------------------------

/**
 * Parse one Surgery_4th answer-key OL item.
 * Items mix CS (single letter) and CM (number + letter group) in one entry, e.g.:
 *   "A 21. A,B,C,E"  → csLetter='A', numberedCm={21:['A','B','C','E']}
 *   "B"              → csLetter='B'
 *   "A,B,C"          → sequentialCm=['A','B','C']
 *   "A,B,C,E 24. B,C"→ sequentialCm=['A','B','C','E'], numberedCm={24:['B','C']}
 */
function parseSurgery4thKeyItem(rawItem) {
  let t = rawItem;
  for (const [cyr, lat] of Object.entries(CYRILLIC_TO_LATIN)) t = t.split(cyr).join(lat);
  t = t.toUpperCase().replace(/\s+/g, ' ').trim();

  const csLetters = [];
  const numberedCm = {};
  const sequentialCm = [];

  // Collect all numbered entries: "21. A,B,C,E" or "21.ABCE"
  const numRe = /(\d+)\s*[.]\s*([A-E][A-E,\s]*)/g;
  const numMatches = [...t.matchAll(numRe)];
  for (const nm of numMatches) {
    numberedCm[parseInt(nm[1])] = [...nm[2].matchAll(/[A-E]/g)].map((m) => m[0]);
  }

  // Remove numbered parts and examine what's left
  let remaining = t;
  for (const nm of [...numMatches].reverse()) {
    remaining = remaining.slice(0, nm.index) + ' ' + remaining.slice(nm.index + nm[0].length);
  }
  remaining = remaining.trim();

  const letterGroups = remaining
    .split(/\s+/)
    .map((s) => s.replace(/[^A-E,]/g, ''))
    .filter(Boolean);

  for (const grp of letterGroups) {
    if (/^[A-E]$/.test(grp)) {
      csLetters.push(grp);
    } else if (/^[A-E]([,A-E])+$/.test(grp)) {
      sequentialCm.push([...grp.matchAll(/[A-E]/g)].map((m) => m[0]));
    }
  }

  return { csLetters, numberedCm, sequentialCm };
}

function parseSurgery4th(html) {
  const allQuestions = [];

  // Find each "Section (answers)" header paragraph.
  // The key that follows may be an OL block OR plain paragraph text.
  const headerRe = /(<p>(?:<[^>]+>)*[^<]*\(answers?\)[^<]*(?:<\/[^>]+>)*<\/p>)/gi;
  const keyBlocks = [];
  let hm;
  while ((hm = headerRe.exec(html)) !== null) {
    const headerEnd = hm.index + hm[0].length;
    const sectionLabel = hm[1].replace(/<[^>]+>/g, '').trim();
    // Skip whitespace/newlines between header and next tag
    const rest = html.slice(headerEnd).replace(/^\s+/, '');
    let items = [];
    let blockLen = 0;

    // Look for an OL within the next ~300 chars (may be wrapped in UL)
    const nearbyHtml = rest.slice(0, 600);
    const firstOlOffset = nearbyHtml.search(/<ol>/i);
    const firstPOffset = nearbyHtml.search(/<p>/i);

    if (firstOlOffset >= 0 && (firstPOffset < 0 || firstOlOffset < firstPOffset + 50)) {
      // OL-format key (possibly nested inside <ul>)
      const olStart = rest.indexOf('<ol>', firstOlOffset);
      const olEnd = rest.indexOf('</ol>', olStart) + 5;
      const olHtml = rest.slice(olStart, olEnd);
      items = [...olHtml.matchAll(/<li>([\s\S]*?)<\/li>/g)]
        .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      // Block extends to closing structure (find closing </ul> or just use olEnd)
      const closingTag = rest.indexOf('</ul>', olEnd);
      blockLen = html.slice(headerEnd).length - rest.length + (closingTag >= 0 ? closingTag + 5 : olEnd);
    } else if (firstPOffset >= 0) {
      // Text-format key — collect consecutive <p> blocks that look like answer data
      let pos = firstPOffset;
      const combinedItems = [];
      while (pos < rest.length) {
        if (!/^<p>/i.test(rest.slice(pos))) break;
        const pClose = rest.indexOf('</p>', pos) + 4;
        if (pClose <= pos) break;
        const pText = rest.slice(pos, pClose).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        // Stop if paragraph contains question-like content (long sentences, CS/CM prefix)
        if (pText.length > 100 || /\b(CS|CM)\b/.test(pText) || /[a-z]{5,}/.test(pText)) break;
        if (/^[A-Ea-e\d\s.,]+$/.test(pText) && pText.length > 1) combinedItems.push(pText);
        pos = pClose;
        // skip whitespace
        while (pos < rest.length && /\s/.test(rest[pos])) pos++;
      }
      if (combinedItems.length > 0) {
        items = [combinedItems.join(' ')];
        blockLen = html.slice(headerEnd).length - rest.length + pos;
      }
    }

    keyBlocks.push({
      index: hm.index,
      end: headerEnd + blockLen,
      sectionLabel,
      items,
    });
  }

  if (keyBlocks.length === 0) return [];

  // Extract question blocks: text BEFORE each key block (from previous key end or doc start).
  let docStart = 0;
  for (const kb of keyBlocks) {
    const sectionHtml = html.slice(docStart, kb.index);
    docStart = kb.end;

    const sectionQuestions = extractQuestionsFromHtml(sectionHtml);
    if (sectionQuestions.length === 0) continue;

    // Parse all key items for this section.
    const csLetters = [];
    const numberedCm = {};
    const seqCmGroups = [];

    for (const item of kb.items) {
      const { csLetters: cl, numberedCm: nc, sequentialCm: sc } = parseSurgery4thKeyItem(item);
      csLetters.push(...cl);
      for (const [n, letters] of Object.entries(nc)) numberedCm[n] = letters;
      seqCmGroups.push(...sc);
    }

    // Apply answers: numbered CM first (by question_number), then sequential.
    const csQueue = [...csLetters];
    const seqCmQueue = [...seqCmGroups];

    for (const q of sectionQuestions) {
      const numKey = q.question_number;
      if (numberedCm[numKey]) {
        // CM question with explicit key entry
        const letters = new Set(numberedCm[numKey]);
        for (const ans of q.answers) {
          if (letters.has(ans.letter)) ans.is_correct = true;
        }
        q.type = 'multiple';
      } else if (q.type === 'CM' || q.type === 'multiple') {
        // CM question without explicit number — take next sequential group
        const group = seqCmQueue.shift();
        if (group) {
          const letters = new Set(group);
          for (const ans of q.answers) {
            if (letters.has(ans.letter)) ans.is_correct = true;
          }
        }
      } else {
        // CS question — take next letter from queue
        const letter = csQueue.shift();
        if (letter) {
          for (const ans of q.answers) {
            if (ans.letter === letter) { ans.is_correct = true; break; }
          }
          // Index fallback
          if (!q.answers.some((a) => a.is_correct)) {
            const idx = letter.charCodeAt(0) - 65;
            if (q.answers[idx]) q.answers[idx].is_correct = true;
          }
        }
        q.type = 'single';
      }
    }

    const validQs = sectionQuestions.filter((q) => q.answers.length >= 2 && q.answers.some((a) => a.is_correct));
    allQuestions.push(...validQs);
  }

  return allQuestions;
}

// ---------------------------------------------------------------------------
// Surgery 5th year — per-section answer key in bold <ol><li>
// ---------------------------------------------------------------------------

function parseSurgery5th(html) {
  const allQuestions = [];

  // Find all KEY answer blocks explicitly.

  const keyAnswerRe = /KEY\s+answers[^<]*(?:<[^>]+>)*([^<]*)<\/[^>]+>(<ol>[\s\S]*?<\/ol>)/gi;
  const keyBlocks = [];
  let km;
  while ((km = keyAnswerRe.exec(html)) !== null) {
    keyBlocks.push({
      index: km.index,
      sectionName: km[1].trim() || km[0].slice(0, 50),
      answerHtml: km[2],
    });
  }

  // Extract all questions in one pass
  const allRawQuestions = extractQuestionsFromSurgery5thHtml(html);

  if (keyBlocks.length === 0) {
    // Fallback: no structured key found
    return allRawQuestions;
  }

  // Assign questions to sections based on document position
  // Each question has no position info, so we rely on sequential order within sections
  // Group questions by the order they appear, matching to key blocks in order

  // For each key block, parse the answer list (bold li items)
  const sectionAnswers = keyBlocks.map((kb) => {
    const liTexts = [...kb.answerHtml.matchAll(/<li>([\s\S]*?)<\/li>/g)]
      .map((m) => stripTags(m[1]).replace(/\s+/g, ' ').trim());
    return liTexts;
  });

  // Since we don't know exactly how many questions belong to each section,
  // use the number of answer key items as a guide
  let qIdx = 0;
  for (let s = 0; s < sectionAnswers.length; s++) {
    const answers = sectionAnswers[s];
    const sectionQs = [];

    for (const keyItem of answers) {
      const q = allRawQuestions[qIdx];
      if (!q) break;

      const letters = new Set(
        [...keyItem.matchAll(/[A-Ea-e]/g)].map((m) => normLetter(m[0]))
      );

      for (const ans of q.answers) {
        if (letters.has(ans.letter)) ans.is_correct = true;
      }
      // Index fallback
      if (!q.answers.some((a) => a.is_correct)) {
        const idx = [...letters][0]?.charCodeAt(0) - 65;
        if (idx >= 0 && q.answers[idx]) q.answers[idx].is_correct = true;
      }

      if (q.answers.some((a) => a.is_correct)) sectionQs.push(q);
      qIdx++;
    }

    allQuestions.push(...sectionQs);
  }

  return allQuestions;
}

function extractQuestionsFromSurgery5thHtml(html) {
  const questions = [];
  // Use extractSegments to get all text lines (br-split paragraphs)
  const segs = extractSegments(html);
  let current = null;

  function flush() {
    if (!current || current.answers.length === 0) { current = null; return; }
    questions.push(current);
    current = null;
  }

  // Surgery_5th has two observed question-number formats:
  //   "1.CM Which of…"    (no space, no dot after CM)
  //   "25.CM.Which of…"   (dot after CM instead of space)
  //   "1. CM Which of…"   (space between dot and CM)
  // The pattern below handles all three variants.
  // SC = Single Choice, MC = Multiple Choice, SM = Selection Multiple (all variants used in this file)
  const SURGERY5_Q = /^(\d+)\s*\.\s*(CM|CS|MC|SC|SM)[.):\s]+(.{5,})$/i;

  for (const seg of segs) {
    const { text, isList } = seg;
    if (!text || /^[-–—_=.]{3,}$/.test(text)) continue;
    // Skip KEY answers lines and section headers
    if (/^KEY\s+answers/i.test(text)) { flush(); continue; }

    const qMatch = text.match(SURGERY5_Q);
    if (qMatch) {
      flush();
      const rawType = qMatch[2].toUpperCase();
      const normType = (rawType === 'CM' || rawType === 'MC' || rawType === 'SM') ? 'CM' : 'CS';
      current = {
        question_number: parseInt(qMatch[1]),
        type: normType,
        question_text: qMatch[3].trim(),
        answers: [],
      };
      continue;
    }

    // Answer line: "A.text" or "A. text" (capital letter + dot)
    const aMatch = text.match(/^([A-E])\.\s*(.{2,})$/);
    if (aMatch && current) {
      current.answers.push({ letter: aMatch[1], text: aMatch[2].trim(), is_correct: false });
      continue;
    }

    // Unlabeled list-item answer (some Surgery_5th sections put answer options
    // inside <ol><li> without a letter prefix — auto-assign A, B, C, D, E).
    if (isList && current && current.answers.length < 5 && text.length > 1) {
      const letter = String.fromCharCode(65 + current.answers.length);
      current.answers.push({ letter, text, is_correct: false });
      continue;
    }

    // Continuation of question text (before answers collected)
    if (current && current.answers.length === 0 && text.length > 3) {
      current.question_text = (current.question_text + ' ' + text).replace(/\s+/g, ' ').trim();
    }
  }

  flush();
  return questions;
}

// ---------------------------------------------------------------------------
// Main file dispatcher
// ---------------------------------------------------------------------------

async function parseFile(filePath) {
  const filename = path.basename(filePath);
  const moduleName = path.basename(filePath, path.extname(filePath));
  const fileRelativePath = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const folder = path.basename(path.dirname(filePath));

  const { value: html } = await mammoth.convertToHtml({ path: filePath });
  const rawText = stripTags(html);

  // Detect strategy
  const hasBracket = /\[[xX×хХ✓ ]\]/.test(rawText);
  const hasExplicitCorrect = /Correct\s+answer/i.test(rawText);
  const isSurgery5th = filename === 'Surgery_5th year_Timis.docx';
  const isSurgery4th = filename === 'Surgery_4th year_Vozian.docx';
  const isUnderlinedSurgery = filename === 'Surgery_3rd year_Vescu.docx';

  let rawQuestions;

  if (isUnderlinedSurgery) {
    rawQuestions = await parseUnderlinedDocx(filePath);
    if (rawQuestions.length === 0) {
      rawQuestions = parseAnswerKey(html);
    }
  } else if (isSurgery5th) {
    rawQuestions = parseSurgery5th(html);
  } else if (isSurgery4th) {
    rawQuestions = parseSurgery4th(html);
  } else if (hasBracket) {
    rawQuestions = parseBracket(html);
  } else if (hasExplicitCorrect) {
    // Check if explicit markers are scattered (Reumatology/Nephrology/Obstetrics style)
    // vs appearing only at the end (answer key style)
    const bodyPart = rawText.slice(0, Math.floor(rawText.length * 0.8));
    const explicitInBody = (bodyPart.match(/Correct\s+answer/gi) || []).length;
    if (explicitInBody >= 3) {
      rawQuestions = parseExplicit(html);
    } else {
      rawQuestions = parseAnswerKey(html);
    }
  } else {
    rawQuestions = parseAnswerKey(html);
  }

  // Validation: alert if strategy returned 0 questions despite non-trivial content
  if (rawQuestions.length === 0 && rawText.length > 2000) {
    console.warn(`  ⚠ Strategy returned 0 raw questions for ${filename} (${rawText.length} chars). Check format detection.`);
  }

  // Normalise output
  const warnings = [];
  const questions = [];
  let order = 0;

  for (const rq of rawQuestions) {
    if (!rq.question_text || rq.question_text.length < 5) continue;
    if (rq.answers.length < 2) {
      warnings.push(`Q${rq.question_number}: only ${rq.answers.length} answer(s) — skipped`);
      continue;
    }
    if (rq.answers.length > 8) {
      warnings.push(`Q${rq.question_number}: ${rq.answers.length} answers (too many) — skipped`);
      continue;
    }
    const correctCount = rq.answers.filter((a) => a.is_correct).length;
    if (correctCount === 0) {
      warnings.push(`Q${rq.question_number}: no correct answer — skipped`);
      continue;
    }

    const type = correctCount > 1 ? 'multiple' : 'single';

    questions.push({
      module: moduleName,
      source_file: fileRelativePath,
      question_order: order++,
      question_number: rq.question_number || order,
      type,
      question_text: rq.question_text.replace(/\s+/g, ' ').trim(),
      answers: rq.answers.map((a) => ({
        letter: a.letter,
        text: a.text.replace(/\s+/g, ' ').trim(),
        is_correct: Boolean(a.is_correct),
      })),
    });
  }

  return { file: fileRelativePath, module: moduleName, folder, questionCount: questions.length, warningCount: warnings.length, warnings, questions };
}

// ---------------------------------------------------------------------------
// File traversal
// ---------------------------------------------------------------------------

function getDocxFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) files.push(...getDocxFiles(fullPath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.docx')) {
      files.push(fullPath);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(DATA_DIR)) throw new Error(`Missing data folder at ${DATA_DIR}`);

  const docxFiles = getDocxFiles(DATA_DIR).sort((a, b) => a.localeCompare(b));
  if (!docxFiles.length) throw new Error(`No .docx files found in ${DATA_DIR}`);

  console.log(`Found ${docxFiles.length} .docx file(s). Parsing...\n`);

  const results = [];
  for (const filePath of docxFiles) {
    try {
      const result = await parseFile(filePath);
      results.push(result);
      const icon = result.questionCount > 0 ? '✓' : '✗';
      const warnStr = result.warningCount > 0 ? ` (${result.warningCount} warnings)` : '';
      console.log(`${icon} ${result.file}: ${result.questionCount} questions${warnStr}`);
      if (result.warningCount > 0 && result.questionCount === 0) {
        result.warnings.slice(0, 3).forEach((w) => console.log(`    ⚠ ${w}`));
      }
    } catch (err) {
      console.log(`✗ ${path.relative(ROOT, filePath)}: ERROR — ${err.message}`);
    }
  }

  const totalQuestions = results.reduce((acc, r) => acc + r.questionCount, 0);
  const totalWarnings = results.reduce((acc, r) => acc + r.warningCount, 0);

  console.log(`\n--- Summary ---`);
  console.log(`Files:     ${results.length}`);
  console.log(`Questions: ${totalQuestions}`);
  console.log(`Warnings:  ${totalWarnings}`);
  console.log(`Files with 0 questions: ${results.filter((r) => r.questionCount === 0).length}`);

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceFolder: 'data',
    totalFiles: results.length,
    totalQuestions,
    files: results.map((result) => {
      const { warnings, warningCount, ...rest } = result;
      void warnings;
      void warningCount;
      return rest;
    }),
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\nOutput written to: ${path.relative(ROOT, OUTPUT_FILE)}`);

  if (WRITE_PER_FILE_JSON) {
    try {
      fs.rmSync(PER_FILE_OUTPUT_DIR, { recursive: true, force: true });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        // No existing output directory to clean.
      } else {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to clean per-file output directory (${PER_FILE_OUTPUT_DIR}): ${message}. ` +
            'Check file permissions and active file locks, then retry.'
        );
      }
    }

    let perFileOutputCount = 0;
    for (const fileEntry of payload.files) {
      const fileOutputPath = getPerFileOutputPath(fileEntry.file);
      fs.mkdirSync(path.dirname(fileOutputPath), { recursive: true });
      fs.writeFileSync(
        fileOutputPath,
        JSON.stringify(
          {
            generatedAt: payload.generatedAt,
            sourceFolder: payload.sourceFolder,
            file: fileEntry.file,
            module: fileEntry.module,
            folder: fileEntry.folder,
            questionCount: fileEntry.questionCount,
            questions: fileEntry.questions,
          },
          null,
          2
        ),
        'utf8'
      );
      perFileOutputCount += 1;
    }

    console.log(
      `Per-file output written: ${perFileOutputCount} file(s) to ${path.relative(ROOT, PER_FILE_OUTPUT_DIR)}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
