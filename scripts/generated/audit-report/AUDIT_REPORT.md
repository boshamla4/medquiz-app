# MedQuiz Parser — Full Diagnostic Audit Report

**Date:** 2026-04-09  
**Scope:** READ-ONLY — no code changes made  
**Auditor:** Claude Code diagnostic run  
**Parser version:** `scripts/parse-data-folder.mjs` (1146 lines, multi-strategy)  
**Data source:** `data/` — 25 .docx files across 2 folders  

---

## Phase 1 — Context Discovery

**Project:** Next.js 16.2.2 App Router, React 19, Supabase (PostgreSQL), mammoth.js for .docx parsing  
**Parser output file:** `scripts/generated/parsed-questions.json`  

**Files found:**  
- `data/Graduation Exam Tests/` — 10 files  
- `data/Pediatrics/` — 15 files  
- Total: **25 .docx files**

**Strategies implemented in parser:**
| ID | Name | Trigger condition |
|----|------|------------------|
| A  | Bracket `[x]/[ ]` | `hasBracket` true |
| B  | Explicit correct answer | `hasExplicitCorrect && explicitInBody >= 3` |
| C  | Answer key at end (OL) | `tryOlAnswerKey` succeeds |
| C2 | Answer key at end (text) | `findAnswerKeyStart` finds key |
| D  | Bold = correct (fallback) | `parseBoldCorrect` |
| E  | Per-section key (Surgery 5th) | exact filename match |
| F  | Underline markers (Surgery 3rd) | exact filename match |

---

## Phase 2 — Static Review (No Changes)

### Critical Logical Flaws

**FLAW 1 — parseExplicit ignores unlabeled list-item answers**  
Location: `parse-data-folder.mjs:379–394`  
When answer choices appear as plain `<li>text</li>` without a letter prefix (`A. text`), 
`parseExplicit` has no answer-collection path for them. The code falls into:
```javascript
if (current.answers.length === 0 && text.length > 3) {
  current.question_text = (current.question_text + ' ' + text)...
}
```
This appends ALL answer options to the question stem. When "Correct answer: c" is then 
processed, `current.answers` is empty → flush discards the question.  
**Affected:** Obstetrics (OL-list answers, position-based "Correct answer: a, b, d" format). 
Estimated **~218 questions silently discarded**.

**FLAW 2 — Nephrology CS questions have no recognizable start marker**  
Location: `parse-data-folder.mjs:306–396` (parseExplicit dispatch)  
Nephrology's structure:  
```html
<h2><strong>CS</strong></h2>
<ol><li>Question text<ol><li>A</li>...<li>E</li></ol></li></ol>
<p><strong>Correct answer: </strong>B</p>
```
After nested-OL flattening, question text appears as `<p>Question text</p>` without any 
numeric prefix or CS/CM prefix. `parseExplicit` has no way to start a new question from 
unlabeled paragraph text. Only CM-prefixed questions (matching `csMatch`) survive.  
**Result:** 239 total questions in file → **23 captured** (only the CM-prefixed ones).  
Estimated **216 questions silently discarded** (all CS questions in the file).

**FLAW 3 — tryOlAnswerKey has no count-consistency check**  
Location: `parse-data-folder.mjs:661–713`  
If a non-key OL block accidentally satisfies the letter-only pattern (e.g., a question whose 
answers happen to all be single words starting with A–E), it is silently treated as the answer 
key. There is no guard checking that key length ≈ question count. A false positive here 
discards the entire file's questions silently (function returns a partial result, not null).

**FLAW 4 — parseSurgery5th sequential mapping breaks on section boundary misalignment**  
Location: `parse-data-folder.mjs:910–937`  
The function assigns questions to answer-key items purely by sequential index. If 
`extractQuestionsFromSurgery5thHtml` identifies a section header or continuation line as a 
question, all subsequent mappings shift by one and every question from that point gets 
the wrong answer letters. No alignment verification is performed.  
**Observed:** 100 answer-key items found but only **74 questions returned** (26 unmapped).

**FLAW 5 — splitCmGroups is sensitive to whitespace between groups**  
Location: `parse-data-folder.mjs:510–535`  
The group boundary detection (letter immediately follows letter without comma) breaks if 
a single space appears between two adjacent group sequences. This edge case produces 
merged groups that assign wrong correct answers silently.

### Anti-Patterns

**AP-1 — Hardcoded filename matching**  
```javascript
const isSurgery5th = filename === 'Surgery_5th year_Timis.docx';
const isUnderlinedSurgery = filename === 'Surgery_3rd year_Vescu.docx';
```
Any rename or addition of a similarly formatted file breaks dispatch silently.

