'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const observed = require('./fixtures/questionnaire-observed.json');
const profile = require('../questionnaire-2026-2027-1.json');
const { validateConfig } = require('../core');
const { loadCurrentSetup } = require('../evaluate-current');
const {
  fillFixedQuestionnaire, planFixedAnswers, validateFixedPage, validateProfile,
} = require('../fixed-questionnaire');

let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

const config = validateConfig({
  url: 'https://example.edu/evaluation',
  actionTimeout: 1000,
  autoSubmit: false,
});

function escapeHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
}

async function questionnairePage(questions = observed, { reverse = false, preselect = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(`
    <div style="height:750px;overflow:auto">
      ${questions.map((question, q) => `<div class="ant-radio-group" style="margin:30px 0">
        ${(reverse ? [...question.options].reverse() : question.options).map((option, i) => `
          <label style="display:block;padding:6px"><input type="radio" name="q${q}"
            ${preselect && i === 0 ? 'checked' : ''}>${escapeHtml(option.text)}</label>
        `).join('')}
      </div>`).join('')}
      <button onclick="document.body.dataset.submitted='yes'">提交</button>
    </div>
  `);
  return page;
}

test('current setup uses all twelve neutral or good answers and honors local submit settings', () => {
  const baseConfig = validateConfig(require('../config.example.json'));
  const setup = loadCurrentSetup(baseConfig);
  assert.equal(setup.config.autoSubmit, baseConfig.autoSubmit);
  assert.equal(setup.config.answerMode, 'perQuestion');
  assert.deepEqual(Object.values(setup.config.perQuestionAnswers), [
    '无', '较好', '同意', '有讲解，基本清晰', '涉及较多', '有安排，基本满足',
    '有反馈，有帮助', '经常', '同意', '满意', '适宜', '满意',
  ]);
});

test('the old question eleven answer is rejected by the fixed profile', () => {
  const wrong = structuredClone(profile);
  wrong.questions[10].answer = '无';
  assert.throws(() => validateProfile(wrong), /第 11 题答案不在选项中/);
});

test('a changed question count or option set is rejected', () => {
  assert.throws(() => planFixedAnswers(observed.slice(1), profile), /应有 12 题/);
  const changed = structuredClone(observed);
  changed[10].options[2].text = '新的选项';
  assert.throws(() => planFixedAnswers(changed, profile), /第 11 题/);
});

test('the complete real option sets fill with the requested moderate answers, even after option reordering', async () => {
  const page = await questionnairePage(observed, { reverse: true, preselect: true });
  try {
    const result = await fillFixedQuestionnaire(page, config, profile);
    assert.equal(result.answered, 12);
    const selected = await page.locator('label:has(input:checked)').allTextContents();
    assert.deepEqual(selected.map(text => text.trim()), [
      '无', '较好', '同意', '有讲解，基本清晰', '涉及较多', '有安排，基本满足',
      '有反馈，有帮助', '经常', '同意', '满意', '适宜', '满意',
    ]);
    await validateFixedPage(page, config, profile);
    assert.equal(await page.locator('body').getAttribute('data-submitted'), null);
    // 人工复核可以改变个别答案；提交前检查结构与完整性，不强制改回模板。
    await page.locator('input[name=q1]').last().check();
    await validateFixedPage(page, config, profile);
  } finally {
    await page.close();
  }
});

test('a mismatch in the last question prevents any answers being changed', async () => {
  const changed = structuredClone(observed);
  changed[11].options.push({ text: '新增选项', checked: false });
  const page = await questionnairePage(changed);
  try {
    await assert.rejects(() => fillFixedQuestionnaire(page, config, profile), /第 12 题/);
    assert.equal(await page.locator('input:checked').count(), 0);
  } finally {
    await page.close();
  }
});

test('a conditional question appearing during filling stops the fixed flow', async () => {
  const page = await questionnairePage();
  try {
    await page.locator('input[name=q0]').first().evaluate(input => {
      input.addEventListener('change', () => {
        document.body.insertAdjacentHTML('beforeend', '<div class="ant-radio-group"><label><input type="radio" name="new">新增题目</label></div>');
      });
    });
    await assert.rejects(() => fillFixedQuestionnaire(page, config, profile), /实际 13 题/);
    assert.equal(await page.locator('input:checked').count(), 1);
    assert.equal(await page.locator('body').getAttribute('data-submitted'), null);
  } finally {
    await page.close();
  }
});
