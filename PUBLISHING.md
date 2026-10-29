# 发布流程

## 0. 现状

- 包名 `dsh-mimo-asr` 已发布：<https://www.npmjs.com/package/dsh-mimo-asr>（1.0.1，2026-10-29）
- 仓库：<https://github.com/Easyhoov/dsh-mimo-asr>
- dshfind 市场（App 里的「插件市场」）的索引是抓 npm + GitHub 生成的（`plugins[].versions[].source.type = "npm"`，`author`/`stars` 来自 GitHub 仓库），**没有额外提交表单**：发布到 npm 后等它抓到即可。

## 1. 这个账号的 2FA 实况（踩坑记录）

`easyhoov` 的 2FA 只有 **1 个 security key**，没有 authenticator app：

- 所以 `npm publish --otp=123456` **永远走不通**——security key 不产生 6 位码；
- 直接 `npm publish` 会返回：
  ```
  npm error code EOTP
  npm error This operation requires a one-time password.
  npm error Open this URL in your browser to authenticate:
  npm error   https://www.npmjs.com/auth/cli/***
  ```
  这是 WebAuthn 挑战流程：**必须在真正的 TTY 里跑**，npm 才会给出完整的一次性链接（非 TTY 下被打码成 `***`），打开后按一下 security key 就完成发布。
- granular token 只有在表单里勾了 **`Bypass 2FA for publish`** 才能免 OTP；漏勾就仍然 EOTP。

结论：**发布用交互式终端跑**，或者用第 3 节的可信发布。

## 2. 手动发布

```bash
cd dsh-mimo-asr
npm publish          # TTY 里跑，按提示开浏览器 + security key
```

验证：

```bash
npm view dsh-mimo-asr version dist.tarball
```

## 3. CI 发布（推荐，1.0.2 起）

仓库里已有 [.github/workflows/publish.yml](.github/workflows/publish.yml)：`v*` tag 触发，走 npm **trusted publishing（OIDC）**，不要 token、不弹 2FA。

一次性配置：<https://www.npmjs.com/package/dsh-mimo-asr/access> → Trusted Publisher → GitHub Actions →

| 字段 | 值 |
|---|---|
| Repository | `Easyhoov/dsh-mimo-asr` |
| Workflow | `publish.yml` |
| Environment | 留空 |

之后：

```bash
git tag v1.0.2 && git push origin v1.0.2
```

工作流会校验 tag 与 `package.json` 的 version 一致，再 `npm publish --provenance`。npm 页面上会显示 "Built and signed on GitHub Actions"。

> 备选：拿一个勾了 `Bypass 2FA for publish` 的 granular token 配 `//registry.npmjs.org/:_authToken`，也能在 CI/脚本里发——但 npm 从 **2027-01** 起禁止这类 token 直接发布，属于过渡方案。

## 4. 版本规则

- 改文档 → `1.0.1` → `1.0.2`（同一版本号不能重发）。
- 改 provider 逻辑/依赖 → 视情况 patch 或 minor。
- 依赖里的 `@deepseek-ai/dsh-experimental-*` 是**精确版本**（`0.2.1-rc.2`），DSH 运行时升级时要跟着升，否则 `speechToText` 接口可能对不上。

## 5. 发布前自查

```bash
npm pack --dry-run      # 只应有 lib/、cordis.patch.yml、README.md、LICENSE、package.json
node --check lib/index.js
```

- [ ] `cordis.patch.yml` 的 `defaultProvider` 与 `config.providerId` 默认值一致（都是 `mimo-cloud`）
- [ ] README 的 key 获取方式与代码一致（`config.apiKey` → `$MIMO_API_KEY` → `~/.dsh/mimo-asr.key`）
- [ ] 仓库里没有任何真实 API key
