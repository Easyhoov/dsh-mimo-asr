# dsh-mimo-asr

Xiaomi MiMo（`mimo-v2.5-asr`）云端语音识别，接到 DSH 的 `speech/*` Remote 上，让 **DSH Go 输入框里的麦克风键**直接用云端转写，手机端零模型下载。

## 它解决什么

DSH Go 的麦克风只认两个接口：`speech/catalog`（有哪些识别器、选了谁、时长上限）和 `speech/transcribe`（一整段 WAV → 文本）。官方「语音输入」bundle 自带的是 SenseVoice **本地**模型（int8 约 228 MB，且要在 proot 里跑 `sherpa-onnx-node`）。这个包把同一个 Remote 换成云端实现，体积为零。

## 组成：一个包，三个条目

```
speech/catalog · speech/transcribe        ← App 只认这两条
        ▲
        │  @deepseek-ai/dsh-experimental-api-speech-to-text   （Remote 控制器）
        ▲
        │  @deepseek-ai/dsh-experimental-speech-to-text       （识别器注册表 speechToText）
        ▲
        │  dsh-mimo-asr  ← 本包：注册 location:'cloud' 的 provider，调 MiMo
```

三者由本包的 `cordis.patch.yml` 一次性 insert，所以装完不用再手工配 profile。

## 安装

```bash
# 从 npm
dsh plugin --profile <profile> add dsh-mimo-asr

# 或用本地打好的包
dsh plugin --profile <profile> add /path/to/dsh-mimo-asr-1.0.1.tgz
```

然后重启引擎（App：设置 › 本机引擎 › 重启；桌面：重启 `dsh web`）。

包会连带装上 DSH 官方的语音注册表与 `speech/*` Remote 控制器（本包的 dependencies），不用另外装官方「语音输入」bundle。

## 配置 API Key

插件 schema 里 `apiKey` 是 `role('secret')` 字段，但当前 DSH Go 的「设置 › 引擎参数」只列注册了自己命名空间的插件（本包只注册识别器，没有自己的设置页），所以实际用下面两种方式之一：

1. **文件**（推荐，权限 600，不进任何配置文件）：
   ```bash
   echo 'sk-...' > ~/.dsh/mimo-asr.key && chmod 600 ~/.dsh/mimo-asr.key
   ```
2. **环境变量**：`MIMO_API_KEY=sk-...`

两者的优先级：`config.apiKey`（如果有人把它写进 patch）> `$MIMO_API_KEY` > `~/.dsh/mimo-asr.key`。

其余字段：

| 字段 | 默认 | 说明 |
|---|---|---|
| `providerId` | `mimo-cloud` | 必须和 registry 的 `defaultProvider` 一致 |
| `access` | `api` | `api` 用 `api.xiaomimimo.com`；`token-plan` 用 `token-plan-{cluster}.xiaomimimo.com` |
| `cluster` | `cn` | Token Plan 的集群：`cn` / `sgp` / `ams` |
| `model` | `mimo-v2.5-asr` | 模型 id |
| `language` | `auto` | `auto` / `zh` / `en`；`auto` 时优先跟随 App 传来的语言提示 |
| `timeoutMs` | `120000` | 单次转写超时 |

## 使用

App：设置 › 语音输入 › **引擎**（`自动` 也能用，但它会先试系统识别器，在部分国产 ROM 上白等一次失败），然后点输入框右边的麦克风说话。

## 验证

- 设置 › 语音输入 里能看到 provider（来自 `speech/catalog`），phase 应为 `ready`；
- 点麦克风 → 说一句 → 松手/点 ■ → 文本落进输入框。

## 排错

| 现象 | 原因 |
|---|---|
| 引擎日志：`dsh-mimo-asr: pending (waiting for service: speechToText)` | registry 条目没起来。检查 `cordis.patch.yml` 的 `defaultProvider`（它是 **required**，缺了会让 registry 的 `_resolveConfig` 抛错，服务就永远不出现） |
| App 提示「请在引擎中启用并配置语音转写」 | `speech/catalog` 返回 null，或 `selection.providerId` 找不到对应 provider |
| `MiMo ASR HTTP 401` | key 不对，或 `access`/`cluster` 选错 |
| `MiMo ASR: no API key` | 上面三种配置方式都没生效 |
| 返回空文本 | 录音里没人声；或用 `language: zh` 明确指定语言 |

## 注意

- **不要同时启用官方「语音输入」bundle**：它也会注册 `speechToText` 与 `speech/*`，和本包的条目撞 id。
- 识别走公网 HTTPS：`api.xiaomimimo.com`（或 `token-plan-*`）。
- 卸载：`dsh plugin --profile <profile> remove dsh-mimo-asr`，再重启引擎。

## 许可

MIT
