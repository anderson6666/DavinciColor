import { useRef } from 'react';

const defaultFilter = { contrast: 1.05, sat: 0.86, bright: 0.95, sepia: 0.04, vignette: 0.7, softLight: 1 };

/**
 * 拖拽/点击上传图片或视频。
 */
export default function Uploader({ onFile }) {
  const inputRef = useRef(null);

  function acceptFile(file) {
    if (!file) return;
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) {
      alert('仅支持图片(jpg/png/webp/gif) 或视频(mp4/webm) 文件。');
      return;
    }
    onFile(file, isVideo);
  }

  function handleDrop(e) {
    e.preventDefault();
    acceptFile(e.dataTransfer.files && e.dataTransfer.files[0]);
  }

  return (
    <section
      className="uploader"
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {}}
      onDrop={handleDrop}
      onClick={() => inputRef.current && inputRef.current.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          acceptFile(e.target.files && e.target.files[0]);
          e.target.value = '';
        }}
      />
      <div className="uploader-icon">✦</div>
      <p className="uploader-main">拖入或点击上传 图片 / 视频</p>
      <p className="uploader-sub">jpg · png · webp · gif · mp4 · webm</p>
    </section>
  );
}

export { defaultFilter };