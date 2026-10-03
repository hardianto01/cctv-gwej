<script lang="ts">
  import { onMount } from 'svelte';
  import { 
    Shield, Video, Plus, Power, Trash2, 
    ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
    Bell, LogOut, CheckCircle2, Moon, Sun, 
    Maximize2, Minimize2, Grid, SlidersHorizontal, 
    X, Info, Radio, Activity, Languages,
    Terminal, Copy, Trash, Check
  } from 'lucide-svelte';
  import { translations, type Lang } from './lib/i18n';

  interface Camera {
    id: string;
    name: string;
    ip: string;
    port: number;
    username: string;
    password: string;
    rtspUrl: string;
    enabled: boolean;
    personDetection: boolean;
    status: 'online' | 'offline';
  }

  interface CameraEvent {
    id: string;
    cameraId: string;
    cameraName: string;
    type: string;
    timestamp: string;
  }

  // Theme
  let isDarkMode = $state(localStorage.getItem('sentinel_theme') !== 'light');
  function toggleTheme() {
    isDarkMode = !isDarkMode;
    localStorage.setItem('sentinel_theme', isDarkMode ? 'dark' : 'light');
    if (isDarkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }

  // Language / i18n
  let currentLang = $state<Lang>((localStorage.getItem('sentinel_lang') as Lang) || 'id');
  let t = $derived(translations[currentLang]);

  function toggleLang() {
    currentLang = currentLang === 'id' ? 'en' : 'id';
    localStorage.setItem('sentinel_lang', currentLang);
  }

  // Auth
  let token = $state(localStorage.getItem('sentinel_jwt') || '');
  let isAuthenticated = $state(false);
  let loginUser = $state('');
  let loginPass = $state('');
  let loginError = $state('');

  // Tabs & Views
  let activeTab = $state<'live' | 'settings'>('live');
  let cameras = $state<Camera[]>([]);
  let events = $state<CameraEvent[]>([]);

  // Hub & Full-page focus states
  let focusedCam = $state<Camera | null>(null);
  let isDrawerOpen = $state(false);
  let drawerTab = $state<'events' | 'console'>('events');
  let consoleFilter = $state<string>('ALL');
  let copiedNotice = $state(false);
  let gridColumnsMode = $state<'auto' | '1' | '2' | '3'>('auto');

  // Interactive Audit Console Logs
  export interface UiLogEntry {
    id: string;
    time: string;
    tag: 'AUTH' | 'WEBSOCKET' | 'WEBRTC' | 'PTZ' | 'CAMERA' | 'SETTINGS';
    level: 'info' | 'warn' | 'error' | 'success';
    message: string;
    data?: any;
    expanded?: boolean;
  }

  let consoleLogs = $state<UiLogEntry[]>([]);
  let filteredLogs = $derived(consoleFilter === 'ALL' ? consoleLogs : consoleLogs.filter(l => l.tag === consoleFilter));

  function uiLog(tag: UiLogEntry['tag'], message: string, data?: any, level: UiLogEntry['level'] = 'info') {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
    const entry: UiLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      time,
      tag,
      level,
      message,
      data,
      expanded: false
    };

    consoleLogs = [entry, ...consoleLogs.slice(0, 199)];

    // Styled DevTools Console Output for F12 Audit
    const tagStyles: Record<string, string> = {
      AUTH: 'background: #2563eb; color: #ffffff; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
      WEBSOCKET: 'background: #7c3aed; color: #ffffff; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
      WEBRTC: 'background: #059669; color: #ffffff; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
      PTZ: 'background: #d97706; color: #ffffff; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
      CAMERA: 'background: #0891b2; color: #ffffff; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
      SETTINGS: 'background: #db2777; color: #ffffff; padding: 2px 6px; border-radius: 3px; font-weight: bold;'
    };
    const timeStyle = 'color: #94a3b8; font-family: monospace; font-size: 11px;';
    const tagStyle = tagStyles[tag] || 'background: #475569; color: #fff; padding: 2px 6px; border-radius: 3px;';

    if (level === 'error') {
      console.error(`%c${time}%c %c${tag}%c ${message}`, timeStyle, '', tagStyle, 'color: #ef4444; font-weight: bold;', data !== undefined ? data : '');
    } else if (level === 'warn') {
      console.warn(`%c${time}%c %c${tag}%c ${message}`, timeStyle, '', tagStyle, 'color: #f59e0b; font-weight: bold;', data !== undefined ? data : '');
    } else if (level === 'success') {
      console.log(`%c${time}%c %c${tag}%c ${message}`, timeStyle, '', tagStyle, 'color: #10b981; font-weight: bold;', data !== undefined ? data : '');
    } else {
      console.log(`%c${time}%c %c${tag}%c ${message}`, timeStyle, '', tagStyle, 'color: inherit;', data !== undefined ? data : '');
    }
  }

  function copyConsoleLogs() {
    const text = consoleLogs
      .map(l => `[${l.time}] [${l.tag}] [${l.level.toUpperCase()}] ${l.message}${l.data ? ' -> ' + JSON.stringify(l.data) : ''}`)
      .reverse()
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      copiedNotice = true;
      setTimeout(() => copiedNotice = false, 2000);
    });
  }

  // Settings
  let tgBotToken = $state('');
  let tgChatId = $state('');
  let adminUsername = $state('');
  let newPassword = $state('');
  let settingsNotice = $state('');

  // Add camera modal
  let showAddModal = $state(false);
  let formId = $state('');
  let formName = $state('');
  let formIp = $state('');
  let formPort = $state(2020);
  let formUser = $state('');
  let formPass = $state('');
  let formRtsp = $state('');

  const pcs = new Map<string, RTCPeerConnection>();

  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  }

  async function checkAuth() {
    if (!token) { 
      isAuthenticated = false; 
      uiLog('AUTH', 'Tidak ada token JWT tersimpan, perlu login', undefined, 'warn');
      return; 
    }
    uiLog('AUTH', 'Memverifikasi status sesi pengguna dengan token...');
    try {
      const res = await fetch('/api/auth/me', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        isAuthenticated = true;
        uiLog('AUTH', `Sesi valid! Login sebagai "${data.user}"`, data, 'success');
        await loadInitialData();
      } else {
        uiLog('AUTH', 'Token kedaluwarsa atau tidak valid, diarahkan ke login', undefined, 'warn');
        doLogout();
      }
    } catch (e: any) {
      uiLog('AUTH', `Gagal koneksi saat verifikasi token: ${e.message}`, undefined, 'error');
      doLogout();
    }
  }

  async function doLogin(e: Event) {
    e.preventDefault();
    loginError = '';
    uiLog('AUTH', `Mencoba login username: "${loginUser}"...`);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser, password: loginPass })
      });
      const data = await res.json();
      if (res.ok && data.token) {
        token = data.token;
        localStorage.setItem('sentinel_jwt', token);
        isAuthenticated = true;
        uiLog('AUTH', `Login sukses! Token JWT berhasil disimpan.`, data, 'success');
        await loadInitialData();
      } else {
        loginError = data.error || t.loginFailed;
        uiLog('AUTH', `Login ditolak: ${loginError}`, data, 'error');
      }
    } catch (err: any) {
      loginError = err.message;
      uiLog('AUTH', `Login error jaringan: ${err.message}`, undefined, 'error');
    }
  }

  function doLogout() {
    uiLog('AUTH', 'Pengguna logout. Sesi lokal dibersihkan & koneksi WebRTC ditutup.', undefined, 'warn');
    token = '';
    localStorage.removeItem('sentinel_jwt');
    isAuthenticated = false;
    pcs.forEach(pc => pc.close());
    pcs.clear();
  }

  async function loadInitialData() {
    uiLog('CAMERA', 'Mengambil data awal (kamera, riwayat event, dan pengaturan)...');
    await Promise.all([loadCameras(), loadEvents(), loadSettings()]);
  }

  async function loadCameras() {
    try {
      const res = await fetch('/api/cameras', { headers: authHeaders() });
      if (res.ok) {
        cameras = await res.json();
        uiLog('CAMERA', `Daftar kamera berhasil dimuat: ${cameras.length} unit`, cameras.map(c => ({ id: c.id, name: c.name, status: c.status, topicId: c.telegramTopicId })), 'success');
        setTimeout(initWebRTCAll, 100);
      } else {
        uiLog('CAMERA', `Gagal memuat kamera, status HTTP: ${res.status}`, undefined, 'error');
      }
    } catch (e: any) {
      uiLog('CAMERA', `Error request loadCameras: ${e.message}`, undefined, 'error');
    }
  }

  async function loadEvents() {
    try {
      const res = await fetch('/api/events', { headers: authHeaders() });
      if (res.ok) {
        events = await res.json();
        uiLog('CAMERA', `Riwayat event dimuat: ${events.length} event tersimpan`, undefined, 'info');
      }
    } catch (e: any) {
      uiLog('CAMERA', `Error request loadEvents: ${e.message}`, undefined, 'error');
    }
  }

  async function loadSettings() {
    try {
      const res = await fetch('/api/settings', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        tgBotToken = data.telegram_bot_token || '';
        tgChatId = data.telegram_chat_id || '';
        adminUsername = data.admin_username || '';
        uiLog('SETTINGS', 'Pengaturan sistem berhasil dimuat', { adminUsername, targetChat: tgChatId }, 'info');
      }
    } catch (e: any) {
      uiLog('SETTINGS', `Error request loadSettings: ${e.message}`, undefined, 'error');
    }
  }

  async function saveSettings(e: Event) {
    e.preventDefault();
    settingsNotice = '';
    uiLog('SETTINGS', 'Menyimpan konfigurasi sistem ke server...');
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        telegram_bot_token: tgBotToken,
        telegram_chat_id: tgChatId,
        admin_username: adminUsername,
        new_password: newPassword || undefined
      })
    });
    if (res.ok) {
      settingsNotice = t.settingsSaved;
      newPassword = '';
      uiLog('SETTINGS', 'Konfigurasi berhasil disimpan!', undefined, 'success');
    } else {
      uiLog('SETTINGS', `Gagal menyimpan konfigurasi HTTP ${res.status}`, undefined, 'error');
    }
  }

  async function testTelegram() {
    settingsNotice = t.tgTesting;
    uiLog('SETTINGS', 'Menguji koneksi Telegram (getMe & sendMessage)...');
    const res = await fetch('/api/settings/test-telegram', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ token: tgBotToken, chat_id: tgChatId })
    });
    const data = await res.json();
    settingsNotice = data.success ? t.tgTestSuccess : `${t.tgTestFailed}: ${data.message}`;
    uiLog('SETTINGS', `Hasil test Telegram: ${data.message}`, data, data.success ? 'success' : 'error');
  }

  async function initWebRTCAll() {
    for (const cam of cameras) {
      if (cam.enabled) startWebRTC(cam);
    }
  }

  async function startWebRTC(cam: Camera) {
    if (pcs.has(cam.id)) {
      uiLog('WEBRTC', `[${cam.name}] Me-refresh PeerConnection yang sudah ada...`, undefined, 'info');
      pcs.get(cam.id)?.close();
    }

    try {
      uiLog('WEBRTC', `[${cam.name}] Menginisialisasi RTCPeerConnection (STUN google)...`);
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      pcs.set(cam.id, pc);

      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        uiLog('WEBRTC', `[${cam.name}] Connection state: "${state}"`, undefined, state === 'connected' ? 'success' : state === 'failed' || state === 'disconnected' ? 'warn' : 'info');
        if (state === 'failed' || state === 'disconnected') {
          uiLog('WEBRTC', `[${cam.name}] Stream terputus, auto-reconnect dalam 3 detik...`, undefined, 'warn');
          setTimeout(() => {
            if (cam.enabled && pcs.get(cam.id) === pc) {
              startWebRTC(cam);
            }
          }, 3000);
        }
      };

      pc.ontrack = (event) => {
        uiLog('WEBRTC', `[${cam.name}] Media track diterima: ${event.track.kind} (${event.track.id})`, undefined, 'success');
        const stream = event.streams[0];
        const videoEl = document.getElementById(`video-${cam.id}`) as HTMLVideoElement;
        if (videoEl && videoEl.srcObject !== stream) {
          videoEl.srcObject = stream;
          const badge = document.getElementById(`loader-${cam.id}`);
          if (badge) badge.style.display = 'none';
        }
        const focusEl = document.getElementById(`focus-video-${cam.id}`) as HTMLVideoElement;
        if (focusEl && focusEl.srcObject !== stream) {
          focusEl.srcObject = stream;
        }
      };

      uiLog('WEBRTC', `[${cam.name}] Membuat WebRTC SDP Offer...`);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      uiLog('WEBRTC', `[${cam.name}] Mengirim SDP Offer ke gateway WHEP (/api/whep/${cam.id})...`);
      const res = await fetch(`/api/whep/${cam.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp
      });

      if (res.ok) {
        const answer = await res.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answer });
        uiLog('WEBRTC', `[${cam.name}] Handshake WHEP selesai, SDP Answer diset. Live playback aktif!`, undefined, 'success');
      } else {
        uiLog('WEBRTC', `[${cam.name}] Gateway WHEP merespon error: HTTP ${res.status}`, undefined, 'error');
      }
    } catch (err: any) {
      uiLog('WEBRTC', `[${cam.name}] WebRTC exception: ${err.message}`, undefined, 'error');
    }
  }

  async function stepPTZ(camId: string, direction: 'up' | 'down' | 'left' | 'right') {
    uiLog('PTZ', `Kamera [${camId}] mengirim perintah gerak: ${direction.toUpperCase()}`);
    try {
      const res = await fetch(`/api/cameras/${camId}/ptz`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ direction })
      });
      const data = await res.json();
      if (res.ok) {
        uiLog('PTZ', `Perintah PTZ [${camId}] berhasil dieksekusi ONVIF`, data, 'success');
      } else {
        uiLog('PTZ', `Perintah PTZ [${camId}] gagal: ${data.error || 'Unknown error'}`, data, 'error');
      }
    } catch (e: any) {
      uiLog('PTZ', `Error jaringan perintah PTZ: ${e.message}`, undefined, 'error');
    }
  }

  async function toggleCamera(id: string) {
    uiLog('CAMERA', `Mengubah status toggle aktif/nonaktif kamera: [${id}]`);
    await fetch(`/api/cameras/${id}/toggle`, { method: 'PATCH', headers: authHeaders() });
    await loadCameras();
  }

  async function deleteCamera(id: string) {
    if (!confirm(t.deleteConfirm)) return;
    uiLog('CAMERA', `Menghapus kamera: [${id}]`, undefined, 'warn');
    await fetch(`/api/cameras/${id}`, { method: 'DELETE', headers: authHeaders() });
    await loadCameras();
  }

  async function handleAddCamera(e: Event) {
    e.preventDefault();
    uiLog('CAMERA', `Menambahkan kamera baru: "${formName}" (${formIp})`);
    await fetch('/api/cameras', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        id: formId,
        name: formName,
        ip: formIp,
        port: formPort,
        username: formUser,
        password: formPass,
        rtspUrl: formRtsp,
        enabled: true,
        personDetection: true
      })
    });
    showAddModal = false;
    uiLog('CAMERA', `Kamera "${formName}" berhasil disimpan!`, undefined, 'success');
    await loadCameras();
  }

  function openFocus(cam: Camera) {
    focusedCam = cam;
    setTimeout(() => {
      const focusEl = document.getElementById(`focus-video-${cam.id}`) as HTMLVideoElement;
      const originalEl = document.getElementById(`video-${cam.id}`) as HTMLVideoElement;
      if (focusEl && originalEl && originalEl.srcObject) {
        focusEl.srcObject = originalEl.srcObject;
      }
    }, 50);
  }

  function closeFocus() {
    focusedCam = null;
  }

  function getGridClasses(): string {
    if (gridColumnsMode === '1') return 'grid-cols-1';
    if (gridColumnsMode === '2') return 'grid-cols-1 md:grid-cols-2';
    if (gridColumnsMode === '3') return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';

    const count = cameras.length;
    if (count <= 1) return 'grid-cols-1 max-w-5xl mx-auto';
    if (count === 2) return 'grid-cols-1 lg:grid-cols-2';
    if (count <= 4) return 'grid-cols-1 md:grid-cols-2';
    return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
  }

  onMount(() => {
    if (isDarkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');

    checkAuth();

    let ws: WebSocket | null = null;
    let wsReconnectTimer: any = null;
    let isDisposed = false;

    function connectWs() {
      if (isDisposed) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${location.host}/ws`;
      uiLog('WEBSOCKET', `Membuka koneksi WebSocket ke ${wsUrl}...`);
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        uiLog('WEBSOCKET', 'WebSocket terhubung ke server (live event feed aktif)', undefined, 'success');
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.event === 'connected') {
            uiLog('WEBSOCKET', `Handshake server dikonfirmasi pada ${data.time}`, data, 'success');
          } else if (data.event === 'event:new') {
            uiLog('WEBSOCKET', `[DETEKSI] ${data.payload.cameraName}: gerakan terdeteksi (${data.payload.type})`, data.payload, 'warn');
            events = [data.payload, ...events.slice(0, 49)];
          } else if (data.event === 'camera:status') {
            uiLog('WEBSOCKET', `Status kamera [${data.payload.id}] diperbarui: ${data.payload.status}`, data.payload, 'info');
            loadCameras();
          } else {
            uiLog('WEBSOCKET', `Pesan WebSocket diterima: ${data.event}`, data, 'info');
          }
        } catch (e: any) {
          uiLog('WEBSOCKET', `Gagal parse pesan WebSocket: ${e.message}`, undefined, 'error');
        }
      };

      ws.onclose = () => {
        uiLog('WEBSOCKET', 'Koneksi WebSocket terputus. Menjadwalkan reconnect dalam 3 detik...', undefined, 'warn');
        if (!isDisposed) {
          wsReconnectTimer = setTimeout(connectWs, 3000);
        }
      };

      ws.onerror = () => {
        uiLog('WEBSOCKET', 'WebSocket mengalami network error', undefined, 'error');
        try { ws?.close(); } catch (e) {}
      };
    }

    connectWs();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (focusedCam) closeFocus();
        if (isDrawerOpen) isDrawerOpen = false;
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      isDisposed = true;
      if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
      window.removeEventListener('keydown', handleKeyDown);
      ws?.close();
      pcs.forEach(pc => pc.close());
    };
  });
