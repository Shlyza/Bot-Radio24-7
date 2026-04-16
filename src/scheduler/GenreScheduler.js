const cron = require('node-cron');
const config = require('../../config.json');

class GenreScheduler {
    constructor(radioPlayer) {
        this.player = radioPlayer;
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

    checkAndUpdateGenre() {
        // Dapatkan jam dengan memformat langsung ke angka (WIB)
        const hourStr = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour: "numeric", hour12: false });
        // Misal pukul 09:00, parseInt("09") = 9
        const hour = parseInt(hourStr);
        
        let newGenre = 'lofi chill'; // Default fallback

        for (const [timeRange, genre] of Object.entries(config.scheduler)) {
            const [startStr, endStr] = timeRange.split('-');
            const startHour = parseInt(startStr.split(':')[0]);
            let endHour = parseInt(endStr.split(':')[0]);
            
            if (endHour === 0) endHour = 24; // Handle format 23:59/00:00

            if (hour >= startHour && hour < endHour) {
                newGenre = genre;
                break;
            }
        }

        console.log(`[SCHEDULER] Waktu menunjukkan jam ${hour}. Set genre ke: ${newGenre}`);
        this.player.setGenre(newGenre);
    }
}

module.exports = GenreScheduler;