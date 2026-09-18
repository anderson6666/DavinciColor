import { useEffect, useRef, useState } from 'react';
import FilteredMedia from './FilteredMedia.jsx';
import ColorSampler from './ColorSampler.jsx';
import ColorWheel from './ColorWheel.jsx';
import { eventToMedia, sampleAverage, fitInfo } from '../lib/media.js';
import { rgbToHsv, hsvToRgb } from '../lib/color.js';

/**
 * 交互舞台：显示滤镜化媒体，支持点击取色。每次点击新增一条“调色记录”，
 * 所有记录的调色自动叠加；可切换、删除。“一键调色”按明度/色相/纯度温和优化。
 */
export default function MediaStage({
  src,
  isVideo,
  filter,
  cleanups,
  active,
  adjustments,
  onSample,
  onWheel,
  onActivate,
  onDelete,
  onExport,
  exporting,
  progress,
  onAutoGrade,
  grading,
}) {
  const mediaRef = useRef(null);
  const stageRef = useRef(null);
  const wheelRef = useRef(null);
  const [mediaSize, setMediaSize] = useState(null);

  // 新取样/切换记录时，把取色盘滚动进可视区
  useEffect(() => {
    if (active && wheelRef.current) {
      wheelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active && active.id]);

  function dims(el) {
    return { mw: el.naturalWidth || el.videoWidth || 0, mh: el.naturalHeight || el.videoHeight || 0 };
  }

  // 记录素材原始尺寸：舞台按素材比例、且不超过原始像素显示，避免放大出现小色块
  function handleMediaReady(el) {
    const { mw, mh } = dims(el);
    if (mw && mh) setMediaSize({ w: mw, h: mh });
  }

  function handlePointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    // 点击视频自带控制条时不取色
    if (e.target && e.target.tagName === 'VIDEO') {
      const vr = e.target.getBoundingClientRect();
      if (vr.bottom - e.clientY < 56) return;
    }
    const el = mediaRef.current;
    if (!el || !stageRef.current) return;
    const { mw, mh } = dims(el);
    if (!mw || !mh) return;

    const rect = stageRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { sx, sy } = eventToMedia(x, y, rect.width, rect.height, mw, mh);
    const avg = sampleAverage(el, sx, sy, 5);
    if (!avg) return;

    const { scale } = fitInfo(rect.width, rect.height, mw, mh);
    onSample({
      x: Math.round(x),
      y: Math.round(y),
      boxW: avg.sampleBoxW * scale,
      boxH: avg.sampleBoxH * scale,
      rgb: { r: avg.r, g: avg.g, b: avg.b },
      hsv: rgbToHsv(avg.r, avg.g, avg.b),
    });
  }

  const stageStyle = mediaSize
    ? { aspectRatio: `${mediaSize.w} / ${mediaSize.h}`, maxWidth: `${mediaSize.w}px` }
    : undefined;

  return (
    <div className="stage-wrap">
      <div
        className="stage stage--interactive"
        style={stageStyle}
        ref={stageRef}
        onPointerDown={handlePointerDown}
      >
        <FilteredMedia
          src={src}
          isVideo={isVideo}
          filter={filter}
          cleanups={cleanups}
          elementRef={mediaRef}
          onMediaReady={handleMediaReady}
        />
        {active && <ColorSampler sample={active} rgb={active.rgb} />}
      </div>

      <div className="stage-toolbar">
        <p className="hint">点击画面上的物体提取颜色，在取色盘上选择它本该是的颜色；所有调色自动叠加。</p>
        <div className="stage-actions">
          <button className="btn-mini" onClick={onAutoGrade} disabled={grading || exporting}>
            {grading ? '分析中…' : '一键调色'}
          </button>
          <button className="btn-mini btn-outline" onClick={onExport} disabled={exporting || grading}>
            {exporting ? `导出中 ${Math.round(progress * 100)}%` : isVideo ? '导出视频' : '导出图片'}
          </button>
        </div>
      </div>

      {adjustments.length > 0 && (
        <div className="adjust-bar">
          <span className="adjust-label">调色记录</span>
          {adjustments.map((a) => {
            const rgb = !a.target ? a.rgb : hsvToRgb(a.target.h, a.target.s, a.target.v);
            return (
              <span
                key={a.id}
                className={`adjust-chip ${a.id === active.id ? 'is-active' : ''}`}
                onClick={() => onActivate(a.id)}
              >
                <span className="adjust-swatch" style={{ background: `rgb(${rgb.r},${rgb.g},${rgb.b})` }} />
                <span className="adjust-del" onClick={(e) => { e.stopPropagation(); onDelete(a.id); }}>
                  ×
                </span>
              </span>
            );
          })}
        </div>
      )}

      {active && (
        <div className="wheel-card" key={`w-${active.id}`} ref={wheelRef}>
          {active.auto ? (
            <div className="auto-grade">
              <div className="report-head">
                <h3>一键调色 · 已叠加</h3>
                <button className="btn-ghost" onClick={() => onDelete(active.id)}>删除</button>
              </div>
              <p className="auto-meta">
                抽取 {active.frames} 帧 · {active.points} 个取样点 · 智能识别 {active.buckets.length} 种杂色 · 非线性优化修正
              </p>
              <ul className="report-list">
                {active.buckets.map((b, i) => (
                  <li key={i}>
                    <i className="bucket-dot" style={{ background: b.hex }} />
                    {b.name}：{b.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <ColorWheel
                sampledHsv={active.hsv}
                initialTarget={active.target}
                sampledRgb={active.rgb}
                onSelect={(t) => onWheel(active.id, t)}
              />
              {active.report && (
                <div className="report">
                  <div className="report-head">
                    <h3>杂色分析</h3>
                    <button className="btn-ghost" onClick={() => onDelete(active.id)}>删除该取样</button>
                  </div>
                  <ul className="report-list">
                    {active.report.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}