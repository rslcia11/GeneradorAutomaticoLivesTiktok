/**
 * SpeechLevel
 *
 * Nivel de apertura de la mandíbula (0..1) mientras el avatar habla.
 *
 * Hoy no hay voz: se sintetiza un ritmo de sílabas creíble.
 * Cuando exista TTS, basta con llamar setExternalLevel()
 * con el volumen real del audio (AnalyserNode) en cada frame.
 */
export class SpeechLevel {

    constructor({
        random = Math.random,
        externalTimeoutS = 0.25
    } = {}) {

        this.random = random;
        this.externalTimeoutS = externalTimeoutS;

        this.level = 0;

        this.syllableTime = 0;
        this.syllableDuration = 0;
        this.syllablePeak = 0;

        this.externalLevel = 0;
        this.externalAge = Infinity;
    }

    setExternalLevel(level) {

        this.externalLevel = Math.min(1, Math.max(0, level));
        this.externalAge = 0;
    }

    update(dt, speaking) {

        this.externalAge += dt;

        const target = this.externalAge < this.externalTimeoutS
            ? this.externalLevel
            : this.#syntheticTarget(dt, speaking);

        /* Abre rápido y cierra un poco más lento, como una boca real. */
        const rate = target > this.level ? 28 : 14;

        this.level += (target - this.level) * Math.min(1, dt * rate);

        return this.level;
    }

    #syntheticTarget(dt, speaking) {

        if (!speaking) {
            this.syllableTime = 0;
            this.syllableDuration = 0;
            return 0;
        }

        this.syllableTime += dt;

        if (this.syllableTime >= this.syllableDuration) {
            this.syllableTime = 0;

            const pause = this.random() < 0.12;

            this.syllableDuration = pause
                ? 0.18 + this.random() * 0.12
                : 0.09 + this.random() * 0.12;

            this.syllablePeak = pause
                ? 0
                : 0.35 + this.random() * 0.65;
        }

        const phase = this.syllableTime / this.syllableDuration;

        return this.syllablePeak * Math.sin(Math.PI * phase);
    }
}
