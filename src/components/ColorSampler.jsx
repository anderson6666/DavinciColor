/**
 * 点击处取样框与十字准星。sx/sy 为相对舞台的显示坐标，单位 px。
 */
export default function ColorSampler({ sample }) {
  const { x, y, boxW = 24, boxH = 24, rgb } = sample;
  const style = {
    left: x,
    top: y,
    width: boxW,
    height: boxH,
    transform: 'translate(-50%, -50%)',
  };
  return (
    <div className="sampler" style={style}>
      <span className="sampler-box" />
      <span className="sampler-cross c1" />
      <span className="sampler-cross c2" />
      <span className="sampler-dot" style={{ background: `rgb(${rgb.r},${rgb.g},${rgb.b})` }} />
    </div>
  );
}