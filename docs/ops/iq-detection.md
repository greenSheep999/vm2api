# 降智检测模块

## 为什么要做

「模型变笨」有三种完全不同的原因，必须先分清：

| 原因 | 判据 |
|---|---|
| 上游换了模型 | `upstream_response_model` ≠ 发出模型 |
| 上游降了推理档位 | `upstream_reasoning_effort` < 请求的 effort |
| 无票裸打被降档服务 | `turn_state_verdict = absent` |

三者都排除后，才轮到「能力本身下降」，那才需要题库。

## 题库（照 sub2api 的实践）

- 只给**校准过**的题下结论，未校准的题只记录、不给 good/bad
- `candy`：数值题，精确匹配（取答卷最后一个数字）
- `pelican`：结构题，判「裸 SVG vs 完整页面」

pelican 结构门槛（sub2api 用 25 份真实答卷校准）：

```
MinSVG: 1, MinPath: 10, MinText: 3, RequireAnyOf: [script, text]
```

probe 的鹈鹕更严格（7 条约束 + 种子变体 + 四态），我们后续接 probe 的判据。

## 校准义务

sub2api 把 candy 期望答案写死 `21`。我们实测 `gpt-6-astra` / `gpt-6.1-sol`
**9 个账号一致答 29**。在下结论前必须做基线采样，否则会把「模型层级差异」
误判成「账号降智」。

## 落地顺序

1. P1：`iq_probes` 表 + candy/pelican 判据 + 定时跑 + 面板只读
2. P2：分布确定后再开「bad → 降权」，不做自动停调度
3. P3：接 probe 的 `capability_drift`，不重复造评分引擎
