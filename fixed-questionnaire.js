'use strict';

const { normalizeText } = require('./core');
const {
  assertPageComplete,
  collectQuestionDiagnostics,
  getVisibleQuestionGroups,
  selectAnswerForGroup,
} = require('./evaluate');

function validateProfile(profile) {
  if (!Array.isArray(profile?.questions) || !profile.questions.length) {
    throw new Error('固定问卷必须配置非空 questions 数组');
  }
  for (const [index, question] of profile.questions.entries()) {
    if (question.number !== index + 1 || !Array.isArray(question.options)
      || question.options.length < 2
      || question.options.some(option => typeof option !== 'string' || !normalizeText(option))) {
      throw new Error(`固定问卷第 ${index + 1} 题配置无效`);
    }
    const options = question.options.map(normalizeText);
    if (new Set(options).size !== options.length) {
      throw new Error(`固定问卷第 ${index + 1} 题选项重复`);
    }
    if (typeof question.answer !== 'string' || !options.includes(normalizeText(question.answer))) {
      throw new Error(`固定问卷第 ${index + 1} 题答案不在选项中`);
    }
  }
  return profile;
}

// 当前诊断没有记录题干，因此按题号和整组选项联合校验，不宣称匹配了题干。
// 选项可换序；新增、缺失或替换任何选项，都不会继续套用这份答案。
function planFixedAnswers(observed, profile) {
  validateProfile(profile);
  if (observed.length !== profile.questions.length) {
    throw new Error(`问卷不匹配：应有 ${profile.questions.length} 题，实际 ${observed.length} 题`);
  }
  return profile.questions.map((expected, index) => {
    const actual = observed[index].options.map(option => normalizeText(option.text));
    const required = expected.options.map(normalizeText);
    if (actual.length !== required.length || new Set(actual).size !== actual.length
      || required.some(option => !actual.includes(option))) {
      throw new Error(`问卷不匹配：第 ${index + 1} 题的整组选项已变化，请重新核对问卷`);
    }
    return {
      number: index + 1,
      answer: expected.answer,
      optionIndex: actual.indexOf(normalizeText(expected.answer)),
    };
  });
}

async function validateFixedPage(page, config, profile) {
  planFixedAnswers(await collectQuestionDiagnostics(page, config), profile);
  await assertPageComplete(page);
}

async function fillFixedQuestionnaire(page, config, profile) {
  const plan = planFixedAnswers(await collectQuestionDiagnostics(page, config), profile);
  console.log(`📋 已核对本次问卷的 ${plan.length} 道题及全部选项`);

  for (const item of plan) {
    // 点击后页面可能重新渲染；每题都重新核对结构并取得当前元素。
    planFixedAnswers(await collectQuestionDiagnostics(page, config), profile);
    const groups = await getVisibleQuestionGroups(page);
    console.log(`  [${item.number}/${plan.length}] 本次配置：${item.answer}`);
    const selected = await selectAnswerForGroup(groups[item.number - 1], item.answer, config, item.number - 1);
    if (!selected) throw new Error(`第 ${item.number} 题无法选中配置答案：${item.answer}`);
  }

  const finalQuestions = await collectQuestionDiagnostics(page, config);
  planFixedAnswers(finalQuestions, profile);
  for (const item of plan) {
    const checked = finalQuestions[item.number - 1].options.filter(option => option.checked);
    if (checked.length !== 1 || normalizeText(checked[0].text) !== normalizeText(item.answer)) {
      throw new Error(`第 ${item.number} 题复核失败，页面选中值与配置答案不一致`);
    }
  }
  console.log(`📊 本次固定问卷填答完成：${plan.length}/${plan.length}`);
  return { total: plan.length, answered: plan.length, skipped: 0 };
}

module.exports = { fillFixedQuestionnaire, planFixedAnswers, validateFixedPage, validateProfile };
