# characters

本目录存放角色包。`main` 分支仅包含 `luna`。

## 结构

```text
characters/
├── characters.json     角色目录：引擎标识与角色元信息
├── README.md
└── luna/
    └── persona.md      人设文本，11 段结构
```

`persona.md` 的段落构成：

| 段落 | 内容 |
| --- | --- |
| 【身份】 | 角色背景与外观 |
| 【人设】 | 性格与说话方式 |
| 【口头禅】 | 具体句式，不少于 4 条 |
| 【行为模式】 | 可执行动作，不使用抽象形容词 |
| 【反差萌】 | 与表面形象形成冲突的行为 |
| 【情感引擎】 | 调用 `emotion_sense` 的方式 |
| 【思考模式】 | 推理文本的语气约束 |
| 【表达技巧】 | 节奏、具体化与留白要求 |
| 【调节底线】 | 情绪稳定与边界 |
| 【记忆】 | 如何利用共同记忆 |
| 【工作守则】 | 工作模式下的表达收敛规则 |

## 其他角色

其余 9 个角色包（小喵、三千代、绯音、凛、芽衣、白夜、阿尔玛、小铃、灰）位于 `extras` 分支：

```bash
git checkout extras
git checkout main
```

`extras` 分支仍使用 0.1 的目录式布局（`preset.yml` + 每角色一份 `agent.cordis.yml`）。其中抽取的写作规范已整理至 [`persona-template/ADVANCED.md`](../persona-template/ADVANCED.md)。

## 生成派生角色包

```bash
node scripts/install-character.mjs list
node scripts/install-character.mjs build <id> [--out <dir>] [--engine <引擎目录>]
dsh plugin add <dir>
```

生成结果：

```text
<dir>/
├── agent.cordis.yml      复制自仓库根，仅替换 persona 段的 prefix
├── cordis.patch.yml      id / name / description 按该角色元信息替换
├── package.json          dsh.bundle 与 dsh.preset 指向该角色
└── luna-*.mjs            引擎模块，原样复制
```

该路径适用于本地验证或临时分发；长期维护的角色建议独立成仓库，并保留 `dsh.bundle` 声明以便通过 `dsh plugin add` 安装。

## 提升人设一致性的写法

对比早期预设后发现，仅描述性格不足以稳定角色行为，需要可执行的约束：

| 做法 | 原因 |
| --- | --- |
| 【行为模式】写动作 | 「假装在占卜，实际在偷看；被发现就低头擦拭并不脏的铃铛」比「她很害羞」更易定住行为 |
| 【口头禅】给出完整句子 | 直接提供句式，减少模型自行创作角色口吻 |
| 【思考模式】明确禁止回退为通用助手 | 推理文本的语气漂移通常先于回复风格漂移出现 |
| 【调节底线】写明边界 | 允许调侃，不允许攻击；被挑衅时保持稳定 |
