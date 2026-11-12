'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const {
  collectQuestionDiagnostics, fillCurrentPage, fillWithManualReview, findVisibleButton,
  goToNextEvaluation, submitEvaluation,
} = require('../evaluate');
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

test('actual long-form options can be filled inside a mobile scrolling questionnaire', async () => {
  const page = await newPage(`
    <div style="height:220px;overflow:auto">
      <div style="height:300px">问卷上方内容</div>
      <div class="ant-form-item">
        <div class="ant-form-item-label">您认为该门课程内容讲授重点难点突出，易于理解吗？</div>
        <div class="ant-radio-group">
          <label style="display:block"><input type="radio" name="q1">没有重难点讲解</label>
          <label style="display:block"><input type="radio" name="q1">有讲解，但比较模糊</label>
          <label style="display:block"><input type="radio" name="q1">有讲解，基本清晰</label>
          <label style="display:block"><input type="radio" name="q1">有讲解，讲解非常清晰且过程中不断强调</label>
        </div>
      </div>
    </div>
  `);
  const result = await fillCurrentPage(page, config({ perQuestionAnswers: {} }));
  assert.equal(result?.answered, 1);
  assert.equal(await page.locator('input[name=q1]').nth(3).isChecked(), true);
  await page.close();
});

test('manual review resumes in the same page without submitting or changing a manual answer', async () => {
  const page = await newPage(`
    <div class="ant-radio-group">
      <label><input type="radio" name="q1">是</label>
      <label><input type="radio" name="q1">否</label>
    </div>
    <div class="ant-radio-group">
      <label><input type="radio" name="q2">非常同意</label>
      <label><input type="radio" name="q2">一般</label>
    </div>
    <button onclick="document.body.dataset.submitted='yes'">提交</button>
  `);
  let prompts = 0;
  let diagnostics;
  const result = await fillWithManualReview(page, config({ autoSubmit: false, perQuestionAnswers: {} }), {
    interactive: true,
    onIncomplete: async (questions) => { diagnostics = questions; },
    prompt: async () => {
      prompts++;
      await page.locator('input[name=q1]').nth(1).check();
    },
  });
  assert.equal(prompts, 1);
  assert.equal(result.answered, 2);
  assert.equal(diagnostics[0].answered, false);
  assert.deepEqual(diagnostics[0].options.map(option => option.text), ['是', '否']);
  assert.equal(await page.locator('input[name=q1]').nth(1).isChecked(), true);
  assert.equal(await page.locator('body').getAttribute('data-submitted'), null);
  await page.close();
});

test('automatic and noninteractive runs do not wait for manual input on unknown answers', async () => {
  const page = await newPage(`
    <div class="ant-radio-group"><label><input type="radio" name="q1">未知选项</label></div>
  `);
  for (const [autoSubmit, interactive] of [[true, true], [false, false]]) {
    const result = await fillWithManualReview(page, config({ autoSubmit, perQuestionAnswers: {} }), {
      interactive,
      prompt: async () => assert.fail('Unexpected manual prompt'),
    });
    assert.equal(result, null);
  }
  assert.equal(await page.locator('input:checked').count(), 0);
  await page.close();
});

test('diagnostics includes offscreen question text and selected answers', async () => {
  const page = await newPage(`
    <div class="ant-form-item" style="margin-top:2000px">
      <div class="ant-form-item-label">课程内容是否易于理解？</div>
      <div class="ant-radio-group">
        <label><input type="radio" name="q1">不清晰</label>
        <label><input type="radio" name="q1" checked>基本清晰</label>
      </div>
    </div>
  `);
  const questions = await collectQuestionDiagnostics(page, config({ perQuestionAnswers: {} }));
  assert.equal(questions[0].question, '课程内容是否易于理解？');
  assert.equal(questions[0].answered, true);
  assert.equal(questions[0].options[1].checked, true);
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

test('bottom submit with spaced text leads to success popup and a fully loaded next course', async () => {
  const page = await newPage(`
    <main id="scroll" style="height:300px;overflow:auto">
      <div class="ant-radio-group"><label><input type="radio" name="q1" checked>满意</label></div>
      <div style="height:1200px"></div>
      <textarea placeholder="请输入您的回答"></textarea>
      <button id="submit"><span>提　交</span></button>
    </main>
    <script>
      document.querySelector('#submit').onclick = () => {
        document.body.insertAdjacentHTML('beforeend', '<div role="dialog" id="success"><h2>提交成功</h2><div id="next"><span>下一门课程</span></div></div>');
        document.querySelector('#next').onclick = () => {
          document.querySelector('#success').remove();
          setTimeout(() => {
            document.querySelector('#scroll').innerHTML = '<h2>第二门课程</h2><div class="ant-radio-group"><label><input type="radio" name="q2">满意</label></div>';
          }, 450);
        };
      };
    </script>
  `);
  const settings = config({ actionTimeout: 2000, navigationTimeout: 3000 });
  await submitEvaluation(page, settings, {
    prompt: async () => assert.fail('Automatic submission must not wait for confirmation'),
  });
  assert.ok(await page.locator('#scroll').evaluate(element => element.scrollTop) > 0);
  assert.equal(await page.locator('#success').isVisible(), true);
  assert.equal(await goToNextEvaluation(page, settings), true);
  assert.equal(await page.locator('input[name=q2]').count(), 1);
  assert.equal(await page.locator('input[name=q2]').isChecked(), false);
  await page.close();
});

test('manual confirmation occurs after scrolling and can survive a rerendered submit button', async () => {
  const page = await newPage(`
    <div class="ant-radio-group"><label><input type="radio" checked>满意</label></div>
    <div id="scroll" style="height:200px;overflow:auto">
      <div style="height:1200px"></div><button id="submit">提 交</button>
    </div>
  `);
  let prompts = 0;
  await submitEvaluation(page, config({ autoSubmit: false }), {
    prompt: async () => {
      prompts++;
      assert.ok(await page.locator('#scroll').evaluate(element => element.scrollTop) > 0);
      assert.equal(await page.getByText('提交成功').count(), 0);
      await page.locator('#submit').evaluate(element => {
        const replacement = element.cloneNode(true);
        element.replaceWith(replacement);
        replacement.onclick = () => { document.body.innerHTML = '<h2>提交成功</h2>'; };
      });
    },
  });
  assert.equal(prompts, 1);
  await page.close();
});

test('button matching ignores disabled wrappers and rejects duplicate actionable buttons', async () => {
  const page = await newPage('<button disabled><span>提 交</span></button>');
  assert.equal(await findVisibleButton(page, [/^提交$/]), null);
  await page.setContent('<button>提交</button><button>提 交</button>');
  await assert.rejects(() => findVisibleButton(page, [/^提交$/]), /多个同名/);
  await page.close();
});
