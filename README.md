# 课程评价辅助脚本

用于教学质量管理平台课程评价页面的自动填答工具。浏览器由 Playwright 打开，登录由用户手动完成。

## 当前默认：12 题固定版

完成下方环境安装和配置后，双击“启动评教.cmd”或运行 `npm.cmd start`，启动 `evaluate-current.js`。按已确定的 12 题答案自动填写、提交，并在成功后自动点击“下一门课程”。不进入新题模板确认流程。首次手动登录并进入问卷后，按一次回车开始即可。

首次使用需把 `config.example.json` 复制为 `config.json` 并填写自己的评教网址。真实配置、截图、诊断和模板不进入版本库；Windows 启动脚本已包含在仓库中。

## 自适应入口（已停用为默认入口）

自适应代码保留，仅在显式运行 `npm.cmd run start:adaptive` 时启动 `evaluate-adaptive.js`。下面的新题确认流程不适用于当前默认固定版。

- 首次读取完整题干、选项、题型和必填约束，按“中性或较好”给出本地规则建议。没有明确规则的题目由你选一次。
- 终端展示新题答案表；输入 `题号=选项编号` 修改，例如 `8=3`，多选如 `3=1,3`，文本题如 `13=建议增加案例讲解`。核对后输入 `Y` 保存模板，输入 `Q` 退出。
- 相同网站、学期内，已确认的题目自动填写；当前本机已启用自动提交，提交成功后自动进入下一门课程。
- 模板按题干、题型、整组选项与约束匹配，题号和选项顺序变化不会误配；题干改写或新增选项只重新确认变化题。换学期会重新确认一次。
- 模板保存在本机 `templates/approved-answers.json`，预览在 `inspect_output/answer-preview.json`；不使用外部模型或传送问卷到第三方服务。新模板确认是一次性建表步骤，不是逐门提交确认。

支持常见原生单选、多选、下拉框、文本和数字输入，以及当前平台的嵌套单选结构；支持单一问卷 iframe。图片答案、滑块、富文本和无法读出题干的结构会提示需要适配，不宣称覆盖所有题型。

换学期先在 `config.json` 更新 `url`，再启动并核对新答案表。平台没有 `semester` 地址参数时，按同一网站路径复用；这种情况下如果要强制重新建表，可先备份并重命名 `templates/approved-answers.json`。详细说明见 [ADAPTIVE.md](ADAPTIVE.md)。

## 本次问卷专用入口（2026-2027-1）

当前默认入口为 `evaluate-current.js`，也可运行 `npm.cmd run start:current`。它使用这次诊断记录的 12 道题完整选项，按题号与整组选项联合核对，再按 `questionnaire-2026-2027-1.json` 填答。

| 题号 | 本次答案 |
|---|---|
| 1 | 无 |
| 2 | 较好 |
| 3 | 同意 |
| 4 | 有讲解，基本清晰 |
| 5 | 涉及较多 |
| 6 | 有安排，基本满足 |
| 7 | 有反馈，有帮助 |
| 8 | 经常 |
| 9 | 同意 |
| 10 | 满意 |
| 11 | 适宜 |
| 12 | 满意 |

每门课程填答前核对全部题目；选项换序仍按文字选择，题数或选项发生变化则停止。固定填答阶段会把已有选择改为上表答案。当前本机按用户要求启用 `autoSubmit: true`：填答并自动复核完成后直接提交，不再逐门等待回车。建议文本沿用 `config.json`，默认留空。

提交前自动将页面底部的按钮滚动到可见位置，兼容“提 交”等带空格的文字。检测到“提交成功”弹窗后，自动点击“下一门课程”，等待新的未填问卷出现再继续；不会在弹窗刚关闭、旧问卷尚未切换时重复填写。

首次手动登录并进入问卷后仍需按一次回车开始，之后连续填答、提交和换课。需要恢复逐门确认时，将本机 `config.json` 的 `autoSubmit` 改为 `false` 后重启脚本。

诊断记录中题干为空，因此目前校验的是题号和选项集，不能识别“选项完全相同但题干改写”的变化。首次使用仍需核对问卷。验证使用实际采集的选项重建本地页面，未提交真实评价。

