import fs from 'fs';
import path from 'path';
import { SettingsRepo } from '../db';

export class TelegramService {
  getToken(): string {
    return SettingsRepo.get('telegram_bot_token', '');
  }

  getChatId(): string {
    return SettingsRepo.get('telegram_chat_id', '');
  }

  async sendPhoto(filePath: string, caption: string): Promise<boolean> {
    const token = this.getToken();
    const chatId = this.getChatId();
    if (!token || !chatId) return false;

    try {
      const formData = new FormData();
      formData.append('chat_id', chatId);
      formData.append('caption', caption);
      const fileBlob = new Blob([fs.readFileSync(filePath)], { type: 'image/jpeg' });
      formData.append('photo', fileBlob, path.basename(filePath));

      const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      return Boolean(data.ok);
    } catch (err: any) {
      console.error('[TelegramService] sendPhoto failed:', err.message);
      return false;
    }
  }

  async sendVideo(filePath: string, caption: string): Promise<boolean> {
    const token = this.getToken();
    const chatId = this.getChatId();
    if (!token || !chatId) return false;

    try {
      const formData = new FormData();
      formData.append('chat_id', chatId);
      formData.append('caption', caption);
      const fileBlob = new Blob([fs.readFileSync(filePath)], { type: 'video/mp4' });
      formData.append('video', fileBlob, path.basename(filePath));

      const res = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      console.log(`[TelegramService] Video sent: ${data.ok}`);
      try { fs.unlinkSync(filePath); } catch (e) {}
      return Boolean(data.ok);
    } catch (err: any) {
      console.error('[TelegramService] sendVideo failed:', err.message);
      return false;
    }
  }

  async testConnection(token: string, chatId: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: '🔔 *Tes Konfigurasi Berhasil!*\nKoneksi Telegram Alert CCTV Sentinel aktif.',
          parse_mode: 'Markdown'
        })
      });
      const data = await res.json();
      if (data.ok) return { success: true, message: 'Pesan tes terkirim!' };
      return { success: false, message: data.description || 'Gagal mengirim pesan' };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }
}

export const telegramService = new TelegramService();
