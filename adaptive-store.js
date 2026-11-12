'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { questionKey, validateAnswer } = require('./adaptive-core');

class AnswerStore {
  constructor(file) {
    this.file = file;
    this.data = { version: 1, scopes: {} };
    if (fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (this.data.version !== 1 || !this.data.scopes || typeof this.data.scopes !== 'object' || Array.isArray(this.data.scopes)) {
        throw new Error(`模板格式无效，请检查 ${file}`);
      }
    }
  }
  find(scope, question) {
    const entry = this.data.scopes[scope]?.[questionKey(question)];
    if (!entry || entry.approved !== true) return null;
    const compact = text => text.replace(/\s+/g, '');
    const answer = Array.isArray(entry.answer) ? entry.answer.map(text =>
      question.options.find(option => compact(option.text) === compact(text))?.text || text) : entry.answer;
    validateAnswer(question, answer);
    return { ...entry, answer };
  }
  approve(scope, items) {
    const entries = this.data.scopes[scope] || {};
    for (const item of items) {
      validateAnswer(item.question, item.answer);
      entries[questionKey(item.question)] = { question: item.question.question, kind: item.question.kind,
        options: item.question.options.map(option => option.text), answer: item.answer,
        approved: true, approvedAt: new Date().toISOString() };
    }
    this.data.scopes[scope] = entries;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2));
    fs.renameSync(temporary, this.file);
  }
}

module.exports = { AnswerStore };
