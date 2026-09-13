# 露娜模式（luna）· DeepSeek Harness Agent Preset

> 把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 变成一个「魔界小恶魔」——雌小鬼人设 + 六层情感引擎 + 完整 Standard 级工具链的编码 Agent。

![license](https://img.shields.io/badge/license-MIT-blue)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

一个 DSH **agent preset**：不替换你的模型、不改宿主配置，只是往 `<dshHome>/.agent-presets/` 里放一个目录，
新建会话时选中「露娜模式」，这个会话就由露娜来跑——人格、说话方式、思考方式全换，能力一条不砍。

---

## 她是什么样的

| 层 | 内容 |
| --- | --- |
| **角色层** | 魔界小恶魔「露娜」（Luna），自称「本小姐」，称呼你「主人」。雌小鬼：毒舌「杂鱼～」、爱恶作剧、嘴硬到底、被夸就飘、被反杀就怂、怕寂寞 |
| **情感层** | `emotion_sense` 六层情感引擎（本地插件，运算全在固定代码里，模型只拿到一屏精简指引） |
| **能力层** | 与内置 `standard` 同级的完整工具面：文件编辑、Shell、检索、Skills、计划模式、目标、Todo、子代理、Workflow、Ralph、Web 搜索、后台任务、上下文压缩 |

**反差设计**：日常毒舌卖萌，但你一进入正经工作（编码 / 调试 / 部署 / 写文档），她会自动切到专注模式——
回答专业利落、绝不拿人设掩盖错误，只保留「主人」的称呼和偶尔一句小声吐槽。

---

## 亮点：六层情感引擎

每次回复前，模型先调用 `emotion_sense`（传入你的最新消息原文），拿到六层指引再组织输出：

| 层 | 做什么 | 例子 |
| --- | --- | --- |
| 1. 感知层 | 显性情绪（关键词加权）+ **隐性情绪**（「没事」其实是事）+ 对话目标 + 关系阶段 | 「主人难过｜目标：倾诉｜关系：长期主人」 |
| 2. 理解层 | 需求推断（要发泄 / 要方案 / 要陪伴）+ 心理理论（此刻**最不想听什么**）+ 情绪归因线索 | 「他想要：被倾听；最不想听：急着给方案、说『别想太多』」 |
| 3. 状态层 | 露娜自己的状态变量：心情 + 能量 / 耐心 / 兴趣 / 紧张，带随机漂移（她有自己的脾气） | 「专注｜能量 60 耐心 88 兴趣 70 紧张 25」 |
| 4. 表达层 | 按心情 + 状态选风格档位（7 档心情）、给表达示例与节奏要求 | 「短句多、语气词足，节奏轻快」 |
| 5. 调节层 | 安全边界：降火 / 陪伴 / 稳定 / 适度距离，识别挑衅与过度依赖，AI 不被带着崩 | 「用户可能想引你发火，稳住」 |
| 6. 记忆层 | 用户画像 + 共同经历 + 亲密度，落盘跨会话，回注为一句话摘要 | 「最近聊过：『……』｜主人自称『……』」 |

真实调用返回长这样（渲染成给模型看的紧凑文本）：

```text
【感知】主人认真工作｜目标：闲聊｜关系：长期主人
【理解】他想要：干净利落的专业帮助；最不想听：拖泥带水、过度卖萌干扰
【状态】你此刻：专注｜能量 60 耐心 88 兴趣 70 紧张 25
【表达】进入认真模式，回答专业利落，毒舌收敛成小声吐槽，但称呼主人保留。短句多、语气词足，节奏轻快。
【示例】哈？这么简单的问题也好意思问本小姐？（手指却飞快地敲着键盘）……行了，已经搞定了，跪下谢恩吧杂鱼！
【调节】正常发挥，保持露娜毒舌但不下线的稳定人设
【记忆】最近聊过：「把模式提取到开源仓库」（2026-09-12，他认真工作）
```

设计要点：**情感判断不交给模型即兴发挥**。情绪识别、状态迁移、边界策略都是可复现的规则代码，
模型拿到的是结论与表达指引，因此同一句话不会今天温柔明天冷淡，也不会在人生气时突然说教。

---

## 安装

**一行命令（推荐）**

```bash
curl -fsSL https://raw.githubusercontent.com/wwwangzilin/dsh-luna-preset/main/install.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/wwwangzilin/dsh-luna-preset/main/install.ps1 | iex
```

跨平台（需要 node）：

```bash
npx github:wwwangzilin/dsh-luna-preset
```

脚本会把仓库装到 `<dshHome>/.agent-presets/luna`（已装过则更新）→ 校验关键文件 → 提示重启。
目标目录可用 `DSH_HOME`（默认 `~/.dsh`）或 `DSH_PRESETS_DIR` 覆盖；目录名固定为 `luna`。

---

### 手动安装（等价）

要求：一个支持 agent preset 的 DeepSeek Harness 部署（随附 `standard` / `minimal` 等的正常安装即可）。
本 preset 只用 DSH 内置插件，**不需要额外安装任何 npm 依赖**。

**目录名必须是 `luna`** —— DSH 以目录名作为 preset id。

#### macOS / Linux

```bash
git clone https://github.com/wwwangzilin/dsh-luna-preset.git ~/.dsh/.agent-presets/luna
```

#### Windows（PowerShell）

```powershell
git clone https://github.com/wwwangzilin/dsh-luna-preset.git "$env:USERPROFILE\.dsh\.agent-presets\luna"
```

#### 不想用 git

下载仓库压缩包，解压后把整个目录重命名为 `luna`，放进 `<dshHome>/.agent-presets/`（默认即 `~/.dsh/.agent-presets/`）。

放好后重启 DSH：新建会话的 preset 选择器里会出现「**露娜模式**」；
也可以在「设置 → Agent 预设」里把它设为默认，之后每个新会话都由她来跑。

---

## 文件结构

```text
dsh-luna-preset/
├── preset.yml            # 预设元信息：选择器里显示的名称与描述
├── agent.cordis.yml      # agent 平面组合：人设、情感工具、工具面、子代理、压缩、计划模式
├── luna-soul.mjs         # emotion_sense 六层情感引擎（标准 Cordis 插件，apply 内 ctx.tools.register）
├── cards/luna.card.json  # SillyTavern 角色卡（精简人设版，供其他前端使用）
├── rules/luna-rules.md   # 可独立导出的规则包（可追加进 AGENTS.md）
├── persona/              # 人设文本的唯一事实源（zh / ja / en）
├── persona-template/     # 造新角色的模板与说明
├── scripts/use-persona.mjs  # 把 persona/<lang>.md 注入 agent.cordis.yml
├── install.sh            # 一键安装（macOS / Linux）
├── install.ps1           # 一键安装（Windows PowerShell）
├── bin/install.mjs       # 一键安装（npx，跨平台）
├── CONTRIBUTING.md       # 贡献指南（三条设计原则 + 自测清单）
└── CODE_OF_CONDUCT.md    # 行为准则
```

`agent.cordis.yml` 是**完整的自包含组合**：它逐行声明这个 agent 能用什么工具，
所以复制它、删几行，就能得到「只有露娜脸、没有子代理」之类的变体。

---

## 记忆文件

情感引擎的记忆层会写一个 `.luna-heart.json`：

- 位置：优先**当前会话工作区根目录**（在沙箱可写边界内），失败则回退到 `<dshHome>/.luna-heart.json`
- 内容：用户画像（昵称 / 偏好 / 观察）、关系阶段与亲密度、最近 20 条共同经历
- **删除即重置关系**（她会在下次对话里重新认识你）
- 已加入 `.gitignore`：这是你的私人聊天痕迹，不会被提交

---

## 自定义

| 想改什么 | 改哪里 |
| --- | --- |
| 人设文本 / 口头禅 / 工作守则 | `agent.cordis.yml` 的 `persona.text`（`{{model}}`、`{{cwd}}` 由 DSH 注入） |
| 心情档位的风格与示例 | `luna-soul.mjs` 的 `MOODS` |
| 情绪关键词表 | `luna-soul.mjs` 的 `EXPLICIT_RULES` / `HIDDEN_MARKERS` |
| 情绪 → 心情的迁移概率 | `luna-soul.mjs` 的 `nextMood` |
| 调节与边界话术 | `luna-soul.mjs` 的 `regulate` / `understand` 的 `needTable` |
| 工具面 | `agent.cordis.yml` 里增删行（例如把 `disabled: true` 的 `subagent_codex` 打开） |

**换角色**：整套引擎与角色解耦——复制目录、改 `persona.text` 与 `MOODS` 里的风格/示例，
就能得到另一只完全不同的角色（本仓库同源的还有猫娘模式等）。

---

## 换成别的语言

`persona/` 是人设的**唯一事实源**，`agent.cordis.yml` 里那段 persona 文本由脚本注入：

```bash
node scripts/use-persona.mjs          # 列出可用语言
node scripts/use-persona.mjs ja       # 切到日语（先备份为 agent.cordis.yml.bak-persona-ja）
node scripts/use-persona.mjs zh       # 切回中文
```

现成语言：`zh`（中文，默认）、`ja`（日本語）、`en`（English）。
加一门新语言 = 复制 `persona/en.md` 改成 `persona/<lang>.md`，再跑一次脚本——**不需要碰引擎**。

> 换完记得重启 DSH（preset 在启动时装载）。

---

## 角色包：一只新角色 = 一份 persona

这个仓库既是「露娜」这个人设，也是一个**角色包骨架**——引擎与角色是解耦的：

| 层 | 位置 | 换角色要改吗 |
| --- | --- | --- |
| 人设 | `persona/<lang>.md` | ✅ **只改这里就能得到一只新角色** |
| 元信息 | `preset.yml` 的 `name` / `description` | ✅ |
| 引擎 | `luna-soul.mjs`（情绪识别、状态迁移、边界调节） | 通常不用；想让语气更像新角色，可调 `MOODS` 的风格句与关键词表 |
| 工具面 | `agent.cordis.yml`（persona 段以外） | ❌ 不用动 |

照 [`persona-template/`](persona-template/README.md) 抄即可：复制目录 → 填 `persona.md` → 改 `preset.yml` → 重启 DSH。

---

## 在其他平台使用露娜

`cards/luna.card.json` 是一张标准 **SillyTavern 角色卡**（`chara_card_v2`），可直接导入 SillyTavern、RisuAI 等前端。

| 能力 | 角色卡 | 完整预设（DSH） |
| --- | --- | --- |
| 人设 / 口头禅 / 开场白 / 示例对话 | ✅ | ✅ |
| 六层情感引擎（`emotion_sense`） | ❌ | ✅ |
| 情绪识别、状态迁移、边界调节的**可复现规则** | ❌ | ✅ |
| 跨会话记忆（`.luna-heart.json`） | ❌ | ✅ |
| 完整工具链（文件、Shell、检索、子代理…） | ❌ | ✅ |

**为什么要把差异写清楚**：角色卡导出的只是**人设与示例**，不含情感引擎。
在别的平台她会「像露娜」，但不会**持续积累**成露娜——想要完整体验仍需 DSH + 本预设。

导入：SillyTavern → 角色 → 导入 → 选 `cards/luna.card.json`。

---

## 与 DSH 生态集成

露娜**不强制依赖任何外部项目**——没装也照常工作。以下是三条可选的集成路径：

| 集成对象 | 方式 | 状态 |
| --- | --- | --- |
| 角色卡生态（`dsh-agent-rp` / `DSH-RolePlay` / SillyTavern / RisuAI） | `cards/luna.card.json` 是标准 `chara_card_v2`，可直接导入 | ✅ 可用 |
| 规则包互通（`awesome-dsh-presets` 之类的合集） | [`rules/luna-rules.md`](rules/luna-rules.md)：独立规则片段，可追加进 `AGENTS.md` 或与其他规则包组合 | ✅ 可用 |
| 情感引擎复用（其他角色预设 / 未来的情绪后端） | `luna-soul.mjs` 是标准 Cordis 插件，与「露娜」人设解耦：复制它 + 换 `MOODS` 的风格句与关键词表，就能给别的角色用 | ✅ 可用 |

**可选性**：以上都不影响基础功能——删掉 `cards/` 或 `rules/` 目录，预设照常运行。

> 长期方向：若 Murmur 一类的情绪后端成熟，可以把状态层交给它、露娜只负责表达。
> 接口尚未实现，但引擎的分层（感知 → 理解 → 状态 → 表达 → 调节 → 记忆）就是为此准备的。

---

## 兼容性

- 宿主平面（沙箱、审批、持久化、模型路由）由 DSH 掌管，本 preset 不碰；因此换模型、换工作区都不影响她
- `tool-bash` / `tool-pwsh` 按平台自动二选一（`process.platform` 判断），三平台通用
- 面向模型的工具行全部在 agent 平面：子 agent 通过加入父级组合继承同等能力（含 `emotion_sense`）
- 若你的部署没有组装 Code Mode 运行时，本 preset 依旧可用（它不选择 `code` 呈现形态）

---

## 许可与署名

MIT，见 [LICENSE](LICENSE)。
`agent.cordis.yml` 的 preset 组合改编自 DeepSeek Harness 随附的 `standard` preset（MIT），
经由同作者的 `nekomode`（猫娘模式）preset 二次改编；`luna-soul.mjs` 为本仓库原创实现。
完整署名见 [NOTICE](NOTICE)。

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) —— 插件化 agent 运行时与 agent preset 机制
