import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { io } from 'socket.io-client'

const CARDS = [
  '?', '☕', '0', '0.5', '1', '1.5', '2', '2.5',
  '3', '3.5', '4', '4.5', '5', '5.5', '6', '6.5',
  '7', '8', '13', '20', '40', '100'
]

const NAME_KEY = 'scrum-poker:name'

const randomName = () => `玩家${Math.floor(1000 + Math.random() * 9000)}`
const randomRoom = () => String(Math.floor(10000000 + Math.random() * 90000000))
const formatRoom = id => id.replace(/(\d{2})(?=\d)/g, '$1 ')
const sanitizeRoom = raw => String(raw || '').replace(/\D/g, '').slice(0, 8)

export default function ScrumPoker() {
  const socketRef = useRef(null)
  const latest = useRef({ room: null, name: '' })
  const [searchParams, setSearchParams] = useSearchParams()

  // 首次渲染时记录 URL 中的房间号与已保存的名字，用于自动加入邀请链接
  const savedNameRef = useRef(localStorage.getItem(NAME_KEY) || '')
  const inviteRoomRef = useRef(sanitizeRoom(searchParams.get('room') || ''))
  const autoJoinRef = useRef(false)
  const inviteRoom = sanitizeRoom(searchParams.get('room') || '')

  const [connected, setConnected] = useState(false)
  const [room, setRoom] = useState(null)
  const [name, setName] = useState(() => savedNameRef.current || randomName())
  const [roomInput, setRoomInput] = useState(() => inviteRoomRef.current)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  latest.current = { room, name }

  useEffect(() => {
    const socket = io()
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      setError('')
      const { room: current, name: currentName } = latest.current
      if (current) {
        // 断线重连后自动回到原房间
        socket.emit('poker:join', { roomId: current.roomId, name: currentName })
      } else if (!autoJoinRef.current && inviteRoomRef.current && savedNameRef.current) {
        // 通过邀请链接进入且已有名字时，自动加入
        autoJoinRef.current = true
        socket.emit('poker:join', { roomId: inviteRoomRef.current, name: currentName }, res => {
          if (res?.error) setError(res.error)
        })
      }
    })
    socket.on('disconnect', () => setConnected(false))
    socket.on('poker:state', state => setRoom(state))
    socket.on('connect_error', () => setError('无法连接服务器，请确认后端已启动'))

    return () => {
      socket.disconnect()
      socketRef.current = null
      autoJoinRef.current = false
    }
  }, [])

  // 加入房间后把房间号同步到 URL，分享地址即可邀请他人
  useEffect(() => {
    if (!room || searchParams.get('room') === room.roomId) return
    const next = new URLSearchParams(searchParams)
    next.set('room', room.roomId)
    setSearchParams(next, { replace: true })
  }, [room?.roomId])

  const enterRoom = id => {
    const roomId = sanitizeRoom(id)
    if (!roomId) {
      setError('请输入房间号')
      return
    }
    if (!socketRef.current?.connected) {
      setError('尚未连接服务器，请稍后重试')
      return
    }
    setError('')
    localStorage.setItem(NAME_KEY, name.trim() || '匿名玩家')
    socketRef.current.emit('poker:join', { roomId, name }, res => {
      if (res?.error) setError(res.error)
    })
  }

  const createRoom = () => {
    const roomId = randomRoom()
    setRoomInput(roomId)
    enterRoom(roomId)
  }

  const leaveRoom = () => {
    socketRef.current?.emit('poker:leave')
    setRoom(null)
    setRoomInput('')
    // 清除 URL 中的房间号，避免刷新后又被自动加入
    const next = new URLSearchParams(searchParams)
    next.delete('room')
    setSearchParams(next, { replace: true })
  }

  const vote = card => {
    if (!room || room.revealed) return
    socketRef.current?.emit('poker:vote', { card })
  }

  const copyInviteLink = async () => {
    const url = new URL(window.location.href)
    url.searchParams.set('room', room.roomId)
    try {
      await navigator.clipboard.writeText(url.toString())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('复制失败，请手动复制地址栏链接')
    }
  }

  const votedCount = useMemo(
    () => room?.participants.filter(p => p.hasVoted).length || 0,
    [room]
  )

  if (!room) {
    return (
      <div className="poker-page poker-page-center">
        <div className="poker-lobby">
          <div className="poker-logo">♠</div>
          <h1>{inviteRoom ? '加入房间' : 'Scrum Poker'}</h1>
          <p className="muted">
            {inviteRoom ? (
              <>
                房间 <strong className="room-code">{formatRoom(inviteRoom)}</strong>
                ，填写名字即可加入。
              </>
            ) : (
              '多人实时敏捷估点，输入房间号即可加入。'
            )}
          </p>

          <form
            className="poker-form"
            onSubmit={e => {
              e.preventDefault()
              enterRoom(inviteRoom || roomInput)
            }}
          >
            <label>
              <span>你的名字</span>
              <input
                value={name}
                maxLength={20}
                onChange={e => setName(e.target.value)}
                placeholder="请输入名字"
              />
            </label>
            {!inviteRoom && (
              <label>
                <span>房间号</span>
                <input
                  value={roomInput}
                  inputMode="numeric"
                  onChange={e => setRoomInput(e.target.value)}
                  placeholder="输入数字房间号，如 48459681"
                />
              </label>
            )}
            <div className="poker-form-actions">
              <button type="submit" className="btn primary" disabled={!connected}>
                进入房间
              </button>
              {!inviteRoom && (
                <button type="button" className="btn" onClick={createRoom} disabled={!connected}>
                  随机创建房间
                </button>
              )}
            </div>
          </form>

          {!connected && <div className="muted small-note">正在连接服务器…</div>}
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    )
  }

  const isHost = room.you.isHost
  const myVote = room.you.vote

  return (
    <div className="poker-page">
      <header className="poker-header">
        <div className="poker-brand">
          <span className="poker-logo small">♠</span>
          <span>Scrum Poker</span>
        </div>
        <div className="poker-room-info">
          <span className="muted">房间</span>
          <strong className="room-code">{formatRoom(room.roomId)}</strong>
          <button className="btn tiny" onClick={copyInviteLink}>
            {copied ? '已复制' : '复制邀请链接'}
          </button>
          <button className="btn tiny" onClick={leaveRoom}>
            退出
          </button>
        </div>
      </header>

      {!connected && <div className="error">连接已断开，正在自动重连…</div>}
      {error && <div className="error">{error}</div>}

      <section className="poker-section">
        <div className="poker-section-head">
          <div>
            <h2>请选择一张卡片估点</h2>
            <p className="muted">
              {myVote != null ? `你已选择 ${myVote}，揭晓前可随时更改` : '选择最接近任务工作量的点数'}
            </p>
          </div>
          <span className="poker-progress" title="已选择人数">
            <span className="status-icon voted">✓</span>
            {votedCount}/{room.participants.length}
          </span>
        </div>

        <div className={`poker-cards ${room.revealed ? 'locked' : ''}`}>
          {CARDS.map(card => (
            <button
              key={card}
              type="button"
              className={`poker-card ${myVote === card ? 'selected' : ''}`}
              onClick={() => vote(card)}
              disabled={room.revealed}
            >
              {card}
            </button>
          ))}
        </div>
      </section>

      <section className="poker-section">
        <div className="poker-section-head">
          <div>
            <h2>揭晓卡片</h2>
            <p className="muted">
              {room.revealed
                ? '结果已揭晓，主持人可隐藏或删除估点'
                : isHost
                  ? '大家选择后，由你统一揭晓'
                  : '等待主持人揭晓结果'}
            </p>
          </div>
          <div className="panel-actions">
            {isHost ? (
              room.revealed ? (
                <>
                  <button className="btn small" onClick={() => socketRef.current?.emit('poker:hide')}>
                    隐藏
                  </button>
                  <button
                    className="btn small danger"
                    onClick={() => socketRef.current?.emit('poker:reset')}
                  >
                    删除估点
                  </button>
                </>
              ) : (
                <button
                  className="btn primary"
                  onClick={() => socketRef.current?.emit('poker:reveal')}
                >
                  揭晓卡片
                </button>
              )
            ) : (
              <span className="muted">主持人：{room.participants.find(p => p.isHost)?.name}</span>
            )}
          </div>
        </div>

        <div className="poker-results">
          <table className="poker-table">
            <thead>
              <tr>
                <th>参与者</th>
                <th className="points-col">故事点</th>
              </tr>
            </thead>
            <tbody>
              {room.participants.map(p => (
                <tr key={p.id} className={p.id === room.you.id ? 'me' : ''}>
                  <td>
                    <span className="avatar">{p.name.slice(0, 1)}</span>
                    <span className="participant-name">{p.name}</span>
                    {p.isHost && <span className="tag">主持人</span>}
                    {p.id === room.you.id && <span className="tag me-tag">你</span>}
                  </td>
                  <td className="points-col">
                    {room.revealed ? (
                      p.vote != null ? (
                        <strong className="points">{p.vote}</strong>
                      ) : (
                        <span className="muted">未选择</span>
                      )
                    ) : p.hasVoted ? (
                      <span className="status-icon voted" title="已选择" aria-label="已选择">
                        ✓
                      </span>
                    ) : (
                      <span className="status-icon" title="未选择" aria-label="未选择">
                        …
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
