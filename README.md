# 📻 Bot Radio 24/7

Bot Discord yang menyiarkan radio musik **24 jam nonstop** di Voice Channel. Genre lagu berganti otomatis sesuai jadwal jam (WIB), member bisa request lagu lewat command, dan semuanya bisa dikontrol lewat **web dashboard**.

## ✨ Fitur

- **Radio 24/7** – otomatis join Voice Channel dan terus memutar lagu tanpa henti.
- **Jadwal genre otomatis** – genre berganti per sesi jam (zona waktu `Asia/Jakarta`). Jadwal disimpan di SQLite dan bisa diubah lewat command maupun dashboard.
- **Request lagu** – lewat judul, link lagu, atau link playlist YouTube. Antrean request diprioritaskan sebelum kembali ke mode radio.
- **Manajemen antrean** – lihat, hapus, dan pindah urutan lagu.
- **Equalizer & mode audio** – preset EQ (`bassboost`, `pop`, `rock`, dll.) dan mode `spatial` / `reverb`.
- **Loop & shuffle** – mode loop `off`, `single`, `queue`.
- **Pilihan engine** – YouTube atau SoundCloud.
- **Riwayat pemutaran** – tersimpan di database SQLite.
- **Auto-reconnect & watchdog** – bot menyambung ulang kalau koneksi Lavalink atau voice terputus.
- **Web dashboard** – pantau status, ping, jumlah pendengar, dan kontrol player dari browser.

## 🧰 Teknologi

