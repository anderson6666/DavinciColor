// FilterEngine —— 纯函数颜色算法层（无状态、无 DOM，可单元测试）

/**
 * RGB → HSV
 * @returns {{h:number,s:number,v:number}} h∈[0,360) s,v∈[0,1]
 */
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h: h % 360, s, v: max };
}

/**
 * HSV → RGB
 * @returns {{r:number,g:number,b:number}} 各通道 ∈[0,255]
 */
export function hsvToRgb(h, s, v) {
  const c = v * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = v - c;
  let r0 = 0, g0 = 0, b0 = 0;
  if (hp < 1) [r0, g0, b0] = [c, x, 0];
  else if (hp < 2) [r0, g0, b0] = [x, c, 0];
  else if (hp < 3) [r0, g0, b0] = [0, c, x];
  else if (hp < 4) [r0, g0, b0] = [0, x, c];
  else if (hp < 5) [r0, g0, b0] = [x, 0, c];
  else [r0, g0, b0] = [c, 0, x];
  return {
    r: Math.round((r0 + m) * 255),
    g: Math.round((g0 + m) * 255),
    b: Math.round((b0 + m) * 255),
  };
}

/** 最短色相环距离 b 到 a 的带符号偏移，∈[-180,180]（返回 a→b 的方向：要把 b 转到 a 应减该值） */
export function shortestHueDist(a, b) {
  return ((a - b + 180 + 360) % 360) - 180;
}

// 感知主色桶定义：Hc 为理想纯主色色相，Sref/Vref 为理想纯色
export const COLOR_BINS = [
  { name: '红', Hc: 0, adjacent: ['粉', '橙'] },
  { name: '橙', Hc: 30, adjacent: ['红', '黄'] },
  { name: '黄', Hc: 57, adjacent: ['橙', '绿'] },
  { name: '绿', Hc: 120, adjacent: ['黄', '青'] },
  { name: '青', Hc: 180, adjacent: ['绿', '蓝'] },
  { name: '蓝', Hc: 225, adjacent: ['青', '紫'] },
  { name: '紫', Hc: 270, adjacent: ['蓝', '粉'] },
  { name: '粉', Hc: 315, adjacent: ['紫', '红'] },
  { name: '灰', Hc: 0, adjacent: [], isAchromatic: true },
];

// 色相区间 → 桶（用于无彩度优先判定后的分类）
const HUE_RANGES = [
  { bin: '红', from: 345, to: 360 },
  { bin: '红', from: 0, to: 15 },
  { bin: '橙', from: 15, to: 45 },
  { bin: '黄', from: 45, to: 70 },
  { bin: '绿', from: 70, to: 165 },
  { bin: '青', from: 165, to: 195 },
  { bin: '蓝', from: 195, to: 255 },
  { bin: '紫', from: 255, to: 285 },
  { bin: '粉', from: 285, to: 345 },
];

/** 感知主色分类：返回桶名（红/橙/黄/绿/青/蓝/紫/粉/灰），黑白归灰 */
export function classifyHue(hsv) {
  const { h, s, v } = hsv;
  if (s < 0.10) return v > 0.85 ? '灰' : v < 0.15 ? '灰' : '灰'; // 无彩色统一归灰
  for (const r of HUE_RANGES) {
    if (h >= r.from && h < r.to) return r.bin;
  }
  return '红';
}

/** 根据桶名取桶定义 */
export function getBin(name) {
  return COLOR_BINS.find((b) => b.name === name) || COLOR_BINS[0];
}

/**
 * 为取样色生成一个温和的默认目标色（取色盘初始落点 / 一键调色共用）。
 * 只做小幅优化：色相往色系中心修正 30%、适度提纯、轻提亮，避免整图失真。
 */
export function defaultPureTarget(hsv) {
  const bin = classifyHue(hsv);
  if (bin === '灰') return { h: 0, s: 0, v: clamp(hsv.v + 0.08, 0.3, 0.7) };
  const b = getBin(bin);
  const dH = shortestHueDist(b.Hc, hsv.h);
  return {
    h: (hsv.h + 0.3 * dH + 360) % 360,
    s: Math.min(0.85, hsv.s + 0.2),
    v: clamp(hsv.v + 0.08, 0.35, 0.85),
  };
}

/** 一键调色：与默认目标色同一套温和优化（明度/色相/纯度） */
export function autoTarget(hsv) {
  return defaultPureTarget(hsv);
}

