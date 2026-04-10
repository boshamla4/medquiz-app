import fs from 'node:fs';
const raw = JSON.parse(fs.readFileSync('scripts/generated/parsed-questions.json','utf8'));
const files = raw.files; // array of { file, questions: [...] }

let total = 0;
let globalNoCorrect = 0;
for (const entry of files) {
  const qs = entry.questions;
  const fname = entry.file.split('/').at(-1);
  const noAnswers = qs.filter(q => !q.answers || q.answers.length === 0).length;
  const noCorrect = qs.filter(q => q.answers?.length > 0 && !q.answers.some(a => a.is_correct)).length;
  const avg = qs.length ? (qs.reduce((s,q) => s + (q.answers?.length||0), 0) / qs.length).toFixed(1) : 0;
  const flag = (noAnswers > 0 || noCorrect > 0) ? ' <<< ISSUE' : '';
  console.log(`${fname}: ${qs.length}q | noAnswers=${noAnswers} | noCorrect=${noCorrect} | avg=${avg}${flag}`);

  if (noCorrect > 0) {
    // Show first problematic question
    const bad = qs.find(q => q.answers?.length > 0 && !q.answers.some(a => a.is_correct));
    console.log(`  Sample: [${bad.type}] ${bad.question_text.slice(0,80)}...`);
    console.log(`  Answers: ${bad.answers.map(a => a.letter + (a.is_correct?'*':'')).join(', ')}`);
  }

  total += qs.length;
  globalNoCorrect += noCorrect;
}
console.log(`\nTOTAL: ${total} | questions with no correct answer: ${globalNoCorrect}`);
