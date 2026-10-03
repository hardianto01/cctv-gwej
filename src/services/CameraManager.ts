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
  isRecording: boolean;
  isStopping: boolean;
  recordProc: any;
  currentVideoPath: string | null;
  recordingStartTime: number;
  stopTimer: any;
  lastFinishTime: number;
  lastMotionTime: number;
  reconnectTimer?: any;
  lastEventTime: number;
}

export class CameraManager {
  private sessions = new Map<string, ActiveSession>();
  private wsClients = new Set<any>();

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
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = null;
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

      const handleEventMessage = (msg: any) => {
        session.lastEventTime = Date.now();
        try {
          const topic = msg?.topic?._ || msg?.topic || '';
          const data = msg?.message?.message?.data?.simpleItem;
          const name = data?.$?.Name;
          const val = data?.$?.Value;

          const isPersonEvent = name === 'IsPeople' || topic.includes('peopleDetector');
          const isMotionEvent = name === 'IsMotion' || topic.includes('CellMotionDetector') || topic.includes('TPSmartEvent');

          if (isPersonEvent || isMotionEvent) {
            const isActive = (val === true || val === 'true');
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
      };

      // Kustomisasi event loop yang stabil & anti-macet:
      // Hindari loop bawaan node-onvif yang melakukan ratusan renew() per menit
      client.removeAllListeners('event');
      client.on('event', handleEventMessage);

      // Heartbeat Watchdog per session:
      // Jika dalam 90 detik sama sekali tidak ada event atau poll stuck, re-init koneksi secara hening
      const scheduleWatchdog = () => {
        if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
        session.reconnectTimer = setInterval(() => {
          const silenceDuration = Date.now() - session.lastEventTime;
          // Cek apakah langganan event masih hidup dengan memanggil getEventProperties/pull
          if (silenceDuration > 60000) {
            client.getEventProperties((err: any) => {
              if (err) {
                console.warn(`[CameraManager] ⚠️ Event bus silent & ping failed for ${cam.name}. Reconnecting...`);
                this.connectOnvif(session);
              }
            });
          }
        }, 30000);
      };

      scheduleWatchdog();

      client.on('eventsError', (error: any) => {
        console.warn(`[CameraManager] ⚠️ ${cam.name} ONVIF eventsError:`, error?.message || error);
        setTimeout(() => this.connectOnvif(session), 4000);
      });
    });

    session.camInstance = client;
  }

  private onPersonDetected(session: ActiveSession) {
    const now = Date.now();
    

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

    console.log(`[CameraManager] 🚶‍♂️ Person detected on [${session.camera.name}] at ${timestampStr}`);

    // Stream via local go2rtc RTSP proxy (rtsp://127.0.0.1:8554/<camId>)
    // Keuntungan: go2rtc sudah keep-alive koneksinya di RAM, sehingga FFmpeg langsung
    // mengunci I-Frame (Keyframe) pertama secara instan (0 ms latency), MENGHILANGKAN TITIK BUTA AWAL!
    const localStreamUrl = `rtsp://127.0.0.1:8554/${session.camera.id}`;

    const args = [
      '-y',
      '-rtsp_transport', 'tcp',
      '-use_wallclock_as_timestamps', '1',
      '-i', localStreamUrl,
      '-t', '300',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      session.currentVideoPath
    ];

    session.recordProc = spawn(FFMPEG_BIN, args);

    session.recordProc.on('close', async (code: number) => {
      const duration = Math.round((Date.now() - session.recordingStartTime) / 1000);
      const videoFile = session.currentVideoPath;
      console.log(`[CameraManager] 🏁 Record closed for [${session.camera.name}], duration: ${duration}s`);

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
          `📹 *Klip Deteksi: ${session.camera.name}*\n⏱ Durasi: \`${duration} detik\`\n🕒 Waktu: \`${timestampStr} WITA\``,
        topicId
        );
      }
    });
  }

  private onPersonLeft(session: ActiveSession) {
    if (!session.isRecording) return;
    if (session.stopTimer) clearTimeout(session.stopTimer);

    session.isStopping = true;
    session.stopTimer = setTimeout(() => {
      if (session.isRecording && session.recordProc) {
        console.log(`[CameraManager] 🛑 Finalizing video for [${session.camera.name}]...`);
        session.recordProc.kill('SIGINT');
      }
    }, 15000); // 15 detik buffer tenang
  }

  stopCamera(id: string) {
    const session = this.sessions.get(id);
    if (session) {
      if (session.recordProc) {
        try { session.recordProc.kill('SIGKILL'); } catch (e) {}
      }
      if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
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
      // Reload go2rtc via curl API
      fetch('http://127.0.0.1:1984/api/restart', { method: 'POST' }).catch(() => {});
    } catch (e) {}
  }
}

export const cameraManager = new CameraManager();
