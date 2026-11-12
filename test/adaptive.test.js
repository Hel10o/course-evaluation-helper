'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { readQuestionnaire } = require('../questionnaire-dom');
const { questionKey, templateScope, suggestAnswer } = require('../adaptive-core');
const { AnswerStore } = require('../adaptive-store');
const { reviewNewAnswers, parseAnswer } = require('../adaptive-review');
const { AdaptiveSession } = require('../adaptive-session');
const { submitEvaluation, goToNextEvaluation } = require('../evaluate');
const { validateConfig } = require('../core');

let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

const config = validateConfig({ url: 'https://example.edu/evaluation', autoSubmit: true,
  actionTimeout: 1500, successTimeout: 1500, navigationTimeout: 3000, maxScanRounds: 10 });

function temporary(t) {
  const root = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(root, 'course-evaluation-adaptive-test-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), root);
    assert.ok(path.basename(resolved).startsWith('course-evaluation-adaptive-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return directory;
}

async function pageFor(t, html) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent(html);
  return page;
}

// 结构依据 2026-11-12 平台公开前端：subject > title/richTextContent + content/FormItem/RadioGroup。
// 下列题干为测试构造；没有把虚构题干写入真实模板。
function radio(title, options, name, { reverse = false, required = true } = {}) {
  return `<div class="index_subject-test">
    <div class="index_title-test">${required ? '<span class="index_necessary-test">*</span>' : ''}
      <div class="index_richTextContent-test">${title}<span class="index_score-test">（单选题）</span></div>
    </div>
    <div class="index_content-test"><div class="ant-form-item"><div class="ant-radio-group">
      ${(reverse ? [...options].reverse() : options).map(text => `<label class="ant-radio-wrapper"><input type="radio" name="${name}"><div>${text}</div></label>`).join('')}
    </div></div></div></div>`;
}

const courseQuestions = (reorder = false) => {
  const questions = [
    radio('您对课程是否满意？', ['不满意', '一般', '满意', '非常满意'], 'satisfaction', { reverse: reorder }),
    radio('您认为讲课语速如何？', ['快', '适宜', '慢'], 'pace', { reverse: reorder }),
    '<fieldset><legend>哪些教学活动有帮助？</legend><div class="ant-checkbox-group"><label><input type="checkbox" required>讨论</label><label><input type="checkbox">练习</label><label><input type="checkbox">答疑</label></div></fieldset>',
    '<div data-question><h3 data-question-title>您的改进建议</h3><textarea required minlength="3" maxlength="80"></textarea></div>',
    '<div data-question><h3 data-question-title>课程内容满意度</h3><select required><option value="">请选择</option><option value="a">一般</option><option value="b">满意</option></select></div>',
  ];
  return (reorder ? questions.reverse() : questions).join('') + '<button id="submit">提 交</button>';
};

test('reads the actual platform nesting, complete titles and required flags', async t => {
  const page = await pageFor(t, courseQuestions());
  const snapshot = await readQuestionnaire(page);
  assert.deepEqual(snapshot.questions.map(q => q.question), ['您对课程是否满意？', '您认为讲课语速如何？', '哪些教学活动有帮助？', '您的改进建议', '课程内容满意度']);
  assert.deepEqual(snapshot.questions.map(q => q.kind), ['radio', 'radio', 'checkbox', 'text', 'select']);
  assert.ok(snapshot.questions.every(q => q.required));
  assert.equal(snapshot.unsupported.length, 0);
});

test('keys survive numbering and option order, but invalidate polarity and required changes', () => {
  const base = { number: 1, question: '1. 教师经常组织讨论吗？', kind: 'radio', required: true,
    options: ['从不', '偶尔', '经常', '总是'].map(text => ({ text })) };
  const reversed = { ...base, question: '8. 教师经常组织讨论吗？', options: [...base.options].reverse() };
  assert.equal(questionKey(base), questionKey(reversed));
  assert.notEqual(questionKey(base), questionKey({ ...base, question: '教师经常迟到吗？' }));
  assert.notEqual(questionKey(base), questionKey({ ...base, required: false }));
  assert.deepEqual(suggestAnswer(base).answer, ['经常']);
  assert.equal(suggestAnswer({ ...base, question: '教师经常迟到吗？' }).answer, null);
  assert.notEqual(templateScope('https://example.edu/#/x&semester=2026-2027-1'), templateScope('https://example.edu/#/x&semester=2027-2028-1'));
});

test('first review saves templates, automatically submits, and reuses them for reordered next course', async t => {
  const directory = temporary(t);
  const file = path.join(directory, 'approved.json');
  const page = await pageFor(t, courseQuestions());
  let reviews = 0;
  const commands = ['Y', '3=1,3', '4=建议增加实例讲解', 'Y'];
  const review = async items => {
    reviews++;
    await reviewNewAnswers(items, { previewFile: path.join(directory, 'preview.json'), log: () => {},
      askInput: async () => { assert.ok(commands.length); return commands.shift(); } });
  };
  let session = new AdaptiveSession({ store: new AnswerStore(file), review, scopeForPage: () => 'term1', log: () => {} });
  await session.fill(page, config);
  assert.equal(reviews, 1);
  assert.equal(await page.locator('input[name=satisfaction]:checked').locator('..').textContent(), '满意');
  assert.equal(await page.locator('input[name=pace]:checked').locator('..').textContent(), '适宜');
  assert.equal(await page.locator('input[type=checkbox]:checked').count(), 2);
  assert.equal(await page.locator('textarea').inputValue(), '建议增加实例讲解');
  assert.equal(await page.locator('select').inputValue(), 'b');
  await page.locator('#submit').evaluate((button, nextHTML) => {
    button.onclick = () => {
      document.body.insertAdjacentHTML('beforeend', '<div id="done" role="dialog"><h2>提交成功</h2><button id="next">下一门课程</button></div>');
      document.querySelector('#next').onclick = () => { document.body.innerHTML = nextHTML; };
    };
  }, courseQuestions(true));
  await submitEvaluation(page, config, { validatePage: () => session.validate(page), prompt: () => assert.fail('Unexpected per-course confirmation') });
  assert.equal(await goToNextEvaluation(page, config, { isReady: () => session.nextReady(page) }), true);
  // 从磁盘重新读取，验证跨进程复用而不是仅复用内存。
  session = new AdaptiveSession({ store: new AnswerStore(file), review: () => assert.fail('Same questions must not be reviewed again'), scopeForPage: () => 'term1', log: () => {} });
  await session.fill(page, config);
  assert.equal(await page.locator('input[name=satisfaction]:checked').locator('..').textContent(), '满意');
  const changedTitle = page.locator('.index_richTextContent-test').filter({ hasText: '您对课程是否满意' });
  await changedTitle.evaluate(element => { element.textContent = '您对课堂作业是否满意？'; });
  const changes = [];
  session.review = async items => {
    changes.push(items.filter(item => !item.saved).map(item => item.question.question));
  };
  await session.fill(page, config);
  assert.deepEqual(changes, [['您对课堂作业是否满意？']]);
  // 新学期即使问卷相同，也必须重新确认一次。
  const nextTerm = new AdaptiveSession({ store: new AnswerStore(file), scopeForPage: () => 'term2', log: () => {},
    review: async items => { assert.ok(items.every(item => !item.saved)); throw new Error('next term review'); } });
  await assert.rejects(() => nextTerm.fill(page, config), /next term review/);
});

test('conditional required questions trigger review only for the newly visible field', async t => {
  const directory = temporary(t);
  const page = await pageFor(t, radio('课程是否满意？', ['一般', '满意'], 'q1'));
  await page.locator('input[name=q1]').last().evaluate(input => {
    input.addEventListener('change', () => document.body.insertAdjacentHTML('beforeend', '<div data-question><h3 data-question-title>请补充学习建议</h3><textarea required></textarea></div>'), { once: true });
  });
  const reviewed = [];
  const session = new AdaptiveSession({ store: new AnswerStore(path.join(directory, 'answers.json')), scopeForPage: () => 'term', log: () => {},
    review: async items => {
      reviewed.push(items.filter(item => !item.saved).map(item => item.question.question));
      for (const item of items.filter(item => !item.saved && item.answer === null)) item.answer = '建议增加练习';
    } });
  await session.fill(page, config);
  assert.deepEqual(reviewed, [['课程是否满意？'], ['请补充学习建议']]);
  assert.equal(await page.locator('textarea').inputValue(), '建议增加练习');
});

test('unknown widgets, missing titles and changed forms never reach submission', async t => {
  const directory = temporary(t);
  const page = await pageFor(t, '<div data-question><h3 data-question-title>星级评价</h3><input type="range"></div>');
  const session = new AdaptiveSession({ store: new AnswerStore(path.join(directory, 'answers.json')), scopeForPage: () => 'term', log: () => {}, review: async () => {} });
  await assert.rejects(() => session.fill(page, config), /尚不支持/);
  await page.setContent('<div class="index_subject-test"><div class="index_title-test">图片选择题</div><div class="ant-form-item"><canvas width="50" height="50"></canvas></div></div>');
  await assert.rejects(() => session.fill(page, config), /未知题目控件/);
  await page.setContent('<div class="ant-radio-group"><label><input type="radio">满意</label></div>');
  await assert.rejects(() => session.fill(page, config), /未能读取题干/);
  await page.setContent(radio('课程是否满意？', ['一般', '满意'], 'q1') + '<button onclick="document.body.dataset.sent=1">提交</button>');
  await session.fill(page, config);
  await page.locator('.index_richTextContent-test').evaluate(element => { element.textContent = '课程是否不够满意？'; });
  await assert.rejects(() => submitEvaluation(page, config, { validatePage: () => session.validate(page) }), /问卷已变化/);
  assert.equal(await page.locator('body').getAttribute('data-sent'), null);
});

test('cancelling review does not save an approved template; scalar zero is preserved', async t => {
  const directory = temporary(t);
  const page = await pageFor(t, radio('课程是否满意？', ['一般', '满意'], 'q1'));
  const file = path.join(directory, 'answers.json');
  const session = new AdaptiveSession({ store: new AnswerStore(file), scopeForPage: () => 'term',
    review: items => reviewNewAnswers(items, { askInput: async () => 'Q', log: () => {}, previewFile: path.join(directory, 'preview.json') }) });
  await assert.rejects(() => session.fill(page, config), /取消/);
  assert.equal(fs.existsSync(file), false);
  assert.equal(await page.locator('input:checked').count(), 0);
  assert.equal(parseAnswer({ kind: 'number', options: [], required: true, min: '0', max: '10' }, '0'), '0');
});

test('a single questionnaire iframe can be filled and submitted using its own action surface', async t => {
  const directory = temporary(t);
  const page = await pageFor(t, '<iframe title="问卷" style="width:500px;height:500px"></iframe>');
  const frame = page.frames()[1];
  await frame.setContent(radio('您对课程是否满意？', ['一般', '满意'], 'q1') + '<button onclick="document.body.innerHTML=\'提交成功\'">提 交</button>');
  const session = new AdaptiveSession({ store: new AnswerStore(path.join(directory, 'answers.json')),
    scopeForPage: () => 'term', review: async () => {}, log: () => {} });
  await session.fill(page, config);
  const snapshot = await readQuestionnaire(page);
  assert.equal(snapshot.frame, frame);
  await submitEvaluation(snapshot.frame, config, { validatePage: () => session.validate(page) });
  assert.match(await frame.locator('body').innerText(), /提交成功/);
});

test('matrix rows have separate identities and ARIA radios on buttons are recognized', async t => {
  const page = await pageFor(t, `<div class="index_subject-test"><div class="index_title-test"><div class="index_richTextContent-test">评价以下教学指标</div></div>
    ${['讲解清晰', '反馈及时'].map((title, index) => `<div class="index_tableContentNewLi-test"><div class="index_issueTextContent-test">${title}</div><div role="radiogroup"><button role="radio" aria-checked="false">一般</button><button role="radio" aria-checked="false">满意</button></div></div>`).join('')}
  </div>`);
  const snapshot = await readQuestionnaire(page);
  assert.deepEqual(snapshot.questions.map(q => q.question), ['评价以下教学指标 / 讲解清晰', '评价以下教学指标 / 反馈及时']);
  assert.ok(snapshot.questions.every(q => q.kind === 'radio'));
  assert.notEqual(questionKey(snapshot.questions[0]), questionKey(snapshot.questions[1]));
});

test('saved choice text maps to current whitespace and is not tied to option IDs', async t => {
  const directory = temporary(t);
  const store = new AnswerStore(path.join(directory, 'answers.json'));
  const question = { question: '课程满意度', kind: 'radio', required: true, options: [{ text: '满 意', value: 'old-id' }] };
  store.approve('term', [{ question, answer: ['满 意'] }]);
  const current = { ...question, options: [{ text: '满意', value: 'new-id' }] };
  assert.deepEqual(store.find('term', current).answer, ['满意']);
});
