import { useCallback, useEffect, useRef, useState } from 'react'

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4'
]

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return ''
  return MIME_CANDIDATES.find(t => MediaRecorder.isTypeSupported(t)) || ''
}

function pad(n) {
  return String(n).padStart(2, '0')
}

// 生成文件名时间戳，如 photo-20261013-101530
function stamp() {
  const d = new Date()
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatTime(ms) {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false })
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000)
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

export default function Camera() {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const startedAtRef = useRef(0)

  const [streaming, setStreaming] = useState(false)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [items, setItems] = useState([])
  const [active, setActive] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch('/api/media')
      if (!res.ok) throw new Error(res.statusText)
      setItems(await res.json())
    } catch (e) {
      setError('读取文件列表失败：' + e.message)
    }
  }, [])

  useEffect(() => {
    loadItems()
  }, [loadItems])

  // 组件卸载时释放摄像头资源
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  const startCamera = async () => {
    setError('')
    try {
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      } catch {
        // 没有麦克风时退化为仅视频
        stream = await navigator.mediaDevices.getUserMedia({ video: true })
      }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setStreaming(true)
    } catch (e) {
      setError('无法访问摄像头：' + e.message)
    }
  }

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setStreaming(false)
  }

  const upload = async (blob, name) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/media?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'application/octet-stream' },
        body: blob
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || res.statusText)
      }
      await loadItems()
    } catch (e) {
      setError('保存失败：' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const takePhoto = async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    if (blob) await upload(blob, `photo-${stamp()}`)
  }

  const startRecording = () => {
    if (!streamRef.current) return
    const mimeType = pickMime()
    if (!mimeType) {
      setError('当前浏览器不支持视频录制')
      return
    }
    chunksRef.current = []
    const recorder = new MediaRecorder(streamRef.current, { mimeType })
    recorder.ondataavailable = e => {
      if (e.data.size) chunksRef.current.push(e.data)
    }
    recorder.onstop = async () => {
      if (timerRef.current) clearInterval(timerRef.current)
      setRecording(false)
      setElapsed(0)
      const blob = new Blob(chunksRef.current, { type: mimeType })
      chunksRef.current = []
      if (blob.size) await upload(blob, `video-${stamp()}`)
    }
    recorder.start()
    recorderRef.current = recorder
    startedAtRef.current = Date.now()
    timerRef.current = setInterval(() => setElapsed(Date.now() - startedAtRef.current), 200)
    setRecording(true)
  }

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
  }

  const remove = async name => {
    if (!window.confirm(`确定删除 ${name}？`)) return
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(name)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(res.statusText)
      if (active?.name === name) setActive(null)
      await loadItems()
    } catch (e) {
      setError('删除失败：' + e.message)
    }
  }

  const openFolder = async () => {
    setError('')
    try {
      const res = await fetch('/api/open-folder', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || res.statusText)
      }
    } catch (e) {
      setError('打开文件夹失败：' + e.message)
    }
  }

  return (
    <div className="camera-page">
      <section className="camera-stage">
        <div className="stage-head">
          <h2>摄像头</h2>
          {recording && <span className="rec-dot">● REC {formatDuration(elapsed)}</span>}
        </div>

        <div className="preview">
          <video ref={videoRef} playsInline muted />
          {!streaming && <div className="preview-placeholder">摄像头未开启</div>}
        </div>

        <div className="controls">
          {!streaming ? (
            <button className="btn primary" onClick={startCamera}>
              开启摄像头
            </button>
          ) : (
            <button className="btn" onClick={stopCamera} disabled={recording}>
              关闭摄像头
            </button>
          )}
          <button className="btn primary" onClick={takePhoto} disabled={!streaming || recording || busy}>
            拍照
          </button>
          {!recording ? (
            <button className="btn danger" onClick={startRecording} disabled={!streaming || busy}>
              开始录制
            </button>
          ) : (
            <button className="btn danger" onClick={stopRecording}>
              停止录制
            </button>
          )}
          {busy && <span className="muted">保存中…</span>}
        </div>

        {error && <div className="error">{error}</div>}
      </section>

      <aside className="result-panel">
        <div className="panel-head">
          <h3>
            结果文件 <span className="count">{items.length}</span>
          </h3>
          <div className="panel-actions">
            <button className="btn small" onClick={loadItems}>
              刷新
            </button>
            <button className="btn small" onClick={openFolder}>
              打开文件夹
            </button>
          </div>
        </div>

        <div className="list">
          {items.length === 0 && <div className="empty">暂无文件，拍照或录制后会显示在这里</div>}
          {items.map(it => (
            <div key={it.name} className="item" onClick={() => setActive(it)}>
              <div className="thumb">
                {it.type === 'image' ? (
                  <img src={it.url} alt={it.name} />
                ) : (
                  <span className="video-badge">▶</span>
                )}
              </div>
              <div className="meta">
                <div className="name" title={it.name}>
                  {it.name}
                </div>
                <div className="sub">
                  {it.type === 'image' ? '图片' : '视频'} · {formatSize(it.size)}
                </div>
                <div className="sub">{formatTime(it.createdAt)}</div>
              </div>
              <button
                className="btn tiny danger"
                onClick={e => {
                  e.stopPropagation()
                  remove(it.name)
                }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      </aside>

      {active && (
        <div className="modal" onClick={() => setActive(null)}>
          <div className="modal-body" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <span className="name" title={active.name}>
                {active.name}
              </span>
              <div className="panel-actions">
                <a className="btn small" href={active.url} download={active.name}>
                  下载
                </a>
                <button className="btn small danger" onClick={() => remove(active.name)}>
                  删除
                </button>
                <button className="btn small" onClick={() => setActive(null)}>
                  关闭
                </button>
              </div>
            </div>
            <div className="modal-media">
              {active.type === 'image' ? (
                <img src={active.url} alt={active.name} />
              ) : (
                <video src={active.url} controls autoPlay playsInline />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
