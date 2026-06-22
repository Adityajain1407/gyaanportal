#!/usr/bin/env node
// .github/scripts/build-search-index.js
//
// Scans every .html file in the repo (excluding index.html and any files
// in .github/), extracts the FULL_QUIZ array from each, and writes a
// consolidated search-index.json to the repo root.
//
// Run automatically by GitHub Actions on every push to main.
// Output format:
// {
//   "built": "ISO timestamp",
//   "quizzes": [
//     {
//       "path": "Folder/Quiz Name.html",   // relative path from repo root
//       "name": "Quiz Name",               // display name (filename without ext)
//       "folder": "Folder",               // parent path for display
//       "questions": [
//         { "text": "...", "opts": [...], "ans": "A", "exp": "..." },
//         ...
//       ]
//     },
//     ...
//   ]
// }

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_FILE = path.join(REPO_ROOT, 'search-index.json');
const EXCLUDE_FILES = new Set(['index.html']);
const EXCLUDE_DIRS = new Set(['.github', 'node_modules', '.git']);

function cleanName(filename) {
  return filename.replace(/\.[^.]+$/, '').replace(/^\d+\.\s*/, '').trim();
}

function findHtmlFiles(dir, relBase = '') {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const absPath = path.join(dir, entry.name);
    const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...findHtmlFiles(absPath, relPath));
    } else if (entry.isFile() && entry.name.endsWith('.html') && !EXCLUDE_FILES.has(entry.name)) {
      results.push(relPath);
    }
  }
  return results;
}

function extractQuiz(filePath) {
  const src = fs.readFileSync(filePath, 'utf-8');
  // Match the FULL_QUIZ array, allowing for topicName and comments between
  // the closing ]; and const TOTAL_QS (the template puts them ~5-10 lines apart)
  const match = src.match(/const\s+FULL_QUIZ\s*=\s*(\[[\s\S]*?\]);[\s\S]{0,800}?const\s+TOTAL_QS/);
  if (!match) return null;
  try {
    // Safe eval via Function constructor — only runs on our own repo files
    // eslint-disable-next-line no-new-func
    const questions = Function('"use strict"; return (' + match[1] + ')')();
    if (!Array.isArray(questions) || questions.length === 0) return null;
    // Strip to only the fields needed for search — keeps the index lean
    return questions.map(q => ({
      text: q.text || '',
      opts: (q.opts || []),
      ans: q.ans || '',
      exp: q.exp || ''
    }));
  } catch (e) {
    console.warn(`  ⚠ Could not parse FULL_QUIZ in ${filePath}: ${e.message}`);
    return null;
  }
}

console.log('Building search index…');
const htmlFiles = findHtmlFiles(REPO_ROOT);
console.log(`Found ${htmlFiles.length} quiz file(s)`);

const quizzes = [];
for (const relPath of htmlFiles) {
  const absPath = path.join(REPO_ROOT, relPath);
  const parts = relPath.split('/');
  const filename = parts[parts.length - 1];
  const name = cleanName(filename);
  const folder = parts.length > 1 ? parts.slice(0, -1).join(' / ') : '';

  process.stdout.write(`  Parsing: ${relPath} … `);
  const questions = extractQuiz(absPath);
  if (!questions) {
    console.log('skipped (no FULL_QUIZ found)');
    continue;
  }
  quizzes.push({ path: relPath, name, folder, questions });
  console.log(`${questions.length} questions`);
}

const index = {
  built: new Date().toISOString(),
  quizzes
};

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(index), 'utf-8');
const sizeKB = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1);
console.log(`\n✅ search-index.json written — ${quizzes.length} quizzes, ${index.quizzes.reduce((s,q)=>s+q.questions.length,0)} total questions, ${sizeKB} KB`);