/**
 * 一键调色（智能阈值选色 + 非线性优化）：
 * 1) 过滤灰阶后按色系分桶，圆均值聚合每桶平均色
 * 2) 智能阈值：每个桶计算"未修正杂色量"（色相偏差 + 饱和缺口 + 明度偏差，按样本量加权可信度），
 *    超过阈值的桶才进入调色——调几个颜色由画面本身决定，不是固定个数
 * 3) 非线性优化：用 CSS filter 的精确数学模拟（hue-rotate 矩阵 / saturate 亮度插值 /
 *    brightness 乘法 / contrast 线性映射）预测每桶修正后的颜色，坐标下降搜索
 *    总杂色成本最小的参数组合，精确控制每项数值
 * @returns {null|{cleanup:Object, represent:{hsv:Object,rgb:Object}, buckets:Array}}
 */
export function autoGradeFromSamples(colors) {
  const chroma = colors.filter((c) => c.hsv && c.hsv.s >= 0.18 && c.hsv.v >= 0.08 && c.hsv.v <= 0.97);
  if (!chroma.length) return null;

  // 分色系分桶
  const map = new Map();
  for (const c of chroma) {
    const name = classifyHue(c.hsv);
    let b = map.get(name);
    if (!b) {
      b = { name, count: 0, hSin: 0, hCos: 0, s: 0, v: 0, r: 0, g: 0, bl: 0 };
      map.set(name, b);
    }
    const rad = (c.hsv.h * Math.PI) / 180;
    b.hSin += Math.sin(rad);
    b.hCos += Math.cos(rad);
    b.s += c.hsv.s;
    b.v += c.hsv.v;
    b.r += c.rgb.r;
    b.g += c.rgb.g;
    b.bl += c.rgb.b;
    b.count++;
  }

  const buckets = [...map.values()]
    .map((b) => {
      const hsv = {
        h: ((Math.atan2(b.hSin, b.hCos) * 180) / Math.PI + 360) % 360,
        s: b.s / b.count,
        v: b.v / b.count,
      };
      const rgb = { r: Math.round(b.r / b.count), g: Math.round(b.g / b.count), b: Math.round(b.bl / b.count) };
      return { name: b.name, count: b.count, hsv, rgb, weight: b.count * Math.max(0.02, hsv.s) };
    })
    .sort((a, b) => b.weight - a.weight);

  // 每桶目标色 + 未修正杂色量
  for (const bk of buckets) {
    bk.rgb01 = { r: bk.rgb.r / 255, g: bk.rgb.g / 255, b: bk.rgb.b / 255 };
    bk.target = autoTarget(bk.hsv);
    bk.need = bucketNeed(bk);
  }
  // 智能阈值：杂色量超门槛、样本量足够的桶才调；上限 6 桶防过度
  const top = buckets
    .filter((b) => b.count >= 2 && b.need >= 0.06)
    .sort((a, b) => b.need - a.need)
    .slice(0, 6);
  if (!top.length) return null;

  const cleanup = nonlinearOptimize(top, nonlinearInit(top));

  // 逐桶给出精确预测：色相偏移、纯度、明度 修正前 → 修正后
  const detail = top.map((bk) => {
    const out = applyCleanup(bk.rgb01, cleanup);
    const o = rgbToHsv(out.r * 255, out.g * 255, out.b * 255);
    const hc = getBin(bk.name).Hc;
    const devB = shortestHueDist(bk.hsv.h, hc);
    const devA = shortestHueDist(o.h, hc);
    return {
      name: bk.name,
      hex: '#' + [bk.rgb.r, bk.rgb.g, bk.rgb.b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join(''),
      text: `色相偏 ${devB >= 0 ? '+' : ''}${devB.toFixed(0)}° → ${devA >= 0 ? '+' : ''}${devA.toFixed(0)}° · 纯度 ${Math.round(bk.hsv.s * 100)}% → ${Math.round(o.s * 100)}% · 明度 ${Math.round(bk.hsv.v * 100)}% → ${Math.round(o.v * 100)}%（${bk.count} 点）`,
    };
  });

  return {
    cleanup,
    represent: { hsv: top[0].hsv, rgb: top[0].rgb },
    buckets: detail,
  };
}

/* ---------- CSS filter 精确模拟（0-1 RGB 空间，与浏览器实现一致） ---------- */

function applyHueRotate(rgb, deg) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return {
    r: (0.213 + c * 0.787 - s * 0.213) * rgb.r + (0.715 - c * 0.715 - s * 0.715) * rgb.g + (0.072 - c * 0.072 + s * 0.928) * rgb.b,
    g: (0.213 - c * 0.213 + s * 0.143) * rgb.r + (0.715 + c * 0.285 - s * 0.14) * rgb.g + (0.072 - c * 0.072 - s * 0.283) * rgb.b,
    b: (0.213 - c * 0.213 - s * 0.787) * rgb.r + (0.715 - c * 0.715 + s * 0.715) * rgb.g + (0.072 + c * 0.928 + s * 0.072) * rgb.b,
  };
}

