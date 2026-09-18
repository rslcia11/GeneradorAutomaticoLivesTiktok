export class QueueWorker {

    constructor({
        processor,
        handler,
        pollIntervalMs = 100,
        maxItemAgeMs = 60_000,
        onResult = null,
        onError = null
    } = {}) {

        if (!processor) {
            throw new Error('QueueWorker requiere processor');
        }

        if (typeof handler !== 'function') {
            throw new Error('QueueWorker requiere handler');
        }

        if (
            !Number.isInteger(pollIntervalMs) ||
            pollIntervalMs <= 0
        ) {
            throw new Error(
                'pollIntervalMs debe ser un entero mayor que 0'
            );
        }

        this.processor = processor;
        this.handler = handler;
        this.pollIntervalMs = pollIntervalMs;

        this.onResult = onResult;
        this.onError = onError;

        this.maxItemAgeMs = maxItemAgeMs;
        this.blockedUntil = 0;
        this.drainItemsBefore = 0;

        this.running = false;
        this.processing = false;
        this.timer = null;

        this.stats = {
            processed: 0,
            failed: 0
        };
    }

    start() {
        if (this.running) {
            return false;
        }

        this.running = true;

        this.#schedule(0);

        return true;
    }

    async stop() {
        if (!this.running && !this.processing) {
            return;
        }

        this.running = false;

        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        /*
         * Esperamos a que el trabajo actualmente
         * en ejecución termine de forma limpia.
         */
        while (this.processing) {
            await this.#sleep(25);
        }
    }

    getStats() {
        return {
            ...this.stats,
            running: this.running,
            processing: this.processing,
            queueSize: this.processor.queueSize,
            blockedUntil: this.blockedUntil
        };
    }

    #schedule(delay = this.pollIntervalMs) {
        if (!this.running) {
            return;
        }

        this.timer = setTimeout(() => {
            this.timer = null;

            void this.#tick();
        }, delay);
    }

    async #tick() {
        if (!this.running || this.processing) {
            this.#schedule();
            return;
        }

        // Circuit breaker: pausa mientras la cuota esté agotada
        const blockRemaining = this.blockedUntil - Date.now();

        if (blockRemaining > 0) {
            this.#schedule(Math.min(blockRemaining, 5_000));
            return;
        }

        const queueItem = this.processor.next();

        if (!queueItem) {
            this.#schedule();
            return;
        }

        // Descartar items que llegaron durante un bloqueo o son demasiado viejos
        const queuedAt = queueItem.queuedAt ?? 0;
        const age = queuedAt > 0 ? Date.now() - queuedAt : 0;
        const isDuringBlock =
            queuedAt > 0 && queuedAt < this.drainItemsBefore;
        const isStale = age > this.maxItemAgeMs;

        if (isDuringBlock || isStale) {
            console.log(
                `🗑️ Descartando ${queueItem.event?.type} ` +
                `(${isDuringBlock
                    ? 'encolado durante bloqueo'
                    : `${Math.round(age / 1_000)}s de antigüedad`})`
            );
            this.#schedule(0);
            return;
        }

        this.processing = true;

        let blockRetryMs = null;

        try {
            const result = await this.handler(queueItem);

            this.stats.processed++;

            if (typeof this.onResult === 'function') {
                try {
                    await this.onResult(result, queueItem);
                } catch (callbackError) {
                    console.error(
                        '❌ Error en onResult:',
                        callbackError
                    );
                }
            }

        } catch (error) {
            if (error?.code === 'AI_ALL_BLOCKED') {
                const retryMs = error.retryAfterMs ?? 60_000;
                this.blockedUntil = Date.now() + retryMs;
                this.drainItemsBefore = this.blockedUntil;
                blockRetryMs = retryMs;

                console.warn(
                    `⏸️ IA bloqueada por cuota agotada. ` +
                    `Pausa de ${Math.round(retryMs / 1_000)}s. ` +
                    `Comentarios encolados durante este período se descartan.`
                );

            } else {
                this.stats.failed++;

                if (typeof this.onError === 'function') {
                    try {
                        await this.onError(error, queueItem);
                    } catch (callbackError) {
                        console.error(
                            '❌ Error en onError:',
                            callbackError
                        );
                    }
                } else {
                    console.error(
                        '❌ Error procesando elemento de cola:',
                        error
                    );
                }
            }

        } finally {
            this.processing = false;

            const delay = blockRetryMs !== null
                ? blockRetryMs
                : (this.processor.queueSize > 0
                    ? 0
                    : this.pollIntervalMs);

            this.#schedule(delay);
        }
    }

    #sleep(ms) {
        return new Promise(resolve => {
            setTimeout(resolve, ms);
        });
    }
}
