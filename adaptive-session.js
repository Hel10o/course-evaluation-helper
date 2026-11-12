'use strict';

const path = require('node:path');
const { AnswerStore } = require('./adaptive-store');
const { questionKey, templateScope, suggestAnswer, validateAnswer, answerMatches } = require('./adaptive-core');
const { readQuestionnaire, applyAnswer } = require('./questionnaire-dom');
const { reviewNewAnswers } = require('./adaptive-review');

function assertReadable(snapshot) {
  if (snapshot.unsupported.length) throw new Error(`存在尚不支持的题型：${snapshot.unsupported.map(item => `${item.question || '未知题目'}（${item.kind}）`).join('；')}。请手动处理或补充适配，未自动提交。`);
  if (!snapshot.questions.length) throw new Error('没有读取到问卷题目');
  const keys = snapshot.questions.map(questionKey);
  if (new Set(keys).size !== keys.length) throw new Error('存在题干和选项完全相同的多题，无法区分上下文，请补充题干适配');
}

const signature = questions => questions.map(questionKey).sort().join('|');

class AdaptiveSession {
  constructor({
    store = new AnswerStore(path.join(__dirname, 'templates', 'approved-answers.json')),
    review = reviewNewAnswers, log = console.log, scopeForPage = page => templateScope(page.url()),
  } = {}) {
    this.store = store;
    this.review = review;
    this.log = log;
    this.scopeForPage = scopeForPage;
    this.last = null;
  }

  async prepare(page, snapshot) {
    assertReadable(snapshot);
    const scope = this.scopeForPage(page);
    const items = snapshot.questions.map(question => {
      const saved = this.store.find(scope, question);
      const suggestion = saved ? { answer: saved.answer, reason: '已确认模板' } : suggestAnswer(question);
      return { question, saved: Boolean(saved), ...suggestion };
    });
    if (items.some(item => !item.saved)) {
      await this.review(items);
      for (const item of items) validateAnswer(item.question, item.answer);
      // 只有明确确认后才把新题写入模板；建议或预览文件不能直接变成已批准答案。
      this.store.approve(scope, items.filter(item => !item.saved));
    }
    return { scope, items, signature: signature(snapshot.questions) };
  }

  async fill(page, config) {
    for (let round = 0; round < config.maxScanRounds; round++) {
      const initial = await readQuestionnaire(page);
      const plan = await this.prepare(page, initial);
      let changed = false;
      for (const item of plan.items) {
        const current = await readQuestionnaire(page);
        assertReadable(current);
        if (signature(current.questions) !== plan.signature) { changed = true; break; }
        const question = current.questions.find(candidate => questionKey(candidate) === questionKey(item.question)
          && candidate.number === item.question.number)
          || current.questions.find(candidate => questionKey(candidate) === questionKey(item.question));
        if (!answerMatches(question, item.answer)) await applyAnswer(current, question, item.answer, config.actionTimeout);
      }
      if (changed) continue;
      await page.waitForTimeout(200);
      const final = await readQuestionnaire(page);
      assertReadable(final);
      if (signature(final.questions) !== plan.signature) continue;
      if (final.questions.some(question => {
        const entry = this.store.find(plan.scope, question);
        return !entry || !answerMatches(question, entry.answer);
      })) continue;
      this.last = { scope: plan.scope, signature: plan.signature,
        answers: Object.fromEntries(plan.items.map(item => [questionKey(item.question), item.answer])) };
      await this.validate(page);
      this.log(`✅ ${final.questions.length} 道题已按确认模板填写并复核，准备提交`);
      return { total: final.questions.length, answered: final.questions.length, skipped: 0 };
    }
    throw new Error('问卷多次变化或选中状态未稳定，已停止提交');
  }

  async validate(page) {
    const snapshot = await readQuestionnaire(page);
    assertReadable(snapshot);
    if (!this.last || this.last.scope !== this.scopeForPage(page) || signature(snapshot.questions) !== this.last.signature) {
      throw new Error('提交前问卷已变化，需要重新读取并确认变化题');
    }
    for (const question of snapshot.questions) {
      const entry = this.store.find(this.last.scope, question);
      if (!entry || !answerMatches(question, entry.answer)) throw new Error(`第 ${question.number} 题尚未按已确认模板填写`);
      if (['text', 'number', 'select', 'multiselect'].includes(question.kind)) {
        const valid = await snapshot.frame.locator(question.selector).evaluate(element => element.validity?.valid !== false);
        if (!valid) throw new Error(`第 ${question.number} 题不符合页面输入要求`);
      }
    }
  }

  async ready(page) {
    const snapshot = await readQuestionnaire(page);
    return snapshot.questions.length > 0 || snapshot.unsupported.length > 0;
  }

  async nextReady(page) {
    const snapshot = await readQuestionnaire(page);
    if (snapshot.unsupported.length) return true; // 交由下一轮明确报告不支持的题型。
    if (!snapshot.questions.length) return false;
    if (!this.last || signature(snapshot.questions) !== this.last.signature) return true;
    return snapshot.questions.some(question => !answerMatches(question, this.last.answers[questionKey(question)]));
  }
}

module.exports = { AdaptiveSession, assertReadable, signature };
