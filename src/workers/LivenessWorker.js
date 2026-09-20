import { randomUUID } from 'node:crypto';
import { INVITATIONS, READINGS } from '../ai/LivenessContent.js';

const TICK_MS_DEFAULT = 5_000;

export class LivenessWorker {

    constructor({
        gateway,
        silenceThresholdMs = 45_000,
        outfitEveryMs      = 4 * 60_000,
        tickMs             = TICK_MS_DEFAULT,
        onOutfitChange     = null,
        log                = console
    } = {}) {

        if (!gateway || typeof gateway.broadcast !== 'function') {
            throw new Error('LivenessWorker requiere gateway con broadcast()');
        }

        this.gateway            = gateway;
        this.silenceThresholdMs = silenceThresholdMs;
        this.outfitEveryMs      = outfitEveryMs;
        this.tickMs             = tickMs;
        this.onOutfitChange     = typeof onOutfitChange === 'function' ? onOutfitChange : null;
        this.log                = log;

        this.silenceMs    = 0;
        this.outfitMs     = 0;
        this.processing   = false;
        this.running      = false;
        this._interval    = null;

        /* Round-robin para no repetir seguido. */
        this._inviteIdx  = 0;
        this._readingIdx = 0;
    }

    start() {
        if (this.running) return false;

        this.running = true;

        this._interval = setInterval(() => {
            this.silenceMs += this.tickMs;
            this.outfitMs  += this.tickMs;

            if (this.outfitMs >= this.outfitEveryMs) {
                this.outfitMs = 0;
                this.onOutfitChange?.();
            }

            if (
                this.silenceMs >= this.silenceThresholdMs &&
                !this.processing
            ) {
                this.silenceMs = 0;
                this.#emitLiveness();
            }
        }, this.tickMs);

        return true;
    }

    stop() {
        if (!this.running) return;
        clearInterval(this._interval);
        this._interval = null;
        this.running   = false;
    }

    resetSilenceTimer() {
        this.silenceMs = 0;
    }

    resetOutfitTimer() {
        this.outfitMs = 0;
    }

    setProcessing(bool) {
        this.processing = Boolean(bool);
    }

    #emitLiveness() {
        const r = Math.random();

        if (r < 0.4) {
            this.#emitInvite();
        } else if (r < 0.8) {
            this.#emitReading();
        } else {
            this.#emitShuffle();
        }
    }

    #emitInvite() {
        const entry = INVITATIONS[this._inviteIdx % INVITATIONS.length];
        this._inviteIdx++;

        this.gateway.broadcast({
            platform:        'system',
            type:            'ai_response',
            interactionId:   randomUUID(),
            text:            entry.text,
            intent:          entry.intent,
            audio:           null,
            user:            null,
            source:          null
        });

        this.log.debug?.('🎭 Liveness invite emitido');
    }

    #emitReading() {
        const entry = READINGS[this._readingIdx % READINGS.length];
        this._readingIdx++;

        this.gateway.broadcast({
            platform:        'system',
            type:            'ai_response',
            interactionId:   randomUUID(),
            text:            `✨ ${entry.card}: ${entry.text}`,
            intent:          entry.intent,
            audio:           null,
            user:            null,
            source:          null
        });

        this.log.debug?.('🃏 Liveness reading emitido');
    }

    #emitShuffle() {
        this.gateway.broadcast({
            platform: 'system',
            type:     'avatar_shuffle'
        });

        this.log.debug?.('🔀 Liveness shuffle emitido');
    }
}
