const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const config = require('../../config.json');

async function initDB() {
    // 1. Buat atau sambungkan ke database
    const db = await open({
        filename: path.join(__dirname, '../../database.sqlite'),
        driver: sqlite3.Database
    });

    // 2. Buat tabel 'schedules' jika belum pernah dibuat
    await db.exec(`
        CREATE TABLE IF NOT EXISTS schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            genre TEXT NOT NULL
        )
    `);

    // 3. Migrasi otomatis dari config.json hanya jika tabel masih kosong
    const { count } = await db.get('SELECT COUNT(*) as count FROM schedules');
    if (count === 0) {
        console.log('[DATABASE] Membuat jadwal jam dari config.json ke SQLite SQLite...');
        const stmt = await db.prepare('INSERT INTO schedules (start_time, end_time, genre) VALUES (?, ?, ?)');
        
        for (const [timeRange, genre] of Object.entries(config.scheduler)) {
            const [startStr, endStr] = timeRange.split('-');
            await stmt.run(startStr, endStr, genre);
        }
        await stmt.finalize();
        console.log('[DATABASE] Berhasil menanam jadwal awal ke SQLite!');
    }

    return db;
}

module.exports = initDB;