网址和浏览器设置仍读取本机 `config.json`；本次 12 题答案以 `questionnaire-2026-2027-1.json` 为准。原通用模式保留，可通过 `npm.cmd run start:generic` 启动。以下关于 `positive` 等通用答案模式的说明适用于通用入口。

## 安全行为

- 示例配置启用自动提交（`autoSubmit: true`）；需要逐门人工确认时改为 `false`。
- 不按选项位置猜答案，只匹配语义明确的答案文本。
- 点击每道题后检查 radio 是否真的处于选中状态。
- 提交前再次检查所有可见题目；存在未完成题目时禁止提交。
- 只有页面明确出现“评价完成”“提交成功”或“评价成功”才记录成功。
- 未知选项在交互式人工确认模式下允许手动选择后继续；自动提交模式仍停止。
- 页面结构、按钮或成功状态无法确认时会截图并安全停止。
- 不绕过登录、验证码或平台的访问控制。

平台规则可能发生变化，使用前请确认学校允许此类辅助工具，并对最终答案负责。

## 环境要求

- Node.js 18 或更高版本（安装 Node.js 时会同时安装 npm）
- Git
- Linux 或 Windows 10/11

不需要 Python、Java、Docker，也不要求预先安装 Chrome。Playwright 会安装项目专用的 Chromium。

### Linux 环境配置

以下命令以 Ubuntu/Debian 为例。先安装 Git，并通过系统包管理器、Node.js 官方安装包或版本管理器安装 Node.js 18 以上版本：

```bash
sudo apt update
sudo apt install -y git
```

确认环境版本：

```bash
node --version
npm --version
git --version
```

`node --version` 应显示 `v18` 或更高版本。然后下载项目并安装依赖：

```bash
git clone https://github.com/Hel10o/course-evaluation-helper.git
cd course-evaluation-helper
npm ci
npx playwright install --with-deps chromium
```

`--with-deps` 会一并安装 Chromium 在 Linux 上需要的系统库，期间可能要求输入 sudo 密码。如果当前目录没有 `package-lock.json`，使用 `npm install` 代替 `npm ci`。

### Windows 环境配置

1. 安装 Node.js 18 或更高版本。
2. 安装 Git for Windows。
3. 打开 PowerShell、Windows Terminal 或命令提示符。

确认环境版本：

```powershell
node --version
npm --version
git --version
```

然后下载项目并安装依赖：

```powershell
git clone https://github.com/Hel10o/course-evaluation-helper.git
cd course-evaluation-helper
npm ci
npx playwright install chromium
```

如果 PowerShell 提示无法运行 `npx.ps1`，可改用：

```powershell
npx.cmd playwright install chromium
```

也可以在传统的命令提示符（CMD）中执行安装命令。

## 配置

首次使用时复制示例配置。

Linux：

```bash
cp config.example.json config.json
```

Windows PowerShell：

```powershell
Copy-Item config.example.json config.json
```

Windows CMD：

```cmd
copy config.example.json config.json
```

然后把 `config.json` 中的 `url` 改为当前学期评价页面的完整地址。真实配置已被 `.gitignore` 忽略，避免任务地址被意外提交。

Linux 可使用任意文本编辑器，例如：

```bash
nano config.json
```

Windows 可以运行：

```powershell
notepad config.json
```

关键字段：

| 字段 | 默认值 | 作用 |
|---|---:|---|
| `answerMode` | `perQuestion` | 按题号使用配置答案；仅通用入口使用此模式字段 |
| `uniformAnswer` | `同意` | `uniform` / `perQuestion` 模式的默认答案 |
| `perQuestionAnswers` | 已配置 12 题 | 通用入口按题号使用；固定入口以 `questionnaire-2026-2027-1.json` 为准 |
| `suggestionText` | 空 | 非空时填写第一个可见文本框 |
| `autoSubmit` | `true` | 是否取消每门课程提交前的人工确认 |
| `skipIfNoMatch` | `false` | 是否继续检查其他题；即使为 `true`，有漏题仍禁止提交 |
| `keepBrowserOpenOnError` | `true` | 出错后等待回车，让用户先检查页面 |
| `captureRoutineScreenshots` | `false` | 是否保存每门课程填答前和成功后的截图 |
| `screenshotRetentionDays` | `30` | 启动时清理超过该天数的截图 |
| `maxScreenshots` | `200` | 最多保留的截图数 |
| `maxCourses` | `100` | 防止异常页面切换造成无限循环 |

