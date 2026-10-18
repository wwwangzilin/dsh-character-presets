# persona-template —— 造一只新角色

这套引擎与角色是**解耦**的：`luna-soul.mjs`（情感引擎）不认识「露娜」，它只处理情绪、
状态与边界；「露娜」这个名字只活在 **persona 文本**、`MOODS` 的风格句和关键词表里。

所以造新角色不需要碰引擎——**复制本目录，改 persona 就够了**。

## 三步

```bash
# 1. 复制仓库到你自己的工作目录
cp -r dsh-character-presets ~/work/dsh-character-preset-<你的角色id>
cd ~/work/dsh-character-preset-<你的角色id>

# 2. 写人设：把 persona.md 填好，注入 agent.cordis.yml
$EDITOR persona/xx.md            # 或直接改 persona-template/persona.md
node scripts/use-persona.mjs xx

# 3. 改元信息（选择器里显示的名字），重新生成补丁，再装进 profile
$EDITOR package.json             # dsh.preset 的 id / name / description
node scripts/sync-bundle.mjs
dsh plugin add .
```

## 要改的地方（按重要性）

| 位置 | 改什么 | 必改 |
| --- | --- | --- |
| `persona/<lang>.md` | 身份 / 人设 / 口头禅 / 行为模式 / 反差 / 表达技巧 / 工作守则 | ✅ |
| `package.json` 的 `dsh.preset` | `id`、`name`（选择器显示名）、`description` | ✅ |
| `luna-soul.mjs` 的 `MOODS` | 各心情档位的**风格描述与示例句**（露娜的嘴替换成你的角色） | 强烈建议 |
| `luna-emotion.mjs` 的 `EXPLICIT_RULES` / `NEGATIONS` / `MIXED_PATTERNS` | 情绪关键词表与判据（角色语料不同，命中率会不同） | 建议 |
| `luna-vitals.mjs` 的 `SENSATIONS` | 局部体感表——换成你角色的「破绽」所在（耳朵 / 尾巴 / 指尖 / 后颈），三档强度各一句 | 建议 |
| `luna-soul.mjs` 的 `needTable` / `regulate` | 安抚与边界话术 | 建议 |
| `cards/` | 想要别的前端也能用，就导出一张角色卡 | 可选 |

**不要改**：引擎的分层结构（感知 → 理解 → 状态 → 表达 → 调节 → 记忆）与「规则可复现」原则
（见仓库根目录 `CONTRIBUTING.md` 的三条原则）。

**也别手改 `cordis.patch.yml`**：它是 `scripts/sync-bundle.mjs` 从 `agent.cordis.yml` +
`package.json` 生成的，手改会在下一次生成时被覆盖（`npm test` 里有断言守着）。

## 检查清单

- [ ] `node --check luna-soul.mjs` 通过
- [ ] `node scripts/sync-bundle.mjs --check` 通过（生成物与源一致）
- [ ] `node --test` 全绿（感知层 / 生理层都有断言守着；改过关键词表或体感表后尤其要跑）
- [ ] `node scripts/preview.mjs` 打出的对照表读起来像你的角色
- [ ] `node scripts/use-persona.mjs xx --dry-run` 显示缩进与行数正常
- [ ] `dsh plugin add .` 之后重启 DSH，新 preset 出现在选择器里，能选中
- [ ] 随便聊两句：`emotion_sense` 返回的是**你角色**的风格与示例，不是露娜的
- [ ] 进入正经工作场景时，角色会自动收敛（专注模式），不会卖萌干扰

## 发布

也欢迎把你的角色作为独立仓库发布，README 里注明「引擎来自
[dsh-character-presets](https://github.com/wwwangzilin/dsh-character-presets)」即可。
`package.json` 里 `dsh.bundle` 一旦就位，它也就能被 `dsh plugin add` 直接安装。
