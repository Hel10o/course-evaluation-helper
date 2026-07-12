'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { fillCurrentPage, submitEvaluation } = require('../evaluate');
const { validateConfig } = require('../core');

let browser;

test.before(async () => {
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  await browser?.close();
});

async function newPage(html) {
  const page = await browser.newPage();
  await page.setContent(html);
  return page;
}

function config(overrides = {}) {
  return validateConfig({
    url: 'https://example.edu/evaluation',
    answerMode: 'positive',
    perQuestionAnswers: { 2: '无' },
    autoSubmit: true,
    actionTimeout: 1000,
    successTimeout: 1000,
    ...overrides,
  });
}

test('browser flow selects semantic answers regardless of option order', async () => {
  const page = await newPage(`
    <div class="ant-radio-group">
      <label><input type="radio" name="q1">非常同意</label>
      <label><input type="radio" name="q1">一般</label>
      <label><input type="radio" name="q1">非常不同意</label>
    </div>
    <div class="ant-radio-group">
      <label><input type="radio" name="q2">有</label>
      <label><input type="radio" name="q2">无</label>
    </div>
  `);

  const result = await fillCurrentPage(page, config());
  assert.equal(result.answered, 2);
  assert.equal(await page.locator('input[name=q1]').first().isChecked(), true);
  assert.equal(await page.locator('input[name=q2]').nth(1).isChecked(), true);
  await page.close();
});

test('unknown binary question stops instead of guessing', async () => {
  const page = await newPage(`
    <div class="ant-radio-group">
      <label><input type="radio" name="q1">是</label>
      <label><input type="radio" name="q1">否</label>
    </div>
  `);
  const result = await fillCurrentPage(page, config({ perQuestionAnswers: {} }));
  assert.equal(result, null);
  assert.equal(await page.locator('input:checked').count(), 0);
  await page.close();
});

test('submission requires completeness and an explicit success state', async () => {
  const page = await newPage(`
    <div class="ant-radio-group">
      <label><input type="radio" name="q1" checked>非常同意</label>
    </div>
    <button id="submit">提交</button>
    <script>
      document.querySelector('#submit').addEventListener('click', () => {
        document.body.innerHTML = '<main>评价完成</main>';
      });
    </script>
  `);
  await submitEvaluation(page, config());
  assert.match(await page.locator('body').innerText(), /评价完成/);
  await page.close();
});

test('submission confirms only a contextual evaluation dialog', async () => {
  const page = await newPage(`
    <div class="ant-radio-group">
      <label><input type="radio" name="q1" checked>非常同意</label>
    </div>
    <button id="submit">提交</button>
    <script>
      document.querySelector('#submit').addEventListener('click', () => {
        document.body.insertAdjacentHTML(
          'beforeend',
          '<div role="dialog"><p>确认提交本次评价？</p><button id="confirm">确定</button></div>',
        );
        document.querySelector('#confirm').addEventListener('click', () => {
          document.body.innerHTML = '<main>提交成功</main>';
        });
      });
    </script>
  `);
  await submitEvaluation(page, config());
  assert.match(await page.locator('body').innerText(), /提交成功/);
  await page.close();
});

test('submission is blocked when any visible question is unanswered', async () => {
  const page = await newPage(`
    <div class="ant-radio-group">
      <label><input type="radio" name="q1">非常同意</label>
    </div>
    <button id="submit">提交</button>
  `);
  await assert.rejects(() => submitEvaluation(page, config()), /未选中/);
  await page.close();
});
