import { Cam } from 'onvif';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { Camera } from '../core/types';
import { CameraRepo, EventRepo } from '../db';
import { telegramService } from './TelegramService';

const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';
const CAPTURE_DIR = path.join(process.cwd(), 'captures');

if (!fs.existsSync(CAPTURE_DIR)) {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
}

interface ActiveSession {
  camera: Camera;
  camInstance: any;
  isConnecting: boolean;
  isRecording: boolean;
  isStopping: boolean;
  recordProc: any;
  currentVideoPath: string | null;
  recordingStartTime: number;
  stopTimer: any;
  lastFinishTime: number;
  lastMotionTime: number;
  watchdogTimer?: any;
  reconnectTimer?: any;
  lastEventTime: number;
}

export class CameraManager {
  private sessions = new Map<string, ActiveSession>();
  private wsClients = new Set<any>();

  constructor() {
    this.cleanOldCaptures();
    setInterval(() => this.cleanOldCaptures(), 60 * 60 * 1000);
  }

  cleanOldCaptures() {
    try {
      if (!fs.existsSync(CAPTURE_DIR)) return;
      const files = fs.readdirSync(CAPTURE_DIR);
      const now = Date.now();
      for (const file of files) {
        const fullPath = path.join(CAPTURE_DIR, file);
        try {
          const stats = fs.statSync(fullPath);
          // Hapus file rekaman sisa yang lebih dari 30 menit
          if (now - stats.mtimeMs > 30 * 60 * 1000) {
            fs.unlinkSync(fullPath);
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  registerWsClient(ws: any) {
    this.wsClients.add(ws);
  }

  unregisterWsClient(ws: any) {
    this.wsClients.delete(ws);
  }

  broadcast(event: string, payload: any) {
    const msg = JSON.stringify({ event, payload });
    for (const ws of this.wsClients) {
      try {
        ws.send(msg);
      } catch (e) {}
    }
  }

  getCamInstance(id: string): any | null {
    const session = this.sessions.get(id);
    return session?.camInstance || null;
  }

  async startAll() {
    const cameras = CameraRepo.getAll().filter(c => c.enabled);
    console.log(`[CameraManager] Initializing ${cameras.length} active camera workers...`);
    for (const cam of cameras) {
      this.startCamera(cam);
    }
  }

  startCamera(cam: Camera) {
    if (this.sessions.has(cam.id)) {
      this.stopCamera(cam.id);
    }

    const session: ActiveSession = {
      camera: cam,
      camInstance: null,
      isConnecting: false,
      isRecording: false,
      isStopping: false,
      recordProc: null,
      currentVideoPath: null,
      recordingStartTime: 0,
      stopTimer: null,
      lastFinishTime: 0,
      lastMotionTime: 0,
      lastEventTime: Date.now()
    };

    this.sessions.set(cam.id, session);
    this.connectOnvif(session);
  }

  private connectOnvif(session: ActiveSession) {
    const cam = session.camera;

    if (session.isConnecting) return;
    session.isConnecting = true;

    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = null;
    }
    if (session.watchdogTimer) {
      clearInterval(session.watchdogTimer);
      session.watchdogTimer = null;
    }

    try {
      if (session.camInstance) {
        session.camInstance.removeAllListeners?.();
      }
    } catch (e) {}

    const client = new Cam({
      hostname: cam.ip,
      port: cam.port,
      username: cam.username,
      password: cam.password
    }, (err: any) => {
      session.isConnecting = false;

      if (err) {
        console.error(`[CameraManager] ${cam.name} (${cam.ip}) ONVIF connection error:`, err.message);
        CameraRepo.updateStatus(cam.id, 'offline');
        this.broadcast('camera:status', { id: cam.id, status: 'offline' });
        session.reconnectTimer = setTimeout(() => this.connectOnvif(session), 10000);
        return;
      }

      CameraRepo.updateStatus(cam.id, 'online');
      this.broadcast('camera:status', { id: cam.id, status: 'online' });
      console.log(`[CameraManager] ✅ ${cam.name} online & listening events.`);

      client.on('event', (msg: any) => {
        session.lastEventTime = Date.now();
        try {
          const topic = msg?.topic?._ || msg?.topic || '';
          const rawSimple = msg?.message?.message?.data?.simpleItem;
          const items = Array.isArray(rawSimple) ? rawSimple : (rawSimple ? [rawSimple] : []);

          let isPerson = topic.includes('peopleDetector');
          let isMotion = topic.includes('CellMotionDetector') || topic.includes('TPSmartEvent');
          let isActive = false;

          for (const item of items) {
            const name = item?.$?.Name;
            const val = item?.$?.Value;
            if (name === 'IsPeople') {
              isPerson = true;
              if (val === true || val === 'true') isActive = true;
            } else if (name === 'IsMotion') {
              isMotion = true;
              if (val === true || val === 'true') isActive = true;
            }
          }

          if (isPerson || isMotion) {
            if (isActive) {
              session.lastMotionTime = Date.now();
              this.onPersonDetected(session);
            } else {
              this.onPersonLeft(session);
            }
          }
        } catch (e) {
          console.error('[CameraManager] Event parse error:', e);
        }
      });

      // Self-healing Watchdog:
      // Setiap 30 detik cek apakah ada event dalam 60 detik terakhir.
      session.watchdogTimer = setInterval(() => {
        const silenceDuration = Date.now() - session.lastEventTime;
        if (silenceDuration > 60000) {
          client.getEventProperties((err: any) => {
            if (err) {
              console.warn(`[CameraManager] ⚠️ Event bus dead for ${cam.name}. Reconnecting...`);
              this.connectOnvif(session);
            }
          });
        }
      }, 30000);

      client.on('eventsError', (error: any) => {
        console.warn(`[CameraManager] ⚠️ ${cam.name} ONVIF eventsError:`, error?.message || error);
        if (!session.reconnectTimer) {
          session.reconnectTimer = setTimeout(() => {
            session.reconnectTimer = null;
            this.connectOnvif(session);
          }, 5000);
        }
      });
    });

    session.camInstance = client;
  }

  private onPersonDetected(session: ActiveSession) {
    const now = Date.now();
    session.lastMotionTime = now;

    // Jika sedang merekam, batalkan rencana stop karena aktor masih aktif
    if (session.isRecording) {
      if (session.stopTimer) {
        clearTimeout(session.stopTimer);
        session.stopTimer = null;
        session.isStopping = false;
      }
      return;
    }

    session.isRecording = true;
    session.isStopping = false;
    session.recordingStartTime = now;
    const timestampStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Makassar' });
    const filePrefix = `${CAPTURE_DIR}/${session.camera.id}_${Date.now()}`;
    session.currentVideoPath = `${filePrefix}.mp4`;

    const eventRecord = {
      id: `evt_${Date.now()}`,
      cameraId: session.camera.id,
      cameraName: session.camera.name,
      type: 'person' as const,
      timestamp: new Date().toISOString()
    };
    EventRepo.add(eventRecord);
    this.broadcast('event:new', eventRecord);

    console.log(`[CameraManager] 🚶‍♂️ Continuous Recording started on [${session.camera.name}] at ${timestampStr}`);

    const localStreamUrl = `rtsp://127.0.0.1:8554/${session.camera.id}`;

    const args = [
      '-y',
      '-rtsp_transport', 'tcp',
      '-use_wallclock_as_timestamps', '1',
      '-i', localStreamUrl,
      '-t', '600', // Maksimal 10 menit jika aktivitas terus berlangsung
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      session.currentVideoPath
    ];

    session.recordProc = spawn(FFMPEG_BIN, args);

    session.recordProc.on('error', (err: any) => {
      console.error(`[CameraManager] FFmpeg spawn error on [${session.camera.name}]:`, err.message);
      session.isRecording = false;
      session.isStopping = false;
      session.recordProc = null;
      if (session.currentVideoPath && fs.existsSync(session.currentVideoPath)) {
        try { fs.unlinkSync(session.currentVideoPath); } catch (e) {}
      }
      session.currentVideoPath = null;
    });

    session.recordProc.on('close', async (code: number) => {
      const duration = Math.round((Date.now() - session.recordingStartTime) / 1000);
      const videoFile = session.currentVideoPath;
      console.log(`[CameraManager] 🏁 Record finalized for [${session.camera.name}], duration: ${duration}s`);

      session.isRecording = false;
      session.isStopping = false;
      session.recordProc = null;
      session.currentVideoPath = null;
      if (session.stopTimer) {
        clearTimeout(session.stopTimer);
        session.stopTimer = null;
      }
      session.lastFinishTime = Date.now();

      if (duration >= 3 && videoFile && fs.existsSync(videoFile) && fs.statSync(videoFile).size > 20000) {
        const topicId = await telegramService.ensureTopicForCamera(session.camera.id, session.camera.name);
        await telegramService.sendVideo(
          videoFile,
          `📹 *Klip Rekaman: ${session.camera.name}*\n⏱ Durasi: \`${duration} detik\`\n🕒 Waktu: \`${timestampStr} WITA\``,
          topicId
        );
      } else if (videoFile && fs.existsSync(videoFile)) {
        // Hapus file sementara jika durasi terlalu pendek atau ukuran kosong/korup
        try { fs.unlinkSync(videoFile); } catch (e) {}
      }
    });
  }

  private onPersonLeft(session: ActiveSession) {
    if (!session.isRecording) return;

    if (session.stopTimer) {
      clearTimeout(session.stopTimer);
      session.stopTimer = null;
    }

    session.isStopping = true;
    // Beri buffer sepi 20 detik setelah gerakan terakhir
    session.stopTimer = setTimeout(() => {
      // Verifikasi ulang: pastikan dalam 18 detik terakhir benar-benar tidak ada gerakan
      const quietDuration = Date.now() - session.lastMotionTime;
      if (quietDuration < 18000) {
        session.isStopping = false;
        return;
      }

      if (session.isRecording && session.recordProc) {
        console.log(`[CameraManager] 🛑 Area tenang selama ${Math.round(quietDuration / 1000)}s. Finalizing video for [${session.camera.name}]...`);
        const proc = session.recordProc;
        proc.kill('SIGINT');

        // Fallback force-kill jika FFmpeg tertahan pada RTSP socket
        setTimeout(() => {
          if (proc && !proc.killed) {
            try { proc.kill('SIGKILL'); } catch (e) {}
          }
        }, 5000);
      }
    }, 20000);
  }

  stopCamera(id: string) {
    const session = this.sessions.get(id);
    if (session) {
      if (session.stopTimer) clearTimeout(session.stopTimer);
      if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
      if (session.watchdogTimer) clearInterval(session.watchdogTimer);
      if (session.recordProc) {
        try { session.recordProc.kill('SIGKILL'); } catch (e) {}
      }
      if (session.currentVideoPath && fs.existsSync(session.currentVideoPath)) {
        try { fs.unlinkSync(session.currentVideoPath); } catch (e) {}
      }
      try { session.camInstance?.removeAllListeners?.(); } catch (e) {}
      this.sessions.delete(id);
    }
  }

  syncToGo2rtc(cameras: Camera[]) {
    try {
      let configContent = `api:\n  listen: "127.0.0.1:1984"\nrtsp:\n  listen: "127.0.0.1:8554"\nwebrtc:\n  listen: "0.0.0.0:8555"\nstreams:\n`;
      for (const cam of cameras) {
        configContent += `  ${cam.id}:\n    - "${cam.rtspUrl}"\n`;
      }
      fs.writeFileSync(path.join(process.cwd(), 'go2rtc.yaml'), configContent);
      fetch('http://127.0.0.1:1984/api/restart', { method: 'POST' }).catch(() => {});
    } catch (e) {}
  }
}

export const cameraManager = new CameraManager();
