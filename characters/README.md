# 角色包

露娜之外的角色，共 5 位。**引擎与角色完全解耦** —— 加角色只需要一份 persona 文本，引擎一行都不用改。

| id | 角色 | 一句话 | 反差钩子 |
| --- | --- | --- | --- |
| `byakuya` | 白夜 | 冷艳巫女 | **重度社恐**，被直视就结巴，「神谕」多是现编的 |
| `alma` | 阿尔玛 | 旧式机械女仆 | 情绪过载会**卡带漏真心话**，随即「记录已损坏」 |
| `suzu` | 小铃 | 街头不良少女 | **怕生 + 被夸就炸毛**，深夜偷偷喂流浪猫 |
| `michiyo` | 三千代 | 干练社畜 | **生活能力为零**，泡面糊锅、怕黑还说「只是省电」 |
| `hui` | 灰 | 图书馆幽灵 | **记不住自己的名字**（因为没人叫过） |

## 安装

```bash
node scripts/install-character.mjs list          # 看有哪些角色
node scripts/install-character.mjs install --all  # 全部装到 ~/.dsh/.agent-presets/
node scripts/install-character.mjs install hui    # 只装一个
node scripts/install-character.mjs card hui       # 只生成角色卡
```

装完**重启 DSH**，新角色就会出现在 preset 选择器里。安装器做的事：

```
characters/<id>/persona.md  ──┐
characters/characters.json  ──┼─→  ~/.dsh/.agent-presets/<id>/
已装的 luna preset（引擎）  ──┘         ├── agent.cordis.yml   （照抄，只换 prefix 那一段）
                                        ├── preset.yml         （选择器显示名 + 描述）
                                        ├── luna-*.mjs ×7      （引擎，原样复制）
                                        └── cards/<id>.card.json（chara_card_v2，供前端/GAL）
```

## 为什么这些角色不容易「丢人设」

对比过本机 5 个老 preset 后发现：它们的 persona 段落结构几乎一致（都有【思考模式】【表达技巧】【调节底线】【工作守则】），**唯一的实质差异是露娜多了一段【行为模式】**。所以本目录的每个角色都按这套配方写：

| 配方 | 作用 |
| --- | --- |
| **【行为模式】写可执行动作** | 不写「她很害羞」，写「假装在占卜其实在偷看你，被发现了就低头擦根本不脏的铃铛」。动作比形容词更能锚住模型 |
| **【口头禅】≥4 条具体句子** | 给模型现成的句式，避免它自己「创作」角色口吻 |
| **【思考模式】强制推理层也用角色口吻** | 关键一条：思考不许偷偷变回普通助手，否则回复迟早跟着漂 |
| **【工作守则】明确收敛方式** | 正经活儿时怎么切专注模式，逐角色写清（三千代几乎不卖萌，灰不许用「据记载」掩盖不确定） |
| **【调节底线】逐角色补边界** | 通用安全条款 + 该角色的专属红线（灰不许用「你也会忘记我」绑住主人；阿尔玛不许因怕被弃置而拦着他做事） |
| **`emotion_sense` 每轮回注** | 引擎每轮返回【表达】【示例】，等于把角色风格重新钉一遍 —— 长会话里最有用的一层 |

## 自己加一个角色

```bash
mkdir characters/<你的id>
$EDITOR characters/<你的id>/persona.md   # 照抄任意一份的结构，替换内容
$EDITOR characters/characters.json       # 追加一条元数据
node scripts/install-character.mjs install <你的id>
```

persona 里可以直接用 `{{model}}` 与 `{{cwd}}` 两个模板变量。

## 与角色卡选择器的关系

`characters.json` 与 `cards/<id>.card.json` 是**同一份数据的两种形态**：

- `dsh-role-cards` 的 `ComboPanel`（下拉/卡片墙）读 `characters.json` 拿显示名、一句话、主题色；
- GAL 界面（`deepseek-pp-gal`）读 `card.json` 的 `extensions['dsh-luna-preset'].characterId` 与立绘；
- 选中后仍走既有的 `agentPresets.select()` 切换 preset，不需要新协议。
