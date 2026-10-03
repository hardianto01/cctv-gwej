export interface Camera {
  id: string;
  name: string;
  ip: string;
  port: number;
  username: string;
  password: string;
  rtspUrl: string;
  enabled: boolean;
  personDetection: boolean;
  status: 'online' | 'offline' | 'error';
  telegramTopicId?: number;
  createdAt: string;
}

export interface CameraEvent {
  id: string;
  cameraId: string;
  cameraName: string;
  type: 'person' | 'motion' | 'vehicle';
  timestamp: string;
  videoDuration?: number;
}
