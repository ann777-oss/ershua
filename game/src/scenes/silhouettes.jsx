// 人物剪影（P0 占位；P5 按 design.md §11 替换为 AI 生成证件照）
export default function SceneSilhouette({ id }) {
  const fill = { chenmo: '#5a5346', zhoulan: '#6a6152', xiaoya: '#57504a' }[id] || '#5a5346'
  const head = id === 'zhoulan'
    ? <ellipse cx="50" cy="38" rx="14" ry="16" fill={fill} />
    : <ellipse cx="50" cy="36" rx="14" ry="16" fill={fill} />
  return (
    <svg viewBox="0 0 100 112" style={{ width: 48 }}>
      {head}
      <path d="M20 112 C20 78 30 62 50 60 C70 62 80 78 80 112 Z" fill={fill} />
    </svg>
  )
}
