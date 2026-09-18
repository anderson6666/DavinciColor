// 媒体工具：文件转 URL、object-fit:contain 坐标换算、离屏取样、滤镜导出
import { makeCssFilter, rgbToHsv } from './color.js';

/** 由 File 生成对象 URL */
export function makeObjectURL(file) {
  return URL.createObjectURL(file);
}

/** 释放对象 URL */
export function revokeObjectURL(url) {
  if (url) URL.revokeObjectURL(url);
}

/** object-fit:contain 适配信息 */
export function fitInfo(stageW, stageH, mw, mh) {
  const scale = Math.min(stageW / mw, stageH / mh);
  const drawW = mw * scale;
  const drawH = mh * scale;
  const ox = (stageW - drawW) / 2;
  const oy = (stageH - drawH) / 2;
  return { scale, ox, oy, drawW, drawH };
}

/** 舞台坐标 → 媒体源像素坐标 */
export function eventToMedia(x, y, stageW, stageH, mw, mh) {
  const { scale, ox, oy } = fitInfo(stageW, stageH, mw, mh);
  return { sx: Math.round((x - ox) / scale), sy: Math.round((y - oy) / scale) };
}

// 取样复用的离屏 canvas
const sampleCanvas = document.createElement('canvas');

/** 从可绘制元素取 (sx,sy) 为中心的方形区域平均色（未滤镜原始帧） */
export function sampleAverage(el, sx, sy, radius = 5) {
  const size = radius * 2 + 1;
  const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  sampleCanvas.width = size;
  sampleCanvas.height = size;
  try {
    ctx.drawImage(el, sx - radius, sy - radius, size, size, 0, 0, size, size);
    const d = ctx.getImageData(0, 0, size, size).data;
    let r = 0, g = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
    }
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), sampleBoxW: size, sampleBoxH: size };
  } catch (e) {
    return null;
  }
}

/** 加载媒体元素（图片/视频），尺寸就绪后 resolve */
function loadMedia(src, isVideo) {
  return new Promise((resolve, reject) => {
    const el = isVideo ? document.createElement('video') : new Image();
    const ok = () => {
      const mw = el.videoWidth || el.naturalWidth || 0;
      const mh = el.videoHeight || el.naturalHeight || 0;
      if (!mw || !mh) return reject(new Error('no size'));
      resolve(el);
    };
    el.addEventListener(isVideo ? 'loadeddata' : 'load', ok, { once: true });
    el.addEventListener('error', () => reject(new Error('load error')), { once: true });
    el.muted = isVideo;
    el.src = src;
  });
}

/** 把视频 seek 到指定时间并等待画面就绪 */
function seekTo(el, t) {
  return new Promise((res) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener('seeked', finish);
      res();
    };
    el.addEventListener('seeked', finish);
    try {
      el.currentTime = t;
    } catch (e) {
      finish();
    }
    setTimeout(finish, 500);
  });
}

/**
 * 一键调色取样：视频在整段时间轴上抽多帧，图片取当前帧；
 * 每帧按网格分布取多个样点，返回全部颜色（RGB + HSV）。
 */
export async function extractAutoSamples(src, isVideo, opts = {}) {
  const frames = isVideo ? Math.max(2, Math.min(opts.frames ?? 16, 24)) : 1;
  const grid = opts.grid ?? 4;
  const el = await loadMedia(src, isVideo);
  const mw = el.videoWidth || el.naturalWidth || 0;
  const mh = el.videoHeight || el.naturalHeight || 0;
  const colors = [];
  if (mw && mh) {
    for (let i = 0; i < frames; i++) {
      if (isVideo) {
        const d = el.duration;
        const t = d && isFinite(d) ? Math.min(d - 0.05, (d * (i + 0.5)) / frames) : 0;
        await seekTo(el, t);
      }
      for (let gy = 0; gy < grid; gy++) {
        for (let gx = 0; gx < grid; gx++) {
          const sx = Math.round((mw * (gx + 0.5)) / grid);
          const sy = Math.round((mh * (gy + 0.5)) / grid);
          const avg = sampleAverage(el, sx, sy, 6);
          if (avg) colors.push({ rgb: { r: avg.r, g: avg.g, b: avg.b }, hsv: rgbToHsv(avg.r, avg.g, avg.b) });
        }
      }
    }
    if (isVideo) el.pause();
  }
  return { colors, frames, points: colors.length };
}

