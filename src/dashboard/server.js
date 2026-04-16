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
            if (radio.player && radio.player.connection) {
                const channel = await radio.client.channels.fetch(radio.player.connection.channelId).catch(()=>null);
                if (channel) {
                    listenerCount = Math.max(0, channel.members.size - 1);
                }
            }
        } catch (e) {
            listenerCount = 0;
        }

        const node = radio.shoukaku.getIdealNode();
        const nodeStatus = node && node.state === 1 ? 'Connected' : 'Disconnected';
        const position = radio.player && radio.player.position ? radio.player.position : 0;

        res.json({
            isPlaying: radio.isPlaying,
            isRadioPlaying: radio.isRadioPlaying,
            currentGenre: radio.currentGenre,
            engine: radio.engine,
            songCount: radio.songCount,
            queue: radio.queue.map(q => q.info), 
            currentSong: radio.currentSong ? radio.currentSong.info : null,
            position: position,
            listenerCount: listenerCount,
            botPing: radio.client.ws.ping || 0,
            nodeStatus: nodeStatus,
            uptime: process.uptime() // Uptime runtime nodejs dalam detik
        });
    });

    // API Kontrol Player: Skip & Stop
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

    // API untuk mengubah Genre secara manual lewat dashboard
    app.post('/api/genre', (req, res) => {
        const { genre } = req.body;
        if (!genre) return res.status(400).json({ success: false, message: 'Nama genre dibutuhkan!' });

        radio.setGenre(genre);

        // Kasih efek langsung skip memanggil lagu genre baru
        if (radio.player) {
            radio.player.stopTrack(); // skip lagunya agar terputar genre yang baru
        }
        res.json({ success: true, message: `Berhasil ganti genre ke: ${genre}` });
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