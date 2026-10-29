# 发布流程

## 0. 现状

- 包名 `dsh-mimo-asr`：npm 上**还没被占用**（2026-10-29 查证，`npm view dsh-mimo-asr` 返回 404）。
- 本机 npm **未登录**（`npm whoami` → ENEEDAUTH），所以最后一步 `npm publish` 需要你的账号。
- dshfind 市场（App 里的「插件市场」）的索引是抓 npm + GitHub 生成：`plugins[].versions[].source.type = "npm"`，`author`/`stars` 来自 GitHub 仓库。**发布到 npm 并被抓到，就会出现在市场里**，没有额外的提交表单。

## 1. 想清楚仓库地址

市场条目会带 `repository.url` 和 GitHub star 数，没有仓库也能上架，但：

- 没有 `repository` 字段 → 市场里没有源码入口、没有 stars，排序靠后（`sortKeys.stars`）；
- 仓库已经建好了（<https://github.com/Easyhoov/dsh-mimo-asr>），`repository`/`homepage`/`bugs` 都已填好，这里记录格式：

```json
"repository": { "type": "git", "url": "https://github.com/Easyhoov/dsh-mimo-asr.git" },
"homepage": "https://github.com/Easyhoov/dsh-mimo-asr#readme",
"bugs": { "url": "https://github.com/Easyhoov/dsh-mimo-asr/issues" }
```

## 2. 发布

```bash
cd dsh-mimo-asr
npm login                 # 浏览器授权
npm publish               # publishConfig.access=public，无需再加 --access
```

验证：

```bash
npm view dsh-mimo-asr version dist.tarball
npx -y dsh-mimo-asr --help 2>/dev/null || true   # 不是 CLI，忽略
```

装到手机上（npm 路径，不再依赖本地 tgz）：

```bash
dsh plugin --profile web add dsh-mimo-asr
```

## 3. 出现到市场

dshfind 的抓取是周期性的，发布后过一段时间跑一次：

```bash
curl -s https://api.dshfind.com/market/dsh-index.json | grep -c '"name": "dsh-mimo-asr"'
```

返回 1 就说明进索引了；App 里「插件市场」搜索 `mimo` 即可。

如果几天后仍没有，去 <https://dshfind.com> 找作者/仓库提 issue 让他收录（索引里没有提交入口）。

## 4. 版本规则

- 只改文档 → `1.0.1` → `1.0.2`（npm 同一个版本号不能重发）。
- 改 provider 逻辑或依赖 → patch/minor 视情况；**不要**在已发布版本上覆盖。
- 依赖里的 `@deepseek-ai/dsh-experimental-*` 是**精确版本**锁定（`0.2.1-rc.2`）：DSH 运行时升级时，这里也要跟着升，否则 `speechToText` 的接口可能对不上。

## 5. 发布前自查

```bash
npm pack --dry-run      # 应该只有 lib/、cordis.patch.yml、README.md、LICENSE、package.json
node --check lib/index.js
```

- [ ] `cordis.patch.yml` 里的 `defaultProvider` 与 `config.providerId` 默认值一致（都是 `mimo-cloud`）
- [ ] README 里的 key 获取方式与代码一致（`config.apiKey` → `$MIMO_API_KEY` → `~/.dsh/mimo-asr.key`）
- [ ] 没把任何真实 API key 写进仓库或 patch
