'use strict';

const crypto = require('node:crypto');
const compact = value => String(value || '').replace(/\s+/g, '').trim();
const titleKey = value => compact(value).replace(/^[*＊]+/, '')
  .replace(/^(?:第[一二三四五六七八九十百\d]+题|\d+[.．、)）])/, '');

function questionKey(question) {
  if (!titleKey(question.question)) throw new Error(`第 ${question.number} 题未能读取题干，不能按选项猜测模板`);
  const texts = question.options.filter(option => !option.disabled).map(option => compact(option.text));
  if (texts.some(text => !text) || new Set(texts).size !== texts.length) {
    throw new Error(`第 ${question.number} 题选项为空或重名，无法唯一识别`);
  }
  const shape = { question: titleKey(question.question), kind: question.kind, required: question.required,
    options: question.options.map(option => [compact(option.text), Boolean(option.disabled)]).sort((a, b) => a[0].localeCompare(b[0])),
    min: question.min ?? null, max: question.max ?? null, step: question.step ?? null, minLength: question.minLength ?? 0,
    maxLength: question.maxLength ?? null, pattern: question.pattern || '' };
  return crypto.createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}

function templateScope(url) {
  const parsed = new URL(url);
  const term = /(?:[?&#/=]|^)semester=([^&#/]+)/i.exec(parsed.search + parsed.hash)?.[1] || '未标明学期';
  return `${parsed.origin}${parsed.pathname} | ${decodeURIComponent(term)} | neutral-good-v1`;
}

function validateAnswer(question, answer) {
  if (['radio', 'checkbox', 'select', 'multiselect'].includes(question.kind)) {
    if (!Array.isArray(answer)) throw new Error('请选择选项编号');
    const enabled = question.options.filter(option => !option.disabled).map(option => option.text);
    if (new Set(answer).size !== answer.length || answer.some(text => !enabled.includes(text))) throw new Error('答案包含不存在、重复或禁用的选项');
    if (question.required && !answer.length) throw new Error('必填题不能留空');
    if (question.kind === 'radio' && !answer.length && question.options.some(option => option.checked)) throw new Error('已选中的单选题不能通过普通点击清空，请选择一个答案');
    if (['radio', 'select'].includes(question.kind) && answer.length > 1) throw new Error('单选题只能选择一个答案');
  } else {
    if (typeof answer !== 'string') throw new Error('请输入文本答案');
    if (question.required && !answer.trim()) throw new Error('必填题不能留空');
    if (answer && answer.length < (question.minLength || 0)) throw new Error('答案未达到最小字数');
    if (question.maxLength != null && answer.length > question.maxLength) throw new Error('答案超过最大字数');
    if (question.kind === 'number' && answer) {
      const value = Number(answer);
      if (!Number.isFinite(value) || (question.min != null && value < Number(question.min))
        || (question.max != null && value > Number(question.max))) throw new Error('数值不在允许范围内');
    }
  }
  return answer;
}

function suggestAnswer(question) {
  const unknown = reason => ({ answer: null, reason });
  if (['text', 'number'].includes(question.kind)) {
    return question.required ? unknown('必填开放题，需要你填写') : { answer: '', reason: '可选输入默认留空' };
  }
  if (['checkbox', 'multiselect'].includes(question.kind)) return unknown('多选题需要核对实际内容');
  const title = titleKey(question.question);
  if (!title) return unknown('没有题干');
  const pick = (labels, reason) => {
    for (const label of labels) {
      const option = question.options.find(item => !item.disabled && compact(item.text).replace(/[，,。]/g, '') === compact(label).replace(/[，,。]/g, ''));
      if (option) return { answer: [option.text], reason };
    }
    return unknown('未识别到适合的中性或较好答案');
  };
  // 先处理明确的适宜尺度；不会把“越快/越难/越多”当成越好。
  if (/语速|节奏|进度|难度|作业量|负担|课时/.test(title)) {
    const pace = pick(['适宜', '适中', '合适'], '适宜尺度');
    if (pace.answer) return pace;
  }
  if (/迟到|早退|旷课|违规|歧视|辱骂|敷衍|照本宣科|拖堂|缺乏|不足|难以|不(?!断)|未|没有/.test(title)) {
    return unknown('含负向或事实性描述，需要你判断');
  }
  if (question.options.every(option => /^(是|否|有|无)([（(].*)?$/.test(compact(option.text)))) {
    return unknown('是/否或有/无题，需要你确认事实');
  }
  if (/互动|讨论|提问|答疑|指导|反馈|鼓励|交流/.test(title)
    && question.options.some(option => compact(option.text) === '经常')) {
    return pick(['经常'], '正向互动频率，偏较好');
  }
  if (/满意|认可|认同|同意|教学|授课|老师|教师|课程|讲解|学习|课堂/.test(title)) {
    return pick(['满意', '较满意', '同意', '较好', '良好', '有讲解，基本清晰', '有安排，基本满足',
      '有反馈，有帮助', '涉及较多', '基本清晰', '基本满足', '一般'], '本地规则：中性或较好（首次需核对）');
  }
  return unknown('题意或选项不在明确规则内');
}

function answerMatches(question, answer) {
  if (Array.isArray(answer)) {
    const selected = question.options.filter(option => option.checked).map(option => option.text).sort();
    return JSON.stringify(selected) === JSON.stringify([...answer].sort());
  }
  return question.value === answer;
}

module.exports = { questionKey, templateScope, validateAnswer, suggestAnswer, answerMatches };
