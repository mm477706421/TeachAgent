# GitHub Pages 自动部署

仓库：[mm477706421/TeachAgent](https://github.com/mm477706421/TeachAgent)

访问：[在线演示](https://mm477706421.github.io/TeachAgent/)

## 发布内容

GitHub Pages 只托管静态文件，不能运行 FastAPI、SQLite、FFmpeg、Whisper 或 Ollama。线上版本自动进入合成课堂演示，展示教学画像、原文证据、示例报告下载与示例追问。

线上不发送课堂 API 请求，不提供真实视频文件选择或账号密码输入。上传按钮展示本地部署指南；正式教学业务仍在学校服务器运行。API 客户端也设置了静态模式保护，避免误连后端。

## CI/CD

工作流：`.github/workflows/ci.yml`。

1. 向 `main` 推送代码，或在 Actions 手动执行 `Validate and deploy TeachAgent`。
2. `test` 执行 Python 测试、本地版构建及真实账号浏览器流程。
3. `build-pages` 运行 `npm ci`、`npm run build:pages`，再验证仓库子路径、刷新、示例下载、手机布局和零课堂 API 请求。
4. 仅将 `frontend/dist-pages` 上传为 Pages 构建产物。
5. `deploy-pages` 使用 GitHub 官方部署 Action 发布，通过 `github-pages` environment 显示访问地址。

任意测试或构建失败均阻止部署。Pull request 执行验证和 Pages 构建测试，但不发布。仓库 Settings → Pages → Build and deployment 的 Source 设置为 GitHub Actions。

## 凭据

个人访问令牌只用于本机 GitHub 操作，保存在系统 Git 凭据管理器中。仓库、构建产物、文档与工作流中不保存该令牌。

CI/CD 使用 GitHub 自动提供的 `GITHUB_TOKEN` 与 OIDC：默认仅 `contents: read`；部署 job 单独授予 `pages: write`、`id-token: write`。无需创建 PAT Secret。

## 本地复现

```bash
cd frontend
npm ci
npm run build:pages
npm run test:pages
```

本地 Pages 浏览器检查启动 Vite preview 并访问 `http://127.0.0.1:4173/TeachAgent/`。默认使用 Microsoft Edge；Linux 使用 `PLAYWRIGHT_CHANNEL=chromium`，提前运行 `npx playwright install --with-deps chromium`。

生产站点验收可设置 `TEACHAGENT_PAGES_URL=https://mm477706421.github.io/TeachAgent/` 后执行 `npm run test:pages`，直接检查线上网站。

本地业务版仍运行 `npm run build`，输出到 `frontend/dist`，不会被 Pages 构建覆盖。仓库更名时需同步调整工作流的 `PAGES_BASE_PATH` 和 Pages 测试路径。