/** 把一帧按“调色叠加 + 暗角 + 黑色柔光”绘制到 ctx */
function drawFilteredFrame(ctx, el, cw, ch, filter, cleanups) {
  ctx.filter = makeCssFilter(filter, cleanups);
  ctx.drawImage(el, 0, 0, cw, ch);
  ctx.filter = 'none';

  // 暗角（multiply 近似）
  ctx.globalCompositeOperation = 'multiply';
  const vg = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.42, cw / 2, ch / 2, Math.max(cw, ch) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, `rgba(0,0,0,${(filter.vignette ?? 0.7) * 0.55})`);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, cw, ch);

  // 黑色柔光（soft-light 近似；不支持则回落）
  if ('soft-light' in ctx) ctx.globalCompositeOperation = 'soft-light';
  else ctx.globalCompositeOperation = 'source-over';
  const sg = ctx.createLinearGradient(0, 0, 0, ch);
  const al = (filter.softLight ?? 0.7) * 0.25;
  sg.addColorStop(0, `rgba(0,0,0,${al})`);
  sg.addColorStop(0.32, 'rgba(0,0,0,0)');
  sg.addColorStop(0.68, 'rgba(0,0,0,0)');
  sg.addColorStop(1, `rgba(0,0,0,${al})`);
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, cw, ch);
  ctx.globalCompositeOperation = 'source-over';
}

/** 导出图片：应用全部调色后输出 PNG 数据 URL */
export async function renderFiltered(src, filter, cleanups) {
  const el = await loadMedia(src, false).catch(() => null);
  if (!el) return null;
  const mw = el.naturalWidth;
  const mh = el.naturalHeight;
  if (!mw || !mh) return null;
  const c = document.createElement('canvas');
  c.width = mw;
  c.height = mh;
  drawFilteredFrame(c.getContext('2d'), el, mw, mh, filter, cleanups);
  return c.toDataURL('image/png');
}

/**
 * 导出视频：逐帧套用全部调色，用 MediaRecorder 录制为 webm，并带上源素材的音频。
 * 录制为实时时长，onProgress(0~1) 汇报进度。
 */
export async function exportFilteredVideo(src, filter, cleanups, onProgress) {
  const el = await loadMedia(src, true);
  const mw = el.videoWidth;
  const mh = el.videoHeight;
  if (!mw || !mh) throw new Error('no video size');
  const c = document.createElement('canvas');
  c.width = mw;
  c.height = mh;
  const ctx = c.getContext('2d');
  const stream = c.captureStream(30);

  // 保留源素材的声音：解除 muted（muted 会让 captureStream 的音频轨道变成静音），
  // 音量拉到 0 避免导出过程中外放；把素材的音频轨道并入录制流。
  el.muted = false;
  el.volume = 0;
  if (!el.parentNode) {
    el.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0;';
    document.body.appendChild(el);
  }
  try {
    const ms = el.captureStream ? el.captureStream() : el.mozCaptureStream && el.mozCaptureStream();
    const audioTracks = (ms && ms.getAudioTracks()) || [];
    for (const t of audioTracks) stream.addTrack(t);
  } catch (e) {
    /* 素材无音频或浏览器不支持时不阻塞视频导出 */
  }

  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(
    (m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)
  );
  if (!mime) throw new Error('MediaRecorder unsupported');
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12000000 });
  const chunks = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise((res) => {
    rec.onstop = res;
  });

  if (el.currentTime > 0) {
    el.currentTime = 0;
    await new Promise((res) => el.addEventListener('seeked', res, { once: true }));
  }
  rec.start(250);
  await el.play();
  const ended = new Promise((res) => el.addEventListener('ended', res, { once: true }));
  const tick = () => {
    drawFilteredFrame(ctx, el, mw, mh, filter, cleanups);
    if (onProgress && el.duration > 0) onProgress(Math.min(1, el.currentTime / el.duration));
    if (!el.ended) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  await ended;
  await new Promise((r) => setTimeout(r, 300));
  rec.stop();
  await stopped;
  el.pause();
  return new Blob(chunks, { type: mime });
}

/** 触发浏览器下载（dataURL 或 blob URL） */
export function downloadUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}