### 答案模式

`positive` 会按完整文本识别“非常同意”“非常满意”“优秀”等明确答案，也支持“有讲解，讲解非常清晰且过程中不断强调”这一长句选项，而不是选择第一个或最后一个。对于“有/无”“是/否”等语义依赖题干的题目，应在 `perQuestionAnswers` 中明确配置，或在提示后手动选择。

`uniform` 对所有未覆盖题目使用 `uniformAnswer`。

`perQuestion` 同样使用 `uniformAnswer` 作为默认值，并允许通过 `perQuestionAnswers` 覆盖指定题号。题号在每门课程内从 1 重新开始。

## 如何使用

### 1. 检查配置

至少确认 `config.json` 中的 `url` 是当前学期的评价页面地址。示例配置默认自动提交；如需先逐门人工核对，可改为：

```json
{
  "autoSubmit": false,
  "skipIfNoMatch": false,
  "headless": false
}
```

本次固定问卷第 1 题为“无/有”，第 11 题为语速。通用入口对应的配置示例为：

```json
{
  "perQuestionAnswers": {
    "1": "无",
    "11": "适宜"
  }
}
```

平台改版或题目顺序变化后，应重新核对题号，不要直接复用旧学期配置。

### 2. 运行检查

Linux 和 Windows 均可运行：

```bash
npm run check
npm test
```

测试全部通过后再启动脚本。

### 3. 启动脚本

```bash
npm start
```

### 4. 按提示完成评价

1. 浏览器打开后手动登录，并进入能看到题目的评价页面。
2. 回到终端按回车，脚本填答并逐题复核。
3. `autoSubmit: true` 时，填答复核通过后自动提交。
4. `autoSubmit: false` 时，在浏览器中检查答案，再回终端按回车确认提交；按 `Ctrl+C` 可以取消。
5. 平台明确返回成功后，脚本才会尝试进入下一门课程。
6. 未检测到“下一门课程”入口时，本次运行结束并关闭浏览器。

如果遇到未匹配的选项，在 `autoSubmit: false` 且终端可交互时，脚本会暂停填答，保留当前浏览器。请在网页中手动选择相应答案，再按回车继续；这一步只继续填答，提交前仍另行确认。已有答案不会被覆盖。

填答未完成时，全部可见题组（包括滚动区域内的题目）、选项、已选状态和目标答案会保存到 `inspect_output/unanswered_questions.json`，后一次诊断覆盖前一次。该文件只保存在本机且已被 Git 忽略。

如遇错误，截图保存在 `screenshots/`。常规截图默认关闭，降低磁盘占用和个人信息留存。

## 常见问题

### 提示找不到 Chromium

Linux：

```bash
npx playwright install --with-deps chromium
```

Windows：

```powershell
npx.cmd playwright install chromium
```

### Windows 路径中包含中文或空格

切换目录时给路径加引号：

```powershell
cd "D:\我的项目\course-evaluation-helper"
```

### 页面上检测不到题目

确认已经手动登录，并进入实际显示题目和选项的评价页面后，再回终端按回车。如果平台已经改版，可以运行 `npm run inspect` 收集新的 DOM 结构用于排查。

### 更新项目

```bash
git pull
npm ci
npm test
```

## 检查与维护

升级依赖或改代码后运行：

```bash
npm run check
npm test
npm audit --omit=dev
```

平台改版后可运行 DOM 探针：

```bash
npm run inspect
```

如选择器失效，优先根据题目语义、可访问角色和按钮文字更新；不要恢复“按位置点击”或直接修改 DOM 的方案。

## 项目结构

```text
├── core.js               # 配置校验与答案匹配（可测试的纯逻辑）
├── evaluate.js           # 浏览器自动化主流程
├── inspect.js            # 页面结构诊断工具
├── config.example.json   # 安全配置模板
├── config.json           # 本机实际配置，不进入版本库
├── test/core.test.js     # 核心逻辑测试
└── screenshots/          # 错误截图，不进入版本库
```
