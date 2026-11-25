import { Link } from 'react-router-dom'

const tools = [
  {
    path: '/camera',
    title: '摄像头拍摄',
    desc: '调用电脑摄像头拍照、录制视频，结果本地存储，可查看与删除。'
  },
  {
    path: '/scrum-poker',
    title: 'Scrum Poker',
    desc: '多人实时敏捷估点，创建或输入房间号，各自选择后由主持人揭晓。'
  }
]

export default function Home() {
  return (
    <div className="home">
      <h1>功能页面</h1>
      <p className="muted">下面是可以使用的功能，点击进入。</p>
      <div className="tool-grid">
        {tools.map(t => (
          <Link key={t.path} to={t.path} className="tool-card">
            <h3>{t.title}</h3>
            <p>{t.desc}</p>
            <span className="enter">进入 →</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
