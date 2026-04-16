const express = require('express');
const path = require('path');

module.exports = (radio) => {
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

    app.listen(PORT, () => {
        console.log(`[DASHBOARD] Web Dashboard berjalan di port ${PORT}`);
    });
};