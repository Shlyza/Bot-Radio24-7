const cron = require('node-cron');

class GenreScheduler {
    constructor(radioPlayer, db) {
        this.player = radioPlayer;
        this.db = db;
    }

    start() {
        // Cek setiap jam, di menit ke 0
        cron.schedule('0 * * * *', () => {
            this.checkAndUpdateGenre();
        }, {
            scheduled: true,
            timezone: "Asia/Jakarta"
        });
        
        // Pengecekan pertama saat bot nyala
        this.checkAndUpdateGenre();
    }

    async checkAndUpdateGenre() {
        const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
        const hour = now.getHours();
        
        let newGenre = 'lofi chill'; // Default fallback

        try {
            const schedules = await this.db.all('SELECT * FROM schedules');

            for (const row of schedules) {
                const startHour = parseInt(row.start_time.split(':')[0]);
                let endHour = parseInt(row.end_time.split(':')[0]);
                
                if (endHour === 0) endHour = 24; 

                if (hour >= startHour && hour < endHour) {
                    newGenre = row.genre;
                    break;
                }
            }
        } catch (error) {
            console.error('[SCHEDULER] Gagal mengambil jadwal dari database:', error);
        }

        console.log(`[SCHEDULER] Waktu menunjukkan jam ${hour}. Set genre ke: ${newGenre}`);
        this.player.setGenre(newGenre);
    }
}

module.exports = GenreScheduler;