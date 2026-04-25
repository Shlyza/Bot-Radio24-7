const express = require('express');
const path = require('path');

module.exports = (radio, db, scheduler) => {
    const app = express();
    const PORT = process.env.PORT || 3000;

    // Sajikan file UI statis (HTML, CSS, JS) dari folder public
    app.use(express.static(path.join(__dirname, 'public')));
    app.use(express.json()); // Wajib ditambahin agar bisa baca data POST dari front-end

    // Buat "Jalur Data" (API) untuk dibaca oleh HTML nanti
    app.get('/api/status', async (req, res) => {
        let listenerCount = 0;
        try {
            // Hitung pendengar (member di Voice Channel - 1 bot)
            if (radio.player && radio.player.guildId) {
                const guild = radio.client.guilds.cache.get(radio.player.guildId);
                if (guild && guild.members.me.voice.channel) {
                    listenerCount = Math.max(0, guild.members.me.voice.channel.members.size - 1);
                }
            }
        } catch (e) {
            listenerCount = 0;
        }

        const node = radio.shoukaku.getIdealNode();
        const nodeStatus = node && node.state === 1 ? 'Connected' : 'Disconnected';
        const position = radio.player && radio.player.position ? radio.player.position : 0;
        
        // Ambil ping spesifik koneksi Voice/Audio (Lavalink) jika bot sedang terhubung
        const voicePing = radio.player && radio.player.ping ? radio.player.ping : 0;
        // Ambil ping teks Gateway Discord
        const botPing = radio.client.ws.ping || 0;

        res.json({
            isPlaying: radio.isPlaying,
            isRadioPlaying: radio.isRadioPlaying,
            currentGenre: radio.currentGenreName, // Kirim nama genre yang sudah di-parse ke web
            engine: radio.engine,
            songCount: radio.songCount,
            volume: radio.volume,
            currentEQ: radio.currentEQ,
            loopMode: radio.loopMode || 'off', // 'off', 'single', 'queue'
            playbackHistory: radio.playbackHistory || [],
            queue: radio.queue.map(q => q.info), 
            currentSong: radio.currentSong ? radio.currentSong.info : null,
            position: position,
            listenerCount: listenerCount,
            botPing: botPing,
            voicePing: voicePing,
            nodeStatus: nodeStatus,
            uptime: process.uptime() // Uptime runtime nodejs dalam detik
        });
    });

    // API Kontrol Player: Skip, Stop, & Join
    app.post('/api/controls/join', (req, res) => {
        if (!radio.player) {
            const channelId = process.env.DEFAULT_VOICE_ID;
            const channel = radio.client.channels.cache.get(channelId);
            
            if (channel) {
                radio.joinAndStart(channel.id, channel.guild.id);
                res.json({ success: true, message: 'Bot berhasil join voice channel!' });
            } else {
                // Fallback cari voice channel pertama jika ID tidak sesuai
                const guild = radio.client.guilds.cache.first();
                const fallbackChannel = guild ? guild.channels.cache.find(c => c.isVoiceBased()) : null;
                if (fallbackChannel) {
                    radio.joinAndStart(fallbackChannel.id, fallbackChannel.guild.id);
                    res.json({ success: true, message: 'Bot berhasil join voice channel!' });
                } else {
                    res.json({ success: false, message: 'Gagal mencari voice channel (Bot tidak ada akses).' });
                }
            }
        } else {
            res.json({ success: false, message: 'Bot sudah online di Voice Channel.' });
        }
    });

    app.post('/api/controls/skip', (req, res) => {
        if (radio.player) {
            radio.player.stopTrack(); // Memicu playNext otomatis
            res.json({ success: true, message: 'Lagu berhasil di-skip!' });
        } else {
            res.json({ success: false, message: 'Tidak ada lagu yang sedang jalan.' });
        }
    });

    app.post('/api/controls/stop', (req, res) => {
        if (radio.player) {
            radio.leave(); // Keluar dan mematikan player
            res.json({ success: true, message: 'Bot radio berhasil dimatikan.' });
        } else {
            res.json({ success: false, message: 'Bot sudah offline.' });
        }
    });

    app.post('/api/controls/reset', (req, res) => {
        res.json({ success: true, message: 'Mesin bot sedang restart otomatis... Mohon tunggu!' });
        setTimeout(() => {
            if (radio.player) radio.reset();
            process.exit(1); // Force exit biar auto-restart oleh host (Railway/PM2/Nodemon)
        }, 1000);
    });

    // API Mengatur Volume
    app.post('/api/controls/volume', (req, res) => {
        const { volume } = req.body;
        if (typeof volume === 'number') {
            radio.setVolume(volume);
            res.json({ success: true, volume: radio.volume });
        } else {
            res.status(400).json({ success: false, message: 'Volume tidak valid.' });
        }
    });

    // API Mengubah EQ
    app.post('/api/controls/eq', (req, res) => {
        const { eq } = req.body;
        if (eq) {
            const success = radio.setEQ(eq);
            res.json({ success: success, currentEQ: radio.currentEQ });
        } else {
            res.status(400).json({ success: false, message: 'Preset EQ dibutuhkan.' });
        }
    });

    // API Mengubah Loop Mode
    app.post('/api/controls/loop', (req, res) => {
        const { mode } = req.body;
        if (radio.setLoopMode(mode)) {
            res.json({ success: true, mode: radio.loopMode });
        } else {
            res.status(400).json({ success: false, message: 'Mode loop tidak valid. Gunakan off, single, atau queue.' });
        }
    });

    // API Shuffle Antrean
    app.post('/api/controls/shuffle', (req, res) => {
        if (!radio.player) return res.status(400).json({ success: false, message: 'Bot offline' });
        radio.shuffleQueue();
        res.json({ success: true, message: 'Antrean berhasil diacak!' });
    });

    // API untuk merequest lagu langsung ke antrean (seperti command !play) lewat dashboard
    app.post('/api/play', async (req, res) => {
        const { query } = req.body;
        if (!query) return res.status(400).json({ success: false, message: 'Judul lagu dibutuhkan!' });

        if (!radio.player) {
            return res.status(400).json({ success: false, message: 'Bot sedang offline atau tidak ada di Voice Channel!' });
        }

        try {
            const addResult = await radio.addToQueue(query);
            // addToQueue me-return string message
            const isError = addResult.includes('❌');
            res.json({ success: !isError, message: addResult.replace(/[*#]/g, '') });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    // API Mengirim Pesan Teks
    app.post('/api/chat', async (req, res) => {
        const { message } = req.body;
        if (!message) return res.status(400).json({ success: false, message: 'Pesan kosong!' });
        
        try {
            // Kita coba kirim ke channel tempat bot berada, atau cari text channel pertama
            let targetChannelId = null;

            if (radio.player) {
                targetChannelId = radio.player.connection ? radio.player.connection.channelId : radio.player.channelId;
            }
            if (!targetChannelId) {
                targetChannelId = process.env.DEFAULT_VOICE_ID;
            }

            let channel = radio.client.channels.cache.get(targetChannelId);

            // Jika channel utamanya bukan channel yang bisa dichat (atau ga ada), cari fallback Teks
            if (!channel || (!channel.isTextBased() && !channel.members)) {
                const guild = radio.client.guilds.cache.first();
                if (guild) {
                    channel = guild.channels.cache.find(c => c.isTextBased());
                }
            }

            if (channel && channel.isTextBased()) {
                await channel.send('💬 **[Web Admin]:** ' + message);
                res.json({ success: true, message: 'Pesan terkirim ke Discord!' });
            } else {
                res.status(400).json({ success: false, message: 'Gagal mencari channel Discord.' });
            }
        } catch (error) {
            console.error('Error send chat:', error);
            res.status(500).json({ success: false, message: 'Gagal mengirim pesan.' });
        }
    });

    // API Mengelola Antrean (Hapus / Pindah)
    app.post('/api/queue/remove', (req, res) => {
        const { index } = req.body;
        if (typeof index !== 'number' || index < 0 || index >= radio.queue.length) {
            return res.status(400).json({ success: false, message: 'Index tidak valid' });
        }
        const removed = radio.queue.splice(index, 1)[0];
        res.json({ success: true, message: `Lagu ${removed.info.title} dihapus dari antrean.` });
    });

    app.post('/api/queue/move', (req, res) => {
        const { fromIndex, toIndex } = req.body;
        if (typeof fromIndex !== 'number' || fromIndex < 0 || fromIndex >= radio.queue.length || 
            typeof toIndex !== 'number' || toIndex < 0 || toIndex >= radio.queue.length) {
            return res.status(400).json({ success: false, message: 'Index tidak valid' });
        }
        const [movedTrack] = radio.queue.splice(fromIndex, 1);
        radio.queue.splice(toIndex, 0, movedTrack);
        res.json({ success: true, message: `Lagu dipindahkan.` });
    });

    // === FUNGSI BANTU CEK BENTROK JADWAL ===
    async function isOverlap(st, et, excludeId = null) {
        let startTime = parseInt(st.replace(':', ''));
        let endTime = parseInt(et.replace(':', ''));
        if (endTime === 0) endTime = 2400;

        const schedules = await db.all('SELECT * FROM schedules');
        for (const row of schedules) {
            if (excludeId && row.id === parseInt(excludeId)) continue;

            let rowSt = parseInt(row.start_time.replace(':', ''));
            let rowEt = parseInt(row.end_time.replace(':', ''));
            if (rowEt === 0) rowEt = 2400;

            // Jika nambah/edit waktu yang bersinggungan
            if (startTime < rowEt && endTime > rowSt) return true;
        }
        return false;
    }

    // === API DATABASE JADWAL ===
    app.get('/api/schedules', async (req, res) => {
        try {
            const schedules = await db.all('SELECT * FROM schedules ORDER BY start_time ASC');
            res.json({ success: true, data: schedules });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    app.post('/api/schedules/update', async (req, res) => {
        const { id, start_time, end_time, genre } = req.body;
        if (!id || !genre) return res.status(400).json({ success: false, message: 'ID dan Genre baru dibutuhkan!' });

        try {
            if (await isOverlap(start_time, end_time, id)) {
                return res.status(400).json({ success: false, message: 'Jam ini bentrok dengan jadwal lain!' });
            }

            await db.run(
                'UPDATE schedules SET start_time = ?, end_time = ?, genre = ? WHERE id = ?', 
                [start_time, end_time, genre, id]
            );

            // Terapkan perubahan jadwal secara instan ke bot
            const oldGenre = radio.currentGenre;
            if (scheduler) await scheduler.checkAndUpdateGenre();
            if (radio.currentGenre !== oldGenre && radio.player) radio.player.stopTrack();

            res.json({ success: true, message: 'Jadwal berhasil diubah!' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    app.post('/api/schedules/add', async (req, res) => {
        const { start_time, end_time, genre } = req.body;
        if (!genre || !start_time || !end_time) return res.status(400).json({ success: false, message: 'Harap isi semua kolom' });

        try {
            if (await isOverlap(start_time, end_time)) {
                return res.status(400).json({ success: false, message: 'Jam ini bentrok dengan jadwal jadwal lain!' });
            }

            await db.run(
                'INSERT INTO schedules (start_time, end_time, genre) VALUES (?, ?, ?)',
                [start_time, end_time, genre]
            );

            // Terapkan perubahan jadwal secara instan ke bot
            const oldGenre = radio.currentGenre;
            if (scheduler) await scheduler.checkAndUpdateGenre();
            if (radio.currentGenre !== oldGenre && radio.player) radio.player.stopTrack();
            
            res.json({ success: true, message: 'Sesi jadwal baru ditambahkan!' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    app.post('/api/schedules/delete', async (req, res) => {
        const { id } = req.body;
        try {
            await db.run('DELETE FROM schedules WHERE id = ?', [id]);
            
            // Terapkan perubahan jadwal secara instan ke bot
            const oldGenre = radio.currentGenre;
            if (scheduler) await scheduler.checkAndUpdateGenre();
            if (radio.currentGenre !== oldGenre && radio.player) radio.player.stopTrack();

            res.json({ success: true, message: 'Jadwal dihapus!' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    app.listen(PORT, () => {
        console.log(`[DASHBOARD] Web Dashboard berjalan di port ${PORT}`);
    });
};