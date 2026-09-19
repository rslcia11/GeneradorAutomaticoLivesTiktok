/**
 * AmbientAudio
 *
 * Música de fondo en loop + efectos sonoros para eventos del LIVE.
 *
 * Música: coloca tu archivo en src/overlay/assets/audio/ambient.mp3
 * Los efectos se generan con Web Audio API (sin archivos extra).
 *
 * Los navegadores bloquean audio hasta el primer gesto del usuario.
 * En OBS el audio arranca solo. Llama unlock() en pointerdown/keydown.
 */
export class AmbientAudio {

    constructor({
        musicSrc = './assets/audio/ambient.mp3',
        musicVolume = 0.22,
        effectsVolume = 0.35
    } = {}) {

        this.musicSrc = musicSrc;
        this.musicVolume = musicVolume;
        this.effectsVolume = effectsVolume;

        this.musicEl = null;
        this.ctx = null;

        this.unlocked = false;
        this.destroyed = false;
    }

    /**
     * Desbloquea audio tras primer gesto del usuario.
     * Llama esto en pointerdown y keydown.
     */
    unlock() {

        if (this.unlocked || this.destroyed) {
            return;
        }

        this.unlocked = true;

        this.#startMusic();
        this.#initContext();
    }

    /**
     * Efectos disponibles:
     *   'gift' | 'follow' | 'share' | 'subscription' | 'thinking' | 'speaking' | 'error'
     */
    playEffect(kind) {

        if (this.destroyed) {
            return;
        }

        /* Si el contexto no está listo (primer evento llega antes del gesto)
           iniciamos en modo sin música y creamos el contexto si hay permiso. */
        if (!this.ctx) {
            this.#initContext();
        }

        if (!this.ctx) {
            return;
        }

        if (this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }

        const presets = {
            gift: {
                notes: [
                    { freq: 784, t: 0,    dur: 0.38 },
                    { freq: 988, t: 0.06, dur: 0.35 },
                    { freq: 1175, t: 0.12, dur: 0.42 }
                ],
                type: 'sine',
                gain: 0.28
            },
            follow: {
                notes: [
                    { freq: 523, t: 0,    dur: 0.28 },
                    { freq: 659, t: 0.07, dur: 0.30 }
                ],
                type: 'sine',
                gain: 0.22
            },
            share: {
                notes: [
                    { freq: 440, t: 0,    dur: 0.22 },
                    { freq: 587, t: 0.06, dur: 0.24 }
                ],
                type: 'sine',
                gain: 0.2
            },
            subscription: {
                notes: [
                    { freq: 523,  t: 0,    dur: 0.38 },
                    { freq: 659,  t: 0.06, dur: 0.36 },
                    { freq: 784,  t: 0.12, dur: 0.38 },
                    { freq: 1047, t: 0.20, dur: 0.50 }
                ],
                type: 'sine',
                gain: 0.32
            },
            thinking: {
                notes: [
                    { freq: 220, t: 0,    dur: 0.55 },
                    { freq: 277, t: 0.08, dur: 0.45 }
                ],
                type: 'triangle',
                gain: 0.14
            },
            speaking: {
                notes: [
                    { freq: 330, t: 0,    dur: 0.30 },
                    { freq: 392, t: 0.06, dur: 0.28 }
                ],
                type: 'sine',
                gain: 0.18
            },
            error: {
                notes: [
                    { freq: 220, t: 0,    dur: 0.35 },
                    { freq: 196, t: 0.10, dur: 0.40 }
                ],
                type: 'triangle',
                gain: 0.18
            }
        };

        const preset = presets[kind];

        if (!preset) {
            return;
        }

        const now = this.ctx.currentTime;
        const masterGain = preset.gain * this.effectsVolume;

        for (const note of preset.notes) {

            const osc = this.ctx.createOscillator();
            const env = this.ctx.createGain();

            osc.type = preset.type;
            osc.frequency.value = note.freq;

            const start = now + note.t;
            const end = start + note.dur;

            env.gain.setValueAtTime(0, start);
            env.gain.linearRampToValueAtTime(masterGain, start + 0.012);
            env.gain.setValueAtTime(masterGain, start + note.dur * 0.35);
            env.gain.exponentialRampToValueAtTime(0.001, end);

            osc.connect(env);
            env.connect(this.ctx.destination);

            osc.start(start);
            osc.stop(end + 0.05);
        }
    }

    setMusicVolume(v) {
        this.musicVolume = Math.max(0, Math.min(1, v));
        if (this.musicEl) {
            this.musicEl.volume = this.musicVolume;
        }
    }

    setEffectsVolume(v) {
        this.effectsVolume = Math.max(0, Math.min(1, v));
    }

    destroy() {
        this.destroyed = true;
        if (this.musicEl) {
            this.musicEl.pause();
            this.musicEl.src = '';
            this.musicEl = null;
        }
        if (this.ctx) {
            this.ctx.close().catch(() => {});
            this.ctx = null;
        }
    }

    #startMusic() {
        this.musicEl = new Audio(this.musicSrc);
        this.musicEl.loop = true;
        this.musicEl.volume = this.musicVolume;

        this.musicEl.play().catch(err => {
            /* En OBS funciona; en navegador normal espera gesto. */
            console.debug('Música ambiental en espera:', err.message);
        });
    }

    #initContext() {
        if (this.ctx) {
            return;
        }
        try {
            this.ctx = new (
                window.AudioContext ||
                window.webkitAudioContext
            )();
        } catch {
            /* Dispositivo sin Web Audio — efectos no disponibles. */
        }
    }
}
