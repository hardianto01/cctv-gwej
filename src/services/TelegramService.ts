import fs from 'fs';
import { SettingsRepo, CameraRepo } from '../db';

export class TelegramService {
  private getBotToken(): string {
    return SettingsRepo.get('telegram_bot_token', '');
  }

  private getChatId(): string {
    return SettingsRepo.get('telegram_chat_id', '');
  }

  async ensureTopicForCamera(cameraId: string, cameraName: string): Promise<number | undefined> {
    const token = this.getBotToken();
    const chatId = this.getChatId();
    if (!token || !chatId) return undefined;

    const cam = CameraRepo.getById(cameraId);
    if (cam?.telegramTopicId) {
      return cam.telegramTopicId;
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/createForumTopic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          name: `📹 ${cameraName}`
        })
      });
      const data = await res.json() as any;
      if (data.ok && data.result?.message_thread_id) {
        const topicId = data.result.message_thread_id;
        CameraRepo.updateTopicId(cameraId, topicId);
        console.log(`[TelegramService] 📁 Auto-created Forum Topic: "${cameraName}" (ID: ${topicId})`);
        return topicId;
      } else {
        // Chat bukan forum atau bot belum punya permission manage_topics
        return undefined;
      }
    } catch (e) {
      return undefined;
    }
  }

  async sendPhoto(filePath: string, caption?: string, topicId?: number): Promise<boolean> {
    const token = this.getBotToken();
    const chatId = this.getChatId();
    if (!token || !chatId) return false;

    try {
      const fileData = fs.readFileSync(filePath);
      const blob = new Blob([fileData], { type: 'image/jpeg' });
      const formData = new FormData();
      formData.append('chat_id', chatId);
      if (topicId) formData.append('message_thread_id', topicId.toString());
      formData.append('photo', blob, 'snapshot.jpg');
      if (caption) formData.append('caption', caption);
      formData.append('parse_mode', 'Markdown');

      const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json() as any;
      return Boolean(data.ok);
    } catch (err: any) {
      console.error('[TelegramService] Send photo error:', err.message);
      return false;
    }
  }

  async sendVideo(filePath: string, caption?: string, topicId?: number): Promise<boolean> {
    const token = this.getBotToken();
    const chatId = this.getChatId();
    if (!token || !chatId) return false;

    try {
      const fileData = fs.readFileSync(filePath);
      const blob = new Blob([fileData], { type: 'video/mp4' });
      const formData = new FormData();
      formData.append('chat_id', chatId);
      if (topicId) formData.append('message_thread_id', topicId.toString());
      formData.append('video', blob, 'clip.mp4');
      if (caption) formData.append('caption', caption);
      formData.append('parse_mode', 'Markdown');

      const res = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json() as any;
      console.log(`[TelegramService] Video sent: ${data.ok}`);

      // Auto unlink temp capture file
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (e) {}

      return Boolean(data.ok);
    } catch (err: any) {
      console.error('[TelegramService] Send video error:', err.message);
      return false;
    }
  }

  async sendMessage(text: string, topicId?: number): Promise<boolean> {
    const token = this.getBotToken();
    const chatId = this.getChatId();
    if (!token || !chatId) return false;

    try {
      const body: any = {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown'
      };
      if (topicId) body.message_thread_id = topicId;

      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json() as any;
      return Boolean(data.ok);
    } catch (err: any) {
      console.error('[TelegramService] Send message error:', err.message);
      return false;
    }
  }
}

export const telegramService = new TelegramService();
