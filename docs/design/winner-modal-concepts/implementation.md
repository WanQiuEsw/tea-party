# 柔粉礼盒弹窗

第三张参考图已落地到所有抽奖方式共用的 result 弹窗。

- `result.css`：柔粉渐变、CSS 蝴蝶结、奶油信息卡、等级徽章、圆角按钮，以及手机/短屏适配。
- `assets/result-gift.webp`：内置 image_gen 基于第三张参考图生成的透明插画，压缩为约 55 KB WebP。装饰图统一表达中奖，不代表每份奖品的实物外观。
- 奖品名称、品牌、参考价值、等级和概率仍由现有抽奖数据填充；复制、多奖品、再来一次、3 秒自动关闭延续原有行为。
- 自动关闭提示从刮刮乐票面移入中奖弹窗。
- 普通手机竖屏无需滚动；短横屏和超长内容在弹窗内滚动。

## 插画生成提示词

Use case: precise-object-edit. Input reference: a mobile winning modal design. Extract and recreate ONLY its central illustration: friendly smiling cup of creamy milk tea with tiny warm golden pearls, whipped creamy top, soft pink blush cheeks, emerging from an open pastel blush pink gift box with gracefully curled pink ribbon ends to left and right, and two small champagne four-point stars floating beside the cup. Preserve this reference's refined soft 2.5D clay/material rendering, pale blush and cream palette, warm subtle lighting. Create a standalone production web UI illustration asset, centered balanced horizontal composition about 4:3, all cup, gift box, ribbon curls and stars fully visible, minimal surrounding empty margin. Genuinely transparent background. No modal, no text whatsoever, no logo, no typography, no UI, no panel, no backdrop, no extra objects. The bottom of the gift box must be a complete visible box with a clean finished bottom edge, not cropped. One isolated high quality illustration to overlay on an ivory/pink webpage.

## 验证

`node --test tests/*.test.cjs`

设置 `NODE_PATH` 为包含 Playwright 的目录、`TEA_RESULT_BROWSER=1`，执行 `node --test tests/result.test.cjs`。浏览器验证使用独立临时数据库，截图保存到 `.screenshots/result-gift/`，覆盖 320、390、768、1280 像素和短横屏、四种等级、多奖品、再来一次、复制、关闭及动画。
