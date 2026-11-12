'use strict';

// 在页面内只读取 DOM；不读取账号、cookie、存储或框架内部状态。
function scanDocument() {
  const clean = text => (text || '').replace(/\s+/g, ' ').trim();
  const subjectSelector = '[class*="_subject-"], .question, .question-item, .ant-form-item, fieldset, [data-question]';
  const controlSelector = 'input:not([type="hidden"]), textarea, select, [role="radio"], [role="checkbox"]';
  const visible = element => {
    if (!element || element.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  };
  const path = element => {
    if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1) return `#${CSS.escape(element.id)}`;
    const parts = [];
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      const siblings = Array.from(node.parentElement?.children || []).filter(sibling => sibling.tagName === node.tagName);
      parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1 || 1})`);
      if (node === document.documentElement) break;
    }
    return parts.join(' > ');
  };
  const titleText = element => {
    if (!element) return '';
    const clone = element.cloneNode(true);
    clone.querySelectorAll('[class*="_score-"], [class*="_necessary-"], .question_type, .question_no, input, textarea, select').forEach(node => node.remove());
    return clean(clone.textContent).replace(/^\s*[*＊]\s*/, '').replace(/[（(](?:单选题|多选题|必填|选填)[）)]/g, '').trim();
  };
  const context = element => {
    const subject = element.closest('[class*="_subject-"], .question, .question-item, [data-question]')
      || element.closest('.ant-form-item, fieldset');
    const named = element.getAttribute('aria-labelledby');
    let title = named ? named.split(/\s+/).map(id => titleText(document.getElementById(id))).join(' ').trim() : '';
    const heading = subject?.querySelector('[class*="_title-"] [class*="_richTextContent-"], .ant-form-item-label, legend, .question-title, [data-question-title], [class*="_title-"]');
    title ||= titleText(heading);
    title ||= clean(element.getAttribute('aria-label'));
    if (!title && !['radio', 'checkbox'].includes(element.type)) {
      title = Array.from(element.labels || []).map(titleText).join(' ');
    }
    // 平台矩阵题：总题干加行题干，避免不同指标共用同一缓存答案。
    const row = element.closest('[class*="_tableContentNewLi-"], tr, [data-question-row]');
    const rowTitle = row?.querySelector('[class*="_issueTextContent-"], th, [data-row-title]');
    if (title && rowTitle) title += ` / ${titleText(rowTitle)}`;
    if (!title) {
      for (let node = element, depth = 0; node && node !== document.body && depth < 6; node = node.parentElement, depth++) {
        const previous = node.previousElementSibling;
        if (previous && !previous.matches(controlSelector) && !previous.querySelector(controlSelector)) {
          const candidate = titleText(previous);
          if (candidate && candidate.length < 600) { title = candidate; break; }
        }
        if (node === subject) break;
      }
    }
    const required = element.required || element.getAttribute('aria-required') === 'true'
      || Boolean(subject?.querySelector('[class*="_necessary-"], .ant-form-item-required, [aria-required="true"]'))
      || /^\s*[*＊]/.test(heading?.textContent || '');
    return { title, required: Boolean(required), subject };
  };
  const optionText = input => {
    if (input.tagName === 'OPTION') return clean(input.textContent);
    const label = input.closest('label') || (input.labels && input.labels[0]) || input;
    const clone = label.cloneNode(true);
    clone.querySelectorAll('input,textarea,select').forEach(node => node.remove());
    return clean(clone.textContent) || clean(input.getAttribute('aria-label'));
  };
  const optionData = input => ({
    text: optionText(input), selector: path(input),
    labelSelector: input.closest('label') ? path(input.closest('label')) : null,
    checked: input.checked ?? input.getAttribute('aria-checked') === 'true',
    disabled: Boolean(input.disabled || input.closest('[aria-disabled="true"]')),
    native: input.tagName === 'INPUT',
  });
  const questions = [];
  const groups = new Map();
  const roots = new WeakMap();
  let rootCount = 0;
  const rootId = element => { if (!roots.has(element)) roots.set(element, ++rootCount); return roots.get(element); };
  const inputs = document.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]');
  for (const input of inputs) {
    if (input.tagName !== 'INPUT' && input.querySelector('input')) continue;
    const label = input.closest('label');
    if (!visible(input) && !visible(label)) continue;
    const kind = input.tagName === 'INPUT' ? input.type : input.getAttribute('role');
    const group = input.closest(kind === 'radio' ? '.ant-radio-group, [role="radiogroup"]' : '.ant-checkbox-group, [role="group"]')
      || input.closest('fieldset') || input.closest(subjectSelector);
    // name 仅用于 DOM 内分组，不参与跨学期的模板身份。
    const key = `${kind}:${rootId(group || input.form || document.body)}:${group ? '' : input.name || path(input)}`;
    if (!groups.has(key)) groups.set(key, { kind, root: group || input, inputs: [] });
    groups.get(key).inputs.push(input);
  }
  for (const { kind, root, inputs: members } of groups.values()) {
    const info = context(root);
    questions.push({ kind, question: info.title, required: info.required || members.some(input => input.required),
      options: members.map(optionData), selector: path(root), orderElement: members[0] });
  }
  for (const element of document.querySelectorAll('select, textarea, input[type="text"], input:not([type]), input[type="number"]')) {
    if (!visible(element) || element.disabled) continue;
    const info = context(element);
    // 不将页面搜索框或登录框当成问卷。自由文本必须属于题目容器。
    if (!info.subject && element.tagName !== 'SELECT') continue;
    const kind = element.tagName === 'SELECT' ? (element.multiple ? 'multiselect' : 'select') : element.type === 'number' ? 'number' : 'text';
    questions.push({ kind, question: info.title, required: info.required, selector: path(element),
      options: kind.includes('select') ? Array.from(element.options).map(option => ({ text: optionText(option), value: option.value, checked: option.selected, disabled: option.disabled || option.value === '' })) : [],
      value: element.value, readOnly: Boolean(element.readOnly),
      min: element.getAttribute('min'), max: element.getAttribute('max'), step: element.getAttribute('step'),
      minLength: element.minLength > 0 ? element.minLength : 0,
      maxLength: element.maxLength >= 0 ? element.maxLength : null,
      pattern: element.getAttribute('pattern') || '', orderElement: element });
  }
  questions.sort((a, b) => a.orderElement.compareDocumentPosition(b.orderElement) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  const unsupported = Array.from(document.querySelectorAll('[role="slider"], input[type="range"], input[type="file"], [contenteditable="true"], [role="combobox"]'))
    .filter(element => visible(element) && element.closest(subjectSelector) && element.tagName !== 'SELECT')
    .map(element => ({ question: context(element).title, kind: element.type || element.getAttribute('role') || 'contenteditable' }));
  for (const subject of document.querySelectorAll(subjectSelector)) {
    if (!visible(subject)) continue;
    if (!questions.some(question => subject.contains(question.orderElement))
      && subject.querySelector('[class*="_title-"], legend, .question-title, [data-question-title]')) {
      unsupported.push({ question: context(subject).title, kind: '未知题目控件' });
    }
  }
  return { questions: questions.map(({ orderElement, ...question }, index) => ({ number: index + 1, ...question })), unsupported };
}

async function readQuestionnaire(page) {
  const snapshots = [];
  for (const [frameIndex, frame] of page.frames().entries()) {
    if (frame !== page.mainFrame() && !await (await frame.frameElement()).isVisible()) continue;
    const snapshot = await frame.evaluate(scanDocument);
    if (snapshot.questions.length || snapshot.unsupported.length) snapshots.push({ frameIndex, frame, ...snapshot });
  }
  if (snapshots.length > 1) throw new Error('多个页面/iframe 同时包含题目，请先进入单一问卷页面');
  return snapshots[0] || { frame: page.mainFrame(), frameIndex: 0, questions: [], unsupported: [] };
}

async function applyAnswer(snapshot, question, answer, timeout) {
  const { frame } = snapshot;
  if (['radio', 'checkbox'].includes(question.kind)) {
    for (const option of question.options) {
      const wanted = answer.includes(option.text);
      if (question.kind === 'radio' && !wanted) continue;
      if (option.checked === wanted) continue;
      if (option.disabled) throw new Error(`选项不可操作：${option.text}`);
      const control = frame.locator(option.selector);
      if (option.native && !option.labelSelector) await control.setChecked(wanted, { timeout });
      else await frame.locator(option.labelSelector || option.selector).click({ timeout });
      const checked = option.native ? await control.isChecked() : await control.getAttribute('aria-checked') === 'true';
      if (checked !== wanted) throw new Error(`点击后状态不符合预期：${option.text}`);
    }
  } else if (question.kind.includes('select')) {
    await frame.locator(question.selector).selectOption(question.options.filter(option => !option.disabled && answer.includes(option.text)).map(option => option.value), { timeout });
  } else {
    if (question.readOnly && question.value !== answer) throw new Error('题目输入框只读，不能自动填写');
    if (!question.readOnly) await frame.locator(question.selector).fill(answer, { timeout });
  }
}

module.exports = { scanDocument, readQuestionnaire, applyAnswer };
