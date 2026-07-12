/**
 * DOM 探针脚本 — 用于嗅探评价页面的 DOM 结构
 *
 * 运行：node inspect.js
 * 然后手动登录进入评价页面，按回车。
 * 脚本会自动 dump 题目、选项、按钮的结构信息。
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { validateConfig } = require('./core');

const configPath = path.resolve(__dirname, 'config.json');
const URL = validateConfig(JSON.parse(fs.readFileSync(configPath, 'utf8'))).url;

const outDir = path.resolve(__dirname, 'inspect_output');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'zh-CN',
  });
  const page = await context.newPage();

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('👆 请手动登录，进入课程评价页面');
  console.log('   （看到题目和选项后回到终端按回车）');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  await waitForEnter('>>> 按回车开始分析页面结构...');

  // 等待页面稳定
  await page.waitForTimeout(1000);

  // 截图
  await page.screenshot({ path: path.join(outDir, 'page.png'), fullPage: true });
  console.log('📸 截图: inspect_output/page.png');

  // 执行 DOM 分析脚本
  const info = await page.evaluate(() => {
    const result = {};

    // -------- 1. 查找所有 radio 相关元素 --------
    const allRadios = document.querySelectorAll('input[type="radio"]');
    result.radioCount = allRadios.length;

    // 按 name 分组
    const radioGroups = {};
    allRadios.forEach((r) => {
      const name = r.getAttribute('name') || '__no_name__';
      if (!radioGroups[name]) radioGroups[name] = [];
      radioGroups[name].push({
        value: r.value,
        id: r.id || '',
        className: r.className || '',
        // 关联的 label 文本
        labelText: (() => {
          if (r.id) {
            const label = document.querySelector(`label[for="${r.id}"]`);
            if (label) return label.textContent.trim();
          }
          const parent = r.closest('label') || r.parentElement;
          return parent ? parent.textContent.trim().slice(0, 80) : '';
        })(),
        // 父元素链
        parentChain: (() => {
          const chain = [];
          let el = r.parentElement;
          for (let i = 0; i < 4 && el; i++) {
            chain.push(el.tagName.toLowerCase() + (el.className ? '.' + el.className.split(' ').slice(0, 2).join('.') : '') + (el.id ? '#' + el.id : ''));
            el = el.parentElement;
          }
          return chain;
        })(),
      });
    });
    result.radioGroups = radioGroups;

    // -------- 2. 查找可能的题目容器 --------
    const questionSelector = [
      '.question', '.question-item', '.topic', '.eval-item', '.subject',
      '[class*="question"]', '[class*="topic"]', '[class*="eval"]',
      '.van-radio-group', '.van-cell-group',
    ].join(',');
    const containers = document.querySelectorAll(questionSelector);
    result.questionContainers = Array.from(containers).map((el, i) => ({
      index: i,
      tag: el.tagName.toLowerCase(),
      className: el.className || '',
      id: el.id || '',
      textSample: el.textContent.trim().slice(0, 120),
      childRadioCount: el.querySelectorAll('input[type="radio"]').length,
    }));

    // -------- 3. 查找所有按钮 --------
    const allButtons = document.querySelectorAll('button, [role="button"], .van-button, .btn, [class*="button"]');
    result.buttons = Array.from(allButtons).map((btn) => ({
      text: btn.textContent.trim().slice(0, 60),
      tag: btn.tagName.toLowerCase(),
      className: btn.className || '',
      id: btn.id || '',
      visible: btn.offsetParent !== null,
    }));

    // -------- 4. 页面标题/提示信息 --------
    const hElements = document.querySelectorAll('h1, h2, h3, h4, [class*="title"], [class*="header"], .van-nav-bar__title');
    result.titles = Array.from(hElements).map((el) => ({
      text: el.textContent.trim().slice(0, 100),
      tag: el.tagName.toLowerCase(),
    }));

    // -------- 5. 是否有 iframe --------
    result.iframes = Array.from(document.querySelectorAll('iframe')).map((f) => ({
      src: f.src,
      id: f.id,
      className: f.className,
    }));

    // -------- 6. body 的 class --------
    result.bodyClass = document.body.className;

    return result;
  });

  // 输出到文件
  const jsonFile = path.join(outDir, 'dom_info.json');
  fs.writeFileSync(jsonFile, JSON.stringify(info, null, 2), 'utf-8');
  console.log(`📄 DOM 结构数据: inspect_output/dom_info.json`);

  // 输出摘要
  console.log('\n========== 分析摘要 ==========');
  console.log(`Radio 总数:       ${info.radioCount}`);
  console.log(`题目组数(name):   ${Object.keys(info.radioGroups).length}`);
  console.log(`题目容器候选:     ${info.questionContainers.length}`);
  console.log(`按钮数:           ${info.buttons.length}`);
  console.log(`iframe 数:        ${info.iframes.length}`);
  console.log(`body class:       ${info.bodyClass}`);

  console.log('\n--- Radio 分组详情 ---');
  for (const [name, radios] of Object.entries(info.radioGroups)) {
    console.log(`\n  Name="${name}" (${radios.length} 个选项):`);
    radios.forEach((r, i) => {
      console.log(`    [${i}] value="${r.value}" label="${r.labelText}"`);
      console.log(`        父链: ${r.parentChain.join(' > ')}`);
    });
  }

  console.log('\n--- 可见按钮 ---');
  info.buttons
    .filter((b) => b.visible)
    .forEach((b) => {
      console.log(`  "${b.text}"  ${b.className}`);
    });

  console.log('\n--- 题目容器 ---');
  info.questionContainers.forEach((c) => {
    console.log(`  [${c.index}] ${c.tag}.${c.className} radios=${c.childRadioCount} text="${c.textSample}"`);
  });

  console.log('\n--- 标题 ---');
  info.titles.forEach((t) => console.log(`  ${t.tag}: "${t.text}"`));

  if (info.iframes.length > 0) {
    console.log('\n⚠️  检测到 iframe:');
    info.iframes.forEach((f) => console.log(`  src="${f.src}" id="${f.id}"`));
  }

  console.log('\n✅ 分析完成。浏览器保持打开，手动关闭即可。');
  console.log(`   完整数据请查看: inspect_output/dom_info.json`);
}

main().catch((err) => {
  console.error('脚本异常:', err);
  process.exit(1);
});
