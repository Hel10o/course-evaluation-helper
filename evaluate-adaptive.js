'use strict';

const { loadConfig, run } = require('./evaluate');
const { AdaptiveSession } = require('./adaptive-session');
const { readQuestionnaire } = require('./questionnaire-dom');

async function main() {
  const config = loadConfig();
  const session = new AdaptiveSession();
  console.log('自适应问卷：新题先生成答案表，经你确认后保存；同学期相同题目自动复用。');
  console.log('偏好：中性或较好。题目与模板只保存在本机，不调用外部模型。');
  await run({
    config,
    banner: '自适应问卷 — 新题确认一次，后续自动提交和换课',
    fillPage: (page, settings) => session.fill(page, settings),
    validatePage: page => session.validate(page),
    isQuestionnaireReady: page => session.ready(page),
    isNextQuestionnaireReady: page => session.nextReady(page),
    getActionSurface: async page => (await readQuestionnaire(page)).frame,
    fillSuggestionPage: async () => {}, // 文本题统一由模板处理，不再盲填第一个 textarea。
  });
}

if (require.main === module) main().catch(error => {
  console.error(`自适应评教停止：${error.message}`);
  process.exitCode = 1;
});

module.exports = { main };
