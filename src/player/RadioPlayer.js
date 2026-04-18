const googleTTS = require('google-tts-api');
const config = require('../../config.json');

class RadioPlayer {
    constructor(client, shoukaku) {
        this.client = client;
        this.shoukaku = shoukaku;
        this.player = null; 
        this.currentGenre = 'lofi chill';
        this.engine = 'youtube'; // Udah aman pakai YouTube berkat Lavalink
        this.history = [];
        this.songCount = 0;
        this.isPlaying = false;
        
        // FITUR PLAY: Antrean lagu & status pemutar
        this.queue = [];
        this.isRadioPlaying = false; 
        
        // VOLUME KONTROL
        this.volume = 100;
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

    async joinAndStart(channelId, guildId) {
        try {
            const node = this.shoukaku.getIdealNode();
            if (!node) throw new Error('Genset Lavalink belum terdeteksi!');

            this.player = await this.shoukaku.joinVoiceChannel({
                guildId: guildId,
                channelId: channelId,
                shardId: 0,
                deaf: true // Wajib true agar bot tuli (tidak menerima suara user). Mencegah Discord memutus sepihak koneksi suaranya.
            });

            console.log('[RADIO] Berhasil masuk Voice Channel via Lavalink!');
            this.setVolume(this.volume); // Terapkan volume yang tersimpan saat ini

            this.player.on('end', (reason) => {
                console.log('[DEBUG] Track End Reason:', reason ? reason.reason : 'Tidak ada');
                
                // Pastikan format alasan (reason) selalu UPPERCASE agar aman di Shoukaku v3 dan v4
                const endReason = reason && reason.reason ? reason.reason.toUpperCase() : 'UNKNOWN';

                // Cegah loop jika track diganti secara otomatis oleh playTrack()
                if (endReason === 'REPLACED') return;
                
                // Kalau lagu full album tiba-tiba berhenti padahal belum selesai
                let isPremature = false;
                let resumePosition = 0;

                // Pastikan tidak resume kalau lagunya distop paksa (!skip)
                if (endReason !== 'STOPPED' && this.currentSong && !this.currentSong.info.isStream) {
                    if (this.player.position > 10000 && this.player.position < (this.currentSong.info.length - 10000)) {
                        isPremature = true;
                        resumePosition = Math.max(0, this.player.position - 5000);
                        console.log(`[RADIO] Lagu tiba-tiba berhenti! (Reason: ${endReason}, Terakhir: ${this.player.position}ms / ${this.currentSong.info.length}ms) Mencoba auto-resume dari: ${resumePosition}ms`);
                    }
                }
                
                this.isPlaying = false;
                this.playNext({ isResume: isPremature, position: resumePosition });
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

            this.player.on('closed', () => this.leave());
            this.player.on('error', (err) => {
                console.error('[LAVALINK PLAYER ERROR]', err);
                this.isPlaying = false;
                setTimeout(() => this.playNext(), 2000);
            });

            this.playNext();
        } catch (error) {
            console.error('[CRITICAL] Gagal Join:', error.message);
        }
    }

    leave() {
        if (this.player) {
            this.isPlaying = false;
            this.shoukaku.leaveVoiceChannel(this.player.guildId);
            this.player = null;
            console.log('[RADIO] Bot keluar dari VC.');
        }
    }

    setEngine(newEngine) {
        if (newEngine === 'youtube' || newEngine === 'soundcloud') {
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

        if (this.songCount > 0 && this.songCount % config.settings.djVoiceRate === 0 && !opts.isResume) {
            await this.playDJVoice(`Masih di Discord Radio. Saat ini menggunakan mesin ${this.engine}. Selamat mendengarkan.`);
            this.songCount++;
            return;
        }

        try {
            this.isPlaying = true;
            const node = this.shoukaku.getIdealNode();
            if (!node) return;

            let query;
            // Cek apakah genre dari scheduler ini berupa Link URL 
            if (this.currentGenre.startsWith('http://') || this.currentGenre.startsWith('https://')) {
                query = this.currentGenre; // Langsung hajar link-nya (Playlist / Single Video)
                console.log(`[RADIO] Scheduler menggunakan link langsung: ${query}`);
            } else {
                const searchPrefix = this.engine === 'youtube' ? 'ytsearch:' : 'scsearch:';
                query = `${searchPrefix}${this.currentGenre} audio`;
                console.log(`[${this.engine.toUpperCase()}] Mencari: ${query}`);
            }
            
            const result = await node.rest.resolve(query);

            if (!result || result.loadType === 'empty' || result.loadType === 'error' || !result.data) {
                console.log(`[${this.engine.toUpperCase()}] Waduh, lagu nggak ketemu. Skip otomatis...`);
                this.isPlaying = false;
                setTimeout(() => this.playNext(), 3000);
                return;
            }

            let searchData = [];
            // Parse loadType bawaan Lavalink v4
            if (result.loadType === 'playlist') {
                searchData = result.data.tracks;
            } else if (result.loadType === 'search') {
                searchData = result.data;
            } else if (result.loadType === 'track') {
                searchData = [result.data];
            } else {
                // Berjaga-jaga jika balikan list array biasa
                searchData = Array.isArray(result.data) ? result.data : [result.data];
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

    async playDJVoice(text) {
        this.isPlaying = true;
        const url = googleTTS.getAudioUrl(text, { lang: 'id', slow: false, host: 'https://translate.google.com' });
        
        try {
            const node = this.shoukaku.getIdealNode();
            const result = await node.rest.resolve(url); 
            if (result && result.data) {
                // ==========================================
                // PERBAIKAN: Format DJ Voice juga dibungkus
                // ==========================================
                const trackData = result.loadType === 'track' ? result.data : result.data[0];
                await this.player.playTrack({ track: { encoded: trackData.encoded } });
                console.log(`[DJ] Berbicara...`);
            } else {
                throw new Error("Gagal load TTS");
            }
        } catch (error) {
            this.isPlaying = false;
            this.playNext(); 
        }
    }

    setGenre(newGenre) {
        if (this.currentGenre !== newGenre) {
            this.currentGenre = newGenre;
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
        
        if (!result || result.loadType === 'empty' || result.loadType === 'error' || !result.data || (Array.isArray(result.data) && result.data.length === 0)) {
            return sendReply(`❌ Waduh, lagunya nggak ketemu nih di \`${this.engine}\`.`);
        }

        let respMessage = '';
        // Kalau bentuknya Playlist
        if (result.loadType === 'playlist') {
            for (const track of result.data.tracks) {
                this.queue.push(track);
            }
            respMessage = sendReply(`📁 ✅ Playlist **${result.data.info.name}** berhasil ditumpuk ke antrean! (+${result.data.tracks.length} lagu).`);
        } 
        // Kalau bentuknya judul tunggal
        else {
            const track = result.loadType === 'track' ? result.data : result.data[0];
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
}

module.exports = RadioPlayer;