const googleTTS = require('google-tts-api');
const config = require('../../config.json');

class RadioPlayer {
    constructor(client, shoukaku) {
        this.client = client;
        this.shoukaku = shoukaku;
        this.db = null;
        this.player = null; 
        this.currentGenre = 'lofi chill';
        this.currentGenreName = 'lofi chill';
        this.engine = 'youtube'; // Udah aman pakai YouTube berkat Lavalink
        this.history = [];
        this.songCount = 0;
        this.isPlaying = false;
        
        // FITUR PLAY: Antrean lagu & status pemutar
        this.queue = [];
        this.isRadioPlaying = false; 
        
        // FITUR ADVANCED: LOOP & HISTORY
        this.loopMode = 'off'; // 'off' | 'single' | 'queue'
        this.playbackHistory = []; // Riwayat 10 lagu yang baru diputar

        // VOLUME KONTROL
        this.volume = 100;

        // EQUALIZER & AUDIO MODE
        this.currentEQ = 'flat';
        this.currentMode = 'flat';

        // WATCHDOG ANTI-STUCK
        this.lastPosition = 0;
        this.stuckCount = 0;
        this.lastVoiceChannelId = null;
        this.lastGuildId = null;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        setInterval(() => this.checkWatchdog(), 15000); // Cek setiap 15 detik
    }

