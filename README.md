# Monitoring Home — NVR & CCTV Management System

A lightweight, zero-cloud, self-hosted CCTV NVR and live-monitoring hub designed specifically to run efficiently on low-resource ARM64 single-board computers (such as Armbian on TV Box S905X with <2 GB RAM).

English | [Bahasa Indonesia](#panduan-bahasa-indonesia)

---

## 🌟 Key Features
- **Ultra-Low Latency Streaming:** Powered by `go2rtc` for sub-200ms WebRTC/WHEP browser streaming with **0% CPU transcoding overhead**.
- **Hardware-Assisted Event Detection:** Leverages native on-device ONVIF WS-Events (`peopleDetector` / `IsPeople`) from TP-Link Tapo and compliant cameras, keeping SBC CPU idle at 0-2%.
- **Smart Dynamic Recorder:** Event-driven FFmpeg stream capture (`-c copy`) with debounce buffers. Clips are uploaded directly to Telegram and immediately deleted locally to prevent storage wear.
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

## 🚀 Quick Start / Installation Guide

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
Copy the sample config and adjust it with your camera's RTSP credentials:
```bash
cp go2rtc.yaml.example go2rtc.yaml
nano go2rtc.yaml
```
Example configuration:
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

### 3. Running the System

#### Option A: Running Manually (Development / Testing)
Run `go2rtc` in the first terminal:
```bash
go2rtc -config /path/to/cctv-gwej/go2rtc.yaml
```
Run the backend server in the second terminal:
```bash
bun run src/server.ts
```

#### Option B: Running via Systemd (Production / Background)
Create the systemd unit for `go2rtc`:
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

Create the systemd unit for the core backend:
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
Enable and start both services:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now go2rtc tapo-cctv
```

---

## 💻 Accessing Dashboard & Initial Setup

1. Open your browser: `http://<YOUR_SERVER_IP>:3000` (e.g., `http://192.168.1.115:3000`)
2. **Default Login Credentials:**
   - **Username:** `admin`
   - **Password:** `admin123`
3. **Camera & Alert Configuration:**
   - Go to the **Settings** tab to enter your Telegram Bot Token & Target Channel ID.
   - Click **Add Camera** in the Live Grid tab to register your ONVIF cameras.

---

<br/>

# 🇮🇩 Panduan Bahasa Indonesia

Sistem NVR & pemantauan CCTV mandiri (self-hosted) tanpa cloud, dirancang khusus agar hemat daya dan resource di komputer single-board (SBC) ARM64 (seperti Armbian di TV Box S905X dengan RAM < 2 GB).

---

## 🌟 Fitur Utama
- **Streaming WebRTC Ultra Cepat:** Didukung `go2rtc` untuk streaming browser berlatensi sangat rendah (<200ms) dengan **beban transcode CPU 0%**.
- **Deteksi Cerdas Hardware AI:** Memanfaatkan deteksi manusia bawaan kamera ONVIF (`peopleDetector` / `IsPeople`), CPU server tetap santai di kisaran 0-2%.
- **Perekam Dinamis Cerdas:** Perekaman video otomatis via FFmpeg (`-c copy`) saat orang lewat dengan buffer penenang. Video langsung dikirim ke Telegram dan langsung dihapus dari disk agar eMMC tidak penuh.
- **Hub Grid Adaptif:** Tampilan layar otomatis menyesuaikan jumlah CCTV (1 kamera layar penuh, 2 kamera split 50:50, grid 2x2), lengkap dengan mode fokus teater dan drawer log event.
- **Kontrol PTZ:** Gerakan pan/tilt presisi per-derajat langsung dari antarmuka web via ONVIF relative move.
- **Antarmuka Modern:** Dibangun dengan ElysiaJS (Bun), SQLite, dan Svelte 5 + Tailwind CSS (True Black OLED, Light Mode, serta dukungan i18n Indonesia & Inggris).

---

## 🛠️ Kebutuhan Sistem (Prerequisites)
Pastikan server Anda (Linux ARM64 / x86_64) sudah terpasang:
1. **Bun runtime** (>= v1.1.0): `curl -fsSL https://bun.sh/install | bash`
2. **FFmpeg**: `sudo apt install ffmpeg`
3. **Binary go2rtc**:
   ```bash
   sudo curl -L https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_arm64 -o /usr/local/bin/go2rtc
   sudo chmod +x /usr/local/bin/go2rtc
   ```

---

## 🚀 Panduan Instalasi Cepat

### 1. Clone Repo & Pasang Dependensi
```bash
git clone https://github.com/hardianto01/cctv-gwej.git
cd cctv-gwej

# Pasang dependensi backend
bun install

# Pasang dependensi UI & build frontend
cd ui
bun install
bun run build
cd ..

# Salin aset frontend ke direktori public
cp -r ui/dist/* public/
```

### 2. Konfigurasi `go2rtc.yaml`
Salin template konfigurasi dan sesuaikan RTSP kamera Anda:
```bash
cp go2rtc.yaml.example go2rtc.yaml
nano go2rtc.yaml
```
Contoh isi:
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

### 3. Menjalankan Sistem

#### Cara Manual (Uji Coba / Dev):
Jalankan di terminal 1:
```bash
go2rtc -config /path/to/cctv-gwej/go2rtc.yaml
```
Jalankan di terminal 2:
```bash
bun run src/server.ts
```

#### Cara Otomatis Background via Systemd (Produksi):
Gunakan systemd service untuk `go2rtc` dan `tapo-cctv` seperti pada panduan bahasa Inggris di atas, lalu aktifkan:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now go2rtc tapo-cctv
```

---

## 💻 Akses Dashboard & Pengaturan Awal

1. Buka browser: `http://<IP_SERVER_ANDA>:3000`
2. **Kredensial Login Default:**
   - **Username:** `admin`
   - **Password:** `admin123`
3. **Pengaturan:**
   - Masuk ke tab **Pengaturan** untuk memasukkan Token Bot Telegram & Chat ID channel.
   - Klik **Tambah Kamera** pada tab Live Grid untuk mendaftarkan kamera Anda.

---

## 🔒 Privasi & Keamanan
- **100% Bebas Cloud:** Pemrosesan video berjalan di jaringan lokal (LAN).
- **Aman untuk eMMC/SD Card:** File rekaman sementara langsung dihapus otomatis dari disk begitu selesai terkirim ke Telegram.
- **Git Higienis:** Kredensial dan file database SQLite disaring aman lewat `.gitignore`.