function applySaturate(rgb, k) {
  const lum = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
  return { r: lum + (rgb.r - lum) * k, g: lum + (rgb.g - lum) * k, b: lum + (rgb.b - lum) * k };
}

function applyBrightness(rgb, k) {
  return { r: rgb.r * k, g: rgb.g * k, b: rgb.b * k };
}

function applyContrast(rgb, k) {
  const f = (v) => Math.min(1, Math.max(0, k * v + 0.5 - 0.5 * k));
  return { r: f(rgb.r), g: f(rgb.g), b: f(rgb.b) };
}

/** 按 CSS 应用顺序执行一条调色参数，精确预测结果色 */
function applyCleanup(rgb, p) {
  let c = applyHueRotate(rgb, p.hueRotate || 0);
  c = applySaturate(c, p.saturate ?? 1);
  c = applyBrightness(c, p.brightness ?? 1);
  c = applyContrast(c, p.contrast ?? 1);
  return {
    r: Math.min(1, Math.max(0, c.r)),
    g: Math.min(1, Math.max(0, c.g)),
    b: Math.min(1, Math.max(0, c.b)),
  };
}

const CLEANUP_BOUNDS = { hueRotate: [-20, 20], saturate: [0.85, 1.6], brightness: [0.85, 1.25], contrast: [1, 1.15] };
const boundParam = (key, v) => Math.min(CLEANUP_BOUNDS[key][1], Math.max(CLEANUP_BOUNDS[key][0], v));

/** 桶的"未修正杂色量"：色相偏差 + 饱和缺口 + 明度偏差，样本量提升可信度 */
function bucketNeed(bk) {
  const dH = shortestHueDist(bk.target.h, bk.hsv.h) / 30;
  const dS = Math.max(0, bk.target.s - bk.hsv.s);
  const dV = Math.abs(bk.target.v - bk.hsv.v);
  const impurity = 2.2 * dH * dH + 1.6 * dS * dS + 0.4 * dV * dV;
  return impurity * Math.min(1.5, Math.log2(1 + bk.count));
}

/** 总杂色成本：精确模拟参数效果后，度量每个选中桶离目标的残差 */
function totalCost(buckets, params) {
  let total = 0;
  for (const bk of buckets) {
    const out = applyCleanup(bk.rgb01, params);
    const hsv = rgbToHsv(out.r * 255, out.g * 255, out.b * 255);
    const dH = shortestHueDist(bk.target.h, hsv.h) / 180;
    const dS = bk.target.s - hsv.s;
    const dV = bk.target.v - hsv.v;
    total += bk.weight * (2.0 * dH * dH + 1.4 * dS * dS + 0.4 * dV * dV);
  }
  return total;
}

/** 非线性初值：softmax(杂色量) 加权 + 乘性参数几何均值 + 色相圆均值 */
function nonlinearInit(buckets) {
  const T = 0.08;
  const ws = buckets.map((b) => Math.exp(b.need / T));
  const sum = ws.reduce((a, b) => a + b, 0) || 1;
  let sin = 0;
  let cos = 0;
  let lsat = 0;
  let lbri = 0;
  let lcon = 0;
  buckets.forEach((b, i) => {
    const w = ws[i] / sum;
    const p = generateCleanupParams(b.hsv, b.target);
    const rad = (p.hueRotate * Math.PI) / 180;
    sin += Math.sin(rad) * w;
    cos += Math.cos(rad) * w;
    lsat += Math.log(p.saturate) * w;
    lbri += Math.log(p.brightness) * w;
    lcon += Math.log(p.contrast) * w;
  });
  return {
    hueRotate: boundParam('hueRotate', (Math.atan2(sin, cos) * 180) / Math.PI),
    saturate: boundParam('saturate', Math.exp(lsat)),
    brightness: boundParam('brightness', Math.exp(lbri)),
    contrast: boundParam('contrast', Math.exp(lcon)),
  };
}