    scheduleReconnect() {
        if (!this.lastVoiceChannelId || !this.lastGuildId) return;
        if (this.reconnectTimer) return;

        this.reconnectAttempts += 1;
        const delay = Math.min(30000, 3000 * this.reconnectAttempts);

        console.log(`[RECONNECT] Mencoba masuk ulang ke VC dalam ${delay}ms (percobaan ke-${this.reconnectAttempts})...`);
        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            const joined = await this.joinAndStart(this.lastVoiceChannelId, this.lastGuildId, true);
            if (!joined) {
                this.scheduleReconnect();
            }
        }, delay);
    }

    async setDatabase(db) {
        this.db = db;
        await this.loadPlaybackHistory();
    }

    async loadPlaybackHistory() {
        if (!this.db) return;

        try {
            const rows = await this.db.all(
                'SELECT title, author, url FROM playback_history ORDER BY played_at DESC, id DESC LIMIT 10'
            );
            this.playbackHistory = rows.map(row => ({
                title: row.title,
                author: row.author,
                url: row.url
            }));
        } catch (error) {
            console.error('[HISTORY] Gagal memuat riwayat lagu:', error.message);
            this.playbackHistory = [];
        }
    }

    async savePlaybackHistory(track) {
        if (!this.db || !track || !track.info) return;

        const entry = {
            title: track.info.title,
            author: track.info.author,
            url: track.info.uri
        };

        try {
            await this.db.run(
                'INSERT INTO playback_history (title, author, url) VALUES (?, ?, ?)',
                [entry.title, entry.author, entry.url]
            );

            const rows = await this.db.all(
                'SELECT id FROM playback_history ORDER BY played_at DESC, id DESC'
            );

            if (rows.length > 10) {
                const idsToDelete = rows.slice(10).map(row => row.id);
                const placeholders = idsToDelete.map(() => '?').join(', ');
                await this.db.run(`DELETE FROM playback_history WHERE id IN (${placeholders})`, idsToDelete);
            }
        } catch (error) {
            console.error('[HISTORY] Gagal menyimpan riwayat lagu:', error.message);
        }
    }

    checkWatchdog() {
        if (!this.player || !this.isPlaying) {
            this.stuckCount = 0;
            return;
        }

        // Kalau posisi audio di Lavalink tidak bergerak (termasuk kalau stuck di 0ms pas baru buffering)
        if (this.player.position === this.lastPosition) {
            this.stuckCount++;
            console.log(`[WATCHDOG] Posisi audio tidak bergerak (${this.player.position}ms)... (${this.stuckCount}/3)`);
            
            if (this.stuckCount >= 3) { // Macet tanpa pergerakan selama 45 detik
                console.log('[WATCHDOG] Audio stuck secara total! Memaksa skip ke lagu baru...');
                this.stuckCount = 0;
                this.isPlaying = false;
                
                // Panggil ulang dari playNext atau stopTrack
                if (this.player && typeof this.player.stopTrack === 'function') {
                    this.player.stopTrack(); 
                } else {
                    this.playNext(); 
                }
            }
        } else {
            this.stuckCount = 0;
        }
        
        this.lastPosition = this.player.position || 0;
    }

    setEQ(presetName) {
        if (!this.player) return false;
        
        const EQs = {
            // Flat: Gak ada perubahan, suara asli bawaan lagu
            flat: [],

            // Bassboost: Bass nendang tapi vokal tetep aman, nggak bikin pusing
            bassboost: [
                { band: 0, gain: 0.15 }, { band: 1, gain: 0.10 }, { band: 2, gain: 0.05 },
                { band: 3, gain: 0.0 }, { band: 4, gain: -0.02 }, { band: 5, gain: -0.02 },
                { band: 6, gain: 0.0 }, { band: 7, gain: 0.0 }, { band: 8, gain: 0.0 },
                { band: 9, gain: 0.0 }, { band: 10, gain: 0.0 }, { band: 11, gain: 0.0 },
                { band: 12, gain: 0.0 }, { band: 13, gain: 0.0 }, { band: 14, gain: 0.0 }
            ],

            // Electronic: Punchy di bawah, jernih di atas buat synth & drop
            electronic: [
                { band: 0, gain: 0.10 }, { band: 1, gain: 0.08 }, { band: 2, gain: 0.05 },
                { band: 3, gain: 0.0 }, { band: 4, gain: -0.02 }, { band: 5, gain: 0.0 },
                { band: 6, gain: 0.02 }, { band: 7, gain: 0.02 }, { band: 8, gain: 0.04 },
                { band: 9, gain: 0.05 }, { band: 10, gain: 0.06 }, { band: 11, gain: 0.08 },
                { band: 12, gain: 0.08 }, { band: 13, gain: 0.08 }, { band: 14, gain: 0.08 }
            ],

            // Pop: Vokal maju, instrumen lebih hangat
            pop: [
                { band: 0, gain: 0.04 }, { band: 1, gain: 0.03 }, { band: 2, gain: 0.02 },
                { band: 3, gain: 0.0 }, { band: 4, gain: 0.0 }, { band: 5, gain: 0.02 },
                { band: 6, gain: 0.04 }, { band: 7, gain: 0.05 }, { band: 8, gain: 0.05 },
                { band: 9, gain: 0.04 }, { band: 10, gain: 0.03 }, { band: 11, gain: 0.03 },
                { band: 12, gain: 0.02 }, { band: 13, gain: 0.02 }, { band: 14, gain: 0.02 }
            ],

            // Rock: Mid-range dipoles biar gitar dan drum lebih kerasa teksturnya
            rock: [
                { band: 0, gain: 0.05 }, { band: 1, gain: 0.04 }, { band: 2, gain: 0.03 },
                { band: 3, gain: 0.0 }, { band: 4, gain: -0.02 }, { band: 5, gain: -0.02 },
                { band: 6, gain: 0.0 }, { band: 7, gain: 0.02 }, { band: 8, gain: 0.04 },
                { band: 9, gain: 0.05 }, { band: 10, gain: 0.05 }, { band: 11, gain: 0.06 },
                { band: 12, gain: 0.06 }, { band: 13, gain: 0.06 }, { band: 14, gain: 0.06 }
            ],

            // Gaming: Sub-bass dipotong dikit, fokus ke frekuensi spasial (step, environment)
            gaming: [
                { band: 0, gain: -0.05 }, { band: 1, gain: -0.05 }, { band: 2, gain: -0.03 },
                { band: 3, gain: 0.0 }, { band: 4, gain: 0.0 }, { band: 5, gain: 0.02 },
                { band: 6, gain: 0.04 }, { band: 7, gain: 0.06 }, { band: 8, gain: 0.08 },
                { band: 9, gain: 0.10 }, { band: 10, gain: 0.10 }, { band: 11, gain: 0.12 },
                { band: 12, gain: 0.12 }, { band: 13, gain: 0.10 }, { band: 14, gain: 0.10 }
            ],

            // Jernih: Clarity nambah, nggak bikin kuping cepet capek
            jernih: [
                { band: 0, gain: 0.02 }, { band: 1, gain: 0.02 }, { band: 2, gain: 0.0 },
                { band: 3, gain: 0.0 }, { band: 4, gain: 0.0 }, { band: 5, gain: 0.02 },
                { band: 6, gain: 0.03 }, { band: 7, gain: 0.04 }, { band: 8, gain: 0.05 },
                { band: 9, gain: 0.06 }, { band: 10, gain: 0.07 }, { band: 11, gain: 0.08 },
                { band: 12, gain: 0.09 }, { band: 13, gain: 0.10 }, { band: 14, gain: 0.10 }
            ],

            // Spotify: Balance V-Shape ringan (Karakter pop-modern)
            spotify: [
                { band: 0, gain: 0.08 }, { band: 1, gain: 0.06 }, { band: 2, gain: 0.04 },
                { band: 3, gain: 0.0 }, { band: 4, gain: -0.02 }, { band: 5, gain: -0.02 },
                { band: 6, gain: 0.0 }, { band: 7, gain: 0.02 }, { band: 8, gain: 0.03 },
                { band: 9, gain: 0.04 }, { band: 10, gain: 0.05 }, { band: 11, gain: 0.06 },
                { band: 12, gain: 0.07 }, { band: 13, gain: 0.08 }, { band: 14, gain: 0.08 }
            ],

            // Brutal JJ: Bass super nendang, tapi mid-nya dipotong biar vokal nggak tenggelam
            brutal_jj: [
// 🚨 Sub & Mid-Bass dioverdrive!
                { band: 0, gain: 0.65 }, // Getaran sub-bass level dewa
                { band: 1, gain: 0.50 }, // Punch utama digeber
                { band: 2, gain: 0.25 }, // Transisi bass biar tebel
                
                // 🧹 Area dengung dibantai lebih dalam supaya bass punya ruang buat "bernapas"
                { band: 3, gain: -0.15 }, 
                { band: 4, gain: -0.20 }, 
                { band: 5, gain: -0.15 }, 
                
                // 💎 Treble dinaikin dikit buat ngimbangin bass yang terlalu dominan
                { band: 6, gain: 0.02 }, { band: 7, gain: 0.02 }, { band: 8, gain: 0.04 },
                { band: 9, gain: 0.06 }, { band: 10, gain: 0.08 }, { band: 11, gain: 0.10 },
                { band: 12, gain: 0.10 }, { band: 13, gain: 0.10 }, { band: 14, gain: 0.10 }
            ]
        };

        const eq = presetName.toLowerCase();
        if (EQs.hasOwnProperty(eq)) {
            this.currentEQ = eq;
            this.applyAllFilters(EQs[eq]);
            return true;
        }
        return false;
    }

    setAudioMode(modeName) {
        if (!this.player) return false;
        const validModes = ['flat', 'spatial', 'reverb'];
        const mode = modeName.toLowerCase();
        
        if (validModes.includes(mode)) {
            this.currentMode = mode;
            // Kirim EQs kosong (null) karena applyAllFilters akan ambil ulang dari re-call kalau butuh.
            // Biar gampang, panggil setEQ aja ulang tapi pakai setting saat ini, biar dirender ulang bareng filter mode.
            this.setEQ(this.currentEQ);
            return true;
        }
        return false;
    }

    applyAllFilters(activeEQ) {
        if (!this.player) return;

        let filters = {};

        // 1. Set Equalizer
        if (activeEQ) {
            filters.equalizer = activeEQ;
        }

        // 2. Set Modifikasi (Spatial/Reverb)
        if (this.currentMode === 'spatial') {
            filters.rotation = { rotationHz: 0.15 };
            filters.tremolo = { frequency: 2.0, depth: 0.1 };
        } else if (this.currentMode === 'reverb') {
            filters.karaoke = { level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 };
        }

        // Terapkan ke Shoukaku Player
        if (typeof this.player.setFilters === 'function') {
            this.player.setFilters(filters);
        }
    }

    setVolume(level) {
        this.volume = level;
        if (this.player) {
            // Pada Shoukaku v3/v4 untuk mengubah global volume:
            if (typeof this.player.setGlobalVolume === 'function') {
                this.player.setGlobalVolume(level);
            } else if (this.player.filters) {
                this.player.filters.volume = level / 100;
                this.player.updateFilters();
            }
        }
    }

    async joinAndStart(channelId, guildId, isReconnect = false) {
        try {
            this.lastVoiceChannelId = channelId;
            this.lastGuildId = guildId;

            if (this.player) {
                return true;
            }

            const node = this.shoukaku.getIdealNode();
            if (!node) throw new Error('Genset Lavalink belum terdeteksi!');

            this.player = await this.shoukaku.joinVoiceChannel({
                guildId: guildId,
                channelId: channelId,
                shardId: 0,
                deaf: true // Wajib true agar bot tuli (tidak menerima suara user). Mencegah Discord memutus sepihak koneksi suaranya.
            });

            this.reconnectAttempts = 0;
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }

            console.log(isReconnect ? '[RADIO] Berhasil reconnect ke Voice Channel via Lavalink!' : '[RADIO] Berhasil masuk Voice Channel via Lavalink!');
            this.setVolume(this.volume); // Terapkan volume yang tersimpan saat ini
            this.setEQ(this.currentEQ); // Terapkan EQ yang tersimpan

            this.player.on('end', (reason) => {
                console.log('[DEBUG] Track End Reason:', reason ? reason.reason : 'Tidak ada');
                
                // Pastikan format alasan (reason) selalu UPPERCASE agar aman di Shoukaku v3 dan v4
                const endReason = reason && reason.reason ? reason.reason.toUpperCase() : 'UNKNOWN';

                // Tambahkan ke History
                if (this.currentSong && endReason !== 'REPLACED') {
                    this.playbackHistory.unshift({
                        title: this.currentSong.info.title,
                        author: this.currentSong.info.author,
                        url: this.currentSong.info.uri
                    });
                    if (this.playbackHistory.length > 10) this.playbackHistory.pop();
                    this.savePlaybackHistory(this.currentSong);
                }

                // Cegah loop jika track diganti secara otomatis oleh playTrack()
                if (endReason === 'REPLACED') return;
                
                // HANDLE LOOPING (Mode Single & Queue)
                if (endReason !== 'STOPPED' && this.currentSong) {
                    if (this.loopMode === 'single') {
                        // Taruh kembali di paling depan antrean persis
                        this.queue.unshift(this.currentSong);
                    } else if (this.loopMode === 'queue' && !this.isRadioPlaying) {
                        // Taruh di paling belakang antrean (Hanya kalau track request pengguna)
                        this.queue.push(this.currentSong);
                    }
                }

                // Kalau lagu full album tiba-tiba berhenti padahal belum selesai
                // FITUR RESUME DIMATIKAN: Karena rawan bikin bot nyangkut/mentok pas reconnect
                
                this.isPlaying = false;
                this.playNext(); // Langsung ganti lagu baru aja biar fresh
            });

            this.player.on('exception', (err) => {
                console.error('[DEBUG] Lavalink Track Exception:', err);
                this.isPlaying = false;
                setTimeout(() => this.playNext(), 2000);
            });

            this.player.on('stuck', (data) => {
                console.log('[DEBUG] Lavalink Track Stuck! (Audio macet). Skip otomatis...');
                this.isPlaying = false;
                setTimeout(() => this.playNext(), 2000);
            });

            this.player.on('closed', (data) => {
                console.log('[DEBUG] Player Closed:', data);
                // Jangan auto-leave supaya bot tetap stay 24/7.
                // Coba auto-reconnect ke VC terakhir.
                this.player = null;
                this.isPlaying = false;
                this.scheduleReconnect();
            });
            this.player.on('error', (err) => {
                console.error('[LAVALINK PLAYER ERROR]', err);
                this.isPlaying = false;
                setTimeout(() => this.playNext(), 2000);
            });

            this.playNext();
            return true;
        } catch (error) {
            console.error('[CRITICAL] Gagal Join:', error.message);
            return false;
        }
    }

    // FITUR ADVANCED: Mengatur Mode Loop (off, single, queue)
    setLoopMode(mode) {
        if (['off', 'single', 'queue'].includes(mode)) {
            this.loopMode = mode;
            return true;
        }
        return false;
    }

    // FITUR ADVANCED: Mengacak antrean request pengguna
    shuffleQueue() {
        if (this.queue.length <= 1) return;
        for (let i = this.queue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
        }
    }

    leave() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.reconnectAttempts = 0;
        this.lastVoiceChannelId = null;
        this.lastGuildId = null;

        if (this.player) {
            this.isPlaying = false;
            this.shoukaku.leaveVoiceChannel(this.player.guildId);
            this.player = null;
            console.log('[RADIO] Bot keluar dari VC.');
        }
    }

    setEngine(newEngine) {
        if (newEngine === 'youtube' || newEngine === 'soundcloud' || newEngine === 'spotify') {
            this.engine = newEngine;
            this.history = []; 
            console.log(`[RADIO] Dialihkan ke mesin: ${newEngine.toUpperCase()}`);
            if (this.isPlaying && this.player) this.player.stopTrack(); 
            return true;
        }
        return false;
    }

    async playNext(opts = { isResume: false, position: 0 }) {
        if (this.isPlaying || !this.player) return;

        // Jika lagu terputus di tengah jalan (premature), prioritas utama adalah me-resume lagu saat ini
        if (opts.isResume && this.currentSong) {
            console.log(`[RADIO RESUME] 🎵 Melanjutkan ${this.currentSong.info.title} di posisi ${opts.position}ms`);
            try {
                this.isPlaying = true;
                await this.player.playTrack({ 
                    track: { encoded: this.currentSong.encoded },
                    position: opts.position
                });
                return;
            } catch (error) {
                console.error('[CRITICAL ERROR RESUME]', error.message);
                this.isPlaying = false;
                setTimeout(() => this.playNext(), 3000);
                return;
            }
        }

        // ==========================================
        // CEK ANTREAN LAGU REQUEST USER (PRIORITAS!)
        // ==========================================
        if (this.queue.length > 0) {
            const track = this.queue.shift();
            try {
                this.isPlaying = true;
                this.isRadioPlaying = false; // Matikan status radio
                this.currentSong = track;
                
                await this.player.playTrack({ track: { encoded: track.encoded } });
                console.log(`[REQUEST MENGUDARA] 🎵 ${track.info.title}`);
                return; // Setop sampai sini biar radio gausah dijalanin
            } catch (error) {
                console.error('[CRITICAL ERROR REQUEST]', error.message);
                this.isPlaying = false;
                setTimeout(() => this.playNext(), 3000);
                return;
            }
        }

        // Kalau sampe sini, artinya antrean request kosong -> Lanjut mode Radio
        this.isRadioPlaying = true;

        try {
            this.isPlaying = true;
            const node = this.shoukaku.getIdealNode();
            if (!node) return;

            let query;
            // Cek apakah genre dari scheduler ini berupa Link URL 
            if (this.currentGenre.startsWith('http://') || this.currentGenre.startsWith('https://')) {
                // HAPUS parameter ?si= atau penanda tracking doang pakai URL API, bukan di split "?" mentahan
                try {
                    const urlObj = new URL(this.currentGenre);
                    urlObj.searchParams.delete('si');
                    urlObj.searchParams.delete('t');
                    query = urlObj.toString();
                    
                    // Kalau linknya youtu.be (shortlink), jadikan format standar watch?v=
                    if (urlObj.hostname === 'youtu.be') {
                        const videoId = urlObj.pathname.slice(1);
                        query = `https://www.youtube.com/watch?v=${videoId}`;
                    }
                } catch(e) {
                    query = this.currentGenre; // fallback aman jika error parsing
                }
                
                console.log(`[RADIO] Scheduler menggunakan link langsung: ${query}`);
            } else {
                const searchPrefix = this.engine === 'youtube' ? 'ytsearch:' : (this.engine === 'spotify' ? 'spsearch:' : 'scsearch:');
                query = this.engine === 'spotify' ? `${searchPrefix}${this.currentGenre}` : `${searchPrefix}${this.currentGenre} audio`;
                console.log(`[${this.engine.toUpperCase()}] Mencari: ${query}`);
            }
            
            const result = await node.rest.resolve(query);

            // !! DEBUG RESULT TERBUKA KARENA LAVALINK 4 NGESELIN !!
            if (result) console.log(`[DEBUG RAW RESULT]`, JSON.stringify(result));

            if (!result || ['empty', 'error'].includes(result.loadType) || (!result.data && !result.tracks)) {
                console.log(`[${this.engine.toUpperCase()}] Waduh, lagu nggak ketemu. Skip otomatis...`);
                this.isPlaying = false;
                setTimeout(() => this.playNext(), 3000);
                return;
            }

            let searchData = [];
            let playlistName = null;
            
            // Parse loadType Lavalink v4 + Plugin YT v1.18.0
            if (['playlist', 'search'].includes(result.loadType) || result.loadType === 'PLAYLIST_LOADED' || result.loadType === 'SEARCH_RESULT') {
                searchData = result.data?.tracks || result.tracks || result.data || [];
                if (!Array.isArray(searchData)) searchData = [];
                // Coba format nama playlist jika ada
                if (result.loadType === 'playlist' || result.loadType === 'PLAYLIST_LOADED') {
                    playlistName = result.data?.info?.name || result.playlistInfo?.name;
                }
            } else if (result.loadType === 'track' || result.loadType === 'TRACK_LOADED') {
                searchData = [result.data || result];
            } else {
                // Berjaga-jaga jika balikan list array biasa
                searchData = Array.isArray(result.data) ? result.data : (Array.isArray(result) ? result : [result.data || result]);
            }

            if (searchData.length === 0) {
                console.log(`[RADIO] Data track kosong. Load as skip.`);
                this.isPlaying = false;
                setTimeout(() => this.playNext(), 3000);
                return;
            }

            let validSongs = searchData.filter(song => !this.history.includes(song.info.identifier));
            if (validSongs.length === 0) {
                this.history = [];
                validSongs = searchData;
            }

            const chosenSong = validSongs[Math.floor(Math.random() * validSongs.length)];
            
            this.history.push(chosenSong.info.identifier);
            if (this.history.length > 15) this.history.shift();

            // Simpan track yang sedang putar
            this.currentSong = chosenSong;

            // ==========================================
            // PERBARUI NAMA GENRE BILA MEMAKAI URL
            // ==========================================
            if (this.currentGenre.startsWith('http://') || this.currentGenre.startsWith('https://')) {
                if (playlistName) {
                    this.currentGenreName = `Playlist: ${playlistName}`;
                } else if (chosenSong && chosenSong.info) {
                    this.currentGenreName = `🔗 ${chosenSong.info.title}`;
                }
            }

            // ==========================================
            // PERBAIKAN: Menggunakan { track: { encoded: ... } } (Lavalink v4)
            // ==========================================
            await this.player.playTrack({ track: { encoded: chosenSong.encoded } });
            
            console.log(`[RADIO MENGUDARA] 🎵 ${chosenSong.info.title}`);
            this.songCount++;

        } catch (error) {
            console.error('[CRITICAL ERROR]', error.message);
            this.isPlaying = false;
            setTimeout(() => this.playNext(), 3000);
        }
    }

    setGenre(newGenre) {
        if (this.currentGenre !== newGenre) {
            this.currentGenre = newGenre;
            this.currentGenreName = newGenre; // Reset nama sesuai input
            console.log(`[RADIO] Genre ganti ke: ${newGenre}`);
            if (config.settings.skipOnGenreChange && this.player) {
                this.player.stopTrack(); 
            }
        }
    }

    // Logika ketika user menambah lagu dengan command !play
    async addToQueue(query, message = null) {
        const replyMode = typeof message === 'object' && message !== null;
        const sendReply = (text) => {
            if (replyMode && message.reply) {
                message.reply(text).catch(console.error);
            }
            return text; // Return teks mentahnya juga supaya gampang dibaca API
        };

        const node = this.shoukaku.getIdealNode();
        if (!node) return sendReply('❌ Genset Lavalink tidak tersedia! Coba lagi bentar.');

        // Mengecek apakah yg dimasukkin link / kata biasa
        const isUrl = query.startsWith('http://') || query.startsWith('https://');
        const searchPrefix = this.engine === 'youtube' ? 'ytsearch:' : 'scsearch:';
        // Tambahkan "official audio" di belakang pencarian supaya Lavalink memprioritaskan lagu tanpa video klip/dialog
        const finalQuery = isUrl ? query : `${searchPrefix}${query} audio`;

        const result = await node.rest.resolve(finalQuery);
        
        if (!result || ['empty', 'error'].includes(result.loadType) || (!result.data && !result.tracks)) {
            return sendReply(`❌ Waduh, lagunya nggak ketemu nih di \`${this.engine}\`.`);
        }

        let respMessage = '';
        // Kalau bentuknya Playlist
        if (result.loadType === 'playlist' || result.loadType === 'PLAYLIST_LOADED') {
            const tracks = result.data?.tracks || result.tracks || [];
            for (const track of tracks) {
                this.queue.push(track);
            }
            const name = result.data?.info?.name || result.playlistInfo?.name || "Playlist";
            respMessage = sendReply(`📁 ✅ Playlist **${name}** berhasil ditumpuk ke antrean! (+${tracks.length} lagu).`);
        } 
        // Kalau bentuknya judul tunggal
        else {
            let track;
            if (result.loadType === 'track' || result.loadType === 'TRACK_LOADED') track = result.data || result;
            else if (result.loadType === 'search' || result.loadType === 'SEARCH_RESULT') track = (result.data || result.tracks || [])[0];
            else track = Array.isArray(result.data) ? result.data[0] : (Array.isArray(result) ? result[0] : result.data);

            if (!track) return sendReply(`❌ Gagal membaca respon lagu.`);
            this.queue.push(track);
            respMessage = sendReply(`✅ **${track.info.title}** berhasil ditumpuk ke antrean nomor **#${this.queue.length}**.`);
        }

        // Kalau bot kebetulan lagi muterin radio (bukan antrean user), setop lagunya 
        // Biar antrean user langsung ditarik & muter di prioritas terdepan
        if (this.isPlaying && this.isRadioPlaying) {
            this.player.stopTrack(); // Memicu event 'end' yg otomatis memutar this.queue teratas
        } else if (!this.isPlaying) {
            this.playNext(); // Pancing nyala kalau bot lagi diem
        }

        return respMessage;
    }

    reset() {
        this.queue = [];
        this.history = [];
        this.isRadioPlaying = false;
        this.isPlaying = false;
        if (this.player) {
            this.player.stopTrack(); // Akan memicu playNext karena antrean kosong
        }
        console.log('[RADIO] Player audio telah direset.');
    }
}

module.exports = RadioPlayer;