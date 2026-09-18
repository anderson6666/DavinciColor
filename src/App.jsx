import { useState } from 'react';
import Uploader, { defaultFilter } from './components/Uploader.jsx';
import MediaStage from './components/MediaStage.jsx';
import {
  makeObjectURL,
  revokeObjectURL,
  renderFiltered,
  exportFilteredVideo,
  downloadUrl,
  downloadBlob,
  extractAutoSamples,
} from './lib/media.js';
import { impurityReport, generateCleanupParams, autoTarget, autoGradeFromSamples } from './lib/color.js';

let uid = 0;

export default function App() {
  const [source, setSource] = useState(null);
  const filter = defaultFilter;
  const [adjustments, setAdjustments] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [grading, setGrading] = useState(false);

  const active = adjustments.find((a) => a.id === activeId) || adjustments[adjustments.length - 1] || null;
  // 所有调色记录叠加
  const cleanups = adjustments.map((a) => a.cleanup).filter(Boolean);

  function handleFile(file, isVideo) {
    if (source && source.url) revokeObjectURL(source.url);
    setSource({ url: makeObjectURL(file), isVideo });
    setAdjustments([]);
    setActiveId(null);
  }

  function handleSample(s, auto) {
    const id = ++uid;
    const tgt = auto ? autoTarget(s.hsv) : null;
    setAdjustments((list) => [
      ...list,
      {
        id,
        ...s,
        target: tgt,
        report: tgt ? impurityReport(s.hsv, tgt) : null,
        cleanup: tgt ? generateCleanupParams(s.hsv, tgt) : null,
      },
    ]);
    setActiveId(id);
  }

  function handleWheel(id, targetHsv) {
    setAdjustments((list) =>
      list.map((a) =>
        a.id === id
          ? {
              ...a,
              target: targetHsv,
              report: impurityReport(a.hsv, targetHsv),
              cleanup: generateCleanupParams(a.hsv, targetHsv),
            }
          : a
      )
    );
  }

  function handleDelete(id) {
    setAdjustments((list) => {
      const rest = list.filter((a) => a.id !== id);
      if (activeId === id) setActiveId(rest.length ? rest[rest.length - 1].id : null);
      return rest;
    });
  }

  // 一键调色：全片抽帧 + 网格多点取色 → 分色系线性优化，合并为一条调色
  async function handleAutoGrade() {
    if (!source || exporting || grading) return;
    setGrading(true);
    try {
      const { colors, frames, points } = await extractAutoSamples(source.url, source.isVideo);
      const result = autoGradeFromSamples(colors);
      if (!result) {
        alert('未检测到需要修正的明显杂色，画面颜色已经很纯。');
        return;
      }
      const id = ++uid;
      setAdjustments((list) => [
        ...list,
        {
          id,
          auto: true,
          rgb: result.represent.rgb,
          hsv: result.represent.hsv,
          target: null,
          report: null,
          cleanup: result.cleanup,
          buckets: result.buckets,
          frames,
          points,
        },
      ]);
      setActiveId(id);
    } catch (e) {
      alert('自动调色失败：素材可能尚未加载完成。');
    } finally {
      setGrading(false);
    }
  }

  // 导出：视频 → webm（实时录制，带进度）；图片 → PNG
  async function handleExport() {
    if (!source || exporting) return;
    setExporting(true);
    setProgress(0);
    const ts = new Date().toISOString().replace(/[:.-]/g, '').slice(0, 15);
    try {
      if (source.isVideo) {
        const blob = await exportFilteredVideo(source.url, filter, cleanups, setProgress);
        downloadBlob(blob, `graded-${ts}.webm`);
      } else {
        const url = await renderFiltered(source.url, filter, cleanups);
        if (!url) throw new Error('render failed');
        downloadUrl(url, `graded-${ts}.png`);
      }
    } catch (e) {
      alert('导出失败：素材可能尚未加载完成，或浏览器不支持视频录制。');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>调色工坊</h1>
        {source && (
          <button className="btn-ghost" onClick={() => setSource(null)}>更换素材</button>
        )}
      </header>

      {!source ? (
        <main className="landing">
          <Uploader onFile={handleFile} />
        </main>
      ) : (
        <main className="workspace">
          <MediaStage
            src={source.url}
            isVideo={source.isVideo}
            filter={filter}
            cleanups={cleanups}
            active={active}
            adjustments={adjustments}
            onSample={handleSample}
            onWheel={handleWheel}
            onActivate={setActiveId}
            onDelete={handleDelete}
            onExport={handleExport}
            exporting={exporting}
            progress={progress}
            onAutoGrade={handleAutoGrade}
            grading={grading}
          />
        </main>
      )}
    </div>
  );
}