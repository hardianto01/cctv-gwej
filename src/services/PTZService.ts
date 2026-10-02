import { Cam } from 'onvif';
import { CameraRepo } from '../db';

export class PTZService {
  private ptzClients = new Map<string, any>();

  private getClient(cameraId: string): Promise<any> {
    if (this.ptzClients.has(cameraId)) {
      return Promise.resolve(this.ptzClients.get(cameraId));
    }

    const cam = CameraRepo.getById(cameraId);
    if (!cam) return Promise.reject(new Error('Kamera tidak ditemukan'));

    return new Promise((resolve, reject) => {
      const client = new Cam({
        hostname: cam.ip,
        port: cam.port,
        username: cam.username,
        password: cam.password
      }, (err: any) => {
        if (err) return reject(err);
        this.ptzClients.set(cameraId, client);
        resolve(client);
      });
    });
  }

  async move(cameraId: string, direction: 'up' | 'down' | 'left' | 'right' | 'stop') {
    const client = await this.getClient(cameraId);

    // Langkah relatif kecil (0.05 = geser sedikit ~5 derajat persis)
    const STEP_PAN = 0.05;
    const STEP_TILT = 0.05;

    let x = 0;
    let y = 0;

    if (direction === 'left') x = -STEP_PAN;
    else if (direction === 'right') x = STEP_PAN;
    else if (direction === 'up') y = STEP_TILT;
    else if (direction === 'down') y = -STEP_TILT;

    return new Promise((resolve, reject) => {
      if (direction === 'stop') {
        client.stop(() => resolve({ success: true, action: 'stop' }));
      } else {
        // relativeMove adalah standar resmi ONVIF untuk geser per-derajat tanpa mutar liar
        client.relativeMove({ x, y }, (err: any) => {
          if (err) {
            console.error('PTZ RelativeMove error:', err.message);
            return reject(err);
          }
          resolve({ success: true, direction, mode: 'relative' });
        });
      }
    });
  }
}

export const ptzService = new PTZService();
