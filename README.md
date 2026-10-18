# dsh-character-presets

DeepSeek Harness 的 agent preset 插件包，提供单一预设「露娜模式」。

预设由一套确定性规则引擎组织对话：情绪感知、需求推断、状态迁移、表达选择、边界调节、记忆检索分别在独立模块中实现，模型只接收引擎输出的结构化指引。工具面与内置 `standard` 预设等价。

- 许可：MIT
- 平台：Windows / macOS / Linux
- 运行环境：DeepSeek Harness 0.2 及以上

---

## 目录

- [工作原理](#工作原理)
- [组成](#组成)
- [安装](#安装)
- [配置](#配置)
- [记忆](#记忆)
- [情感引擎](#情感引擎)
- [打包结构](#打包结构)
- [开发](#开发)
- [自定义](#自定义)
- [兼容性](#兼容性)
- [许可与署名](#许可与署名)

---

## 工作原理

每次模型回复前，预设中的 `emotion_sense` 工具接收用户消息原文，按固定规则计算六层指引并返回一屏紧凑文本；模型依据该文本组织回复。情绪分类、状态迁移与边界策略均由可复现的规则代码实现，不依赖模型自由发挥，因此同一输入在相同状态下的判断保持一致。

```text
输入：主人认真工作，但这句话像是在开玩笑

【感知】主人认真工作｜目标：闲聊｜关系：长期主人
【理解】他想要：干净利落的专业帮助；最不想听：拖泥带水、过度卖萌干扰
【状态】你此刻：专注｜能量 60 耐心 88 兴趣 70 紧张 25
【表达】进入认真模式，回答专业利落，毒舌收敛成小声吐槽，但称呼主人保留。
【示例】哈？这么简单的问题也好意思问本小姐？（手指却飞快地敲着键盘）……
【调节】正常发挥，保持稳定人设
【记忆】最近聊过：「把模式提取到开源仓库」（2026-09-12，他认真工作）
```

## 组成

| 层 | 实现 | 输出 |
| --- | --- | --- |
| 角色层 | `agent.cordis.yml` 中 `persona` 行的 `prefix` | 人设、口头禅、行为模式、工作守则 |
| 情感层 | `luna-soul.mjs` 及其依赖模块 | 六层指引文本 |
| 生理层（派生） | `luna-vitals.mjs` | 心跳、体温、呼吸与局部体感 |
| 记忆层 | `luna-memory.mjs` / `luna-gate.mjs` / `luna-recall.mjs` / `luna-forget.mjs` | 跨会话记忆的写入、检索与失效 |
| 能力层 | `agent.cordis.yml` 其余插件行 | 文件、Shell、检索、Skills、计划模式、目标、Todo、子代理、Workflow、Ralph、Web 搜索、后台任务、上下文压缩 |

工作模式与闲聊模式由 `luna-mode.mjs` 的粘滞状态机区分：进入工作后至少保持 6 轮，期间仅明确脱离工作的语句可以退出。工作模式下表达收敛为结论优先，不铺垫、不使用夸张语气；称呼与少量自嘲保留。

---

## 安装

### 通过 CLI 安装（推荐）

```bash
dsh plugin add https://github.com/wwwangzilin/dsh-character-presets.git
```

安装完成后重启 DSH。新会话的预设选择器中出现「露娜模式」；也可在「设置 → Agent 预设」中设为默认。

`dsh plugin add` 将本包写入当前 profile 的依赖与组合列表，并作为 bundle patch 插入一条 `@deepseek-ai/dsh-agent-preset` 声明行。撤销方式：

```bash
dsh plugin --profile <profile> remove dsh-character-presets
```

### 从本地目录安装

```bash
git clone --depth 1 https://github.com/wwwangzilin/dsh-character-presets.git ~/dsh-character-presets
dsh plugin add ~/dsh-character-presets
```

### 脚本安装

`install.sh`（POSIX shell）与 `install.ps1`（Windows PowerShell）先将包取到 `$DSH_HOME/presets/luna`，再调用 `dsh plugin add`。可用环境变量覆盖路径：`DSH_HOME`、`DSH_PRESET_DIR`、`DSH_PRESET_REPO`、`DSH_PRESET_REF`。

```bash
curl -fsSL https://raw.githubusercontent.com/wwwangzilin/dsh-character-presets/main/install.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/wwwangzilin/dsh-character-presets/main/install.ps1 | iex
```

### 手动安装

要求 DSH 0.2 及以上，无需额外 npm 依赖：

1. 将仓库克隆到任意目录；
2. 在该 profile 中执行 `dsh plugin add <目录>`；
3. 重启 DSH。

> 0.1 版本的安装方式（将仓库复制到 `<dshHome>/.agent-presets/luna/` 并以目录名作为预设 id）自 0.2 起不再生效：预设注册表不扫描该目录，也不接受任何 YAML 写回。已有部署需改为上述安装方式。

---

## 配置

选择器中的显示信息由 `package.json` 的 `dsh.preset` 提供：

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "preset": {
    "id": "luna",
    "name": "露娜模式",
    "description": "…",
    "order": 2
  }
}
```

| 字段 | 作用 |
| --- | --- |
| `id` | 稳定的预设标识符；会话恢复与记忆归属都以它为准 |
| `name` | 选择器中的显示名称 |
| `description` | 选择器中的说明文本 |
| `order` | 列表排序 |

修改 `dsh.preset` 或 `agent.cordis.yml` 后须重新生成补丁：

```bash
node scripts/sync-bundle.mjs
```

## 记忆

情感引擎的记忆层维护 `$DSH_HOME/.luna-heart.json`（未设置 `DSH_HOME` 时为 `~/.dsh/.luna-heart.json`），并回退到当前会话工作区根目录。

- 每次调用 `emotion_sense`，返回文本的 `【记忆】` 行末尾附有持久化状态（`持久化 ✓ .luna-heart.json` 或失败原因），无需查阅日志。
- 删除该文件即重置关系状态，下一次对话按初次见面处理。
- 仓库 `.gitignore` 已排除该文件；插件写入的始终是本地文件，不进行任何网络传输。

数据结构（v2）：

| 字段 | 内容 |
| --- | --- |
| `claims` | 稳定事实（称呼、职业、语言、偏好、边界、时区），写入受谓词注册表约束 |
| `episodes` | 共同经历，带效价、唤醒度与原文证据 |
| `inferences` | 慢速推断，累积证据后确认 |
| `runtimeState` | 关系阶段与亲密度等临时状态，带过期时间 |
| `suppressions` | 遗忘抑制记录；被抑制的条目不参与检索，依赖它的推断重新计算 |

旧版（`profile` / `experiences` 结构）在首次读取时就地迁移，原文件备份为 `.luna-heart.v1.bak.json`。

### 写入

写入路径为确定性代码（候选提取 → 证据门控 → 合并 → 落库），共五道校验：

| 校验 | 规则 |
| --- | --- |
| 逐字引用 | 证据必须逐字出现在原文中 |
| 来源分类 | 必须区分 `[USER]` / `[TOOL]` / `[ACT]` / `[SELF]` |
| 事实来源 | 稳定事实必须来自用户本人 |
| 谓词白名单 | 字段必须在注册表中 |
| 数字出处 | 数字必须来自用户消息或工具结果 |

合并策略按类型区分：同谓词新值替代旧值并保留历史；相似经历合并计数；推断在证据累积到 3 条后转为确认。

### 检索

召回结果条数受 `maxResults` 限制，注入成本不随记忆量增长：

| 通道 | 打分 | 启用条件 |
| --- | --- | --- |
| 关键词 | 中英混合分词命中率（中文按 bigram） | 始终 |
| 情绪 | 效价接近度 | 紧张度 ≥ 0.7 |
| 时近 | 半衰期衰减（默认 14 天） | 始终 |

三路结果经 RRF（倒数排名融合）合并后按类型加权截断。被抑制的记忆不参与检索。

### 失效

遗忘以抑制为主，不以删除为主：

| 操作 | 行为 | 数据保留 |
| --- | --- | --- |
| 抑制 | 记录不可用，并重算依赖推断 | 是 |
| 撤回 | 取消抑制并重算推断 | 是 |
| 老化 | 30 天未提及且召回少于 3 次的经历标记为陈旧 | 是 |
| 合并 | 相似陈旧经历合并，被合并项保留墓碑 | 是 |
| 硬删除 | 移除条目，保留抑制记录 | 否 |

被抑制、陈旧或已删除的条目一律不进入上下文。每 20 轮对话自动执行一次老化与合并。

---

## 情感引擎

### 感知层

情绪识别叠加四类信号，避免关键词误判：

```text
我不开心        → 难过（否定翻转，而非命中「开心」）
哈哈哈哈        → 强度 3（重复字符外溢，附加「干笑」标记）
真是气笑了      → 生气 + 开心（混合情绪，整词识别）
```

1. **否定**：命中词前 4 字内出现否定词则翻转；跨逗号、句号的否定不生效。单字「别」被排除，避免「特别开心」误判。
2. **强度**：基础 1.2 分，按感叹号数量、连续重复字符（3 个及以上非标点字符）、程度副词上调；「有点」等减弱词下调。
3. **混合情绪**：「气笑」「哭笑不得」「又累又」等固定说法整体识别，输出主情绪与次情绪。
4. **标点与句式**：连续问号、省略号、干笑分别作为补充信号。

### 状态与表达

状态层维护心情与四项状态变量（能量、耐心、兴趣、紧张），按角色基线衰减并叠加随机漂移。表达层按心情选择风格档位，并给出节奏要求；调节层处理降火、陪伴、稳定与适度距离四类场景。

### 生理层

由前六层派生，输出一行身体事实：

- 只报告状态，不给出行为指令（例如「耳朵尖发烫」，而非「你现在应该害羞」）；
- 平静时不输出数值，仅在显著偏离常态时报告心率；
- 每种心情配置三档局部体感（强度越高，描述越多）；
- 身体指标按 `inertia: 0.5` 滞后于情绪，心情与强度当轮生效；
- 久别 ≥48 小时的会话，心率基线先上调；
- 包含昼夜节律与情感债：夜间指标整体下调；强度达标的负面情绪挂账，在随后数轮中逐渐消退。

### 粘滞状态机

```text
帮我把那个备份脚本改一下  → 工作（进入）
嗯                      → 工作（保持）
继续                    → 工作（保持）
好了吗                  → 工作（保持）
陪我聊会话              → 闲聊（明确脱离，直接退出）
```

进入条件为工作信号累计 2 分（代码片段、路径、报错、祈使句、追问）；保持 6 轮；退出需保持期结束且当前消息无工作信号；空闲超过 6 小时重置为闲聊。工作模式每轮额外消耗少量能量。

### 补充层

| 模块 | 作用 |
| --- | --- |
| `luna-offline.mjs` | 根据会话间隔生成不在场行为描述，同一间隔内恒定 |
| `luna-loops.mjs` | 记录未了结事项，冷却（≥8 轮且 ≥30 分钟）后主动询问，工作模式不询问 |
| `luna-siblings.mjs` | 读取共享来访记录，报告其他角色最近的会话时间 |
| `luna-soul.mjs`（场景） | 从工作区路径推断当前项目名称 |

`luna-siblings.mjs` 写入 `$DSH_HOME/.agent-presets/.siblings.json`；目录不可写时静默跳过，不影响其他功能。

---

## 打包结构

本仓库是一个 bundle：`package.json` 声明 `dsh.bundle.patch`，指向 `cordis.patch.yml`。该补丁声明一条 `@deepseek-ai/dsh-agent-preset` 行，其 `config.plugins` 为 `agent.cordis.yml` 的正文（整体缩进后嵌入）。

```text
agent.cordis.yml   人工维护：人设文本与工具面，保留注释
package.json       dsh.bundle 与 dsh.preset 元信息
cordis.patch.yml   生成物：由 scripts/sync-bundle.mjs 输出，请勿手工编辑
```

生成规则：

- 相对路径的模块引用改写为包名路径（`dsh-character-presets/luna-soul.mjs`），解析依赖 `package.json` 的 `exports`；
- 补丁正文的缩进必须深于 `config:` 所在列，否则 Loader 报 `bad indentation of a mapping entry`；
- 生成物与源不一致时 `tests/bundle.test.mjs` 失败。

## 开发

```bash
npm install                 # 仅安装 js-yaml（测试用）
npm test                    # node --test
node scripts/sync-bundle.mjs
node scripts/sync-bundle.mjs --check
node scripts/preview.mjs    # 感知 / 生理对照表
node scripts/use-persona.mjs <lang>   # zh | ja | en
```

测试全部为零运行时依赖的纯函数用例：

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `tests/memory.test.mjs` | 24 | v1→v2 迁移、版本检测、谓词注册表、去重与上限、抑制可见性 |
| `tests/gate.test.mjs` | 22 | 五道校验的拒绝场景、来源分类、合并策略、推断确认 |
| `tests/recall.test.mjs` | 16 | 分词、三通道打分、RRF 融合、高情绪启用条件 |
| `tests/forget.test.mjs` | 14 | 抑制与撤回、下游重算、老化、合并、软删除、硬删除 |
| `tests/vitals.test.mjs` | 14 | 数值省略、体感档位、漂移方向、久别加成、输出不重复 |
| `tests/mode.test.mjs` | 14 | 工作信号识别、保持、退出条件、空闲重置 |
| `tests/engine.test.mjs` | 12 | 实际 `apply()` 调用、记忆落库、跨轮状态、伪造内容拦截 |
| `tests/emotion.test.mjs` | 14 | 否定作用域、强度分档、混合情绪、误判回归 |
| `tests/loops.test.mjs` | 13 | 未了结事项抽取、冷却、询问次数上限、完成判定 |
| `tests/siblings.test.mjs` | 10 | 损坏文件容错、自身排除、时间窗口 |
| `tests/debt.test.mjs` | 10 | 强度门槛、续账、情绪覆盖、优先级 |
| `tests/offline.test.mjs` | 9 | 确定性、分桶、异常输入 |
| `tests/rhythm.test.mjs` | 9 | 钟点映射、昼夜调整、缺省行为 |
| `tests/bundle.test.mjs` | 6 | 生成同步、缩进、YAML 合法性、清单文件存在性 |

## 自定义

| 目标 | 位置 |
| --- | --- |
| 人设与工作守则 | `agent.cordis.yml` 中 `persona` 行的 `prefix` |
| 显示名称与说明 | `package.json` 的 `dsh.preset` |
| 心情档位与示例句 | `luna-soul.mjs` 的 `MOODS` |
| 工作模式档位与保持轮数 | `luna-mode.mjs` 的 `WORK_STYLE` / `MODE_DEFAULTS` |
| 情绪关键词与判据 | `luna-emotion.mjs` 的 `EXPLICIT_RULES` / `NEGATIONS` / `MIXED_PATTERNS` |
| 调节与边界话术 | `luna-soul.mjs` 的 `regulate` / `understand` |
| 记忆可写字段 | `luna-memory.mjs` 的 `PREDICATE_REGISTRY` |
| 生理基线 | `luna-vitals.mjs` 的 `VITALS_DEFAULTS` |
| 局部体感 | `luna-vitals.mjs` 的 `SENSATIONS` |
| 惯性与阈值 | `luna-inertia.mjs` 的 `INERTIA_DEFAULTS` |
| 工具面 | `agent.cordis.yml` 的插件行 |

### 其他前端

`cards/luna.card.json` 为 `chara_card_v2` 格式，可导入 SillyTavern、RisuAI 等。该卡片仅包含人设与示例，不含情感引擎、记忆与工具链。

### 派生角色

`characters/` 仅保留 `luna`。`extras` 分支保留其余 9 个角色包（小喵、三千代、绯音、凛、芽衣、白夜、阿尔玛、小铃、灰）；该分支仍使用 0.1 的目录式布局。生成可安装的派生包：

```bash
node scripts/install-character.mjs build <id> --out <dir>
```

## 兼容性

- 需要 DSH 0.2 及以上（bundle patch 中的 `@deepseek-ai/dsh-agent-preset` 声明）；
- 宿主平面（沙箱、审批、持久化、模型路由）由 DSH 管理，本包不做改动；
- `tool-bash` / `tool-pwsh` 按 `process.platform` 自动二选一；
- 面向模型的工具行位于 agent 平面，子代理通过加入父级组合继承同等能力。

## 许可与署名

MIT，见 [LICENSE](LICENSE)。

`agent.cordis.yml` 的预设组合改编自 DeepSeek Harness 随附的 `standard` 预设（MIT），并经同作者的 `nekomode` 预设二次改编；`luna-soul.mjs` 及同目录引擎模块为本仓库原创。完整署名见 [NOTICE](NOTICE)。

相关项目：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。
