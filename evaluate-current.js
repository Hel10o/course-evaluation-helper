'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, run } = require('./evaluate');
const { fillFixedQuestionnaire, validateFixedPage, validateProfile } = require('./fixed-questionnaire');

function loadCurrentSetup(baseConfig = loadConfig()) {
  const profile = validateProfile(JSON.parse(fs.readFileSync(
    path.join(__dirname, 'questionnaire-2026-2027-1.json'), 'utf8',
  )));
  const config = {
    ...baseConfig,
    answerMode: 'perQuestion',
    perQuestionAnswers: Object.fromEntries(profile.questions.map(q => [String(q.number), q.answer])),
    // 是否自动提交沿用本机 config.json，避免专用入口覆盖用户的设置。
    skipIfNoMatch: false,
  };
  return { profile, config };
}

async function main() {
  const { profile, config } = loadCurrentSetup();
  console.log(`本次问卷：${profile.name}`);
  console.table(profile.questions.map(q => ({ 题号: q.number, 本次答案: q.answer })));
  await run({
    config,
    banner: '2026-2027-1 本次问卷 — 中性 / 较好评价',
    fillPage: (page, settings) => fillFixedQuestionnaire(page, settings, profile),
    validatePage: (page, settings) => validateFixedPage(page, settings, profile),
  });
}

if (require.main === module) {
  main().catch(error => {
    console.error(`本次问卷脚本停止：${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { loadCurrentSetup, main };
