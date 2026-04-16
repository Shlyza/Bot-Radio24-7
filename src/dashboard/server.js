const express = require('express');
const path = require('path');

module.exports = (radio) => {
    const app = express();
    const PORT = process.env.PORT || 3000;

    // Sajikan file UI statis (HTML, CSS, JS) dari folder public
    app.use(express.static(path.join(__dirname, 'public')));

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

    app.listen(PORT, () => {
        console.log(`[DASHBOARD] Web Dashboard berjalan di port ${PORT}`);
    });
};