'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { validateAnswer } = require('./adaptive-core');

function ask(prompt) {
  if (!process.stdin.isTTY) throw new Error('发现新题，需要在交互终端中确认模板');
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => input.question(prompt, value => { input.close(); resolve(value.trim()); }));
}

function parseAnswer(question, text) {
  if (text === '留空' || (text === '0' && question.options.length)) return validateAnswer(question, question.options.length ? [] : '');
  if (!question.options.length) return validateAnswer(question, text);
  const parts = text.split(/[,，、\s]+/).filter(Boolean);
  if (!parts.length || parts.some(part => !/^[1-9]\d*$/.test(part))) throw new Error('请填选项编号；多选用逗号分隔');
  const answers = parts.map(part => {
    const option = question.options[Number(part) - 1];
    if (!option) throw new Error('选项编号超出范围');
    return option.text;
  });
  return validateAnswer(question, answers);
}

async function reviewNewAnswers(items, {
  askInput = ask, log = console.log,
  previewFile = path.join(__dirname, 'inspect_output', 'answer-preview.json'),
} = {}) {
  const pending = items.filter(item => !item.saved);
  if (!pending.length) return;
  const writePreview = () => {
    fs.mkdirSync(path.dirname(previewFile), { recursive: true });
    fs.writeFileSync(previewFile, JSON.stringify(items.map(item => ({ number: item.question.number,
      question: item.question.question, kind: item.question.kind, required: item.question.required,
      options: item.question.options.map((option, index) => ({ number: index + 1, text: option.text, disabled: option.disabled })),
      answer: item.answer, status: item.saved ? '已保存' : '待确认', reason: item.reason })), null, 2));
  };
  const show = () => {
    log(`\n发现 ${pending.length} 道新题/变化题；${items.length - pending.length} 道沿用已确认模板。`);
    for (const item of pending) {
      const q = item.question;
      log(`\n[${q.number}] ${q.question} ${q.required ? '（必填）' : '（可选）'}`);
      q.options.forEach((option, index) => log(`  ${index + 1}. ${option.text}${option.disabled ? '（不可选）' : ''}`));
      log(`  建议：${item.answer === null ? '需要你选择' : JSON.stringify(item.answer)}；${item.reason}`);
    }
    log(`\n完整答案表：${previewFile}`);
  };
  writePreview();
  show();
  while (true) {
    const command = (await askInput('输入“题号=选项编号”修改（例如 8=3，多选 2=1,3）；文本题填文字；输入 Y 确认保存，Q 退出：')).trim();
    if (/^q$/i.test(command)) throw new Error('已取消新问卷模板确认，未提交评价');
    if (/^(y|确认)$/i.test(command)) {
      const missing = pending.filter(item => item.answer === null);
      if (missing.length) { log(`第 ${missing.map(item => item.question.number).join('、')} 题还需要选择，不能确认。`); continue; }
      for (const item of pending) validateAnswer(item.question, item.answer);
      writePreview();
      return;
    }
    const edit = /^(\d+)\s*=\s*(.*)$/.exec(command);
    const item = edit && pending.find(candidate => candidate.question.number === Number(edit[1]));
    if (!item) { log('请输入本次新题的题号=答案，或 Y / Q。'); continue; }
    try {
      item.answer = parseAnswer(item.question, edit[2]);
      item.reason = '本次人工指定';
      writePreview();
      log(`第 ${item.question.number} 题已设为 ${JSON.stringify(item.answer)}`);
    } catch (error) { log(error.message); }
  }
}

module.exports = { ask, parseAnswer, reviewNewAnswers };
