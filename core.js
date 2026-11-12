'use strict';

const ANSWER_MODES = new Set(['positive', 'uniform', 'perQuestion']);

function normalizeText(value) {
  return String(value ?? '')
    .replace(/[\s\u00a0]+/g, '')
    .replace(/[，。！？、；：,.!?;:]/g, '')
    .trim();
}

const ANSWER_ALIASES = new Map([
  ['非常满意', ['非常满意', '非常同意', '完全同意']],
  ['非常同意', ['非常同意', '完全同意', '非常满意']],
  ['满意', ['满意', '同意']],
  ['同意', ['同意', '满意']],
  ['不满意', ['不满意', '不同意']],
  ['不同意', ['不同意', '不满意']],
  ['非常不满意', ['非常不满意', '非常不同意', '完全不同意']],
  ['非常不同意', ['非常不同意', '完全不同意', '非常不满意']],
]);

// 只收录语义明确的正面选项。未知题型必须显式配置，避免按位置猜测。
const POSITIVE_ANSWERS = [
  '有讲解，讲解非常清晰且过程中不断强调',
  '非常满意', '非常同意', '完全同意', '十分满意',
  '优秀', '非常好', '很好', '满意', '同意', '良好', '好',
];

function chooseOptionIndex(optionTexts, targetAnswer) {
  const normalizedOptions = optionTexts.map(normalizeText);

  if (targetAnswer === '__POSITIVE__') {
    for (const answer of POSITIVE_ANSWERS) {
      const index = normalizedOptions.indexOf(normalizeText(answer));
      if (index !== -1) return index;
    }
    return -1;
  }

  const aliases = ANSWER_ALIASES.get(targetAnswer) ?? [targetAnswer];
  for (const answer of aliases) {
    const index = normalizedOptions.indexOf(normalizeText(answer));
    if (index !== -1) return index;
  }
  return -1;
}

function answerForQuestion(config, questionIndex) {
  const key = String(questionIndex + 1);
  if (Object.prototype.hasOwnProperty.call(config.perQuestionAnswers, key)) {
    return config.perQuestionAnswers[key];
  }
  if (config.answerMode === 'positive') return '__POSITIVE__';
  return config.uniformAnswer;
}

function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('配置必须是一个 JSON 对象');
  }

  let url;
  try {
    url = new URL(input.url);
  } catch {
    throw new Error('config.url 必须是有效的 http/https 地址');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('config.url 只允许 http/https 地址');
  }

  const answerMode = input.answerMode ?? 'positive';
  if (!ANSWER_MODES.has(answerMode)) {
    throw new Error(`config.answerMode 必须是 ${[...ANSWER_MODES].join('、')} 之一`);
  }

  const perQuestionAnswers = input.perQuestionAnswers ?? {};
  if (!perQuestionAnswers || typeof perQuestionAnswers !== 'object' || Array.isArray(perQuestionAnswers)) {
    throw new Error('config.perQuestionAnswers 必须是对象');
  }
  for (const [key, value] of Object.entries(perQuestionAnswers)) {
    if (key.startsWith('_')) continue;
    if (!/^[1-9]\d*$/.test(key) || typeof value !== 'string' || !value.trim()) {
      throw new Error(`perQuestionAnswers.${key} 必须是非空答案文本，题号必须为正整数`);
    }
  }

  if (answerMode !== 'positive' && (typeof input.uniformAnswer !== 'string' || !input.uniformAnswer.trim())) {
    throw new Error('uniform/perQuestion 模式必须设置非空的 config.uniformAnswer');
  }

  const booleanFields = [
    'autoSubmit',
    'skipIfNoMatch',
    'headless',
    'keepBrowserOpenOnError',
    'captureRoutineScreenshots',
  ];
  for (const field of booleanFields) {
    if (input[field] !== undefined && typeof input[field] !== 'boolean') {
      throw new Error(`config.${field} 必须是 true 或 false`);
    }
  }

  const numberDefaults = {
    navigationTimeout: 30000,
    actionTimeout: 10000,
    successTimeout: 20000,
    maxScanRounds: 10,
    maxCourses: 100,
    maxScreenshots: 200,
    screenshotRetentionDays: 30,
  };
  const numbers = {};
  for (const [field, fallback] of Object.entries(numberDefaults)) {
    const value = input[field] ?? fallback;
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`config.${field} 必须是大于 0 的整数`);
    }
    numbers[field] = value;
  }

  return {
    ...input,
    ...numbers,
    url: url.toString(),
    answerMode,
    uniformAnswer: input.uniformAnswer ?? '',
    perQuestionAnswers,
    suggestionText: input.suggestionText ?? '',
    autoSubmit: input.autoSubmit ?? false,
    skipIfNoMatch: input.skipIfNoMatch ?? false,
    headless: input.headless ?? false,
    keepBrowserOpenOnError: input.keepBrowserOpenOnError ?? false,
    captureRoutineScreenshots: input.captureRoutineScreenshots ?? false,
  };
}

module.exports = {
  answerForQuestion,
  chooseOptionIndex,
  normalizeText,
  validateConfig,
};
