# TeachAgent

### 让课堂被看见，让成长有迹可循。

面向学校内网的课堂分析与教研 Agent 工作台。视频、音频、转写、报告和追问上下文只在学校本地处理与保存，无云端模型调用、埋点、外部字体或 CDN。

![TeachAgent 工作台](docs/images/dashboard.png)

## 在线演示与自动部署

[体验 GitHub Pages 工作台](https://mm477706421.github.io/TeachAgent/)

Pages 只提供合成课堂演示，直接进入工作台，不显示教师登录表单、不读取真实视频、不调用后端 API。报告示例和演示对话在浏览器内生成。学校正式使用请按下方步骤部署本地服务。

推送到 `main` 后，GitHub Actions 依次执行后端与本地版浏览器测试、Pages 构建、静态演示浏览器测试，全部通过后部署。也可在 Actions 手动运行工作流。CI 使用内置 `GITHUB_TOKEN` 和 OIDC，不需要保存个人访问令牌为仓库 Secret。

Pages 构建命令为 `npm run build:pages`，仓库路径为 `/TeachAgent/`，输出目录 `frontend/dist-pages/`；本地版仍使用 `npm run build` 和 `frontend/dist/`。仅静态演示产物会上传到 Pages，数据目录、模型、密码和本机配置不会上传。

## 已实现

- **本地视频管线**：MP4 / MOV / MKV / AVI / WebM / M4V 上传，FFmpeg 抽帧与音轨提取，faster-whisper 离线转写，任务进度、失败原因与重试。
- **文本蒸馏与画像**：TXT / SRT / VTT 导入，文本清洗，环节时间轴、提问和互动线索、话语语速、语言习惯及证据化改进建议。
- **本机教研助手**：连接回环地址的 Ollama，结合当前课堂及历史消息追问；不可用时明确退回本地规则建议。
- **教师独立空间**：账号登录、会话校验、课堂数据隔离、视频回看、原文定位、Markdown / JSON / HTML 报告导出。
- **学校管理**：教师账号创建、按账号 ZIP 数据备份、审计日志、密码修改与本地密码重置。
- **精致 WebUI**：墨绿与暖白工作台、动态图表、移动端导航、无账号只读合成示例。

> 一期分析以语音和文本为主。环节与互动由可审计规则识别，不输出伪造的教学评分或师生占比。动作、板书、声纹分离与深度视觉分析属于扩展能力。

## 快速运行

环境：Python 3.12、Node.js 22+、FFmpeg（含 ffprobe）。首次安装依赖需要联网；正式运行可完全断网。

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
cd frontend
npm ci
npm run build
cd ..
.venv/Scripts/python -m backend.cli create-admin
.venv/Scripts/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1
```

管理员命令会生成随机密码，请保存该本地终端输出。访问 **http://127.0.0.1:8000**，登录后即可导入文本分析；也可以在登录页体验只读合成示例。

Linux 将 `.venv/Scripts/python` 换为 `.venv/bin/python`。生产运行必须使用 **1 个 Uvicorn worker、1 个应用实例**；ASR 队列按顺序执行。

### 准备本地模型

1. 在独立联网准备环境下载完整的 `Systran/faster-whisper-small` 模型目录。
2. 搬运到 `models/whisper-small/`，至少包含 `model.bin`、`config.json`、`tokenizer.json`、词表等模型原始文件。
3. 将 `.env.example` 复制为 `.env`，设置模型和 FFmpeg 路径。
4. 在“空间设置”检查就绪状态，然后上传有音轨的课堂视频。

运行时强制 `HF_HUB_OFFLINE=1`、`TRANSFORMERS_OFFLINE=1` 和 `local_files_only=True`，不会自动下载模型。模型不随源码或 Release 分发。

### 可选：本机 Ollama

在联网准备阶段预装 Ollama 并执行 `ollama pull qwen2.5:7b`，随后断网运行。默认地址为 `http://127.0.0.1:11434`。只接受本机回环 IP，禁止外部 URL、代理继承与重定向。没有 Ollama 也能转写、分析和导出，追问会显示“本地规则建议”。

### Docker

```bash
docker compose up -d --build
docker compose exec teachagent python -m backend.cli create-admin
```

默认只向宿主回环地址发布 8000 端口。学校访问应使用内网 HTTPS 反向代理，并设置 `COOKIE_SECURE=1`。容器中的 `127.0.0.1` 指向容器本身；与宿主 Ollama 协作的 Linux host-network 配置见部署文档。

## 文档

- [详细功能与部署文档](docs/功能与部署文档.md)：全部功能、操作步骤、计算口径、架构、部署、备份恢复、API、验收与扩展。
- [Word 版功能文档](docs/TeachAgent-功能与部署文档.docx)
- [验收记录](docs/验收记录.md)：测试结果与未验证条件。
- [版本变更](CHANGELOG.md)

## 开发与验证

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
cd frontend
npm run build
# 在后端已启动的条件下运行：
npm run test:e2e
```

浏览器默认使用系统 Microsoft Edge；其他环境设置 `PLAYWRIGHT_CHANNEL=chromium` 并运行 `npx playwright install chromium`。真实登录端到端检查需设置 `TEACHAGENT_E2E_USERNAME` 与 `TEACHAGENT_E2E_PASSWORD`。

本地双服务开发：后端 8000 端口，前端 `npm run dev` 启动 Vite；`/api` 自动代理到本机后端。生产部署使用 FastAPI 托管构建后的前端。

## 数据与开源范围

源码采用 MIT 许可。学校数据归学校统一管理。`.data/`、`.env`、模型、虚拟环境和个人账号信息不进入 Git。仓库内课堂内容全部为明确标注的人工合成示例。
