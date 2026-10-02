# Monitoring Home — NVR & CCTV Management System

A lightweight, zero-cloud, self-hosted CCTV NVR and live-monitoring hub designed to run efficiently on low-resource ARM64 single-board computers (e.g., Armbian / TV Box S905X with <2 GB RAM).

## Key Features
- **Ultra-Low Latency Streaming:** Powered by `go2rtc` for sub-200ms WebRTC/WHEP browser streaming with 0% CPU transcoding overhead.
- **Hardware-Assisted Event Detection:** Leverages on-device ONVIF WS-Events (`peopleDetector` / `IsPeople`) from TP-Link Tapo and compliant cameras, keeping SBC CPU idle at 0-2%.
- **Smart Dynamic Recorder:** Event-driven FFmpeg stream capture (`-c copy`) with debounce buffers. Temporary clips are automatically uploaded to Telegram and pruned immediately to prevent eMMC storage bloat.
- **Modern Clean Console:** Built with ElysiaJS (Bun runtime), SQLite (`bun:sqlite`), and Svelte 5 with Tailwind CSS (True OLED Dark & Clean Light mode).
- **PTZ Controls:** Discrete step-based pan/tilt controls via native ONVIF relative move.
- **Adaptive Hub:** Dynamic layout grid adapting from single camera to multi-camera split screens, complete with full-page theater view and slide-over event logs.

## Tech Stack
- **Backend:** Bun, ElysiaJS, `node-onvif`, `bun:sqlite`
- **Frontend:** Svelte 5, Vite, Tailwind CSS, Lucide Icons
- **Media Engine:** `go2rtc` (WebRTC / WHEP)
- **Deployment:** Systemd services on ARM64 Linux
