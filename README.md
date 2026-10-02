# Monitoring Home — NVR & CCTV Management System

A lightweight, zero-cloud, self-hosted CCTV NVR and live-monitoring hub designed specifically to run efficiently on low-resource ARM64 single-board computers (such as Armbian on TV Box S905X with <2 GB RAM).

---

## 🌟 Key Features
- **Ultra-Low Latency Streaming:** Powered by `go2rtc` for sub-200ms WebRTC/WHEP browser streaming with **0% CPU transcoding overhead**.
- **Hardware-Assisted Event Detection:** Leverages native on-device ONVIF WS-Events (`peopleDetector` / `IsPeople`) from TP-Link Tapo and compliant cameras, keeping SBC CPU idle at 0-2%.
- **Smart Dynamic Recorder:** Event-driven FFmpeg stream capture (`-c copy`) with debounce buffers. Clips are uploaded directly to Telegram and immediately deleted locally to prevent eMMC storage wear.
- **Adaptive SOC Hub:** Auto-adjusts layout from 1-camera full view to multi-camera split screens (50:50, 2x2 grid), with full-screen focus/theater mode and slide-over event logs.
- **PTZ Controls:** On-screen discrete step controls via ONVIF relative move.
- **Modern Clean Console:** Built with ElysiaJS (Bun runtime), SQLite (`bun:sqlite`), and Svelte 5 with Tailwind CSS (True OLED Dark & Clean Light mode, Dual-language i18n ID & EN).

---

## 🛠️ Prerequisites
Make sure your host machine (Linux ARM64 / x86_64) has the following installed:
1. **Bun runtime** (>= v1.1.0): `curl -fsSL https://bun.sh/install | bash`
2. **FFmpeg**: `sudo apt install ffmpeg`
3. **go2rtc binary**:
   ```bash
   # Download go2rtc ARM64 (adjust for your architecture)
   sudo curl -L https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_arm64 -o /usr/local/bin/go2rtc
   sudo chmod +x /usr/local/bin/go2rtc
   ```

---

## 🚀 Quick Start / Cara Instalasi & Menjalankan

### 1. Clone Repository & Install Dependencies
```bash
git clone https://github.com/hardianto01/cctv-gwej.git
cd cctv-gwej

# Install backend dependencies
bun install

# Install frontend dependencies & build UI
cd ui
bun install
bun run build
cd ..

# Copy frontend assets to public directory
cp -r ui/dist/* public/
```

### 2. Configure `go2rtc.yaml`
Salin template konfigurasi streaming dan sesuaikan dengan alamat kamera Anda:
```bash
cp go2rtc.yaml.example go2rtc.yaml
nano go2rtc.yaml
```
Isi dengan kredensial RTSP kamera Anda:
```yaml
api:
  listen: "127.0.0.1:1984"
rtsp:
  listen: "127.0.0.1:8554"
webrtc:
  listen: "0.0.0.0:8555"
streams:
  tapo-c500:
    - "rtsp://username:password@192.168.1.101:554/stream1"
```

### 3. Run the System

#### Option A: Running Manually (Development / Testing)
Jalankan `go2rtc` di terminal pertama:
```bash
go2rtc -config /path/to/cctv-gwej/go2rtc.yaml
```
Jalankan backend server di terminal kedua:
```bash
bun run src/server.ts
```

#### Option B: Running via Systemd (Production / Background)
Buat service untuk `go2rtc`:
```ini
# /etc/systemd/system/go2rtc.service
[Unit]
Description=go2rtc WebRTC Streaming Engine
After=network.target

[Service]
ExecStart=/usr/local/bin/go2rtc -config /root/cctv-gwej/go2rtc.yaml
Restart=always
User=root

[Install]
WantedBy=multi-user.target
```

Buat service untuk core backend:
```ini
# /etc/systemd/system/tapo-cctv.service
[Unit]
Description=Monitoring Home CCTV Core
After=network.target go2rtc.service

[Service]
WorkingDirectory=/root/cctv-gwej
ExecStart=/root/.bun/bin/bun run src/server.ts
Restart=always
User=root

[Install]
WantedBy=multi-user.target
```
Aktifkan kedua service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now go2rtc tapo-cctv
```

---

## 💻 Accessing Dashboard & Initial Setup

1. Buka browser: `http://<IP_SERVER_ANDA>:3000` (contoh: `http://192.168.1.115:3000`)
2. **Kredensial Default Login:**
   - **Username:** `admin`
   - **Password:** `admin123`
3. **Konfigurasi Kamera & Alert:**
   - Masuk ke tab **Konfigurasi / Settings** untuk memasukkan Token Bot Telegram & Chat ID channel alert.
   - Klik **Tambah Kamera / Add Camera** di tab Live Grid untuk mendaftarkan kamera ONVIF Anda.

---

## 🔒 Security & Privacy
- **Zero-Cloud:** Video stream diproses 100% lokal via LAN.
- **Storage-Friendly:** Klip rekaman sementara langsung dihapus otomatis dari disk setelah berhasil dikirim ke Telegram.
- **Git Hygiene:** Kredensial, file database lokal (`cctv.db`), dan file rekaman disaring ketat melalui `.gitignore`.
