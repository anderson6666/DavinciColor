import { useEffect, useRef, useState } from 'react';
import { defaultPureTarget, hsvToRgb } from '../lib/color.js';

/**
 * 取色盘：用户在色相环上点选 + 纯度/明度滑杆，选定一个"目标纯色"。
 * 反复触发 onSelect(目标hsv)，用于和提取到的取样色做杂色对比。
 */
export default function ColorWheel({ sampledHsv, initialTarget, sampledRgb, onSelect }) {
  const [target, setTarget] = useState(() => initialTarget || defaultPureTarget(sampledHsv));
  const ringRef = useRef(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    onSelect(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // 目标色被外部更新（如“一键调色”）时同步到取色盘
  useEffect(() => {
    if (initialTarget) setTarget(initialTarget);
  }, [initialTarget]);

  function setHueFromPointer(e) {
    const el = ringRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy; // y 向下，0 角在正上、顺时针
    const ang = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const h = (ang + 360) % 360;
    setTarget((t) => ({ ...t, h }));
  }

  function onRingDown(e) {
    e.preventDefault();
    draggingRef.current = true;
    setHueFromPointer(e);
    ringRef.current && ringRef.current.setPointerCapture(e.pointerId);
  }
  function onRingMove(e) {
    if (draggingRef.current) setHueFromPointer(e);
  }
  function onRingUp(e) {
    draggingRef.current = false;
    ringRef.current && ringRef.current.releasePointerCapture(e.pointerId);
  }

  const rgb = hsvToRgb(target.h, target.s, target.v);
  const hex =
    '#' +
    [rgb.r, rgb.g, rgb.b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

  // 色相盘标记位置：h→角度(0在正上，顺时针)，标记落在色环最外圈
  const hrad = (target.h * Math.PI) / 180;
  const markerX = 50 + 38 * Math.sin(hrad); // 半径 % 略小于环中心
  const markerY = 50 - 38 * Math.cos(hrad);

  return (
    <div className="wheel">
      <div className="wheel-head">
        <span className="swatch" style={{ background: `rgb(${sampledRgb.r},${sampledRgb.g},${sampledRgb.b})` }} />
        <span>提取到的颜色 → 在取色盘上拖到它「本该是」的纯色</span>
        <span className="swatch swatch-tgt" style={{ background: `hsl(${target.h} ${target.s * 100}% ${target.v * 100}%)` }} />
      </div>

      <div className="wheel-body">
        <div
          ref={ringRef}
          className="wheel-ring"
          style={{ background: `conic-gradient(hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))` }}
          onPointerDown={onRingDown}
          onPointerMove={onRingMove}
          onPointerUp={onRingUp}
        >
          <span className="wheel-center" />
          <span className="wheel-marker" style={{ left: `${markerX}%`, top: `${markerY}%` }} />
        </div>

        <div className="wheel-sliders">
          <label className="ctrl">
            <span>纯度 <em>{Math.round(target.s * 100)}%</em></span>
            <input type="range" min="0" max="1" step="0.01" value={target.s}
              onChange={(e) => setTarget((t) => ({ ...t, s: parseFloat(e.target.value) }))} />
          </label>
          <label className="ctrl">
            <span>明度 <em>{Math.round(target.v * 100)}%</em></span>
            <input type="range" min="0" max="1" step="0.01" value={target.v}
              onChange={(e) => setTarget((t) => ({ ...t, v: parseFloat(e.target.value) }))} />
          </label>
          <div className="wheel-hex">{hex}</div>
        </div>
      </div>
    </div>
  );
}