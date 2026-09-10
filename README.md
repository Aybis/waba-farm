# 🐄 WABA Farm — Peternakan AI Agent Monitoring

Dashboard monitoring **WhatsApp Business API (WABA)** bergaya **peternakan**:

- 🐾 **Setiap nomor WABA = satu kandang + satu hewan AI**
- 🌿 **Hewan lagi makan** = ada proses yang sedang berjalan
- 💤 **Hewan tidur (z Z z)** = agent idle
- 🔥 **Hewan panik + kandang bergetar merah** = ada ERROR
- 💬 **Bubble notifikasi dari hewan** = pesan error tampil langsung dari hewannya

## ✨ Fitur

| Fitur | Keterangan |
|---|---|
| 🌾 **Farm View** | Kandang per nomor WABA, hewan animasi (makan/tidur/panik) |
| 🤖 **Agent View** | Kartu teknis per agent: task, live log, status |
| 📊 **Flow View** | Sankey diagram alur `success/error → in/out → nomor` |
| 🔍 **Detail Session** | Klik kandang/agent → waterfall spans (ala AgentOps) + event log |
| ⚙️ **Konfigurasi** | Ubah nama service & nomor WABA (setiap nomor jadi 1 agent) |
| ▶ **Live mode** | Update otomatis tiap 5 detik |
| 📈 **KPI** | Agent aktif, total pesan, success/error rate, latency |

## 🚀 Cara Menjalankan

```bash
# Buka di folder proyek, lalu jalankan server statis apa saja:
python3 -m http.server 8899
# atau
npx serve
```

Lalu buka `http://localhost:8899/index.html`

### Deploy ke Vercel (gratis)

Static site tanpa build step — tinggal import repo ini di Vercel:

| Setting | Nilai |
|---|---|
| Framework Preset | `Other` |
| Root Directory | `./` |
| Build Command | _(kosongkan)_ |
| Output Directory | _(kosongkan)_ |

Setelah deploy, akses lewat URL `https://<nama-project>.vercel.app`.

## 🛠️ Teknologi

- **Vanilla HTML + CSS + JavaScript** — tanpa dependency, tanpa build step
- **Canvas 2D** untuk Sankey diagram
- **CSS animations** untuk hewan (mengunyah, tidur, panik) & kandang

## ⚠️ Catatan

- Data saat ini **simulasi deterministik** (di-`fetchTelemetry()` di `app.js`) — tinggal ganti dengan data asli dari API WABA/backend kamu.
- Konfigurasi service & nomor tersimpan di `localStorage`.
