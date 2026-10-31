# VoiceDock

macOS 菜单栏里的 AI 配音工作台。打开小面板、写台词、选音色，生成可直接用于视频剪辑的音频和 SRT。

使用 **Tauri 2 + Rust + React + TypeScript**，首个服务商为 Fish Audio 原生 REST API。默认模型固定为 `s2.1-pro-free`，不自动切换付费模型。

## 安装与首次使用

面向 Apple Silicon Mac，最低系统版本 macOS 12。下载本仓库 Releases 中的 `.dmg`，将 `VoiceDock.app` 拖到「应用程序」，然后打开。当前构建没有 Apple Developer ID 签名和公证；如 macOS 阻止打开，请在「系统设置 → 隐私与安全性」中检查来源后允许本应用。

本地构建的产物位于：

```text
src-tauri/target/release/bundle/macos/VoiceDock.app
src-tauri/target/release/bundle/dmg/VoiceDock_0.1.1_aarch64.dmg
```

1. 打开设置，保存自己的 Fish Audio API Key。Key 仅保存在系统安全存储，界面不会回显已有 Key。「已保存」表示凭据已保存，不代表网络已通过验证。
2. 在「管理音色」中添加原始 Voice ID 和中文别名，也可主动导入自己 Fish 工作区的音色。不会把别名发给 API。
3. 输入台词，选择输出目录、模型、语速、格式。台词整篇发送一次，情绪标签原样保留。
4. 开启「同时生成字幕」后，从同次响应的真实时间戳生成 SRT，同时保存无情绪标签的 TXT。关闭后只调用普通音频接口。
5. 在结果区试听、拖动播放进度、在 Finder 中定位，或再次导出。生成历史可载入原始台词并重播文件。

每次调用付费模型前均需确认，包括付费试听。试听结果按音色 ID、模型、文本及合成参数缓存；相同参数重复试听使用缓存。

## 面板与快捷键

| 操作 | 方式 |
| --- | --- |
| 展开 / 收起 | 单击菜单栏图标，或 `⌥⌘G` |
| 开始生成 | `⌘↵` |
| 打开设置 | `⌘,` |
| 返回 / 收起 | `Esc`，有对话框时先关闭对话框 |
| 固定在桌面 | 点击图钉，开启置顶、移动及调整尺寸 |
| 移动 | 拖动标题区域 |
| 真正退出 | 右击菜单栏图标 → 退出 VoiceDock |

普通模式失焦会收起，编辑内容自动保存；原生目录选择期间不收起。关闭面板不退出进程。开机启动默认关闭，可在设置中主动开启。全局快捷键可以修改，例如 `Alt+Super+KeyG`。

## 已实现的工作流

- 本地音色资料库：添加、别名编辑、标签、描述、收藏、搜索、排序、复制 ID、最近使用时间与自定义试听句。
- 草稿自动保存，情绪标签在光标处插入并弱强调；合成文本 / 干净字幕预览。
- MP3、WAV、Ogg Opus 直接输出；音频、SRT、TXT 使用相同基本文件名。
- 默认目录、本次目录、本次文件名，以及 `{date}_{voice}_{title}` 命名规则。同名文件自动递增，不覆盖已有文件或字幕。
- 配音预设，最近 200 条生成历史，播放、重新载入台词、定位文件与复制导出。
- 系统代理及可选 HTTP / HTTPS / SOCKS5 代理。代理地址不接受内嵌账号密码。
- 请求取消、明确的连接 / 接收 / 校验状态，不显示伪造百分比。

## 字幕与音频可靠性

后端按 SSE 协议增量解析网络分块、UTF-8、CRLF、多行 data 和事件错误。音频按到达顺序连接；每个 `chunk_seq` 的非空 alignment 使用最新快照覆盖；相对时间加 `chunk_audio_offset_sec` 转成完整音频时间轴。

字幕按实际分段、标点、长度和停顿合并。不会把一整段的时间等分到每个字。只换行，不虚构更细的时间点。时间缺失、重叠、越界或对齐文本不完整时，仍保存有效音频和 TXT，并提示未生成 SRT。数字规范化造成对齐文本和原文不同，也会保守拒绝输出 SRT。时间戳接口失败时不会自动改用普通接口；用户可主动关闭字幕后重新生成。

