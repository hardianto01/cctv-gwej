import path from 'path';
import { Elysia, t } from 'elysia';
import { staticPlugin } from '@elysiajs/static';
import { cors } from '@elysiajs/cors';
import { jwt } from '@elysiajs/jwt';
import { CameraRepo, EventRepo, SettingsRepo } from './db';
import { cameraManager } from './services/CameraManager';
import { telegramService } from './services/TelegramService';
import { ptzService } from './services/PTZService';
import type { Camera } from './core/types';
import fs from 'fs';

const JWT_SECRET = SettingsRepo.get('jwt_secret', 'sentinel-secret-key-998877');
SettingsRepo.set('jwt_secret', JWT_SECRET);

const app = new Elysia()
  .use(cors())
  .use(
    jwt({
      name: 'jwt',
      secret: JWT_SECRET
    })
  )
  .use(staticPlugin({ assets: path.join(import.meta.dir, '../public'), prefix: '/' }))

  // Serve Frontend index.html
  .get('/', () => {
    return new Response(fs.readFileSync(path.join(import.meta.dir, '../public/index.html')), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  })

  // WebSocket for Live Event Feeds
  .ws('/ws', {
    open(ws) {
      cameraManager.registerWsClient(ws);
      ws.send(JSON.stringify({ event: 'connected', time: new Date().toISOString() }));
    },
    close(ws) {
      cameraManager.unregisterWsClient(ws);
    }
  })

  // Auth Endpoints (Public)
  .group('/api/auth', (auth) =>
    auth
      .post('/login', async ({ body, jwt, set }: any) => {
        const { username, password } = body || {};
        const adminUser = SettingsRepo.get('admin_username', 'admin');
        const passHash = SettingsRepo.get('admin_password_hash');

        if (username !== adminUser) {
          set.status = 401;
          return { error: 'Username atau password salah' };
        }

        const isMatch = await Bun.password.verify(password, passHash);
        if (!isMatch) {
          set.status = 401;
          return { error: 'Username atau password salah' };
        }

        const token = await jwt.sign({ sub: username, role: 'admin' });
        return { success: true, token, username };
      })

      .get('/me', async ({ headers, jwt, set }: any) => {
        const authHeader = headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          set.status = 401;
          return { error: 'Unauthorized' };
        }
        const payload = await jwt.verify(authHeader.slice(7));
        if (!payload) {
          set.status = 401;
          return { error: 'Invalid token' };
        }
        return { authenticated: true, user: payload.sub };
      })
  )

  // Protected CCTV & System API
  .group('/api', (api) =>
    api
      .derive(async ({ headers, jwt, set }: any) => {
        const authHeader = headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return { user: null };
        }
        const user = await jwt.verify(authHeader.slice(7));
        return { user };
      })

      // WHEP WebRTC negotiation (allowed for player)
      .post('/whep/:id', async ({ params: { id }, request }) => {
        const offerSdp = await request.text();
        const res = await fetch(`http://127.0.0.1:1984/api/webrtc?src=${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: offerSdp
        });
        const answerSdp = await res.text();
        return new Response(answerSdp, {
          status: res.status,
          headers: { 'Content-Type': 'application/sdp' }
        });
      })

      // Cameras CRUD
      .get('/cameras', ({ user, set }: any) => {
        if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
        return CameraRepo.getAll();
      })

      .post('/cameras', ({ body, user, set }: any) => {
        if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
        const cam: Camera = {
          ...body,
          id: body.id || `cam_${Date.now()}`,
          status: 'offline',
          createdAt: new Date().toISOString()
        };
        CameraRepo.upsert(cam);
        cameraManager.startCamera(cam);
        cameraManager.syncToGo2rtc(CameraRepo.getAll());
        return { success: true, camera: cam };
      })

      .delete('/cameras/:id', ({ params: { id }, user, set }: any) => {
        if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
        cameraManager.stopCamera(id);
        CameraRepo.delete(id);
        cameraManager.syncToGo2rtc(CameraRepo.getAll());
        return { success: true };
      })

      .patch('/cameras/:id/toggle', ({ params: { id }, user, set }: any) => {
        if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
        const cam = CameraRepo.getById(id);
        if (!cam) return { error: 'Camera not found' };
        cam.enabled = !cam.enabled;
        CameraRepo.upsert(cam);
        if (cam.enabled) {
          cameraManager.startCamera(cam);
        } else {
          cameraManager.stopCamera(id);
        }
        return { success: true, enabled: cam.enabled };
      })

      // PTZ Movement
      .post('/cameras/:id/ptz', async ({ params: { id }, body, user, set }: any) => {
        if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
        const direction = body?.direction;
        if (!['up', 'down', 'left', 'right', 'stop'].includes(direction)) {
          return { error: 'Invalid direction' };
        }
        const res = await ptzService.move(id, direction);
        return res;
      })

      // Events Feed
      .get('/events', ({ user, set }: any) => {
        if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
        return EventRepo.getLatest(50);
      })

      // Settings Endpoints
      .get('/settings', ({ user, set }: any) => {
        if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
        return {
          telegram_chat_id: SettingsRepo.get('telegram_chat_id'),
          telegram_bot_token: SettingsRepo.get('telegram_bot_token'),
          admin_username: SettingsRepo.get('admin_username')
        };
      })

      .post('/settings', async ({ body, user, set }: any) => {
        if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
        const { telegram_chat_id, telegram_bot_token, admin_username, new_password } = body || {};
        if (telegram_chat_id) SettingsRepo.set('telegram_chat_id', telegram_chat_id);
        if (telegram_bot_token) SettingsRepo.set('telegram_bot_token', telegram_bot_token);
        if (admin_username) SettingsRepo.set('admin_username', admin_username);
        if (new_password && new_password.trim().length >= 6) {
          const hash = Bun.password.hashSync(new_password);
          SettingsRepo.set('admin_password_hash', hash);
        }
        return { success: true };
      })

      .post('/settings/test-telegram', async ({ body, user, set }: any) => {
        if (!user) { set.status = 401; return { error: 'Unauthorized' }; }
        const token = body?.token || SettingsRepo.get('telegram_bot_token');
        const chatId = body?.chat_id || SettingsRepo.get('telegram_chat_id');
        return await telegramService.testConnection(token, chatId);
      })
  )

  .listen(3000);

console.log(`🦊 Elysia CCTV Core running at http://${app.server?.hostname}:${app.server?.port}`);
cameraManager.startAll();
