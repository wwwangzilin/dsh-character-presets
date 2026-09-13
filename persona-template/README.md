# persona-template —— 造一只新角色

这套引擎与角色是**解耦**的：`luna-soul.mjs`（情感引擎）不认识「露娜」，它只处理情绪、
状态与边界；「露娜」这个名字只活在 **persona 文本**、`MOODS` 的风格句和关键词表里。

所以造新角色不需要碰引擎——**复制本目录，改 persona 就够了**。

## 三步

```bash
# 1. 复制仓库，目录名 = 你的 preset id（DSH 用目录名当 id）
cp -r dsh-character-presets ~/.dsh/.agent-presets/<你的角色id>

# 2. 写人设：把 persona.md 填好，注入 agent.cordis.yml
cd ~/.dsh/.agent-presets/<你的角色id>
$EDITOR persona/xx.md          # 或直接改 persona-template/persona.md
node scripts/use-persona.mjs xx

# 3. 改元信息，重启 DSH
$EDITOR preset.yml             # name / description 换成新角色
```

## 要改的地方（按重要性）

| 位置 | 改什么 | 必改 |
| --- | --- | --- |
| `persona/<lang>.md` | 身份 / 人设 / 口头禅 / 行为模式 / 反差 / 表达技巧 / 工作守则 | ✅ |
| `preset.yml` | `name`（选择器显示名）、`description` | ✅ |
| `luna-soul.mjs` 的 `MOODS` | 各心情档位的**风格描述与示例句**（露娜的嘴替换成你的角色） | 强烈建议 |
| `luna-soul.mjs` 的 `EXPLICIT_RULES` / `HIDDEN_MARKERS` | 情绪关键词表（角色语料不同，命中率会不同） | 建议 |
| `luna-soul.mjs` 的 `needTable` / `regulate` | 安抚与边界话术 | 建议 |
| `cards/` | 想要别的前端也能用，就导出一张角色卡 | 可选 |

**不要改**：引擎的分层结构（感知 → 理解 → 状态 → 表达 → 调节 → 记忆）与「规则可复现」原则
（见仓库根目录 `CONTRIBUTING.md` 的三条原则）。

## 检查清单

- [ ] `node --check luna-soul.mjs` 通过
- [ ] `node scripts/use-persona.mjs xx --dry-run` 显示缩进与行数正常
- [ ] 重启 DSH 后新 preset 出现在选择器里，能选中
- [ ] 随便聊两句：`emotion_sense` 返回的是**你角色**的风格与示例，不是露娜的
- [ ] 进入正经工作场景时，角色会自动收敛（专注模式），不会卖萌干扰

## 发布

也欢迎把你的角色作为独立仓库发布，README 里注明「引擎来自
[dsh-character-presets](https://github.com/wwwangzilin/dsh-character-presets)」即可。