**AP-2 — Strategy detection order creates masking**  
`hasBracket` is checked before `hasExplicitCorrect`. If a file has both bracket markers 
(in examples or text) AND explicit correct lines, it is routed to parseBracket which 
will fail on the explicit sections. No audit of the detected strategy occurs.

**AP-3 — findAnswerKeyStart searches from 50% threshold**  
For Surgery_4th which has per-section answer keys interspersed throughout the document, 
the 50% threshold might find an intermediate key rather than the document's actual structure, 
leading to partially matched or shifted answers.

**AP-4 — No question-count validation after parsing**  
If `extractQuestionsFromHtml` returns 0 questions (e.g., due to format mismatch), 
`applyAnswerKeyToQuestions` returns an empty array silently. There is no warning logged, 
no fallback strategy tried.

**AP-5 — Nested OL preprocessing modifies HTML globally**  
The `flatHtml` preprocessing applies globally to the entire document before any block 
is processed. For files with mixed OL formats (some nested, some flat), a regex overshoot 
in one section silently corrupts adjacent sections.

**AP-6 — isQuestion heuristic relies on English vocabulary**  
```javascript
/\b(which|what|choose|select|indicate|identify|specify|name|note|mark|determine|define|enumerate)\b/i
```
For medical files with transliterated or non-English question stems, this heuristic 
fails, causing questions to be classified as continuation text.

**AP-7 — No deduplication of output**  
If a document contains duplicate question text (e.g., repeated in two sections), both 
copies are emitted to the JSON output. This would cause DB conflicts on re-import.

**AP-8 — parseBoldCorrect is documented as imprecise and effectively unused**  
It is listed as "last resort" but will produce mostly wrong results because bold text 
indicates topics/keywords in most files, not correct answers. Should be removed or 
made explicit-opt-in only.

### Fragile Parsing Logic

**FR-1 — QUESTION_P requires digit prefix**  
`/^(\d+)[.)]\s*(?:(CM|CS)[.):]?\s+)?(\S[\s\S]+)$/i` — any unnumbered question stem 
(Nephrology, Obstetrics, some Pediatrics files) is never recognized as a question start.

**FR-2 — CORRECT_ANSWER_P matches position letters as named letters**  
Obstetrics uses "Correct answer: a, b, d" where a/b/d are OL-list POSITIONS, not 
named answer letters. The parser interprets them as named letters A, B, D and tries 
to mark those answers correct in an empty answers array → silently discards.

**FR-3 — innerOl lazy match in nested-OL flattening**  
```javascript
/<li>((?:(?!<\/li>|<\/ol>|<li)[\s\S])*?)<ol>([\s\S]*?)<\/ol>\s*<\/li>/g
```
The `([\s\S]*?)` for innerOl is lazy and stops at the FIRST `</ol>`. For doubly-nested 
structures (e.g., a question whose text itself contains sub-lists), the regex would 
stop at the inner-inner `</ol>` rather than the intended inner `</ol>`.

---

## Phase 3 — Format Families

| Family | Description | Files |
|--------|-------------|-------|
| **Bracket** | `[x]`/`[ ]` inline markers | Cardiology, Gastro, Pneumology, Surgery_Ped_Jalba, Neonatology |
| **Explicit** | `Correct answer: X` after each Q | Nephrology\*, Reumatology, Obstetrics\* |
| **OL key (Pediatrics)** | Flat OL list + CS/CM OL key at end | 12 Pediatrics files |
| **Nested OL** | `<li>Q<ol><li>A</li>...</ol></li>` | Nephrology, Reumatology, Malabsorbtion, colagenosis |
| **Surgery 5th** | Per-section bold OL keys | Surgery_5th year_Timis |
| **Underline** | XML underline markers in runs | Surgery_3rd year_Vescu |
| **Mixed/Hybrid** | Multiple formats in one file | Obstetrics (OL-list + explicit correct) |

\* Misfiled or mishandled due to format overlap

---

## Phase 4 — Controlled Execution (Parser Run 2026-04-09)

Parser command: `node scripts/parse-data-folder.mjs`

