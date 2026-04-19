require('dotenv').config();

// Paksa zona waktu seluruh sistem Node.js jadi Waktu Indonesia Barat (WIB)
process.env.TZ = 'Asia/Jakarta';

const { Client, GatewayIntentBits } = require('discord.js');
const { Shoukaku, Connectors } = require('shoukaku');
const RadioPlayer = require('./src/player/RadioPlayer');
const GenreScheduler = require('./src/scheduler/GenreScheduler');
const fs = require('fs');
const path = require('path');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ] 
});

// ==========================================
// KONFIGURASI KABEL KE GENSET LAVALINK
// ==========================================
const Nodes = [{
    name: 'MilloHost Lavalink (Asia)', // Nama bebas, untuk log di terminal
    url: 'lava-v4.millohost.my.id:443', // Format: Host:Port
    auth: 'https://discord.gg/mjS5J2K3ep', // Masukkan password di sini
    secure: true // Wajib true karena dari penyedia tertulis true (pakai wss/https)
}];

const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes);

shoukaku.on('error', (_, error) => console.error('[LAVALINK ERROR]', error));
shoukaku.on('ready', (name) => console.log(`[SYSTEM] Berhasil tersambung ke ${name}! Mesin siap tempur.`));
// ==========================================

// Masukin shoukaku ke dalam RadioPlayer biar bisa dikendalikan
const radio = new RadioPlayer(client, shoukaku);
const initDB = require('./src/database/db');

// Bungkus dalam async agar bisa nunggu database siap
let db;
let scheduler;

async function startBot() {
    console.log('[SYSTEM] Menyiapkan database...');
    db = await initDB();

    scheduler = new GenreScheduler(radio, db);

    // ==========================================
    // NYALAKAN WEB DASHBOARD
    // ==========================================
    require('./src/dashboard/server.js')(radio, db, scheduler);
    // ==========================================

    client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    // Jalankan fitur penjadwalan genre
    scheduler.start();
    
    // Tunggu 2 detik biar kabel ke Lavalink kepasang sempurna sebelum auto-join
    setTimeout(() => {
        const channel = client.channels.cache.get(process.env.DEFAULT_VOICE_ID);
        if (channel) {
            radio.joinAndStart(channel.id, channel.guild.id);
        } else {
            console.log('[SYSTEM] Bot siap! Silakan ketik !join di server.');
        }
    }, 2000);
});

