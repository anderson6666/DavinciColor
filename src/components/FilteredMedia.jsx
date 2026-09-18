import { makeCssFilter } from '../lib/color.js';

/**
 * 渲染已施加“电影暗调柔光”滤镜的图片或视频。
 * 滤镜用 CSS filter 链（GPU 合成，视频零逐帧开销）；
 * 暗角 = 径向渐变 multiply，黑色柔光 = 上下渐变 soft-light。
 */
export default function FilteredMedia({
  src,
  isVideo,
  filter,
  cleanups,
  elementRef,
  controls = true,
  autoPlay = true,
  onMediaReady,
  children,
}) {
  const cssFilter = makeCssFilter(filter, cleanups);
  const vidIntensity = (filter.vignette ?? 0.7) * 0.45;
  const softIntensity = (filter.softLight ?? 0.7) * 0.18;
  return (
    <div className="stage">
      {isVideo ? (
        <video
          ref={elementRef}
          className="stage-media"
          src={src}
          loop
          muted
          playsInline
          controls={controls}
          autoPlay={autoPlay}
          style={{ filter: cssFilter }}
          onLoadedMetadata={(e) => onMediaReady && onMediaReady(e.currentTarget)}
        />
      ) : (
        <img
          ref={elementRef}
          className="stage-media"
          src={src}
          draggable={false}
          style={{ filter: cssFilter }}
          onLoad={(e) => onMediaReady && onMediaReady(e.currentTarget)}
        />
      )}
      <div
        className="stage-vignette"
        style={{ opacity: Math.min(1, vidIntensity) }}
      />
      <div
        className="stage-softlight"
        style={{ opacity: Math.min(1, softIntensity) }}
      />
      {children}
    </div>
  );
}