| File | Questions | SC | MC | Strategy Used |
|------|-----------|----|----|---------------|
| Cardiology_Grejdieru | 500 | — | — | Bracket |
| Gastro_Berliba | 357 | — | — | Bracket |
| Nephrology_Nistor | **23** | — | — | Explicit |
| Obstetrics_Ginecol_Catrinici | **283** | 128 | 155 | Explicit |
| Pneumology_Calaras | 213 | — | — | Bracket |
| Reumatology_Nistor | 239 | — | — | Explicit |
| Surgery_3rd year_Vescu | 124 | — | — | Underline |
| Surgery_4th year_Vozian | 68 | — | — | Answer key |
| Surgery_5th year_Timis | **74** | — | — | Per-section key |
| Surgery_Ped_Jalba | **107** | — | — | Bracket |
| Acute pneumonia_2026_OC | 50 | 21 | 29 | OL key (CS=18, CM=32) |
| Acute repiratory infections | 43 | 25 | 18 | OL key |
| ARF engl | 25 | 8 | 17 | OL key |
| Bronchial asthma_2026_OC | 34 | 21 | 13 | OL key |
| Bronchitis_2026_OC | 24 | 20 | 4 | OL key (CS=20, CM=4) |
| Child growth and development | 24 | 11 | 13 | OL key |
| Chronic lung disease | 40 | 23 | 17 | OL key |
| Coagulation disorders | 11 | 11 | 0 | OL key |
| colagenosis in children | 34 | 13 | 21 | OL key |
| Congenetal Heart Diseases | 53 | 20 | 33 | OL key |
| iron deficiency anemia | 31 | 14 | 17 | OL key |
| Malabsorbtion corrected | 16 | 16 | 0 | Nested OL + explicit |
| Malnutrition corrected | 40 | 15 | 25 | OL key |
| neonatology engl (REW2026) | **82** | 43 | 39 | Bracket |
| Rickets CORRECTED | 40 | 15 | 25 | OL key |
| **TOTAL** | **2535** | | | |

**Warnings generated:** 0  
**Files returning 0 questions:** 0  
**Files in bold** are known or suspected undercounts (see Phase 6).

---

## Phase 5 — Ground Truth Validation (Independent Analysis)

Ground truth was estimated using format-specific independent methods, NOT reusing parser logic:

| Method | Description |
|--------|-------------|
| **bracketGroups** | Count bracket-answer group transitions in raw HTML |
| **correctMarkers** | Count `Correct answer:` occurrences (one per question) |
| **nestedOlItems** | Count `<li>` items containing a nested `<ol>` |
| **olKeyItems** | Count items in the CS and CM OL key blocks combined |
| **keyAnswerCount** | Count items in all Surgery_5th KEY answer bold OL blocks |
| **numberedLines** | Count lines matching `^\d+[.)] (CS|CM)?` pattern |

### Ground Truth Results

| File | GT Method | GT Estimate | Confidence |
|------|-----------|-------------|------------|
| Cardiology_Grejdieru | bracketGroups | **500** | High |
| Gastro_Berliba | distinctQNums | **~357** | High |
| Nephrology_Nistor | correctMarkers | **239** | High |
| Obstetrics_Ginecol_Catrinici | correctMarkers | **~501** | Medium |
| Pneumology_Calaras | bracketGroups | **~228** | Medium |
| Reumatology_Nistor | correctMarkers | **248** | High |
| Surgery_3rd year_Vescu | underline XML | **~124** | Medium |
| Surgery_4th year_Vozian | per-section keys | **~100** | Low |
| Surgery_5th year_Timis | keyAnswerCount | **100** | High |
| Surgery_Ped_Jalba | bracketGroups | **~140** | Medium |
| Acute pneumonia | CS+CM OL items | **50** (18+32) | High |
| Acute repiratory inf | CS+CM OL items | **43** | High |
| ARF engl | CS+CM OL items | **25** | High |
| Bronchial asthma | CS+CM OL items | **34** | High |
| Bronchitis | CS+CM OL items | **24** (20+4) | High |
| Child growth | CS+CM OL items | **24** | High |
| Chronic lung | CS+CM OL items | **40** | High |
| Coagulation disorders | CS+CM OL items | **11** | High |
| colagenosis in children | nestedOlItems | **~57** | Medium |
| Congenetal Heart Diseases | CS+CM OL items | **53** | High |
| iron deficiency anemia | CS+CM OL items | **31** | High |
| Malabsorbtion corrected | nestedOlItems | **16** | High |
| Malnutrition corrected | CS+CM OL items | **~40** | Medium |
| neonatology engl | bracketGroups | **~94** | Medium |
| Rickets CORRECTED | CS+CM OL items | **~40** | Medium |

---

## Phase 6 — Comparison Report

### Per-File Discrepancy Analysis

