# 贡献指南

露娜欢迎改造 —— 但请先读这三条设计原则，它们决定了什么改动会被接受。

## 三条原则

1. **角色与引擎解耦**：`luna-soul.mjs` 是通用引擎，不放露娜专属内容；露娜的性格只出现在 `agent.cordis.yml` 的 `persona.text` 与 `luna-soul.mjs` 的 `MOODS` / 关键词表里。
2. **规则可复现**：情绪识别、状态迁移、边界策略必须是可读的规则代码，**不要**把它们交给模型即兴发挥。模型只该拿到结论与表达指引。
3. **只报告，不命令**：注入的是「事实」（如「你此刻心跳 112」），不是命令（如「你现在应该害羞」）。角色怎么反应由角色自己决定。

违反这三条的 PR 会被要求改写，不是因为你写得不好，而是它们会让同一句话今天温柔明天冷淡。

## 本地跑起来

```bash
git clone https://github.com/wwwangzilin/dsh-luna-preset.git ~/.dsh/.agent-presets/luna
# 重启 DSH → 新建会话时选「露娜模式」
```

改完 `agent.cordis.yml` / `luna-soul.mjs` 后重启 DSH 即可生效（预设是启动时装载的）。

想边改边看？把目录换成你自己工作区里的 clone，编辑后重启一次 DSH 就能验。

## 自测清单

提交前请逐条确认：

- [ ] `node --check luna-soul.mjs` 通过（语法）
- [ ] `jq . cards/luna.card.json` 通过（角色卡是合法 JSON）
- [ ] 改了 `agent.cordis.yml` 的话：新会话能正常起（preset 选择器里出现「露娜模式」且能选中）
- [ ] 改了 `persona.text` 的话：毒舌层与专注模式的切换仍然成立（正经工作时不许卖萌干扰）
- [ ] 改了 `MOODS` / 关键词表的话：`emotion_sense` 的返回值仍然是一屏精简文本，没有变成长篇大论
- [ ] `.luna-heart.json` 的 schema 若有改动：`version` 字段已递增，并在 PR 里说明迁移方式

## 提 PR

1. Fork → 开分支（`feat/xxx`、`fix/xxx`、`docs/xxx`）
2. 改动尽量**单一主题**，别把「加个口头禅」和「重构引擎」混在一个 PR
3. PR 描述里写清楚：**改了什么 / 为什么 / 怎么验证的**
4. 涉及人设的改动，附一段改动前后的实际对话对比（截图或文本都行）—— 这是最有说服力的证据

## 加一个新角色（不用改引擎）

引擎与角色解耦，所以新角色就是「复制目录 + 换 persona」：

1. 复制本仓库为 `~/.dsh/.agent-presets/<你的角色 id>`
2. 改 `preset.yml` 的 `name` / `description`
3. 改 `agent.cordis.yml` 的 `persona.text`
4. 改 `luna-soul.mjs` 里 `MOODS` 的风格与示例句、关键词表（可选）
5. 目录名就是 preset id，必须与 `preset.yml` 的名字对应

> 也欢迎把新角色作为独立仓库发布，README 里注明「引擎来自 dsh-luna-preset」即可。

## 不接受的改动

- 把情感判断改成「让模型自己判断情绪」
- 为了讨好用户而破坏人设一致性（例如让露娜在正经工作时也长篇卖萌）
- 在 preset 里引入新的运行时依赖（本 preset 只用 DSH 内置插件）
- 提交任何人的 `.luna-heart.json`（那是私人聊天痕迹，已在 `.gitignore`）

## 行为准则

参与本项目即表示同意 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
