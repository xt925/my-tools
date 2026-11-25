import express from 'express'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { exec } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Server } from 'socket.io'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_DIR = path.join(__dirname, '..', 'storage')
const DIST_DIR = path.join(__dirname, '..', 'dist')
const PORT = process.env.PORT || 3001

fs.mkdirSync(STORAGE_DIR, { recursive: true })

const EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'video/webm': '.webm',
  'video/mp4': '.mp4'
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const VIDEO_EXT = new Set(['.webm', '.mp4', '.mov'])

const app = express()

// 静态访问已保存的媒体文件
app.use('/media', express.static(STORAGE_DIR))

// 文件列表
app.get('/api/media', (req, res) => {
  const files = fs
    .readdirSync(STORAGE_DIR)
    .filter(name => !name.startsWith('.'))
    .map(name => {
      const full = path.join(STORAGE_DIR, name)
      const stat = fs.statSync(full)
      if (!stat.isFile()) return null
      const ext = path.extname(name).toLowerCase()
      const type = IMAGE_EXT.has(ext) ? 'image' : VIDEO_EXT.has(ext) ? 'video' : 'file'
      return {
        name,
        url: `/media/${encodeURIComponent(name)}`,
        type,
        size: stat.size,
        createdAt: stat.birthtimeMs || stat.mtimeMs
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt)
  res.json(files)
})

// 上传保存（原始二进制 body，文件名通过 ?name= 传入）
app.post('/api/media', express.raw({ type: () => true, limit: '2gb' }), (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: '空文件' })
    }
    const raw = String(req.query.name || 'capture')
    const base = path.basename(raw).replace(/[^\w.-]/g, '_').slice(0, 60) || 'capture'
    const ext = EXT_BY_MIME[req.headers['content-type']] || '.bin'

    let filename = `${base}${ext}`
    let i = 1
    while (fs.existsSync(path.join(STORAGE_DIR, filename))) {
      filename = `${base}-${i++}${ext}`
    }

    fs.writeFileSync(path.join(STORAGE_DIR, filename), req.body)
    res.json({
      name: filename,
      url: `/media/${encodeURIComponent(filename)}`,
      size: req.body.length
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 删除文件
app.delete('/api/media/:name', (req, res) => {
  const name = path.basename(req.params.name)
  const full = path.join(STORAGE_DIR, name)
  if (!fs.existsSync(full)) return res.status(404).json({ error: '文件不存在' })
  try {
    fs.unlinkSync(full)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 在系统文件管理器中打开存储目录
app.post('/api/open-folder', (req, res) => {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  exec(`${cmd} "${STORAGE_DIR}"`, err => {
    if (err) return res.status(500).json({ error: err.message })
    res.json({ ok: true, dir: STORAGE_DIR })
  })
})

// ---------- Scrum Poker 实时房间 ----------
const httpServer = http.createServer(app)
const io = new Server(httpServer, { cors: { origin: true } })

const POKER_CARDS = [
  '?', '☕', '0', '0.5', '1', '1.5', '2', '2.5',
  '3', '3.5', '4', '4.5', '5', '5.5', '6', '6.5',
  '7', '8', '13', '20', '40', '100'
]
// roomId -> { id, revealed, hostId, participants: Map<socketId, {id,name,vote}> }
const pokerRooms = new Map()

const sanitizeRoom = raw => String(raw || '').replace(/\D/g, '').slice(0, 8)
const sanitizeName = raw => {
  const name = String(raw || '').trim().replace(/\s+/g, ' ')
  return name.slice(0, 20) || '匿名玩家'
}

// 按查看者生成房间快照：未揭晓时不泄露他人点数
function pokerState(room, viewerId) {
  return {
    roomId: room.id,
    revealed: room.revealed,
    hostId: room.hostId,
    participants: [...room.participants.values()].map(p => ({
      id: p.id,
      name: p.name,
      isHost: p.id === room.hostId,
      hasVoted: p.vote != null,
      vote: room.revealed ? p.vote : null
    })),
    you: {
      id: viewerId,
      isHost: viewerId === room.hostId,
      vote: room.participants.get(viewerId)?.vote ?? null
    }
  }
}

function broadcastPokerRoom(room) {
  for (const p of room.participants.values()) {
    io.to(p.id).emit('poker:state', pokerState(room, p.id))
  }
}

function leavePokerRoom(socket) {
  const roomId = socket.data.pokerRoom
  socket.data.pokerRoom = null
  const room = pokerRooms.get(roomId)
  if (!room) return

  room.participants.delete(socket.id)
  if (room.participants.size === 0) {
    pokerRooms.delete(roomId)
    return
  }
  // 主持人离开时顺位交给下一位
  if (room.hostId === socket.id) {
    room.hostId = room.participants.values().next().value.id
  }
  broadcastPokerRoom(room)
}

io.on('connection', socket => {
  socket.on('poker:join', (payload = {}, ack) => {
    const roomId = sanitizeRoom(payload.roomId)
    if (!roomId) return ack?.({ error: '请输入房间号' })

    leavePokerRoom(socket)

    let room = pokerRooms.get(roomId)
    if (!room) {
      room = { id: roomId, revealed: false, hostId: null, participants: new Map() }
      pokerRooms.set(roomId, room)
    }

    // 同房间重名时自动追加序号
    let name = sanitizeName(payload.name)
    const names = new Set([...room.participants.values()].map(p => p.name))
    if (names.has(name)) {
      let i = 2
      while (names.has(`${name} ${i}`)) i++
      name = `${name} ${i}`
    }

    room.participants.set(socket.id, { id: socket.id, name, vote: null })
    if (!room.hostId) room.hostId = socket.id
    socket.data.pokerRoom = roomId

    ack?.({ ok: true })
    broadcastPokerRoom(room)
  })

  socket.on('poker:vote', payload => {
    const room = pokerRooms.get(socket.data.pokerRoom)
    const participant = room?.participants.get(socket.id)
    if (!room || !participant || room.revealed) return
    const card = String(payload?.card)
    if (!POKER_CARDS.includes(card)) return
    participant.vote = card
    broadcastPokerRoom(room)
  })

  socket.on('poker:reveal', () => {
    const room = pokerRooms.get(socket.data.pokerRoom)
    if (!room || room.hostId !== socket.id) return
    room.revealed = true
    broadcastPokerRoom(room)
  })

  socket.on('poker:hide', () => {
    const room = pokerRooms.get(socket.data.pokerRoom)
    if (!room || room.hostId !== socket.id) return
    room.revealed = false
    broadcastPokerRoom(room)
  })

  socket.on('poker:reset', () => {
    const room = pokerRooms.get(socket.data.pokerRoom)
    if (!room || room.hostId !== socket.id) return
    room.revealed = false
    for (const p of room.participants.values()) p.vote = null
    broadcastPokerRoom(room)
  })

  socket.on('poker:leave', () => leavePokerRoom(socket))
  socket.on('disconnect', () => leavePokerRoom(socket))
})

// 生产环境下托管前端构建产物
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  app.get(/^\/(?!api|media|socket\.io).*/, (req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')))
}

httpServer.listen(PORT, () => {
  console.log(`服务已启动: http://localhost:${PORT}`)
  console.log(`存储目录: ${STORAGE_DIR}`)
})