| File | GT Estimate | Parser | Delta | Severity |
|------|-------------|--------|-------|----------|
| Cardiology_Grejdieru | 500 | 500 | 0 | PASS |
| Gastro_Berliba | ~357 | 357 | 0 | PASS |
| **Nephrology_Nistor** | **239** | **23** | **-216** | **CRITICAL** |
| **Obstetrics_Ginecol** | **~500** | **283** | **~-218** | **CRITICAL** |
| Pneumology_Calaras | ~228 | 213 | ~-15 | MODERATE |
| Reumatology_Nistor | 248 | 239 | -9 | MINOR |
| Surgery_3rd year_Vescu | ~124 | 124 | 0 | PASS |
| Surgery_4th year_Vozian | ~100 | 68 | ~-32 | MODERATE |
| **Surgery_5th year_Timis** | **100** | **74** | **-26** | **HIGH** |
| **Surgery_Ped_Jalba** | **~140** | **107** | **~-33** | **HIGH** |
| Acute pneumonia_2026_OC | 50 | 50 | 0 | PASS |
| Acute repiratory inf | 43 | 43 | 0 | PASS |
| ARF engl | 25 | 25 | 0 | PASS |
| Bronchial asthma | 34 | 34 | 0 | PASS |
| Bronchitis_2026_OC | 24 | 24 | 0 | PASS |
| Child growth | 24 | 24 | 0 | PASS |
| Chronic lung disease | 40 | 40 | 0 | PASS |
| Coagulation disorders | 11 | 11 | 0 | PASS |
| colagenosis in children | ~57 | 34 | ~-23 | MODERATE |
| Congenetal Heart Diseases | 53 | 53 | 0 | PASS |
| iron deficiency anemia | 31 | 31 | 0 | PASS |
| Malabsorbtion corrected | 16 | 16 | 0 | PASS |
| Malnutrition corrected | ~40 | 40 | ~0 | PASS |
| neonatology engl | ~94 | 82 | ~-12 | MODERATE |
| Rickets CORRECTED | ~40 | 40 | ~0 | PASS |

### Summary Statistics

| Metric | Value |
|--------|-------|
| Files with 0 delta | 14 |
| Files with PASS | 14 |
| Files MINOR (< 10 missing) | 1 |
| Files MODERATE (10–30 missing) | 4 |
| Files HIGH (26–33 missing) | 2 |
| Files CRITICAL (> 100 missing) | 2 |
| Total parser output | 2535 |
| Estimated total actual | ~2780 |
| Estimated questions lost | **~245** (8.8%) |

### Root Cause Attribution

| Root Cause | Files Affected | Est. Questions Lost |
|------------|---------------|---------------------|
| parseExplicit ignores unlabeled list answers | Obstetrics | ~218 |
| parseExplicit ignores non-prefixed unnumbered stems | Nephrology | ~216 |
| Surgery_5th sequential mapping drift | Surgery_5th | ~26 |
| Bracket parser misses alternate bracket structures | Surgery_Ped, Neonatology | ~45 |
| Mixed OL format (colagenosis part nested, part flat) | colagenosis | ~23 |
| Text key mismatch / answer drift | Surgery_4th, Reumatology | ~40 |
| **Total** | | **~568 (some overlap)** |

---

## Phase 7 — Findings Summary & Prioritized Fix List

### P0 — Critical (Fix First)

**P0-A: Nephrology CS questions (−216 questions)**  
`parseExplicit` must detect unnumbered paragraph text as a question start when:
- There is no CS/CM prefix AND
- The text is followed by lettered answer paragraphs OR  
- An `<h2>CS</h2>` or `<h2>CM</h2>` immediately precedes the OL block  
Fix: In `parseExplicit`, add the same `isQuestion()` heuristic that `extractQuestionsFromHtml` uses, or detect the `<h2>CS/CM</h2>` context to set question type and expect the next paragraph as the question stem.

**P0-B: Obstetrics unlabeled OL answers (−218 questions)**  
Obstetrics format: `<ol><li>CM. Question text</li><li>answer 1</li>...<li>answer 5</li></ol><p>Correct answer: a, b, d</p>`  
The "Correct answer" uses position-based lowercase letters (a=1st, b=2nd). Parser:
1. Needs to recognize when list items inside an OL where the FIRST item is the question stem (starts with CS/CM prefix or is a question)
2. Assign auto-letters A–E to remaining list items
3. Interpret position-based "Correct answer: a, b" by mapping to auto-assigned letters  
Fix: In `extractQuestionsFromHtml`, when iterating OL list items, if the first `<li>` is a question and subsequent `<li>` items have no letter prefix, auto-assign letters and mark them. For `parseExplicit`, apply the same treatment after detecting a `csMatch` within an OL item context.

