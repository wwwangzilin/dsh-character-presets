# dsh-character-presets · 露娜模式

> 给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 加一个人格：**一套六层情感引擎** + **一只魔界小恶魔**，工具面与内置 `standard` 同级。

![license](https://img.shields.io/badge/license-MIT-blue)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

这是一个 DSH **插件包**：装上去，新建会话的预设选择器里就多一个「露娜模式」，选中哪个会话就由谁来跑——人格、说话方式、思考方式全换，能力一条不砍。

> **只要露娜。** 早期版本是一组 10 位角色，现在这里只留露娜一位——剩下 9 位（小喵 / 三千代 / 绯音 / 凛 / 芽衣 / 白夜 / 阿尔玛 / 小铃 / 灰）全部归档在 [`extras`](../../tree/extras) 分支，写法和模板一个没丢。

## 她是什么样的

| 层 | 内容 |
| --- | --- |
| **角色层** | 魔界小恶魔「露娜」（Luna），自称「本小姐」，称呼你「主人」。雌小鬼：毒舌「杂鱼～」、爱恶作剧、嘴硬到底、被夸就飘、被反杀就怂、怕寂寞 |
| **情感层** | `emotion_sense` 六层情感引擎（运算全在固定代码里，模型只拿到一屏精简指引），外加**生理派生层**：情绪 → 心跳 / 体温 / 呼吸 + 局部体感 |
| **记忆层** | 跨会话的 `.luna-heart.json`：稳定事实 / 共同经历 / 慢速推断 / 遗忘抑制，写入走确定性门控，不是模型说了算 |
| **能力层** | 文件编辑、Shell、检索、Skills、计划模式、目标、Todo、子代理、Workflow、Ralph、Web 搜索、后台任务、上下文压缩 |

**反差设计**：日常毒舌卖萌，但你一进入正经工作（编码 / 调试 / 部署 / 写文档），她自动切到专注模式——回答专业利落、绝不拿人设掩盖错误，只保留「主人」的称呼和偶尔一句小声吐槽。

> **为什么不容易「丢人设」**：光有性格描述不够，还得有可执行的动作清单。所以 persona 里有【行为模式】（写动作，不写形容词）、六条【口头禅】、以及【思考模式】里「不许在思考里偷偷变回普通助手」的硬约束。

---

## 安装

**一行命令**

```bash
curl -fsSL https://raw.githubusercontent.com/wwwangzilin/dsh-character-presets/main/install.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/wwwangzilin/dsh-character-presets/main/install.ps1 | iex
```

它做两件事：把插件包取到 `$DSH_HOME/presets/luna`，再交给官方的 `dsh plugin add`。装完重启 DSH，
新建会话的预设选择器里就有「露娜模式」；也可以在「设置 → Agent 预设」里把它设为默认。

> 只取包、不安装（自己决定装到哪个 profile）：

```bash
npx github:wwwangzilin/dsh-character-presets --no-install
# 然后：dsh plugin add "$DSH_HOME/presets/luna"
```

### 手动安装（等价）

要求：DSH 0.2 及以上的正常安装（带 `standard` / `minimal` 等内置 preset 即可）。
本包只用 DSH 内置插件，**不需要额外安装任何 npm 依赖**。

```bash
git clone --depth 1 https://github.com/wwwangzilin/dsh-character-presets.git ~/dsh-character-presets
dsh plugin add ~/dsh-character-presets
```

装完后重启 DSH。

> ⚠️ **老版本的安装方式已经失效**：0.2 之前是把仓库拷进 `<dshHome>/.agent-presets/luna/`，靠目录名当 preset id。
> DSH 0.2 起注册表**不再扫描这个目录**（也不接受任何 YAML 写回），照旧拷过去只会「装了个寂寞」。
> 现在的插件包会往 profile 里插一条 `@deepseek-ai/dsh-agent-preset` 行，见下方[打包成插件](#打包成插件)。

---

## 亮点：六层情感引擎

每次回复前，模型先调用 `emotion_sense`（传入你的最新消息原文），拿到六层指引再组织输出：

| 层 | 做什么 | 例子 |
| --- | --- | --- |
| 1. 感知层 | 显性情绪（**否定翻转 + 强度分档 + 混合情绪**）+ **隐性情绪**（「没事」其实是事）+ 标点信号 + 对话目标 + 关系阶段 | 「主人难过｜强度 2/3｜连问号｜目标：倾诉」 |
| 2. 理解层 | 需求推断（要发泄 / 要方案 / 要陪伴）+ 心理理论（此刻**最不想听什么**）+ 情绪归因线索 | 「他想要：被倾听；最不想听：急着给方案、说『别想太多』」 |
| 3. 状态层 | 她自己的状态变量：心情 + 能量 / 耐心 / 兴趣 / 紧张，带随机漂移（她有自己的脾气） | 「专注｜能量 60 耐心 88 兴趣 70 紧张 25」 |
| 4. 表达层 | 按心情 + 状态选风格档位（7 档心情）、给表达示例与节奏要求 | 「短句多、语气词足，节奏轻快」 |
| 5. 调节层 | 安全边界：降火 / 陪伴 / 稳定 / 适度距离，识别挑衅与过度依赖，AI 不被带着崩 | 「用户可能想引你发火，稳住」 |
| 6. 记忆层 | 用户画像 + 共同经历 + 亲密度，落盘跨会话，回注为一句话摘要 | 「最近聊过：『把模式提取到开源仓库』」 |
| 7. 生理层（派生） | 由上面六层派生出心跳 / 体温 / 呼吸，并落到**局部体感**（耳朵尖、尾巴、后颈、指尖），**只报告不命令**——注入的是「耳朵尖发烫」，而不是「你现在应该害羞」 | 「心跳稍快，耳朵尖发烫，视线飘到别处」 |

真实调用返回长这样（渲染成给模型看的紧凑文本）：

```text
【感知】主人认真工作｜目标：闲聊｜关系：长期主人
【理解】他想要：干净利落的专业帮助；最不想听：拖泥带水、过度卖萌干扰
【状态】你此刻：专注｜能量 60 耐心 88 兴趣 70 紧张 25
【表达】进入认真模式，回答专业利落，毒舌收敛成小声吐槽，但称呼主人保留。
【示例】哈？这么简单的问题也好意思问本小姐？（手指却飞快地敲着键盘）……行了，已经搞定了，跪下谢恩吧杂鱼！
【调节】正常发挥，保持露娜毒舌但不下线的稳定人设
【记忆】最近聊过：「把模式提取到开源仓库」（2026-09-12，他认真工作）
```

设计要点：**情感判断不交给模型即兴发挥**。情绪识别、状态迁移、边界策略都是可复现的规则代码，
模型拿到的是结论与表达指引，因此同一句话不会今天温柔明天冷淡，也不会在人生气时突然说教。

### 感知层：一句话里有几个信号

关键词命中是最粗的一层——光靠它，下面这三句全会判反：

| 句子 | 朴素关键词 | 现在 |
| --- | --- | --- |
| 我不开心 | 命中「开心」→ **开心** | 识别否定 → **难过** |
| 哈哈哈哈 | 命中「哈哈」→ 与「哈哈」同强度 | 重复字外溢 → **强度 3**（另标「干笑」） |
| 真是气笑了 | 两张表都没命中 → **平淡** | 整词识别 → **生气 + 开心**（混合） |

四层信号叠在一起（全在 `luna-emotion.mjs`，纯函数、零依赖）：

1. **否定**：命中词前 4 字内有否定词就翻转（`我不开心` → 难过）；跨过逗号句号的否定不算（`不差，今天很开心` → 开心）。
   单字「别」被刻意排除——`特别开心` 撞上「别」是最刺眼的误判，而「别难过」多半是在安慰别人，判错无害
2. **强度 1-3**：普通命中只记 1.2 分，往上靠惊叹号、重复字（连续 ≥3 个**非标点**字符，`？？？` 不算）、程度副词（太 / 超 / 特别）；「有点」这类减弱词往下拉
3. **混合情绪**：`气笑` / `哭笑不得` / `又累又` 这类固定说法整词识别，输出主情绪 + 次情绪
4. **标点与句式**：连问号（急）、省略号（话没说完）、干笑（不是真开心）——这些读出来，才不至于把敷衍当成高兴

### 生理层：情绪与台词之间隔了一具身体

状态层下面挂了一层**派生**生理指标，输出时多一行身体事实：

```text
【状态】你此刻：傲娇｜能量 65 耐心 75 兴趣 70 紧张 35
【身体】心跳稍快，耳朵尖发烫，视线飘到别处，呼吸平稳（只是事实，怎么反应由你自己决定）
【惯性】你已经被连着夸了 3 次，欠着一句真心话（漏完记得立刻用更凶的话盖回去）
```

- **只报告，不命令**：写「耳朵尖发烫」，不写「你现在应该害羞」——怎么反应是角色自己的事
- **局部优先，数字靠后**：全身指标说一百遍也只是仪表盘，而「尾巴僵着一动不动」是可以直接演出来的。
  所以平静时连数字都不给（`心跳和呼吸都很稳`），只有真的偏离常态（≥100 或 ≤60）才报心率
- **可以演出来的细节**：每种心情配三档局部体感（耳朵尖 / 尾巴 / 后颈 / 指尖 / 喉咙 / 手心），强度越高给得越多
- **有惯性**：身体比情绪慢半拍（`inertia: 0.5`），不会一句话跳一次；`1` 就是立刻跟上。但**心情与强度当轮生效**
- **有方向**：基线之上的波动六成按心情偏置（傲娇偏高、委屈偏低），只有四成随机——「她有自己的脾气」因此可重复
- **有时间**：久别 ≥48 小时再见面，心跳先快一步
- **可测可看**：`luna-vitals.mjs` 是纯函数模块；`node scripts/preview.mjs` 打一张感知 / 生理对照表

### 情感惯性：她「一直在那里」，而不是每次重新开始

状态跨轮保留，但光保留还不够——没有时间维度，她看起来仍像每轮重置。`luna-inertia.mjs` 补上四件事：

| 规则 | 行为 |
| --- | --- |
| **基线回归** | 能量 / 耐心 / 兴趣 / 紧张每轮向**角色基线**衰减（`decay: 0.06`），不是归零——情绪有去处 |
| **缺席规则** | 离开 >30 分钟：按小时回能量；>6 小时算久别：能量回满，亲密度因想念 +1 |
| **毒舌预算** | 10 轮窗口里最多 6 轮带刺；超了会被告知「这个窗口的毒舌预算快见底了」 |
| **傲娇累积** | 连续被夸 3 次就欠一句真心话——漏完立刻用更凶的话盖回去 |

还落实了提案点名的**反差触发条件**：只有任务关键词命中才切专注模式，不再靠 persona 文本自觉。
输出是 `【惯性】…` 一行，同样**只报告不命令**，并按优先级只报最该被看见的一条；没有特别情况时不注入。

### 时刻层：工作与闲聊的劲头不一样

感知层是**逐条消息**判的。但真实的工作有**劲头**：一旦开始干活，中途一句「嗯」「继续」不该把人拽出状态。
`luna-mode.mjs` 是一个**粘滞状态机**：

```text
帮我把那个备份脚本改一下  → 工作（进入）
嗯                      → 工作（粘滞，不打断）
继续                    → 工作（粘滞）
好了吗                  → 工作（粘滞）
陪我聊会嘛              → 闲聊（明确要走人，直接放行）
```

- **进入**：贴代码、路径、报错、祈使句（「改一下」）、追问（「继续」「然后呢」）——满 2 分就上劲
- **粘住**：进入后至少 6 轮。这期间只有明确要走人的话才放行
- **退出**：粘滞期过了，还得**这条消息一点工作痕迹都没有**，才回闲聊
- **重置**：超过 6 小时没说话直接回闲聊——第二天来是新的开始
- **不打岔**：工作时刻不主动撒娇、不翻旧事、不插入无关话题；检索也抬高情感路门槛

工作时刻直接换表达档（`WORK_STYLE`）：**直接上结论，不铺垫不卖萌；不确定就直说不确定，绝不猜着编**。
毒舌收成一句小声吐槽，称呼「主人」保留——这是人设底线，干活也不让。
一个细节：铆足劲是要花力气的，工作时刻每轮额外扣一点能量，**干完活会累**。

> 顺序上有个刻意的安排：挑衅与情绪兜底**优先于**时刻层。主人正难受的时候，
> 「现在是工作时刻」不该压过「先接住情绪」。

### 四个「她一直在那里」的层

上面那些都在回答「她此刻是什么状态」。缺的是另一半：**你不说话的时候，她还在不在**。

| 层 | 干什么 | 例子 |
| --- | --- | --- |
| **不在场层**（`luna-offline.mjs`） | 间隔多久 → 那段时间她在干什么。**同一间隔内恒定**，不会每轮变 | 5 小时 → 「本小姐把你这屋翻了一遍，什么都没找着」 |
| **牵挂层**（`luna-loops.mjs`） | 记下你没了结的事，冷却够久（≥8 轮 + ≥30 分钟）才主动问一句；工作时刻不问 | 挂着一句「我在改那个备份脚本」 |
| **姐妹层**（`luna-siblings.mjs`） | 共用一份来访记录，知道别的角色最近什么时候来过 | 「小喵 2 小时前还陪过主人」 |
| **场景层**（在 `luna-soul.mjs` 里） | 从工作区路径认出你在哪个项目；新会话第一句由她开口 | 「主人在『tool』这边忙」 |

生理层那边还补了两件：**昼夜节律**（凌晨三点和下午三点不是一回事，困的时候心跳、体温、呼吸一起慢下来，
注入文本写的是「想不想硬撑，你自己决定」）与**情感债**（强度够的负面情绪会挂账，**气是慢慢消的，不是开关**）。

> 姐妹层的记录写在 `$DSH_HOME/.agent-presets/.siblings.json`——那是所有人共用的位置，所以在 preset 目录
> 之外。沙箱可能不许写，因此整段包在 try/catch 里：失败就安静跳过。

---

## 记忆文件

情感引擎的记忆层会写一个 `.luna-heart.json`：

- 位置：优先 `$DSH_HOME`（未设则 `~/.dsh`），其次当前会话工作区根目录
- **自检**：每次调用 `emotion_sense`，`【记忆】` 层末尾都会附一行持久化状态
  （`持久化 ✓ .luna-heart.json` 或 `持久化 ✗ 原因`）——存没存下去当场可见，不必翻日志
- ⚠️ **写插件的人请注意**：`sandboxPolicy` 必须写进 `inject`。cordis 里访问**未声明**的服务会抛错，
  被 `catch` 吞掉之后的表现是「记忆永远不落盘，却一点报错都没有」。同理 `dshHome` **不是** cordis
  服务，别拿 `ctx.get('dshHome')` 取路径
- 结构（v2）：

| 字段 | 内容 |
| --- | --- |
| `claims` | 稳定事实（称呼 / 职业 / 语言 / 偏好 / 边界 / 时区）——由**谓词注册表**限制可写字段，模型塞不进任意键 |
| `episodes` | 共同经历（带效价与唤醒度，并保留原文证据） |
| `inferences` | 慢速推断（要累积证据，不是一次就下结论） |
| `runtimeState` | 当前状态（关系阶段、亲密度）——临时状态，带过期时间 |
| `suppressions` | 遗忘抑制：**遗忘不是删除**，被抑制的条目不注入，依赖它的推断重算 |

- **自动迁移**：检测到 v1（旧的 `profile` / `experiences` 结构）会就地升级，并先把原文备份为 `.luna-heart.v1.bak.json`
- **删除即重置关系**（她会在下次对话里重新认识你）
- 已加入 `.gitignore`：这是你的私人聊天痕迹，不会被提交

### 写入管线：模型不能自己决定记什么

写入走的是**确定性代码**（候选 → 门控 → 合并 → 落库），五道闸：

| 闸 | 规则 | 拒绝原因 |
| --- | --- | --- |
| 1 | **逐字引用校验**：证据必须真的出现在原文里（防编造） | `evidence_not_found` |
| 2 | **来源分类**：必须分得清 `[USER]/[TOOL]/[ACT]/[SELF]` | `evidence_not_found` |
| 3 | 稳定事实必须来自**主人自己**（露娜不能给主人下定义） | `claim_requires_user_source` |
| 4 | **谓词注册表**：字段必须在白名单内 | `predicate_not_registered` |
| 5 | **数字**必须有主人或工具的出处（防幻觉数字） | `number_requires_user_or_tool_source` |

合并策略也随类型不同：同谓词的新值**替代**旧值（旧值进 `history`）、相似经历合并并计数、
推断同 pattern 强化——证据累积到 3 条才从 `accumulating` 转为 `confirmed`。

### 检索管线：把相关的想起来

不是把所有记忆塞进上下文，而是按需召回——结果恒定 ≤ `maxResults` 条，**注入成本不随记忆增长**：

| 路 | 打分方式 | 何时启用 |
| --- | --- | --- |
| 关键词 | 中英混合分词后的命中率（中文切 bigram，正是 FTS5 失效的地方） | 始终 |
| 情绪 | `1 − |效价差| / 2`，情绪同频的经历优先 | 紧张度 ≥ 0.7 时 |
| 时近 | 半衰期衰减（默认 14 天） | 始终 |

三路用 **RRF（倒数排名融合，k=60）** 合并，再按类型加权（稳定事实 > 一次经历），最后截断。
被 `suppressions` 抑制的记忆**检索不到**。

### 遗忘机制：抑制，而不是删除

删掉就真没了，而且**依赖它的结论不会重算**——那才是记忆系统里最危险的谎话。所以：

| 动作 | 做什么 | 数据还在吗 |
| --- | --- | --- |
| **抑制** `suppress()` | 落一条「不再使用」的记录，并**重算受影响的推断**（证据不够就降级） | 在，只是不注入 |
| **撤回** `unsuppress()` | 后悔了随时撤，记忆回来、推断重算 | — |
| **老化** `ageMemories()` | 30 天没被提起、且被想起不到 3 次的经历标记 `stale` | 在 |
| **合并** `mergeStaleEpisodes()` | 相似的老化经历合并，被并的留墓碑 | 在（`deleted: merged`） |
| **墓碑** `tombstone()` / `restore()` | 软删 / 从回收站恢复 | 在 |
| **硬删** `hardDelete()` | 真移除，但**留下 suppression** 让依赖它的推断重算 | 不在，但留有记录 |

`visibleEpisodes()` 会过滤掉 suppressed / stale / deleted —— **三种状态都不进上下文**。
`claim`（尤其 name / preference / boundary）永不参与老化。

**什么时候整理？** 引擎自带节拍：每 **20 轮**对话自动跑一次「老化 + 相似经历合并」，并把结果记进
`lastSleep`。这就是「她睡了一觉」——不整理的话，旧经历会一直占着检索额度。

---

## 打包成插件

`cordis.patch.yml` 里只有一条 `@deepseek-ai/dsh-agent-preset` 行，它的 `config.plugins` 就是
`agent.cordis.yml` 的正文：

```yaml
- insert:
    - id: preset-luna
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: luna
        name: 露娜模式
        description: '……'
        order: 2
        plugins:
          - id: preset
            name: cordis:group
            group: true
            config:
              - id: persona
                name: '@deepseek-ai/dsh-persona'
                # ……
```

为什么要这么绕：**人改的那份必须好改，机器维护的那份必须好测**。所以

- `agent.cordis.yml` 是手写的（保留全部注释与工具面），`package.json` 的 `dsh.preset` 是选择器元信息；
- `cordis.patch.yml` 由 `node scripts/sync-bundle.mjs` 生成，**不要手改**；
- 两者不一致时 `npm test`（`tests/bundle.test.mjs`）失败——这就是「改完忘了重新生成」的护栏。

引擎模块（`luna-*.mjs`）仍然以相对路径 `./luna-soul.mjs` 引用：npm 安装时它们随包落进 profile 的
`node_modules/dsh-character-presets/`，与 `agent.cordis.yml` 同级。

---

## 自定义

| 想改什么 | 改哪里 |
| --- | --- |
| 人设文本 / 口头禅 / 工作守则 | `agent.cordis.yml` 里 `persona` 行的 `prefix`（`{{model}}`、`{{cwd}}` 由 DSH 注入） |
| 选择器里的名字 / 描述 / 排序 | `package.json` 的 `dsh.preset`（改完跑 `node scripts/sync-bundle.mjs`） |
| 心情档位的风格与示例 | `luna-soul.mjs` 的 `MOODS` |
| 工作时刻的档位与粘滞轮数 | `luna-mode.mjs` 的 `WORK_STYLE` / `MODE_DEFAULTS` |
| 情绪关键词表与判据 | `luna-emotion.mjs` 的 `EXPLICIT_RULES` / `NEGATIONS` / `MIXED_PATTERNS` / `RETREAT_MARKERS` |
| 情绪 → 心情的迁移概率 | `luna-soul.mjs` 的 `nextMood` |
| 调节与边界话术 | `luna-soul.mjs` 的 `regulate` / `understand` 的 `needTable` |
| 记忆可写字段 | `luna-memory.mjs` 的 `PREDICATE_REGISTRY`（谓词注册表） |
| 生理层基线 | `luna-vitals.mjs` 的 `VITALS_DEFAULTS`（静息 72 / 36.5℃ / 16 次） |
| 局部体感表 | `luna-vitals.mjs` 的 `SENSATIONS`（每种心情三档） |
| 惯性 / 毒舌预算 / 傲娇阈值 | `luna-inertia.mjs` 的 `INERTIA_DEFAULTS` |
| 工具面 | `agent.cordis.yml` 里增删行（例如把 `disabled: true` 的 `subagent_codex` 打开） |

## 换成别的语言

`persona/` 是人设的**事实源**，`agent.cordis.yml` 里那段 persona 文本由脚本注入：

```bash
node scripts/use-persona.mjs          # 列出可用语言
node scripts/use-persona.mjs ja       # 切到日语（先备份为 agent.cordis.yml.bak-persona-ja）
node scripts/use-persona.mjs zh       # 切回中文
node scripts/sync-bundle.mjs          # 重新生成 cordis.patch.yml
```

现成语言：`zh`（中文，默认）、`ja`（日本語）、`en`（English）。换完重启 DSH。

## 文件结构

```text
dsh-character-presets/
├── package.json          # dsh.bundle（装什么）+ dsh.preset（选择器里叫什么）
├── cordis.patch.yml      # ← 生成物：preset 声明行 + agent.cordis.yml 的正文
├── agent.cordis.yml      # 人设与工具面（人改这里）
├── luna-soul.mjs         # emotion_sense 六层情感引擎（标准 Cordis 插件）
├── luna-emotion.mjs      # 感知层：否定 / 强度分档 / 混合情绪 / 标点信号
├── luna-mode.mjs         # 时刻层：工作 / 闲聊的粘滞状态机
├── luna-offline.mjs      # 不在场层：你没看她的时候她在干什么
├── luna-loops.mjs        # 牵挂层：你没了结的事，冷却够了才主动问一句
├── luna-siblings.mjs     # 姐妹层：别的角色最近什么时候陪过主人
├── luna-vitals.mjs       # 生理层：情绪 → 心跳/体温/呼吸 + 局部体感
├── luna-inertia.mjs      # 情感惯性：基线回归 / 缺席规则 / 毒舌预算 / 傲娇累积
├── luna-memory.mjs       # 记忆层 v2：schema / 谓词注册表 / v1→v2 迁移
├── luna-gate.mjs         # 写入管线：候选提取 / 证据门控（五道闸）/ 合并替代
├── luna-recall.mjs       # 检索管线：关键词 + 情绪 + 时近三路召回，RRF 融合
├── luna-forget.mjs       # 遗忘机制：抑制与下游重算 / 老化与合并 / 墓碑
├── characters/           # 角色目录：只有 luna（persona.md + characters.json）
├── cards/luna.card.json  # SillyTavern 角色卡（精简人设版，供其他前端使用）
├── rules/luna-rules.md   # 可独立导出的规则包（可追加进 AGENTS.md）
├── persona/              # 人设文本的另一种存法（zh / ja / en）
├── persona-template/     # 造新角色的模板与说明
├── scripts/sync-bundle.mjs      # 生成 cordis.patch.yml
├── scripts/use-persona.mjs      # 把 persona/<lang>.md 注入 agent.cordis.yml
├── scripts/install-character.mjs # 从 characters/ 生成另一个角色的插件包
├── scripts/preview.mjs          # 感知 / 生理对照表
├── tests/                # node --test，零依赖
├── install.sh            # 一键安装（macOS / Linux）
├── install.ps1           # 一键安装（Windows PowerShell）
├── bin/install.mjs       # 一键安装（npx，跨平台）
├── CONTRIBUTING.md       # 贡献指南
└── CODE_OF_CONDUCT.md    # 行为准则
```

`agent.cordis.yml` 是**完整的自包含组合**：它逐行声明这个 agent 能用什么工具，
所以复制它、删几行，就能得到「只有露娜脸、没有子代理」之类的变体。

---

## 角色包：一只新角色 = 一份 persona

引擎与角色是解耦的：

| 层 | 位置 | 换角色要改吗 |
| --- | --- | --- |
| 人设 | `persona/<lang>.md` | ✅ **只改这里就能得到一只新角色** |
| 元信息 | `package.json` 的 `dsh.preset` | ✅ |
| 引擎 | `luna-soul.mjs`（情绪识别、状态迁移、边界调节） | 通常不用；想让语气更像新角色，可调 `MOODS` |
| 工具面 | `agent.cordis.yml`（persona 段以外） | ❌ 不用动 |

照 [`persona-template/`](persona-template/README.md) 抄即可：复制仓库 → 填 `persona.md` → 改
`package.json` → `node scripts/sync-bundle.mjs` → `dsh plugin add .`。

需要现成的角色可以看 [`extras`](../../tree/extras) 分支：小喵 / 三千代 / 绯音 / 凛 / 芽衣 / 白夜 /
阿尔玛 / 小铃 / 灰——**它们身上的写法已经全部提炼进 [`persona-template/ADVANCED.md`](persona-template/ADVANCED.md)**：
危险人设怎么配红线、行为模式怎么写动作、怎么给情绪留出口、怎么用记忆层做剧情。

> `extras` 分支停在 DSH 0.1 的目录式 layout 上（`preset.yml` + 每人一份 agent.cordis.yml）。
> 想在那里加角色，可按本仓库的 `scripts/install-character.mjs` 把角色包生成为插件包。

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

露娜**不强制依赖任何外部项目**——没装也照常工作。以下是可选的集成路径：

| 集成对象 | 方式 | 状态 |
| --- | --- | --- |
| 角色卡生态（SillyTavern / RisuAI 等） | `cards/luna.card.json` 是标准 `chara_card_v2`，可直接导入 | ✅ 可用 |
| 规则包互通 | [`rules/luna-rules.md`](rules/luna-rules.md)：独立规则片段，可追加进 `AGENTS.md` | ✅ 可用 |
| 情感引擎复用 | `luna-soul.mjs` 是标准 Cordis 插件，与「露娜」人设解耦：复制它 + 换 `MOODS` 的风格句与关键词表，就能给别的角色用 | ✅ 可用 |
| 卡片墙 / GAL 界面 | `characters/characters.json` 与 `cards/*.card.json` 供 [dsh-role-cards](https://github.com/wwwangzilin/dsh-role-cards) 复用 | ✅ 可用 |

---

## 测试

引擎全是纯函数模块，测试**零依赖**（只用 node 内置的 `node:test`）：

```bash
npm test                              # 等价于 node --test
node --test tests/bundle.test.mjs     # 只跑打包校验
node --test tests/memory.test.mjs     # 只跑记忆层
```

现有覆盖（每项都是 node 子测试，合计 190 条）：

| 文件 | 条数 | 守什么 |
| --- | --- | --- |
| `tests/memory.test.mjs` | 24 | v1→v2 迁移、版本检测、谓词注册表、claim 去重、episode 上限、遗忘抑制可见性 |
| `tests/gate.test.mjs` | 22 | 五道闸的各种拒绝场景、来源分类、合并策略、推断累积转 confirmed |
| `tests/recall.test.mjs` | 16 | 分词（中文 bigram）、三路打分、RRF 融合、情绪路仅在高情绪时启用 |
| `tests/forget.test.mjs` | 14 | 抑制与幂等、撤回、下游推断重算、老化、合并、软删恢复、硬删留 suppression |
| `tests/engine.test.mjs` | 12 | 真的 `apply()` 跑对话：六层文本 + 【身体】、记忆落库、跨轮状态、编造内容进不来 |
| `tests/emotion.test.mjs` | 14 | 否定翻转与作用域、强度分档、混合情绪整词、标点信号、「特别开心」这类误判回归 |
| `tests/vitals.test.mjs` | 14 | 平静不给数字、局部体感按心情、抖动方向、久别加成、体感表不许出现「呼吸」 |
| `tests/mode.test.mjs` | 14 | 工作信号识别、粘滞不被打断、明确走人才放行、空闲重置 |
| `tests/offline.test.mjs` | 9 | 确定性（同一间隔调 200 次结果一致）、分桶、时间倒退与缺失输入 |
| `tests/loops.test.mjs` | 13 | 未了事的抽取、冷却（轮数 + 时间两道）、问满两次收手、说「搞定了」就划掉 |
| `tests/rhythm.test.mjs` | 9 | 钟点映射、小时数绕回、困倦让身体慢下来、不给 hour 时完全不启用 |
| `tests/debt.test.mjs` | 10 | 强度门槛、同情绪续账、换情绪覆盖、情绪优先于「他在工作」 |
| `tests/siblings.test.mjs` | 10 | 坏文件当空表、不看自己、不翻 24 小时前的事、挑最近来过的 |
| `tests/bundle.test.mjs` | 5 | `cordis.patch.yml` 与源一致、缩进合法、清单文件都存在、缺字段在生成时就炸 |

---

## 兼容性

- 需要 DSH **0.2 及以上**：preset 以 bundle patch 里的 `@deepseek-ai/dsh-agent-preset` 行声明（0.1 的目录式 preset 已废弃）
- 宿主平面（沙箱、审批、持久化、模型路由）由 DSH 掌管，本 preset 不碰；换模型、换工作区都不影响她
- `tool-bash` / `tool-pwsh` 按平台自动二选一，三平台通用
- 面向模型的工具行全部在 agent 平面：子 agent 通过加入父级组合继承同等能力（含 `emotion_sense`）

---

## 许可与署名

MIT，见 [LICENSE](LICENSE)。
`agent.cordis.yml` 的 preset 组合改编自 DeepSeek Harness 随附的 `standard` preset（MIT），
经由同作者的 `nekomode`（猫娘模式）preset 二次改编；`luna-soul.mjs` 为本仓库原创实现。
完整署名见 [NOTICE](NOTICE)。

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) —— 插件化 agent 运行时与 agent preset 机制