| Komponen | Library |
| --- | --- |
| Discord | `discord.js` v14 |
| Audio engine | [Lavalink](https://github.com/lavalink-devs/Lavalink) via `shoukaku` |
| Database | `sqlite` + `sqlite3` |
| Scheduler | `node-cron` |
| Dashboard | `express` |
| Pencarian | `yt-search`, `play-dl`, `@distube/ytdl-core` |

Membutuhkan **Node.js 20.x**.

## 🚀 Instalasi

```bash
# 1. Clone repo
git clone https://github.com/Shlyza/Bot-Radio24-7.git
cd Bot-Radio24-7

# 2. Install dependency
npm install

# 3. Buat file .env (lihat bagian di bawah)

# 4. Jalankan bot
npm start
```

## ⚙️ Konfigurasi

### Environment variable (`.env`)

```env
DISCORD_TOKEN=token_bot_discord_kamu
DEFAULT_VOICE_ID=id_voice_channel_default
PREFIX=!
PORT=3000
```

| Variable | Wajib | Keterangan |
| --- | --- | --- |
| `DISCORD_TOKEN` | ✅ | Token bot dari [Discord Developer Portal](https://discord.com/developers/applications) |
| `DEFAULT_VOICE_ID` | ✅ | ID Voice Channel tempat bot siaran otomatis |
| `PREFIX` | ❌ | Prefix command, default `!` |
| `PORT` | ❌ | Port web dashboard, default `3000` |

> Di Discord Developer Portal, aktifkan **Message Content Intent** karena bot membaca command dari isi pesan.

### Lavalink

Bot memakai node Lavalink eksternal. Atur host, port, dan password di `index.js`:

```js
const Nodes = [{
    name: 'Nama Node',
    url: 'host:port',
    auth: 'password_lavalink',
    secure: true
}];
```

### Jadwal genre (`config.json`)

Saat pertama dijalankan (tabel masih kosong), jadwal dari `config.json` dimasukkan ke SQLite. Setelah itu jadwal dibaca dari database.

```json
{
  "scheduler": {
    "00:00-03:00": "lofi sleep relax",
    "06:00-09:00": "morning pop acoustic",
    "12:00-15:00": "Indo Hits"
  }
}
```

Format key: `JJ:MM-JJ:MM`, value: kata kunci genre atau link playlist.

## 💬 Daftar Command

Prefix default `!` (bisa diubah lewat `PREFIX`).

| Command | Alias | Fungsi |
| --- | --- | --- |
| `join` | | Bot masuk ke Voice Channel kamu dan mulai siaran |
| `play <judul/link>` | `p` | Request lagu atau playlist |
| `list` | `queue`, `q` | Lihat antrean request |
| `list hapus <no>` | `remove`, `rm` | Hapus lagu dari antrean |
| `list pindah <dari> <ke>` | `move`, `mv` | Pindah urutan lagu |
| `skip` | | Lewati lagu saat ini |
| `clear` | | Kosongkan antrean, kembali ke mode jadwal |
| `np` | `nowplaying` | Info lagu yang sedang diputar |
| `volume <1-150>` | `vol` | Atur volume |
| `eq [preset]` | `equalizer` | Ganti equalizer |
| `mode [nama]` | `filter` | Ganti mode audio |
| `engine [youtube\|soundcloud]` | | Ganti sumber pencarian lagu |
| `genre` | | Lihat genre aktif |
| `jadwal` | | Lihat jadwal radio |
| `gantijadwal <sesi> <genre/link>` | | Ubah genre pada sesi tertentu |
| `status` | | Ringkasan lagu, volume, EQ, dan mode |
| `ping` | | Cek latensi |
| `reset` | | Restart bot & bersihkan antrean |
| `hardreset` | | Restart lewat `pm2 restart all` |
| `help` | | Daftar bantuan |

**Preset EQ:** `flat`, `bassboost`, `electronic`, `pop`, `rock`, `gaming`, `jernih`, `spotify`, `brutal_jj`

**Mode audio:** `flat`, `spatial`, `reverb`

## 🌐 Web Dashboard

Setelah bot jalan, buka `http://localhost:3000` (atau sesuai `PORT`).

Dashboard menampilkan status siaran, genre aktif, jumlah pendengar, ping bot/voice, antrean, dan riwayat. Dari sini kamu bisa join/stop/skip, atur volume, EQ, mode, loop, shuffle, request lagu, kelola antrean, dan edit jadwal.

<details>
<summary>Daftar endpoint API</summary>

| Method | Endpoint | Fungsi |
| --- | --- | --- |
| GET | `/api/status` | Status lengkap bot |
| POST | `/api/controls/join` | Join voice channel |
| POST | `/api/controls/skip` | Skip lagu |
| POST | `/api/controls/stop` | Stop siaran |
| POST | `/api/controls/reset` | Reset player |
| POST | `/api/controls/volume` | Atur volume |
| POST | `/api/controls/eq` | Atur equalizer |
| POST | `/api/controls/mode` | Atur mode audio |
| POST | `/api/controls/loop` | Atur loop |
| POST | `/api/controls/shuffle` | Acak antrean |
| POST | `/api/play` | Request lagu |
| POST | `/api/chat` | Kirim pesan ke Discord sebagai Web Admin |
| POST | `/api/queue/remove` | Hapus lagu dari antrean |
| POST | `/api/queue/move` | Pindah urutan antrean |
| GET | `/api/schedules` | Lihat jadwal |
| POST | `/api/schedules/add` | Tambah jadwal |
| POST | `/api/schedules/update` | Ubah jadwal |
| POST | `/api/schedules/delete` | Hapus jadwal |

</details>

> ⚠️ Dashboard belum memakai autentikasi. Jangan expose ke internet publik tanpa proteksi tambahan (reverse proxy dengan password, firewall, dll.).

## 📁 Struktur Project

```
Bot-Radio24-7/
├── index.js                  # Entry point: bot, command handler, koneksi Lavalink
├── config.json               # Jadwal genre awal
├── database.sqlite           # Database jadwal & riwayat putar
└── src/
    ├── player/RadioPlayer.js     # Logika player, antrean, EQ, loop
    ├── scheduler/GenreScheduler.js # Pergantian genre per jam (cron)
    ├── database/db.js            # Inisialisasi SQLite
    ├── dashboard/
    │   ├── server.js             # REST API (Express)
    │   └── public/index.html     # UI dashboard
    ├── commands/                 # Command tambahan
    └── utils/logger.js
```

## ☁️ Deployment

Cocok dijalankan di Railway, VPS, atau host lain yang menjaga proses tetap hidup. Command `reset` keluar dengan `process.exit(1)` agar di-restart otomatis oleh host, sedangkan `hardreset` memakai **PM2**.

```bash
pm2 start index.js --name radio-bot
```

## 📝 Lisensi

ISC