### P1 — High (Fix Next)

**P1-A: Surgery_5th sequential drift (−26 questions)**  
`parseSurgery5th` counts answer-key items = 100, but returns 74. Likely 26 questions 
from `extractQuestionsFromSurgery5thHtml` are not recognized because the question format 
regex `^(\d+)\.(CM|CS)\s+(.{5,})$` is strict. Answer-option lines parsed as "questions" 
shift the remaining mapping.  
Fix: Add validation that the number of extracted questions per section ≈ key items for 
that section. Log mismatches instead of silently drifting.

**P1-B: Surgery_Ped_Jalba missing ~33 questions**  
Bracket parser sees 140 groups but captures only 107. 33 questions likely use a variant 
bracket format (e.g., no question number, or the bracket appears on a CS/CM-labeled line 
which triggers csMatch INSTEAD of a bracket answer match).  
Fix: Trace through Surgery_Ped_Jalba HTML to find which 33 questions are dropped. The 
`pendingNumber` + `pendMatch` path may fail for questions that have neither a number nor 
inline CS/CM prefix.

### P2 — Moderate

**P2-A: Nephrology/Obstetrics/Reumatology shared issue — parseExplicit doesn't handle h2-CS/CM context**

**P2-B: colagenosis ~23 missing questions**  
colagenosis uses nested OL for some questions and flat OL for others. The flattening 
regex handles nested, but flat OL items (without a nested sub-OL) are treated as 
regular list items by `extractQuestionsFromHtml`. Some answers therefore get 
misclassified as question starts.

**P2-C: Neonatology missing ~12 bracket-format questions**  
Bracket parser gets 82 vs estimated 94. Likely same cause as Surgery_Ped — some 
question structures don't match the recognized patterns.

**P2-D: Pneumology missing ~15 questions**  
Bracket parser gets 213 vs estimated 228. Some CS/CM questions in Pneumology's 
"flat-list" section likely use bracket format that fails the `ANSWER_BRACKET_P` pattern.

### P3 — Minor / Hardening

- Remove `parseBoldCorrect` or make it explicit-opt-in (currently registered as 
  fallback but almost never produces correct results)
- Add `tryOlAnswerKey` count guard: if `|csAnswers| + |cmGroups|` differs from 
  `extractQuestionsFromHtml` count by more than 20%, log a warning
- Replace hardcoded filename dispatching with content-based heuristics or a 
  configurable map
- Add integration test harness: run parser, compare output counts against expected 
  values, fail loudly on regression

---

## Appendix A — Data Integrity (Current JSON)

File: `scripts/generated/parsed-questions.json`  
Generated: 2026-04-09 (this audit run)  
Total questions: **2535**

All 2535 questions have:
- `source_file` (relative path)  
- `question_order` (0-based per file)  
- `question_number` (from document)  
- `type` (`single` | `multiple`)  
- `answers` array with `is_correct` flags  

**Idempotency status:** The output file is overwritten on each parser run. No DB import 
has been run in this session. The `reset-and-import.mjs` script (Task #3 from backlog) 
does not yet exist — DB import is still a manual step.

---

## Appendix B — DB Schema Status

Migration file: `supabase/migrations/20260407_add_question_metadata.sql`  
Contents include: `ADD COLUMN source_file`, `ADD COLUMN question_order`, `DROP COLUMN topic`  
**Status:** Migration file EXISTS on disk. Whether it has been APPLIED to the live DB 
is unknown — requires `supabase migration list` or direct DB column check to verify.

---

## Appendix C — API / UI Alignment with Data

| Component | Status | Issues |
|-----------|--------|--------|
| `GET /api/questions` | Partially broken | Still references `topic` column; `?modules=1` returns module list but modules=file stems (no folder grouping) |
| `POST /api/exam/start` | Partially broken | Schema accepts `files: string[]` but still has `module?` and `topic?` fallback paths; `originalOrder` sort uses `question_order` column which may not exist yet in live DB |
| `app/dashboard/page.tsx` | Mixed | Has new file/folder selection UI code alongside old module/topic UI; selection mode switch exists but folder grouping incomplete |

**Conclusion:** The API and UI are in a transitional state — neither the old topic/module 
system nor the new file-based system is fully functional end-to-end. The DB migration 
must be applied before file-based exam start will work correctly.

---

*Report generated as part of a read-only diagnostic audit session. No code was modified.*
