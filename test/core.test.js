'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  answerForQuestion,
  chooseOptionIndex,
  normalizeText,
  validateConfig,
} = require('../core');

const baseConfig = {
  url: 'https://example.edu/evaluation',
  answerMode: 'positive',
  perQuestionAnswers: {},
};

test('normalizeText removes whitespace and punctuation', () => {
  assert.equal(normalizeText(' 非常 同意！ '), '非常同意');
});

test('positive mode chooses by meaning instead of position', () => {
  assert.equal(chooseOptionIndex(['非常同意', '同意', '一般', '不同意'], '__POSITIVE__'), 0);
  assert.equal(chooseOptionIndex(['一般', '非常满意', '不满意'], '__POSITIVE__'), 1);
});

test('positive mode refuses unknown binary questions', () => {
  assert.equal(chooseOptionIndex(['有', '无'], '__POSITIVE__'), -1);
  assert.equal(chooseOptionIndex(['是', '否'], '__POSITIVE__'), -1);
});

test('positive mode recognizes the full-sentence answer from the actual questionnaire', () => {
  const options = [
    '没有重难点讲解',
    '有讲解，但比较模糊',
    '有讲解，基本清晰',
    '有讲解，讲解非常清晰且过程中不断强调',
  ];
  assert.equal(chooseOptionIndex(options, '__POSITIVE__'), 3);
  assert.equal(chooseOptionIndex([...options].reverse(), '__POSITIVE__'), 0);
  assert.equal(chooseOptionIndex(['没有讲解非常清晰的内容'], '__POSITIVE__'), -1);
});

test('configured answers use exact normalized matching', () => {
  assert.equal(chooseOptionIndex(['非常满意', '满意'], '满意'), 1);
  assert.equal(chooseOptionIndex(['非常同意', '同意'], '非常满意'), 0);
  assert.equal(chooseOptionIndex(['比较满意'], '满意'), -1);
});

test('per-question answer overrides positive mode', () => {
  const config = validateConfig({
    ...baseConfig,
    perQuestionAnswers: { 1: '无' },
  });
  assert.equal(answerForQuestion(config, 0), '无');
  assert.equal(answerForQuestion(config, 1), '__POSITIVE__');
});

test('safe defaults disable automatic and incomplete submission', () => {
  const config = validateConfig(baseConfig);
  assert.equal(config.autoSubmit, false);
  assert.equal(config.skipIfNoMatch, false);
  assert.equal(config.captureRoutineScreenshots, false);
});

test('invalid config is rejected with a useful error', () => {
  assert.throws(() => validateConfig({ ...baseConfig, url: 'not a url' }), /有效/);
  assert.throws(() => validateConfig({ ...baseConfig, answerMode: 'guess' }), /answerMode/);
  assert.throws(
    () => validateConfig({ ...baseConfig, perQuestionAnswers: { x: '无' } }),
    /正整数/,
  );
});