MP3 / WAV 在 Rust 中解码检查，WAV 额外核对文件长度；Opus 检查 Ogg 容器、CRC、头信息和结束标记，尚不做完整 Opus 帧解码。文件先写同目录临时文件，校验完成后原子提交，不覆盖目标。音频与字幕多文件导出会在失败时回收本次已创建的侧车文件。

429 只在尚未开始接收音频时最多重试 2 次，退避 1 / 2 秒，尊重有限范围的 Retry-After。网络中断、超时、401、余额 / 模型错误均不自动重发，防止重复计费。取消本地请求不能保证服务端停止计费。

## 开发与构建

准备 Node.js 22.12+、npm、Rust 1.90+ 和 Xcode Command Line Tools。仓库提交 `package-lock.json`、`Cargo.lock`；使用锁定依赖复现。

```bash
npm ci
npm run tauri -- dev
```

本次开发环境的 Rust 位于项目忽略目录 `.tools/cargo` 和 `.tools/rustup`。脚本会自动检测该工具链；其他电脑使用正常安装的 Cargo，无需这些目录。

```bash
# TypeScript / Vite、前端单元测试、Rust 离线测试
npm run check

# 生成当前架构的 .app 与 .dmg
npm run tauri -- build --bundles app,dmg

# 仅预览网页界面；没有 Tauri 时不提供合成、凭据和文件操作
npm run dev
```

自动化测试使用本地模拟服务器和合成音频样本，不需要 API Key，不请求 Fish、不产生费用。真实联网测试必须在应用内配置 Key 后，由使用者主动点击生成。

## 模块结构

```text
src/
  App.tsx                     面板、状态与工作流协调
  components/
    ScriptEditor.tsx          光标插入、情绪强调与字幕预览
    VoiceLibrary.tsx          音色管理与账号导入
    Settings.tsx              安全凭据、代理、命名及系统设置
    Player.tsx                播放、定位与再次导出
    ui/                       shadcn / Radix 基础控件
  lib/api.ts                  类型化 Tauri 调用，不直接请求 Fish
  lib/text.ts                 纯文本编辑辅助函数
src-tauri/src/
  lib.rs                      Tauri 命令、Keychain、托盘与窗口
  model.rs                    配置类型、ID 映射及请求校验
  provider.rs                 Fish HTTP、限流重试与取消
  subtitles.rs                SSE、alignment 快照、时间轴与 SRT
  files.rs                    音频校验、安全文件名与原子导出
  tests.rs                    本地模拟 API 与核心回归测试
scripts/toolchain.mjs          项目本地 / 系统 Rust 工具链入口
```

macOS 本地资料位于 `~/Library/Application Support/com.harry6400.voicedock/workspace.json`；试听缓存位于系统应用缓存目录。资料库包含台词、音色、配置、历史和文件路径，不包含 API Key。Keychain 的 service 为 `com.harry6400.voicedock`，account 为 `fish-api-key`。用户导出的文件保留在自行选择的目录。

## 验证范围与后续项目

详见 [TESTING.md](TESTING.md)。没有真实 API Key 的联网合成、Fish 账号音色导入、真实字幕准确度、真实双显示器边界、开机启动、其他 Mac 与 Windows 均需要后续验证。实现和离线通过不等于线上已经验证。

本版未实现：FLAC / M4A 转码、跨应用原生文件拖拽、其他 TTS 服务商、批量任务、云端同步、自动更新、Developer ID 签名与公证。FFmpeg 可用也不会通过改扩展名假装转码。当前前端仍有组件复杂度等静态诊断，见验证记录。

## 官方依据

- [Fish 普通 TTS](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech)
- [Fish 带时间戳 TTS](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech-stream-with-timestamps)
- [Fish 账号音色列表](https://docs.fish.audio/api-reference/endpoint/model/list-models)
- [Tauri 2 托盘](https://v2.tauri.app/learn/system-tray/)、[全局快捷键](https://v2.tauri.app/plugin/global-shortcut/)、[持久化](https://v2.tauri.app/plugin/store/)

界面与实现有 AI 辅助参与。第三方控件来源与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
