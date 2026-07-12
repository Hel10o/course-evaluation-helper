'use strict';

/**
 * 教学质量管理平台课程评价辅助脚本。
 *
 * 安全原则：无法确认题目、答案、提交按钮或成功状态时立即停止，绝不猜测。
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {
  answerForQuestion,
  chooseOptionIndex,
  validateConfig,
} = require('./core');

const CONFIG_PATH = path.resolve(__dirname, 'config.json');
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

const SELECTORS = {
  questionGroups: [
    'div.ant-radio-group',
    '[role="radiogroup"]',
  ].join(', '),
  optionLabels: 'label.ant-radio-wrapper, label:has(input[type="radio"])',
  radioInput: 'input[type="radio"]',
  suggestionTextarea: 'textarea',
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error('找不到 config.json；请复制 config.example.json 后再修改');
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`config.json 不是有效 JSON：${error.message}`);
  }
  return validateConfig(parsed);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function waitForEnter(prompt = '按回车继续...') {
  if (!process.stdin.isTTY) {
    throw new Error('当前终端不可交互，无法等待人工确认');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, () => {
    rl.close();
    resolve();
  }));
}

async function waitUntil(check, timeoutMs, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

function ensureScreenshotDir() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function takeScreenshot(page, prefix) {
  ensureScreenshotDir();
  const file = path.join(SCREENSHOT_DIR, `${prefix}_${timestamp()}.png`);
  try {
    await page.screenshot({ path: file, fullPage: true });
    console.log(`📸 截图: ${file}`);
    return file;
  } catch (error) {
    console.warn(`⚠️ 无法保存截图: ${error.message}`);
    return null;
  }
}

function pruneScreenshots(config) {
  ensureScreenshotDir();
  const now = Date.now();
  const maxAge = config.screenshotRetentionDays * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(SCREENSHOT_DIR)
    .filter((name) => name.endsWith('.png'))
    .map((name) => {
      const file = path.join(SCREENSHOT_DIR, name);
      return { file, mtime: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  let removed = 0;
  for (let index = 0; index < files.length; index++) {
    const item = files[index];
    if (now - item.mtime > maxAge || index >= config.maxScreenshots) {
      fs.unlinkSync(item.file);
      removed++;
    }
  }
  if (removed) console.log(`🧹 已清理 ${removed} 张过期截图`);
}

async function getVisibleQuestionGroups(page) {
  const groups = await page.$$(SELECTORS.questionGroups);
  const visible = [];
  for (const group of groups) {
    if (await group.isVisible().catch(() => false)) visible.push(group);
  }
  return visible;
}

async function getQuestionText(group) {
  return group.evaluate((element) => {
    const formItem = element.closest('.ant-form-item');
    const label = formItem?.querySelector('.ant-form-item-label');
    if (label?.textContent?.trim()) return label.textContent.trim();

    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelled = document.getElementById(labelledBy);
      if (labelled?.textContent?.trim()) return labelled.textContent.trim();
    }

    let sibling = element.parentElement?.previousElementSibling;
    while (sibling) {
      const text = sibling.textContent?.trim();
      if (text) return text.slice(0, 160);
      sibling = sibling.previousElementSibling;
    }
    return '';
  }).catch(() => '');
}

async function groupIsAnswered(group) {
  const inputs = await group.$$(SELECTORS.radioInput);
  for (const input of inputs) {
    if (await input.isChecked().catch(() => false)) return true;
  }
  return false;
}

async function selectAnswerForGroup(group, targetAnswer, config, questionIndex) {
  const labels = await group.$$(SELECTORS.optionLabels);
  if (!labels.length) {
    console.error(`  ⚠️ 第 ${questionIndex + 1} 题没有可识别的选项`);
    return false;
  }

  const optionTexts = [];
  for (const label of labels) {
    optionTexts.push(((await label.textContent().catch(() => '')) || '').trim());
  }

  const pickedIndex = chooseOptionIndex(optionTexts, targetAnswer);
  if (pickedIndex === -1) {
    const wanted = targetAnswer === '__POSITIVE__' ? '明确的正面答案' : `“${targetAnswer}”`;
    console.error(`  ⚠️ 第 ${questionIndex + 1} 题找不到${wanted}`);
    console.error(`     可用选项: ${optionTexts.join(' / ')}`);
    return false;
  }

  const label = labels[pickedIndex];
  const input = await label.$(SELECTORS.radioInput);
  if (!input) {
    console.error(`  ⚠️ 第 ${questionIndex + 1} 题目标选项没有 radio input`);
    return false;
  }

  const strategies = [
    () => label.click({ timeout: config.actionTimeout }),
    () => input.click({ timeout: config.actionTimeout }),
  ];
  for (const click of strategies) {
    try {
      await click();
      const checked = await waitUntil(
        () => input.isChecked().catch(() => false),
        Math.min(config.actionTimeout, 3000),
      );
      if (checked) {
        console.log(`  ✅ 已选择 “${optionTexts[pickedIndex]}”`);
        return true;
      }
    } catch {
      // 尝试下一种正常的用户点击方式；不直接篡改 DOM 状态。
    }
  }

  console.error(`  ⚠️ 第 ${questionIndex + 1} 题点击后未处于选中状态`);
  return false;
}

async function fillCurrentPage(page, config) {
  let skipped = 0;
  const skippedGroups = new Set();

  for (let round = 1; round <= config.maxScanRounds; round++) {
    const groups = await getVisibleQuestionGroups(page);
    if (!groups.length) {
      console.error('❌ 当前页面没有检测到题目，请确认已进入评价页面');
      return null;
    }

    const pending = [];
    for (let index = 0; index < groups.length; index++) {
      if (!await groupIsAnswered(groups[index]) && !skippedGroups.has(groups[index])) {
        pending.push({ group: groups[index], index });
      }
    }
    if (!pending.length) break;

    if (round === 1) console.log(`📋 检测到 ${groups.length} 道可见题目`);
    else console.log(`🔄 检测到 ${pending.length} 道新增或尚未完成的题目`);

    for (const { group, index } of pending) {
      const questionText = await getQuestionText(group);
      console.log(`  [${index + 1}/${groups.length}] ${questionText || `题目 ${index + 1}`}`);
      const target = answerForQuestion(config, index);
      const selected = await selectAnswerForGroup(group, target, config, index);
      if (!selected) {
        skipped++;
        skippedGroups.add(group);
        if (!config.skipIfNoMatch) return null;
      }
    }

    // 给条件题渲染机会，随后重新扫描；不是用固定等待判断页面成功。
    await page.waitForTimeout(150);
  }

  const groups = await getVisibleQuestionGroups(page);
  let answered = 0;
  for (const group of groups) {
    if (await groupIsAnswered(group)) answered++;
  }
  const incomplete = groups.length - answered;
  console.log(`📊 填答检查: ${answered}/${groups.length} 已确认选中，${incomplete} 未完成`);

  if (incomplete > 0) {
    console.error('❌ 存在未完成题目，禁止提交');
    return null;
  }
  return { total: groups.length, answered, skipped };
}

async function fillSuggestion(page, config) {
  if (!config.suggestionText) return;
  const textareas = await page.$$(SELECTORS.suggestionTextarea);
  for (const textarea of textareas) {
    if (await textarea.isVisible().catch(() => false)) {
      await textarea.fill(config.suggestionText, { timeout: config.actionTimeout });
      console.log('📝 已填写建议文本');
      return;
    }
  }
  throw new Error('已配置 suggestionText，但页面上找不到可见文本框');
}

async function findVisibleButton(page, allowedTexts, scope = null) {
  const root = scope ?? page;
  const buttons = await root.$$('button, [role="button"]');
  for (const button of buttons) {
    const text = ((await button.textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    const visible = await button.isVisible().catch(() => false);
    const enabled = await button.isEnabled().catch(() => false);
    if (visible && enabled && allowedTexts.some((pattern) => pattern.test(text))) return button;
  }
  return null;
}

async function assertPageComplete(page) {
  const groups = await getVisibleQuestionGroups(page);
  if (!groups.length) throw new Error('提交前复核失败：页面上没有题目');
  for (let index = 0; index < groups.length; index++) {
    if (!await groupIsAnswered(groups[index])) {
      throw new Error(`提交前复核失败：第 ${index + 1} 题未选中`);
    }
  }
}

async function handleSubmitConfirmation(page, config) {
  const deadline = Date.now() + Math.min(config.actionTimeout, 2000);
  while (Date.now() < deadline) {
    const pageText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
    if (/评价完成|提交成功|评价成功/.test(pageText)) return;

    const dialogs = await page.$$('[role="dialog"], .ant-modal');
    for (const dialog of dialogs) {
      if (!await dialog.isVisible().catch(() => false)) continue;
      const text = ((await dialog.textContent().catch(() => '')) || '').trim();
      if (/未填|错误|失败|必填/.test(text)) {
        throw new Error(`平台拒绝提交：${text.slice(0, 120)}`);
      }
      if (!/提交|评价|确认/.test(text)) continue;
      const confirm = await findVisibleButton(
        page,
        [/^确定$/, /^确认$/, /^确认提交$/, /^提交$/],
        dialog,
      );
      if (confirm) {
        await confirm.click({ timeout: config.actionTimeout });
        console.log('✅ 已确认提交弹窗');
        return;
      }
    }
    await page.waitForTimeout(100);
  }
}

async function waitForSubmissionSuccess(page, config) {
  const success = await waitUntil(async () => {
    const bodyText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
    if (/提交失败|评价失败|网络错误|请完成必填|尚未填写/.test(bodyText)) {
      throw new Error('平台返回失败或未完成提示');
    }
    return /评价完成|提交成功|评价成功/.test(bodyText);
  }, config.successTimeout, 200);

  if (!success) throw new Error(`提交后 ${config.successTimeout}ms 内未检测到成功状态`);
  console.log('✅ 平台已明确确认评价完成');
}

async function submitEvaluation(page, config) {
  await assertPageComplete(page);
  const submit = await findVisibleButton(page, [/^提交$/, /^提交评价$/, /^完成评价$/]);
  if (!submit) throw new Error('找不到唯一、可见且可点击的提交按钮');

  if (!config.autoSubmit) {
    console.log('\n⚠️ 即将提交，请在浏览器中复核答案。');
    await waitForEnter('>>> 确认无误后按回车提交；按 Ctrl+C 取消...');
    await assertPageComplete(page);
  } else {
    console.log('⏩ autoSubmit=true，提交前完整性检查已通过');
  }

  await submit.click({ timeout: config.actionTimeout });
  await handleSubmitConfirmation(page, config);
  await waitForSubmissionSuccess(page, config);
}

async function goToNextEvaluation(page, config) {
  const next = await findVisibleButton(page, [
    /^下一门(?:课程)?$/,
    /^下一位(?:教师|老师)?$/,
    /^继续评价$/,
    /^下一项$/,
  ]);
  if (!next) return false;

  await next.click({ timeout: config.actionTimeout });
  const ready = await waitUntil(async () => {
    const groups = await getVisibleQuestionGroups(page);
    const bodyText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
    return groups.length > 0 && !/评价完成|提交成功|评价成功/.test(bodyText);
  }, config.navigationTimeout, 200);
  if (!ready) throw new Error('点击下一门课程后，没有加载出新的评价题目');
  return true;
}

async function run() {
  const config = loadConfig();
  pruneScreenshots(config);

  console.log('========================================');
  console.log('  教学质量管理平台 — 安全填答模式');
  console.log('========================================\n');

  let browser;
  let page;
  let failed = false;
  try {
    browser = await chromium.launch({ headless: config.headless });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: 'zh-CN',
    });
    context.setDefaultTimeout(config.actionTimeout);
    page = await context.newPage();

    console.log(`📍 打开评价页面: ${config.url}`);
    await page.goto(config.url, {
      waitUntil: 'domcontentloaded',
      timeout: config.navigationTimeout,
    });

    console.log('\n请手动登录并进入能看到题目的评价页面。');
    await waitForEnter('>>> 准备好后按回车开始...');

    const initialReady = await waitUntil(
      async () => (await getVisibleQuestionGroups(page)).length > 0,
      config.navigationTimeout,
      200,
    );
    if (!initialReady) throw new Error('等待超时：没有检测到评价题目');

    for (let courseNumber = 1; courseNumber <= config.maxCourses; courseNumber++) {
      console.log(`\n════════ 第 ${courseNumber} 门课程 ════════`);
      if (config.captureRoutineScreenshots) await takeScreenshot(page, `course${courseNumber}_before`);

      const result = await fillCurrentPage(page, config);
      if (!result) throw new Error(`第 ${courseNumber} 门课程未完整填答`);
      await fillSuggestion(page, config);
      await submitEvaluation(page, config);

      if (config.captureRoutineScreenshots) await takeScreenshot(page, `course${courseNumber}_success`);
      if (!await goToNextEvaluation(page, config)) {
        console.log(`\n🏁 全部完成，共处理 ${courseNumber} 门课程`);
        return;
      }
    }
    throw new Error(`已达到 maxCourses=${config.maxCourses}，为防止异常循环已停止`);
  } catch (error) {
    failed = true;
    console.error(`\n❌ 已安全停止：${error.message}`);
    if (page && !page.isClosed()) await takeScreenshot(page, 'error');
    throw error;
  } finally {
    if (browser) {
      if (failed && config.keepBrowserOpenOnError && process.stdin.isTTY) {
        await waitForEnter('浏览器暂时保留供检查；按回车关闭...').catch(() => {});
      }
      await browser.close().catch(() => {});
    }
  }
}

if (require.main === module) {
  run().catch((error) => {
    if (process.env.DEBUG) console.error(error.stack);
    process.exitCode = 1;
  });
}

module.exports = {
  fillCurrentPage,
  findVisibleButton,
  loadConfig,
  run,
  SELECTORS,
  submitEvaluation,
};
