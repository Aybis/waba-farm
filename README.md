# WABA Workstation

Dashboard monitoring **WhatsApp Business API (WABA)** dengan konsep bilik warnet / office workstation. Setiap pasangan **service + nomor WABA** memiliki satu bilik komputer dan satu operator piksel.

## Tampilan dan status

| Status | Operator dan komputer | Bubble status |
|---|---|---|
| `working` | Operator duduk dan mengetik; monitor menyala | Proses pesan aktif / tugas operator |
| `idle` | Operator meninggalkan kursi dan berjalan santai di area bilik; monitor standby | Standby / istirahat |
| `warning` | Operator bergerak tergesa-gesa di meja | Peringatan kuning/oranye dengan penyebab masalah |
| `error` | Operator panik; monitor mengalami gangguan visual | Error merah dengan pesan kegagalan |

Penentuan status menggunakan prioritas berikut, dari yang tertinggi:

1. **Error:** `health` bernilai `ERROR` atau `SERVER`, atau `status` bernilai `ERROR`.
2. **Warning:** `health` atau `status` bernilai `WARN` / `WARNING`, latency **≥ 2,5 detik**, atau `queueDepth` **> 50**.
3. **Working:** `status` bernilai `ACTIVE` / `WORKING`, atau `queueDepth` **> 0**.
4. **Idle:** nomor tanpa kondisi di atas, termasuk `IDLE` dan `DONE` tanpa antrean.

`queueDepth` bersifat opsional. Error tetap diprioritaskan meskipun nomor memiliki antrean atau status aktif. Jumlah error dan pesan error historis saja tidak mengubah status saat ini. Aturan status dan pembentukan bubble reusable berada di `state.js`.

## Fitur

- **Workstation View:** grid bilik responsif, dikelompokkan per service, dengan animasi sesuai status.
- **Filter:** pilih semua service atau satu service, cari nomor/nama service, dan saring status workstation.
- **Metrik:** total pesan, success rate, jumlah error, dan latency tetap tersedia. Tabel serta detail nomor menyediakan rincian telemetry.
- **Kontrol bubble:** tampilkan atau sembunyikan bubble status, termasuk notifikasi error.
- **Live mode:** telemetry diperbarui setiap **15 detik**. Pause menghentikan pembaruan otomatis dan animasi; Refresh meminta pembaruan manual.
- **Agent View dan Flow View:** percakapan inbound/outbound dan diagram aliran pesan tetap tersedia.
- **Detail nomor:** pilih bilik, kartu agent, atau baris tabel untuk melihat metrik, waterfall session, dan event log.
- **Konfigurasi:** ubah service dan nomor WABA melalui **Nomor & Service**. Konfigurasi menggunakan key `localStorage` lama, `waba-monitor-config-v2`, sehingga konfigurasi yang tersimpan tetap terbaca.

## Menjalankan

Tidak memerlukan dependency atau build step. Jalankan server statis dari folder proyek:

```bash
python3 -m http.server 8899
```

Buka [http://localhost:8899/index.html](http://localhost:8899/index.html).

Jalankan pengujian aturan status dan bubble dengan Node.js:

```bash
node --test state.test.js
```

## Implementasi

- `index.html` dan `styles.css`: struktur dashboard, kontrol, tabel, serta modal.
- `app.js`: konfigurasi, telemetry simulasi, filter, KPI, Agent View, Flow View, dan detail nomor.
- `state.js`: pemetaan telemetry ke empat status workstation dan komponen status bubble.
- `workstations.js` dan `workstations.css`: bilik, karakter piksel, serta animasi duduk, mengetik, berjalan, dan panik.

Workstation diperbarui berdasarkan identitas `service + nomor` agar node bilik dapat digunakan kembali saat telemetry berubah. Animasi memakai CSS; bilik di luar layar berhenti beranimasi dan preferensi sistem `prefers-reduced-motion` dihormati. Flow View menggunakan Canvas 2D.

## Sumber data

Data saat ini adalah **simulasi** dari `fetchTelemetry()` di `app.js`, termasuk antrean, pesan, status, dan error. Aplikasi belum terhubung ke API WABA / Meta. Untuk integrasi backend, pertahankan metrik `total`, `success`, `errors`, `errRate`, dan `latency` (dalam detik), beserta identitas `id`, `service`, `number`, `health`, dan `status`; tambahkan `queueDepth` dan `lastError` bila tersedia.