client.on('messageCreate', async message => {
    // Prefix utama untuk bot versi Railway
    const prefix = process.env.PREFIX || '!';

    if (message.author.bot || !message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'join') {
        if (message.member.voice.channel) {
            radio.joinAndStart(message.member.voice.channel.id, message.guild.id);
            message.reply('✅ Bergabung ke channel pakai mesin Lavalink!');
        } else {
            message.reply('❌ Masuk voice channel dulu, Pak!');
        }
    }

    // COMMAND: ?play [judul_or_link]
    if (command === 'play' || command === 'p') {
        const query = args.join(' ');
        if (!query) return message.reply('🎶 Masukkan judul lagu, link lagu, atau link Playlist YouTube\nCth: `?play lofi hiphop` atau `?play https://...`');
        
        // Deteksi kalo bot-nya blm join VC sama sekali 
        if (!message.member.voice.channel) return message.reply('❌ Ke channel suara (VC) dulu ya Pak!');
        if (!radio.player) {
            await radio.joinAndStart(message.member.voice.channel.id, message.guild.id);
            message.reply('⏳ Terhubung dan memasukkan lagu Anda ke antrean...');
        }

        await radio.addToQueue(query, message);
    }

    if (command === 'leave') {
        radio.leave();
        message.reply('👋 Siap Pak! Mesin dimatikan, bot ijin pamit.');
    }

    // COMMAND: ?list / ?queue (Melihat dan Mengatur Antrean Request)
    if (command === 'list' || command === 'queue' || command === 'q') {
        const subCommand = args[0]?.toLowerCase();

        if (!subCommand || subCommand === 'view') {
            if (radio.queue.length === 0) {
                return message.reply('📭 Antrean request saat ini kosong. Ketik `?play` untuk menambahkan lagu!');
            }
            
            // Tampilkan max 10 lagu
            const queueList = radio.queue.slice(0, 10).map((track, i) => `**${i + 1}.** ${track.info.title}`).join('\n');
            const extra = radio.queue.length > 10 ? `\n*...dan ${radio.queue.length - 10} lagu lainnya*` : '';
            
            message.reply(`📋 **ANTREAN LAGU REQUEST:**\n${queueList}${extra}\n\n*Guna: \`${prefix}list hapus <nomor>\` untuk buang, atau \`${prefix}list pindah <dari> <ke>\` untuk ubah urutan.*`);
            return;
        }

        if (subCommand === 'hapus' || subCommand === 'remove' || subCommand === 'rm') {
            const index = parseInt(args[1]) - 1;
            if (isNaN(index) || index < 0 || index >= radio.queue.length) {
                return message.reply('❌ Masukkan nomor urut lagu yang valid untuk dihapus!');
            }
            const removed = radio.queue.splice(index, 1)[0];
            return message.reply(`🗑️ Berhasil menghapus **${removed.info.title}** dari antrean.`);
        }

        if (subCommand === 'pindah' || subCommand === 'move' || subCommand === 'mv') {
            const fromIndex = parseInt(args[1]) - 1;
            const toIndex = parseInt(args[2]) - 1;
            
            if (isNaN(fromIndex) || fromIndex < 0 || fromIndex >= radio.queue.length || 
                isNaN(toIndex) || toIndex < 0 || toIndex >= radio.queue.length) {
                return message.reply('❌ Nomor urut tidak valid! Pastikan kedua angka ada di dalam batas antrean.');
            }
            
            // Pindahkan lagu
            const [movedTrack] = radio.queue.splice(fromIndex, 1);
            radio.queue.splice(toIndex, 0, movedTrack);
            
            return message.reply(`📦 Berhasil memindahkan **${movedTrack.info.title}** ke urutan **#${toIndex + 1}**.`);
        }

        message.reply(`❌ Perintah tidak dikenal. Gunakan \`${prefix}list\`, \`${prefix}list hapus\`, atau \`${prefix}list pindah\`.`);
    }

    if (command === 'skip') {
        if (radio.player) {
            radio.player.stopTrack(); // Di Lavalink, stopTrack otomatis trigger lagu selanjutnya
            message.reply('⏭️ Lagu telah di-skip!');
        }
    }

    // COMMAND: !clear
    if (command === 'clear') {
        if (radio.queue.length === 0) {
            return message.reply('📭 Antrean sudah kosong, tidak ada yang perlu dihapus.');
        }
        
        const count = radio.queue.length;
        radio.queue = []; // Kosongkan array queue
        message.reply(`🧹 Berhasil menghapus **${count}** lagu dari antrean! Radio akan kembali ke mode jadwal.`);
    }

    if (command === 'genre') {
        message.reply(`📻 Genre aktif: **${radio.currentGenre}**`);
    }

    if (command === 'engine') {
        const selectedEngine = args[0]?.toLowerCase();
        if (!selectedEngine) {
            return message.reply(`📻 Mesin saat ini: **${radio.engine.toUpperCase()}**. \nKetik \`!engine youtube\` atau \`!engine soundcloud\`.`);
        }

        if (radio.setEngine(selectedEngine)) {
            message.reply(`🔄 Mesin diganti ke **${selectedEngine.toUpperCase()}**! Request lagu selanjutnya bakal dialihin ke sana.`);
        } else {
            message.reply('❌ Pilihan tidak valid! Pilih: `youtube` atau `soundcloud`.');
        }
    }

    // COMMAND: !np (Now Playing)
    if (command === 'np' || command === 'nowplaying') {
        if (!radio.isPlaying || !radio.currentSong) {
            return message.reply('❌ Sedang tidak ada lagu yang diputar.');
        }

        const songInfo = radio.currentSong.info;
        const minutes = Math.floor(songInfo.length / 60000);
        const seconds = ((songInfo.length % 60000) / 1000).toFixed(0);
        const duration = `${minutes}:${(seconds < 10 ? "0" : "")}${seconds}`;

        message.reply(`🎧 **SEDANG MENGUDARA** 🎧\n\n🎶 **Judul:** \`${songInfo.title}\`\n👤 **Channel:** \`${songInfo.author}\`\n⌚ **Durasi:** \`${duration}\`\n🔗 **Link:** <${songInfo.uri}>`);
    }

    // COMMAND: !volume
    if (command === 'volume' || command === 'vol') {
        const vol = parseInt(args[0]);
        if (!vol || vol < 1 || vol > 100) return message.reply('🔊 Masukkan angka dari 1 sampai 100.');
        
        if (radio.player) {
            radio.player.setGlobalVolume(vol);
            message.reply(`🔊 Volume diatur menjadi **${vol}%**`);
        }
    }

    // COMMAND: !ping
    if (command === 'ping') {
        message.reply(`🏓 Pong! Latensi Discord: **${client.ws.ping}ms**\n📻 Mesin Aktif: **${radio.engine.toUpperCase()}**`);
    }

    // COMMAND: !help
    if (command === 'help') {
        try {
            const schedules = await db.all('SELECT * FROM schedules ORDER BY start_time ASC');
            const scheduleInfo = schedules.map((row, index) => `**Sesi ${index + 1}** (${row.start_time}-${row.end_time}): \`${row.genre}\``).join('\n');
            
            const helpMessage = `
🎶 **DISCORD RADIO BOT MENU** 🎶

**📋 Perintah Musik & Antrean:**
🔹 **\`!play <judul/link>\`** - Request lagu ke dalam antrean (Alias: \`!p\`)
🔹 **\`!list\`** - Melihat daftar antrean (Alias: \`!q\`)
🔹 **\`!list hapus <nomor>\`** - Menghapus lagu dari antrean
🔹 **\`!list pindah <dari> <ke>\`** - Mengubah urutan lagu di antrean
🔹 **\`!skip\`** - Melewati lagu saat ini
🔹 **\`!clear\`** - Menghapus semua lagu di antrean request
🔹 **\`!np\`** - Menampilkan info lagu yang sedang diputar
🔹 **\`!volume <1-100>\`** - Mengatur besar volume suara (Alias: \`!vol\`)

**📻 Perintah Radio & Sistem:**
🔹 **\`!genre\`** - Melihat genre radio yang memutar otomatis saat ini
🔹 **\`!engine <youtube/soundcloud>\`** - Mengganti sumber pencarian lagu
🔹 **\`!join\`** / **\`!leave\`** - Memanggil/mengeluarkan bot dari Voice Channel
🔹 **\`!ping\`** - Cek latensi bot ke Discord
🔹 **\`!jadwal\`** - Melihat daftar jadwal radio saat ini
🔹 **\`!help\`** - Menampilkan panduan lengkap ini

⏰ **JADWAL RADIO SAAT INI (WIB):**
${scheduleInfo}

Ganti jadwal otomatis ketik: **\`!gantijadwal <nomor_sesi> <genre_atau_link>\`**
Contoh: \`!gantijadwal 2 dangdut koplo\`
`;
            message.reply(helpMessage);
        } catch (error) {
            console.error(error);
            message.reply('❌ Gagal memuat data bantuan.');
        }
    }

    // COMMAND: !jadwal (Menampilkan jadwal radio)
    if (command === 'jadwal') {
        try {
            const schedules = await db.all('SELECT * FROM schedules ORDER BY start_time ASC');
            const scheduleInfo = schedules.map((row, index) => `**Sesi ${index + 1}** (${row.start_time}-${row.end_time}): \`${row.genre}\``).join('\n');
            
            message.reply(`⏰ **JADWAL RADIO SAAT INI (WIB):**\n\n${scheduleInfo}\n\n*Ganti jadwal ketik: \`${prefix}gantijadwal <nomor_sesi> <genre_atau_link>\`*`);
        } catch (error) {
            console.error(error);
            message.reply('❌ Gagal memuat jadwal radio.');
        }
    }

    // COMMAND: !gantijadwal (Mengubah jadwal di database secara langsung)
    if (command === 'gantijadwal') {
        const sessionNumber = parseInt(args.shift());
        const newScheduleGenre = args.join(' ');

        if (isNaN(sessionNumber) || sessionNumber < 1 || !newScheduleGenre) {
            return message.reply(`❌ Format salah! Gunakan: \`${prefix}gantijadwal <nomor_sesi> <genre_atau_link>\`\nContoh: \`${prefix}gantijadwal 1 dangdut koplo\`. \nKetik \`${prefix}jadwal\` untuk melihat daftar sesi.`);
        }

        try {
            const schedules = await db.all('SELECT * FROM schedules ORDER BY start_time ASC');

            if (sessionNumber > schedules.length) {
                return message.reply(`❌ Sesi tidak ditemukan! Hanya ada Sesi 1 sampai ${schedules.length}. Ketik \`${prefix}help\`.`);
            }

            const targetSession = schedules[sessionNumber - 1]; // Cari baris dari jadwal lama

            // 1. UPDATE DB: Timpa genre di jadwal tsb
            await db.run('UPDATE schedules SET genre = ? WHERE id = ?', [newScheduleGenre, targetSession.id]);

            // 2. SURUH SCHEDULER BACA ULANG DB:
            if (scheduler) await scheduler.checkAndUpdateGenre();

            message.reply(`✅ Jadwal **Sesi ${sessionNumber} (${targetSession.start_time}-${targetSession.end_time})** berhasil diubah menjadi: **${newScheduleGenre}**!`);
        } catch (error) {
            console.error(error);
            message.reply("❌ Gagal menyimpan jadwal ke database.");
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
}

startBot();