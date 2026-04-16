const express = require('express');
const path = require('path');

module.exports = (radio, db) => {
    const app = express();
    const PORT = process.env.PORT || 3000;

    // Sajikan file UI statis (HTML, CSS, JS) dari folder public
    app.use(express.static(path.join(__dirname, 'public')));
    app.use(express.json()); // Wajib ditambahin agar bisa baca data POST dari front-end

    // Buat "Jalur Data" (API) untuk dibaca oleh HTML nanti
    app.get('/api/status', (req, res) => {
        res.json({
            isPlaying: radio.isPlaying,
            isRadioPlaying: radio.isRadioPlaying,
            currentGenre: radio.currentGenre,
            engine: radio.engine,
            songCount: radio.songCount,
            queue: radio.queue.map(q => q.info), // Kirim daftar info antreannya saja
            currentSong: radio.currentSong ? radio.currentSong.info : null
        });
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
            await db.run(
                'UPDATE schedules SET start_time = ?, end_time = ?, genre = ? WHERE id = ?', 
                [start_time, end_time, genre, id]
            );
            res.json({ success: true, message: 'Jadwal berhasil diubah!' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    app.post('/api/schedules/add', async (req, res) => {
        const { start_time, end_time, genre } = req.body;
        if (!genre || !start_time || !end_time) return res.status(400).json({ success: false, message: 'Harap isi semua kolom' });

        try {
            await db.run(
                'INSERT INTO schedules (start_time, end_time, genre) VALUES (?, ?, ?)',
                [start_time, end_time, genre]
            );
            res.json({ success: true, message: 'Sesi jadwal baru ditambahkan!' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    app.post('/api/schedules/delete', async (req, res) => {
        const { id } = req.body;
        try {
            await db.run('DELETE FROM schedules WHERE id = ?', [id]);
            res.json({ success: true, message: 'Jadwal dihapus!' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    app.listen(PORT, () => {
        console.log(`[DASHBOARD] Web Dashboard berjalan di port ${PORT}`);
    });
};