</script>

{#if !isAuthenticated}
  <!-- Clean Login Gate -->
  <div class="min-h-screen bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100 flex flex-col items-center justify-center p-4">
    <div class="w-full max-w-xs border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 rounded-lg shadow-sm">
      <div class="flex items-center justify-between mb-5 pb-3 border-b border-zinc-200 dark:border-zinc-800">
        <div class="flex items-center gap-2">
          <Shield class="h-4 w-4 text-zinc-900 dark:text-white" />
          <span class="text-xs font-semibold tracking-wider uppercase font-mono">{t.accessTitle}</span>
        </div>
        <div class="flex items-center gap-1">
          <button onclick={toggleLang} class="text-[10px] font-mono px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-900 dark:hover:text-white" title={t.langToggle}>
            {currentLang.toUpperCase()}
          </button>
          <button onclick={toggleTheme} class="text-zinc-500 hover:text-zinc-900 dark:hover:text-white p-1" title={t.themeToggle}>
            {#if isDarkMode}<Sun class="h-3.5 w-3.5 text-amber-400" />{:else}<Moon class="h-3.5 w-3.5" />{/if}
          </button>
        </div>
      </div>

      {#if loginError}
        <div class="mb-4 text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 p-2 rounded">
          {loginError}
        </div>
      {/if}

      <form onsubmit={doLogin} class="space-y-3.5">
        <div>
          <label for="input-login-user" class="block text-[10px] uppercase font-mono text-zinc-500 mb-1">{t.username}</label>
          <input 
            id="input-login-user"
            bind:value={loginUser} 
            required 
            placeholder="admin" 
            class="h-8 w-full rounded border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 text-xs text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-400" 
          />
        </div>
        <div>
          <label for="input-login-pass" class="block text-[10px] uppercase font-mono text-zinc-500 mb-1">{t.password}</label>
          <input 
            id="input-login-pass"
            type="password" 
            bind:value={loginPass} 
            required 
            placeholder="••••••••" 
            class="h-8 w-full rounded border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 text-xs text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-400" 
          />
        </div>
        <button 
          type="submit" 
          class="h-8 w-full rounded bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 text-xs font-semibold font-mono tracking-wide mt-1 transition"
        >
          {t.loginBtn}
        </button>
      </form>
    </div>
  </div>
{:else}
  <!-- Main High-Density Monitoring Console -->
  <div class="min-h-screen bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100 flex flex-col font-sans transition-colors duration-150 relative overflow-x-hidden">
    
    <!-- Top System Header -->
    <header class="h-12 border-b border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950 px-4 md:px-6 flex items-center justify-between sticky top-0 z-30">
      <div class="flex items-center space-x-4">
        <div class="flex items-center gap-2">
          <div class="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></div>
          <span class="text-xs font-bold tracking-wider uppercase font-mono">{t.brand}</span>
        </div>

        <nav class="flex items-center space-x-1 border-l border-zinc-200 dark:border-zinc-800 pl-3">
          <button 
            onclick={() => activeTab = 'live'} 
            class="px-2.5 py-1 rounded text-xs font-medium transition {activeTab === 'live' ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-white' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'}"
          >
            {t.navLive}
          </button>
          <button 
            onclick={() => activeTab = 'settings'} 
            class="px-2.5 py-1 rounded text-xs font-medium transition {activeTab === 'settings' ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-white' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'}"
          >
            {t.navConfig}
          </button>
        </nav>
      </div>

      <!-- Controls & Layout Selectors -->
      <div class="flex items-center space-x-2">
        {#if activeTab === 'live'}
          <!-- Grid Column Selector -->
          <div class="hidden sm:flex items-center rounded border border-zinc-200 dark:border-zinc-800 p-0.5 bg-zinc-100 dark:bg-zinc-900 text-[10px] font-mono">
            <button 
              onclick={() => gridColumnsMode = 'auto'} 
              class="px-2 py-0.5 rounded transition {gridColumnsMode === 'auto' ? 'bg-white dark:bg-zinc-800 font-bold shadow-sm' : 'text-zinc-500'}"
            >
              {t.auto} ({cameras.length})
            </button>
            <button 
              onclick={() => gridColumnsMode = '1'} 
              class="px-2 py-0.5 rounded transition {gridColumnsMode === '1' ? 'bg-white dark:bg-zinc-800 font-bold shadow-sm' : 'text-zinc-500'}"
            >
              {t.col1}
            </button>
            <button 
              onclick={() => gridColumnsMode = '2'} 
              class="px-2 py-0.5 rounded transition {gridColumnsMode === '2' ? 'bg-white dark:bg-zinc-800 font-bold shadow-sm' : 'text-zinc-500'}"
            >
              {t.col2}
            </button>
            <button 
              onclick={() => gridColumnsMode = '3'} 
              class="px-2 py-0.5 rounded transition {gridColumnsMode === '3' ? 'bg-white dark:bg-zinc-800 font-bold shadow-sm' : 'text-zinc-500'}"
            >
              {t.col3}
            </button>
          </div>

          <!-- Drawer Toggle Button -->
          <button 
            onclick={() => isDrawerOpen = !isDrawerOpen} 
            class="h-7 px-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-mono flex items-center gap-1.5 transition"
            title={t.drawerTitle}
          >
            <Bell class="h-3 w-3" />
            <span class="hidden md:inline">{t.drawerBtn}</span>
            {#if events.length > 0}
              <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
            {/if}
          </button>

          <!-- Add Camera Button -->
          <button 
            onclick={() => showAddModal = true}
            class="h-7 px-2.5 rounded bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 text-xs font-medium flex items-center gap-1 font-mono transition"
          >
            <Plus class="h-3 w-3" />
            <span class="hidden md:inline">{t.addCamera}</span>
          </button>
        {/if}

        <!-- Language Switcher Button -->
        <button 
          onclick={toggleLang} 
          class="h-7 px-2 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-[11px] font-mono font-semibold flex items-center gap-1 transition"
          title={t.langToggle}
        >
          <Languages class="h-3 w-3" />
          <span>{currentLang.toUpperCase()}</span>
        </button>

        <!-- Dark/Light Mode Toggle -->
        <button 
          onclick={toggleTheme} 
          class="h-7 w-7 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 flex items-center justify-center transition"
          title={t.themeToggle}
        >
          {#if isDarkMode}<Sun class="h-3.5 w-3.5 text-amber-400" />{:else}<Moon class="h-3.5 w-3.5 text-zinc-700" />{/if}
        </button>

        <!-- Logout Button -->
        <button 
          onclick={doLogout} 
          class="h-7 w-7 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 flex items-center justify-center transition"
          title={t.logout}
        >
          <LogOut class="h-3.5 w-3.5" />
        </button>
      </div>
    </header>

    <!-- Tab View: Live Monitor -->
    {#if activeTab === 'live'}
      <main class="flex-1 p-3 md:p-5 w-full">
        <div class="grid {getGridClasses()} gap-4">
          {#each cameras as cam (cam.id)}
            <div class="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden shadow-sm flex flex-col group transition hover:border-zinc-400 dark:hover:border-zinc-700">
              
              <!-- Video Header -->
              <div class="px-3.5 py-1.5 bg-zinc-50 dark:bg-zinc-900/60 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="h-1.5 w-1.5 rounded-full {cam.status === 'online' ? 'bg-emerald-500' : 'bg-red-500'}"></span>
                  <span class="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{cam.name}</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 bg-zinc-200/60 dark:bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-800">{cam.ip}</span>
                  <button 
                    onclick={() => openFocus(cam)} 
                    class="text-zinc-400 hover:text-zinc-900 dark:hover:text-white p-0.5" 
                    title={t.clickFocusHint}
                  >
                    <Maximize2 class="h-3 w-3" />
                  </button>
                  <button onclick={() => toggleCamera(cam.id)} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-0.5" title="Toggle On/Off">
                    <Power class="h-3 w-3 {cam.enabled ? 'text-emerald-500' : 'text-zinc-400'}" />
                  </button>
                  <button onclick={() => deleteCamera(cam.id)} class="text-zinc-400 hover:text-red-500 p-0.5" title="Hapus">
                    <Trash2 class="h-3 w-3" />
                  </button>
                </div>
              </div>

              <!-- Clickable Video Screen -->
              <div 
                role="button"
                tabindex="0"
                onclick={() => openFocus(cam)}
                onkeydown={(e) => e.key === 'Enter' && openFocus(cam)}
                class="relative aspect-video bg-black flex items-center justify-center overflow-hidden cursor-pointer"
                title={t.clickFocusHint}
              >
                <video id="video-{cam.id}" autoplay playsinline muted controls class="w-full h-full object-cover pointer-events-none"></video>
                <div id="loader-{cam.id}" class="absolute inset-0 flex items-center justify-center bg-zinc-950 text-[11px] font-mono text-zinc-500">
                  {t.connectingWebRTC}
                </div>
                <!-- Hover Hint Overlay -->
                <div class="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <span class="bg-black/80 text-white text-[10px] font-mono px-2.5 py-1 rounded-full border border-white/20 flex items-center gap-1.5 shadow-lg">
                    <Maximize2 class="h-3 w-3" /> {t.clickFocusHint}
                  </span>
                </div>
              </div>

              <!-- Solid Transparent Bottom Control Bar -->
              <div class="px-3.5 py-1.5 bg-transparent border-t border-zinc-200 dark:border-zinc-800/60 flex items-center justify-between">
                <span class="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">{t.ptzTitle}</span>
                
                <!-- Minimalist Monochrome D-Pad -->
                <div class="flex items-center gap-1">
                  <button 
                    onclick={(e) => { e.stopPropagation(); stepPTZ(cam.id, 'left'); }} 
                    class="h-6 w-6 rounded border border-zinc-300 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 active:scale-95 text-zinc-700 dark:text-zinc-300 flex items-center justify-center transition" 
                    title={t.ptzLeft}
                  >
                    <ArrowLeft class="h-3 w-3" />
                  </button>
                  <button 
                    onclick={(e) => { e.stopPropagation(); stepPTZ(cam.id, 'up'); }} 
                    class="h-6 w-6 rounded border border-zinc-300 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 active:scale-95 text-zinc-700 dark:text-zinc-300 flex items-center justify-center transition" 
                    title={t.ptzUp}
                  >
                    <ArrowUp class="h-3 w-3" />
                  </button>
                  <button 
                    onclick={(e) => { e.stopPropagation(); stepPTZ(cam.id, 'down'); }} 
                    class="h-6 w-6 rounded border border-zinc-300 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 active:scale-95 text-zinc-700 dark:text-zinc-300 flex items-center justify-center transition" 
                    title={t.ptzDown}
                  >
                    <ArrowDown class="h-3 w-3" />
                  </button>
                  <button 
                    onclick={(e) => { e.stopPropagation(); stepPTZ(cam.id, 'right'); }} 
                    class="h-6 w-6 rounded border border-zinc-300 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 active:scale-95 text-zinc-700 dark:text-zinc-300 flex items-center justify-center transition" 
                    title={t.ptzRight}
                  >
                    <ArrowRight class="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          {/each}
        </div>
      </main>
    {:else}
      <!-- Tab View: Settings -->
      <main class="flex-1 p-5 max-w-2xl w-full mx-auto space-y-5">
        <div>
          <h2 class="text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-200 font-mono">{t.settingsTitle}</h2>
          <p class="text-xs text-zinc-500 mt-0.5">{t.settingsDesc}</p>
        </div>

        {#if settingsNotice}
          <div class="rounded border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
            <CheckCircle2 class="h-4 w-4 shrink-0" />
            <span>{settingsNotice}</span>
          </div>
        {/if}

        <form onsubmit={saveSettings} class="space-y-4">
          <!-- Telegram Section -->
          <div class="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 space-y-3">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-200 font-mono border-b border-zinc-200 dark:border-zinc-800 pb-1.5">{t.tgSection}</h3>
            
            <div class="space-y-1">
              <label for="input-tg-token" class="text-[11px] font-mono text-zinc-500">{t.tgToken}</label>
              <input id="input-tg-token" bind:value={tgBotToken} required class="h-8 w-full rounded border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 text-xs text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-400" />
            </div>

            <div class="space-y-1">
              <label for="input-tg-chatid" class="text-[11px] font-mono text-zinc-500">{t.tgChatId}</label>
              <input id="input-tg-chatid" bind:value={tgChatId} required placeholder="-100xxxxxxxxx" class="h-8 w-full rounded border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 text-xs text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-400" />
            </div>

            <button type="button" onclick={testTelegram} class="h-7 px-3 rounded border border-zinc-300 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-xs font-mono transition">
              {t.tgTestBtn}
            </button>
          </div>

          <!-- Auth & Security Section -->
          <div class="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 space-y-3">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-200 font-mono border-b border-zinc-200 dark:border-zinc-800 pb-1.5">{t.adminSection}</h3>
            
            <div class="space-y-1">
              <label for="input-admin-username" class="text-[11px] font-mono text-zinc-500">{t.username}</label>
              <input id="input-admin-username" bind:value={adminUsername} required class="h-8 w-full rounded border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 text-xs text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-400" />
            </div>

            <div class="space-y-1">
              <label for="input-new-pass" class="text-[11px] font-mono text-zinc-500">{t.newPassword}</label>
              <input id="input-new-pass" type="password" bind:value={newPassword} placeholder={t.newPasswordPlaceholder} class="h-8 w-full rounded border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 text-xs text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-400" />
            </div>
          </div>

          <div class="flex justify-end">
            <button type="submit" class="h-8 px-4 rounded bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 text-xs font-semibold font-mono transition">
              {t.saveBtn}
            </button>
          </div>
        </form>
      </main>
    {/if}

    <!-- Slide-Over Drawer: Event Logs & Stream Info -->
    {#if isDrawerOpen}
      <div 
        role="button"
        tabindex="0"
        onclick={() => isDrawerOpen = false}
        onkeydown={(e) => e.key === 'Escape' && (isDrawerOpen = false)}
        class="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 transition-opacity"
      ></div>

      <aside class="fixed right-0 top-0 bottom-0 w-88 md:w-112 lg:w-[460px] bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 z-50 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        <div class="h-12 border-b border-zinc-200 dark:border-zinc-800 px-4 flex items-center justify-between">
          <div class="flex items-center gap-2">
            {#if drawerTab === 'events'}
              <Bell class="h-4 w-4 text-zinc-500" />
            {:else}
              <Terminal class="h-4 w-4 text-emerald-500" />
            {/if}
            <span class="text-xs font-bold uppercase tracking-wider font-mono">{t.drawerTitle}</span>
          </div>
          <button onclick={() => isDrawerOpen = false} class="p-1 rounded text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition">
            <X class="h-4 w-4" />
          </button>
        </div>

        <!-- Navigation Tabs: Events vs Audit Console -->
        <div class="flex border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900/60 p-1.5 gap-1.5">
          <button
            onclick={() => drawerTab = 'events'}
            class="flex-1 py-1.5 px-3 rounded text-xs font-mono font-medium flex items-center justify-center gap-1.5 transition-colors {drawerTab === 'events' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}"
          >
            <Bell class="h-3.5 w-3.5" />
            <span>{t.tabEvents}</span>
            <span class="text-[10px] px-1 rounded bg-zinc-200 dark:bg-zinc-700/60">{events.length}</span>
          </button>
          <button
            onclick={() => drawerTab = 'console'}
            class="flex-1 py-1.5 px-3 rounded text-xs font-mono font-medium flex items-center justify-center gap-1.5 transition-colors {drawerTab === 'console' ? 'bg-white dark:bg-zinc-800 text-emerald-500 dark:text-emerald-400 shadow-xs' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'}"
          >
            <Terminal class="h-3.5 w-3.5" />
            <span>{t.tabConsole}</span>
            <span class="text-[10px] px-1 rounded bg-emerald-500/10 text-emerald-500 font-bold">{consoleLogs.length}</span>
          </button>
        </div>

        {#if drawerTab === 'events'}
          <!-- Camera Status Summary -->
          <div class="p-4 border-b border-zinc-200 dark:border-zinc-800/60 bg-zinc-50 dark:bg-zinc-900/30">
            <span class="text-[10px] font-mono uppercase text-zinc-500 block mb-2">{t.connectedCamSummary}</span>
            <div class="space-y-1.5">
              {#each cameras as c}
                <div class="flex items-center justify-between text-xs">
                  <span class="text-zinc-700 dark:text-zinc-300 font-medium truncate">{c.name}</span>
                  <span class="text-[10px] font-mono px-1.5 py-0.5 rounded {c.status === 'online' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}">
                    {c.status}
                  </span>
                </div>
              {/each}
            </div>
          </div>

          <!-- Realtime Detection Feed -->
          <div class="flex-1 overflow-y-auto p-4 space-y-2">
            <span class="text-[10px] font-mono uppercase text-zinc-500 block mb-2">{t.recentEvents}</span>
            {#if events.length === 0}
              <div class="text-center py-12 text-zinc-500 text-xs font-mono">
                {t.noEvents}
              </div>
            {:else}
              {#each events as evt (evt.id)}
                <div class="rounded border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900/50 p-2.5 text-xs">
                  <div class="flex items-center justify-between mb-1">
                    <span class="font-medium text-zinc-900 dark:text-zinc-200 text-xs truncate">{evt.cameraName}</span>
                    <span class="text-[10px] text-zinc-500 font-mono">{new Date(evt.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p class="text-[11px] text-zinc-500 font-mono flex items-center gap-1.5">
                    <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                    <span>{t.personDetectedTg}</span>
                  </p>
                </div>
              {/each}
            {/if}
          </div>
        {:else}
          <!-- Interactive Audit Console Logs View -->
          <div class="p-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 space-y-2">
            <!-- Filter Pills -->
            <div class="flex items-center justify-between gap-1 overflow-x-auto pb-1 text-[10px] font-mono">
              <div class="flex items-center gap-1">
                {#each ['ALL', 'WEBRTC', 'WEBSOCKET', 'CAMERA', 'PTZ', 'AUTH', 'SETTINGS'] as f}
                  <button
                    onclick={() => consoleFilter = f}
                    class="px-2 py-0.5 rounded transition-colors {consoleFilter === f ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-bold' : 'bg-zinc-200/70 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-700'}"
                  >
                    {f}
                  </button>
                {/each}
              </div>
            </div>

            <!-- Toolbar buttons -->
            <div class="flex items-center justify-between pt-1 text-[11px] font-mono">
              <span class="text-zinc-500 text-[10px]">
                {filteredLogs.length} logs
              </span>
              <div class="flex items-center gap-1.5">
                <button
                  onclick={copyConsoleLogs}
                  class="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 flex items-center gap-1 transition"
                  title="Copy logs to clipboard"
                >
                  {#if copiedNotice}
                    <Check class="h-3 w-3 text-emerald-500" />
                    <span class="text-emerald-500 font-semibold">{t.copied}</span>
                  {:else}
                    <Copy class="h-3 w-3" />
                    <span>{t.copyLogs}</span>
                  {/if}
                </button>
                <button
                  onclick={() => consoleLogs = []}
                  class="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 flex items-center gap-1 transition"
                  title="Clear all logs"
                >
                  <Trash class="h-3 w-3" />
                  <span>{t.clearLogs}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Log stream output -->
          <div class="flex-1 overflow-y-auto p-2.5 font-mono text-[11px] space-y-1.5 bg-zinc-950 text-zinc-200">
            {#if filteredLogs.length === 0}
              <div class="text-center py-16 text-zinc-600 text-xs">
                No logs recorded for filter "{consoleFilter}"
              </div>
            {:else}
              {#each filteredLogs as log (log.id)}
                <div class="p-2 rounded bg-zinc-900/80 border border-zinc-800/80 hover:border-zinc-700 transition">
                  <div class="flex items-start justify-between gap-1.5">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span class="text-zinc-500 text-[10px]">{log.time}</span>
                      <span class="px-1.5 py-0.2 rounded text-[9px] font-bold tracking-wider 
                        {log.tag === 'AUTH' ? 'bg-blue-500/20 text-blue-400' :
                         log.tag === 'WEBSOCKET' ? 'bg-purple-500/20 text-purple-400' :
                         log.tag === 'WEBRTC' ? 'bg-emerald-500/20 text-emerald-400' :
                         log.tag === 'PTZ' ? 'bg-amber-500/20 text-amber-400' :
                         log.tag === 'SETTINGS' ? 'bg-pink-500/20 text-pink-400' :
                         'bg-cyan-500/20 text-cyan-400'}">
                        {log.tag}
                      </span>
                      <span class="h-1.5 w-1.5 rounded-full 
                        {log.level === 'error' ? 'bg-red-500 animate-pulse' :
                         log.level === 'warn' ? 'bg-amber-400' :
                         log.level === 'success' ? 'bg-emerald-400' :
                         'bg-zinc-500'}"></span>
                    </div>
                  </div>
                  <p class="mt-1 text-zinc-300 leading-snug break-words">{log.message}</p>
                  {#if log.data !== undefined}
                    <details class="mt-1.5">
                      <summary class="cursor-pointer text-[10px] text-zinc-500 hover:text-zinc-400 select-none">
                        payload
                      </summary>
                      <pre class="mt-1 p-1.5 rounded bg-black/60 text-[10px] text-zinc-400 overflow-x-auto max-h-36">{JSON.stringify(log.data, null, 2)}</pre>
                    </details>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>

          <div class="p-2 border-t border-zinc-800 bg-zinc-950 text-[10px] font-mono text-zinc-500 flex items-center justify-between">
            <span class="flex items-center gap-1">
              <span class="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Live DevTools mirror active (F12)
            </span>
            <span class="text-zinc-600">Auto-buffered</span>
          </div>
        {/if}
      </aside>
    {/if}

    <!-- Full-Page Focus / Theater Mode Modal -->
    {#if focusedCam}
      <div class="fixed inset-0 z-50 bg-black flex flex-col animate-in fade-in zoom-in-95 duration-150">
        <!-- Top Focus Bar -->
        <div class="h-12 border-b border-zinc-800 bg-zinc-950 px-4 md:px-6 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span class="h-2 w-2 rounded-full {focusedCam.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}"></span>
            <div>
              <h3 class="text-xs font-bold text-white font-mono uppercase tracking-wider">{focusedCam.name}</h3>
              <p class="text-[10px] font-mono text-zinc-500">{focusedCam.ip} • Port ONVIF {focusedCam.port} • H.264 Full HD</p>
            </div>
          </div>

          <div class="flex items-center space-x-2">
            <button 
              onclick={closeFocus} 
              class="h-8 px-3 rounded border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs font-mono flex items-center gap-1.5 transition"
            >
              <Minimize2 class="h-3.5 w-3.5" />
              <span>{t.focusClose}</span>
            </button>
          </div>
        </div>

        <!-- Huge Main Video Feed -->
        <div class="flex-1 relative bg-black flex items-center justify-center p-2 md:p-4 overflow-hidden">
          <video 
            id="focus-video-{focusedCam.id}" 
            autoplay 
            playsinline 
            muted 
            controls 
            class="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          ></video>
        </div>

        <!-- Large Tactical PTZ Controls in Focus Mode -->
        <div class="h-16 border-t border-zinc-800 bg-zinc-950 px-6 flex items-center justify-between">
          <div class="hidden sm:flex items-center gap-4 text-xs font-mono text-zinc-400">
            <span class="flex items-center gap-1.5">
              <Radio class="h-3 w-3 text-emerald-500" />
              <span>{t.webrtcBadge}</span>
            </span>
          </div>

          <!-- Discrete Center PTZ Step Controller -->
          <div class="flex items-center gap-2 mx-auto sm:mx-0">
            <span class="text-xs font-mono text-zinc-500 mr-2 uppercase">{t.ptzTitle}:</span>
            <button 
              onclick={() => stepPTZ(focusedCam!.id, 'left')} 
              class="h-9 w-9 rounded border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 active:scale-95 text-zinc-200 flex items-center justify-center transition" 
              title={t.ptzLeft}
            >
              <ArrowLeft class="h-4 w-4" />
            </button>
            <button 
              onclick={() => stepPTZ(focusedCam!.id, 'up')} 
              class="h-9 w-9 rounded border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 active:scale-95 text-zinc-200 flex items-center justify-center transition" 
              title={t.ptzUp}
            >
              <ArrowUp class="h-4 w-4" />
            </button>
            <button 
              onclick={() => stepPTZ(focusedCam!.id, 'down')} 
              class="h-9 w-9 rounded border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 active:scale-95 text-zinc-200 flex items-center justify-center transition" 
              title={t.ptzDown}
            >
              <ArrowDown class="h-4 w-4" />
            </button>
            <button 
              onclick={() => stepPTZ(focusedCam!.id, 'right')} 
              class="h-9 w-9 rounded border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 active:scale-95 text-zinc-200 flex items-center justify-center transition" 
              title={t.ptzRight}
            >
              <ArrowRight class="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Modal Tambah Kamera -->
  {#if showAddModal}
    <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="w-full max-w-sm border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 rounded-lg shadow-xl space-y-3">
        <h3 class="text-xs font-bold text-zinc-900 dark:text-zinc-100 font-mono uppercase">{t.modalAddTitle}</h3>

        <form onsubmit={handleAddCamera} class="space-y-2.5">
          <div>
            <label for="form-cam-id" class="text-[10px] font-mono text-zinc-500 block mb-0.5">{t.modalCamId}</label>
            <input id="form-cam-id" bind:value={formId} required placeholder="tapo-halaman" class="h-7 w-full rounded border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 text-xs text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none" />
          </div>
          <div>
            <label for="form-cam-name" class="text-[10px] font-mono text-zinc-500 block mb-0.5">{t.modalCamName}</label>
            <input id="form-cam-name" bind:value={formName} required placeholder="Tapo C500 Belakang" class="h-7 w-full rounded border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 text-xs text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none" />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label for="form-cam-ip" class="text-[10px] font-mono text-zinc-500 block mb-0.5">{t.modalCamIp}</label>
              <input id="form-cam-ip" bind:value={formIp} required placeholder="192.168.1.102" class="h-7 w-full rounded border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 text-xs text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none" />
            </div>
            <div>
              <label for="form-cam-port" class="text-[10px] font-mono text-zinc-500 block mb-0.5">{t.modalCamPort}</label>
              <input id="form-cam-port" type="number" bind:value={formPort} required class="h-7 w-full rounded border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 text-xs text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label for="form-cam-user" class="text-[10px] font-mono text-zinc-500 block mb-0.5">{t.modalCamUser}</label>
              <input id="form-cam-user" bind:value={formUser} required class="h-7 w-full rounded border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 text-xs text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none" />
            </div>
            <div>
              <label for="form-cam-pass" class="text-[10px] font-mono text-zinc-500 block mb-0.5">{t.modalCamPass}</label>
              <input id="form-cam-pass" type="password" bind:value={formPass} required class="h-8 w-full rounded border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 text-xs text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none" />
            </div>
          </div>
          <div>
            <label for="form-cam-rtsp" class="text-[10px] font-mono text-zinc-500 block mb-0.5">{t.modalCamRtsp}</label>
            <input id="form-cam-rtsp" bind:value={formRtsp} required placeholder="rtsp://user:pass@192.168.1.102:554/stream1" class="h-7 w-full rounded border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 text-xs text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none" />
          </div>

          <div class="flex justify-end gap-2 pt-2">
            <button type="button" onclick={() => showAddModal = false} class="h-7 px-3 rounded border border-zinc-300 dark:border-zinc-800 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white font-mono">
              {t.cancel}
            </button>
            <button type="submit" class="h-7 px-3 rounded bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 text-xs font-semibold font-mono">
              {t.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  {/if}
{/if}
