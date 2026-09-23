// 词库读取（见 FULLREADME.md 第7节 / 第11.3节）：
//   backend/wordbanks/ 目录下每个 .txt 文件是一个分类，文件名（去扩展名）即分类 id/展示名，
//   文件内一行一个词。这里只做“列分类” + “分类内随机抽词”，不做分类的增删改（一期直接改文件即可）。
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const WORDBANKS_DIR = process.env.WORDBANKS_DIR
  ? path.resolve(process.env.WORDBANKS_DIR)
  : path.join(__dirname, '..', '..', 'wordbanks');

function readCategoryFile(fileName) {
  const filePath = path.join(WORDBANKS_DIR, fileName);
  const raw = fs.readFileSync(filePath, 'utf-8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

// 列出所有分类：{ id, name, wordCount }。id/name 目前一致，都用文件名去掉 .txt。
function listCategories() {
  if (!fs.existsSync(WORDBANKS_DIR)) return [];
  return fs
    .readdirSync(WORDBANKS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.txt'))
    .map((fileName) => {
      const id = fileName.slice(0, -4);
      let wordCount = 0;
      try {
        wordCount = readCategoryFile(fileName).length;
      } catch (err) {
        wordCount = 0;
      }
      return { id, name: id, wordCount };
    })
    .filter((c) => c.wordCount > 0);
}

function categoryExists(categoryId) {
  if (typeof categoryId !== 'string' || !categoryId) return false;
  // 防止路径穿越（比如传 "../../etc/passwd"）
  if (categoryId.includes('/') || categoryId.includes('\\') || categoryId.includes('..')) {
    return false;
  }
  return fs.existsSync(path.join(WORDBANKS_DIR, `${categoryId}.txt`));
}

// 从指定分类里随机抽 count 个不重复的词，供作画者选词候选（竞猜/接龙一期都是抽 3 个）。
function pickWords(categoryId, count = 3) {
  if (!categoryExists(categoryId)) {
    throw new Error(`WORDBANK_CATEGORY_NOT_FOUND: ${categoryId}`);
  }
  const words = readCategoryFile(`${categoryId}.txt`);
  const pool = [...words];
  const picked = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i += 1) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

module.exports = { listCategories, categoryExists, pickWords, WORDBANKS_DIR };
