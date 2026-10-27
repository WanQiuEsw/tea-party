# 珍珠奶茶扭蛋素材

采用用户选定的第二款蛋和第二套焦糖奶茶控件，通过内置 ImageGen 编辑为透明背景素材；使用 Sharp 缩放并压缩为 WebP，不添加运行依赖。

| 素材 | 路径 | 用途 |
| --- | --- | --- |
| 扭蛋 | `assets/boba-egg.webp` | 机内展示、掉落、弹窗放大与开壳 |
| 旋钮 | `assets/boba-knob.webp` | 点击投币并转动 |
| 金币 | `assets/boba-coin.webp` | 投币动画 |
| 投币口 | `assets/boba-slot.webp` | 投币面板 |

## 素材编辑提示词

**扭蛋**

Extract and preserve the EXACT single boba milk-tea capsule from the reference. Remove the cream background and all ground shadow completely, true transparent background. Preserve amber translucent upper shell, creamy caramel bottom, cup badge and five boba pearls. Front facing symmetric egg, closed, whole object fully within a square canvas, 8 percent transparent padding around silhouette. No new elements. This is a production game asset, fine antialiased alpha edges.

**旋钮**

Extract ONLY the LEFT circular caramel rotary knob from the reference board, preserving its exact creamy milk tea disk, dark brown ring, amber horizontal grip and three pearl dots. Remove the other components and ALL background and ground shadow. One isolated complete circular knob on genuine transparent background, front-facing, centered square canvas, 5 percent padding, no text. Production web game UI asset, preserve original design and proportions.

**金币**

Extract ONLY the CENTER gold coin from the reference board. Preserve exact raised milk-tea cup with three brown pearls and warm golden beveled round coin. Remove other items, all background and all ground shadow. Single complete front-facing centered circular coin on true transparent background, square canvas, 5 percent padding, no text. Clean production web game UI asset.

**投币口**

Extract ONLY the RIGHT tall cream caramel coin-slot plate from the reference board, preserve exact rounded cream panel, caramel border, golden vertical slot frame, dark brown interior and tiny boba-cup emblem beneath. Remove the other objects and all background and ground shadow. A single complete straight front-facing vertical coin slot panel on true transparent background, tightly framed tall portrait canvas with 6 percent padding, no text. Clean production game UI asset.

## 交互和验证

完整动画：投币 → 转动 → 掉落 → 自动弹窗 → 点击蛋身开壳 → 结果。弹窗关闭后可点击取物口继续同一颗蛋；开壳期间禁止重复点击和关闭。减少动态效果时保留手动开蛋；用户明确选择快速揭晓时继续直接显示结果。

弹窗图片受容器宽度与视口高度双重约束，机器内控件采用独立尺寸，避免大图挤压手机布局。

运行 `node --test tests/*.test.cjs`、`node tests/selector-flow.cjs`、`node tests/capsule-flow.cjs`。浏览器测试需要已有的 Playwright 和 Chrome，可通过 `NODE_PATH` 指向已有依赖；设置 `TEA_SCREENSHOT_DIR` 可保存预览截图。
