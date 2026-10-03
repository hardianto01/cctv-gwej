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
  lastPullActivity: number;
  reconnectTimer?: any;
  watchdogTimer?: any;
  pullLoopStop?: () => void;
}

export class CameraManager {
  private sessions = new Map<string, ActiveSession>();
  private wsClients = new Set<any>();

  constructor() {
    this.cleanOldCaptures();
    setInterval(() => this.cleanOldCaptures(), 30 * 60 * 1000);
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
          // Hapus file rekaman sisa yang lebih dari 15 menit
          if (now - stats.mtimeMs > 15 * 60 * 1000) {
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
      lastPullActivity: Date.now()
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
    if (session.pullLoopStop) {
      session.pullLoopStop();
      session.pullLoopStop = undefined;
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
      console.log(`[CameraManager] ✅ ${cam.name} online & starting controlled PullPoint loop...`);

      session.lastPullActivity = Date.now();
      session.pullLoopStop = this.startControlledPullLoop(client, session);

      // Active Heartbeat Watchdog:
      // Socket WiFi kamera IP Tapo bisa mati sepihak tanpa mengirim TCP FIN/RST.
      // Jika tidak ada respon/aktivitas PullPoint > 90 detik, lakukan auto-recover instan.
      session.watchdogTimer = setInterval(() => {
        const silenceTime = Date.now() - session.lastPullActivity;
        if (silenceTime > 90000) {
          console.warn(`[CameraManager] 🚨 ${cam.name} socket inactive for ${Math.round(silenceTime / 1000)}s. Auto-recovering connection...`);
          this.connectOnvif(session);
        }
      }, 15000);
    });

    session.camInstance = client;
  }

  /**
   * Native Controlled PullPoint Loop
   * Menggunakan renew() reguler dan hard timeout 25s per request pullMessages.
   */
  private startControlledPullLoop(client: any, session: ActiveSession): () => void {
    let isRunning = true;
    let termTime = 0;
    const cam = session.camera;

    const pullStep = () => {
      if (!isRunning) return;

      const now = Date.now();
      // Inisialisasi subscription pertama kali
      if (!client.events?.subscription) {
        client.createPullPointSubscription((err: any) => {
          if (!isRunning) return;
          if (err) {
            console.warn(`[CameraManager] ⚠️ ${cam.name} subscription error:`, err.message || err);
            setTimeout(pullStep, 5000);
            return;
          }

          termTime = client.events?.terminationTime
            ? new Date(client.events.terminationTime).getTime()
            : now + 120000;
          session.lastPullActivity = Date.now();
          doPull();
        });
      } else if (now > termTime - 40000) {
        // Perpanjang masa aktif subscription yang ada (pakai renew, tidak buat endpoint/port baru)
        client.renew({}, (err: any) => {
          if (!isRunning) return;
          if (err) {
            console.warn(`[CameraManager] ⚠️ ${cam.name} renew failed, recreating sub:`, err.message || err);
            delete client.events?.subscription;
            setTimeout(pullStep, 2000);
            return;
          }
          termTime = client.events?.terminationTime
            ? new Date(client.events.terminationTime).getTime()
            : now + 120000;
          session.lastPullActivity = Date.now();
          doPull();
        });
      } else {
        doPull();
      }
    };

    const doPull = () => {
      if (!isRunning) return;

      let pullHandled = false;
      // Hard safety timer 75 detik per pull (karena default pull kamera jika sunyi adalah 60s).
      // Jika kamera/socket WiFi nge-hang dan tidak panggil callback dalam 75s,
      // kita putus dan re-pull agar tidak stuck selamanya.
      const safetyTimer = setTimeout(() => {
        if (pullHandled || !isRunning) return;
        pullHandled = true;
        console.warn(`[CameraManager] ⏱ Pull socket timeout on [${cam.name}], resetting subscription...`);
        delete client.events?.subscription;
        setTimeout(pullStep, 1000);
      }, 75000);

      client.pullMessages({ messageLimit: 10 }, (err: any, data: any) => {
        if (pullHandled || !isRunning) return;
        pullHandled = true;
        clearTimeout(safetyTimer);
        session.lastPullActivity = Date.now();

        if (err) {
          delete client.events?.subscription;
          setTimeout(pullStep, 3000);
          return;
        }

        if (data?.notificationMessage) {
          const msgs = Array.isArray(data.notificationMessage)
            ? data.notificationMessage
            : [data.notificationMessage];

          for (const msg of msgs) {
            this.handleParsedMessage(session, msg);
          }
        }

        setTimeout(pullStep, 500);
      });
    };

    pullStep();

    return () => {
      isRunning = false;
    };
  }

  private handleParsedMessage(session: ActiveSession, msg: any) {
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
      console.error('[CameraManager] Parse error:', e);
    }
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

    // Maksimal 90 detik per klip (~15-20MB pada 1080p 15fps)
    // Menjamin ukuran video selalu aman di bawah batas 50MB Telegram Bot API
    const args = [
      '-y',
      '-rtsp_transport', 'tcp',
      '-use_wallclock_as_timestamps', '1',
      '-i', localStreamUrl,
      '-t', '90',
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

    session.recordProc.on('close', (code: number) => {
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

      // Dispatch video upload ke Telegram secara async non-blocking
      if (duration >= 3 && videoFile && fs.existsSync(videoFile) && fs.statSync(videoFile).size > 20000) {
        (async () => {
          try {
            const topicId = await telegramService.ensureTopicForCamera(session.camera.id, session.camera.name);
            await telegramService.sendVideo(
              videoFile,
              `📹 *Klip Rekaman: ${session.camera.name}*\n⏱ Durasi: \`${duration} detik\`\n🕒 Waktu: \`${timestampStr} WITA\``,
              topicId
            );
          } catch (e: any) {
            console.error(`[CameraManager] Send video error:`, e.message);
          } finally {
            try {
              if (fs.existsSync(videoFile)) fs.unlinkSync(videoFile);
            } catch (e) {}
          }
        })();
      } else if (videoFile && fs.existsSync(videoFile)) {
        try { fs.unlinkSync(videoFile); } catch (e) {}
      }

      // Seamless Multi-Clip: Jika gerakan masih aktif, segera rekam klip berikutnya tanpa jeda!
      const timeSinceLastMotion = Date.now() - session.lastMotionTime;
      if (timeSinceLastMotion < 8000) {
        console.log(`[CameraManager] 🔄 Motion still ongoing for [${session.camera.name}]. Starting next seamless clip...`);
        this.onPersonDetected(session);
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
    // Beri buffer tenang 12 detik setelah gerakan terakhir
    session.stopTimer = setTimeout(() => {
      const quietDuration = Date.now() - session.lastMotionTime;
      if (quietDuration < 10000) {
        session.isStopping = false;
        return;
      }

      if (session.isRecording && session.recordProc) {
        console.log(`[CameraManager] 🛑 Area tenang selama ${Math.round(quietDuration / 1000)}s. Finalizing video for [${session.camera.name}]...`);
        const proc = session.recordProc;
        proc.kill('SIGINT');

        setTimeout(() => {
          if (proc && !proc.killed) {
            try { proc.kill('SIGKILL'); } catch (e) {}
          }
        }, 5000);
      }
    }, 12000);
  }

  stopCamera(id: string) {
    const session = this.sessions.get(id);
    if (session) {
      if (session.pullLoopStop) session.pullLoopStop();
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
