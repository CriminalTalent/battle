// index.js - Server entry (ESM).
// Port: 3001, Socket.IO path '/socket.io'
// Serves admin/player/spectator HTML (inline files) and provides minimal APIs.
import fs from 'fs';
import path from 'path';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer } from 'socket.io';

import { registerSocketEvents } from './battle-handlers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

const ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:3001,http://127.0.0.1:3001')
  .split(',').map(s=>s.trim()).filter(Boolean);

const io = new SocketIOServer(server, {
  path: '/socket.io',
  cors: { origin: ORIGINS, methods:['GET','POST'] }
});

// Middleware
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended:true }));
app.use(cors({ origin: ORIGINS }));

// Static
const PUBLIC_DIR = path.join(__dirname, 'public');
if(!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive:true });
app.use(express.static(PUBLIC_DIR));

// Inline HTML routes (serve local files)
const sendHtml = (res, file)=> res.sendFile(path.join(__dirname, file));
app.get('/', (req,res)=> res.redirect('/admin'));
app.get('/admin', (req,res)=> sendHtml(res, 'admin.html'));
app.get('/player', (req,res)=> sendHtml(res, 'player.html'));
app.get('/spectator', (req,res)=> sendHtml(res, 'spectator.html'));

// Upload dir
const AVATAR_DIR = path.join(PUBLIC_DIR, 'uploads', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive:true });

const storage = multer.diskStorage({
  destination: (req,file,cb)=> cb(null, AVATAR_DIR),
  filename: (req,file,cb)=>{
    const ext = path.extname(file.originalname)||'';
    const base = path.basename(file.originalname, ext).replace(/\s+/g,'_').slice(0,64);
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2*1024*1024 },
  fileFilter: (req,file,cb)=>{
    if(!file.mimetype.startsWith('image/')) return cb(new Error('이미지 파일만 허용됩니다.'));
    cb(null,true);
  }
});

// APIs
const battles = new Map();
app.get('/api/health', (req,res)=>{
  res.json({ ok:true, uptime:process.uptime(), battles: battles.size });
});

app.post('/api/upload/avatar', upload.single('avatar'), (req,res)=>{
  if(!req.file) return res.status(400).json({ ok:false, error:'NO_FILE' });
  const rel = path.relative(PUBLIC_DIR, req.file.path).split(path.sep).join('/');
  res.json({ ok:true, url: `/${rel}` });
});

import crypto from 'crypto';
function originOf(req){
  return (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-host'])
    ? `${req.headers['x-forwarded-proto']}://${req.headers['x-forwarded-host']}`
    : (req.headers.origin || `http://localhost:${process.env.PORT||3001}`);
}
app.post('/api/admin/battles/:battleId/links', (req,res)=>{
  const id = req.params.battleId;
  const b = battles.get(id);
  if(!b) return res.status(404).json({ ok:false, error:'BATTLE_NOT_FOUND' });
  const spectatorOtp = crypto.randomBytes(6).toString('hex');
  const baseNames = (b.players && b.players.length>0) ? b.players.map(p=>p.name) : ['전투참가자1','전투참가자2','전투참가자3','전투참가자4'];
  const origin = originOf(req);
  const playerLinks = baseNames.map(n=> `${origin}/player?battle=${encodeURIComponent(id)}&name=${encodeURIComponent(n)}&otp=${crypto.randomBytes(8).toString('hex')}`);
  res.json({ ok:true, spectatorOtp, playerLinks });
});
app.post('/api/battles/:battleId/links', (req,res)=>{
  req.url = `/api/admin/battles/${req.params.battleId}/links`;
  app._router.handle(req,res,()=>{});
});

// Sockets
registerSocketEvents(io, app, battles);

// Start
const PORT = Number(process.env.PORT||3001);
server.listen(PORT, ()=>{
  console.log(`[PYXIS] listening on http://localhost:${PORT}`);
  console.log(`[PYXIS] socket path: /socket.io`);
});
