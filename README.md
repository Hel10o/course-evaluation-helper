# 课程评价辅助脚本

用于教学质量管理平台课程评价页面的半自动填答工具。浏览器由 Playwright 打开，登录仍由用户手动完成。

## 安全行为

- 默认逐门课程等待人工确认后再提交（`autoSubmit: false`）。
- 不按选项位置猜答案，只匹配语义明确的答案文本。
- 点击每道题后检查 radio 是否真的处于选中状态。
- 提交前再次检查所有可见题目；存在未完成题目时禁止提交。
- 只有页面明确出现“评价完成”“提交成功”或“评价成功”才记录成功。
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
| `answerMode` | `positive` | 使用语义明确的最正面答案；未知题型会停止 |
| `uniformAnswer` | `非常同意` | `uniform` / `perQuestion` 模式的默认答案 |
| `perQuestionAnswers` | `{}` | 按当前课程题号覆盖答案，例如 `{"1":"无","11":"无"}` |
| `suggestionText` | 空 | 非空时填写第一个可见文本框 |
| `autoSubmit` | `false` | 是否取消每门课程提交前的人工确认 |
| `skipIfNoMatch` | `false` | 是否继续检查其他题；即使为 `true`，有漏题仍禁止提交 |
| `keepBrowserOpenOnError` | `true` | 出错后等待回车，让用户先检查页面 |
| `captureRoutineScreenshots` | `false` | 是否保存每门课程填答前和成功后的截图 |
| `screenshotRetentionDays` | `30` | 启动时清理超过该天数的截图 |
| `maxScreenshots` | `200` | 最多保留的截图数 |
| `maxCourses` | `100` | 防止异常页面切换造成无限循环 |

### 答案模式

`positive` 会按文本识别“非常同意”“非常满意”“优秀”等明确答案，而不是选择第一个或最后一个。对于“有/无”“是/否”等语义依赖题干的题目，必须在 `perQuestionAnswers` 中明确配置。

`uniform` 对所有未覆盖题目使用 `uniformAnswer`。

`perQuestion` 同样使用 `uniformAnswer` 作为默认值，并允许通过 `perQuestionAnswers` 覆盖指定题号。题号在每门课程内从 1 重新开始。

## 如何使用

### 1. 检查配置

至少确认 `config.json` 中的 `url` 是当前学期的评价页面地址。建议首次运行时保留以下安全设置：

```json
{
  "autoSubmit": false,
  "skipIfNoMatch": false,
  "headless": false
}
```

如果当前问卷的第 1、11 题仍是“无/有”题，保留：

```json
{
  "perQuestionAnswers": {
    "1": "无",
    "11": "无"
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
3. 在浏览器中人工检查每一道答案。
4. 回到终端按回车确认提交；按 `Ctrl+C` 可以取消。
5. 平台明确返回成功后，脚本才会尝试进入下一门课程。
6. 所有课程完成后，浏览器自动关闭。

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