/** 非线性优化：坐标下降搜索总杂色成本最小的参数（每步都用精确模拟评估） */
function nonlinearOptimize(buckets, init) {
  const steps = { hueRotate: 4, saturate: 0.08, brightness: 0.05, contrast: 0.03 };
  let best = { ...init };
  let bestCost = totalCost(buckets, best);
  for (let round = 0; round < 8; round++) {
    let improved = false;
    for (const key of Object.keys(steps)) {
      for (const dir of [1, -1]) {
        const cand = { ...best, [key]: boundParam(key, best[key] + dir * steps[key]) };
        const cost = totalCost(buckets, cand);
        if (cost < bestCost - 1e-9) {
          best = cand;
          bestCost = cost;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return best;
}

/**
 * 杂质检测：把取样色 src 与取色盘选定目标色 tgt 对比，产出可读文案。
 * @param {{h:number,s:number,v:number}} src 提取到的颜色
 * @param {{h:number,s:number,v:number}} tgt 取色盘选定的目标纯色
 * @returns {string[]}
 */
export function impurityReport(src, tgt) {
  const texts = [];
  const dH = shortestHueDist(tgt.h, src.h); // 把 src 转到 tgt 的色相需旋转量（带符号）
  if (Math.abs(dH) >= 8) {
    const dir = dH < 0 ? '逆时针' : '顺时针';
    texts.push(`色相对目标偏移约 ${Math.abs(dH).toFixed(0)}°，需${dir}清理混入的异色杂质。`);
  }
  const sGap = tgt.s - src.s;
  if (sGap > 0.08) {
    texts.push(`饱和度比目标低约 ${Math.round(sGap * 100)}%，去掉发灰发闷的杂色会显得更纯。`);
  } else if (sGap < -0.08) {
    texts.push('饱和度偏高，略降饱和以去掉刺眼的杂质感。');
  }
  const vGap = tgt.v - src.v;
  if (vGap > 0.08) {
    texts.push(`明度需提亮约 ${Math.round(vGap * 100)}%，去除偏黑的压抑感。`);
  } else if (vGap < -0.08) {
    texts.push(`明度需压低约 ${Math.round(-vGap * 100)}%，去掉偏白/过亮的杂色。`);
  }
  if (texts.length === 0) texts.push('颜色已很接近你在取色盘上选定的纯色，杂质很轻微。');
  return texts;
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * 生成把取样色 src 修正到取色盘目标色 tgt 的去杂色调色参数（映射为 CSS filter 算子）。
 * 所有幅度都限幅：色相旋转全局生效，过大会导致整图失真。
 * @returns {{hueRotate:number,saturate:number,brightness:number,contrast:number}}
 */
export function generateCleanupParams(src, tgt) {
  return {
    hueRotate: clamp(shortestHueDist(tgt.h, src.h), -20, 20),
    saturate: clamp(tgt.s / Math.max(src.s, 0.01), 0.85, 1.6),
    brightness: clamp(tgt.v / Math.max(src.v, 0.01), 0.85, 1.25),
    contrast: 1 + 0.15 * Math.max(0, tgt.s - src.s),
  };
}

/** 把去杂色参数拼成 CSS filter 片段 */
export function cleanupToCss(p) {
  if (!p) return '';
  return `hue-rotate(${p.hueRotate.toFixed(1)}deg) saturate(${p.saturate.toFixed(2)}) brightness(${p.brightness.toFixed(2)}) contrast(${p.contrast.toFixed(2)})`;
}

/** 基础电影暗调 look 转 CSS filter */
export function baseToCss(filter) {
  return `contrast(${filter.contrast}) saturate(${filter.sat}) brightness(${filter.bright}) sepia(${filter.sepia})`;
}

/** 最终滤镜链：所有调色记录的去杂色参数依次叠加，再叠电影底 */
export function makeCssFilter(filter, cleanups) {
  const list = Array.isArray(cleanups) ? cleanups : cleanups ? [cleanups] : [];
  const parts = [];
  for (const c of list) {
    const s = cleanupToCss(c);
    if (s) parts.push(s);
  }
  parts.push(baseToCss(filter));
  return parts.join(' ');
}