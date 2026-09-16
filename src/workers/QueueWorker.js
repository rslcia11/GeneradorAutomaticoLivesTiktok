export class QueueWorker {

    constructor({
        processor,
        handler,
        pollIntervalMs = 100,
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
            queueSize: this.processor.queueSize
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

        const queueItem = this.processor.next();

        if (!queueItem) {
            this.#schedule();
            return;
        }

        this.processing = true;

        try {
            const result = await this.handler(queueItem);

            this.stats.processed++;

            if (typeof this.onResult === 'function') {
                try {
                    await this.onResult(
                        result,
                        queueItem
                    );
                } catch (callbackError) {
                    console.error(
                        '❌ Error en onResult:',
                        callbackError
                    );
                }
            }

        } catch (error) {
            this.stats.failed++;

            if (typeof this.onError === 'function') {
                try {
                    await this.onError(
                        error,
                        queueItem
                    );
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

        } finally {
            this.processing = false;

            /*
             * Si todavía existen elementos,
             * procesamos el siguiente inmediatamente.
             *
             * Si está vacía, volvemos al intervalo normal.
             */
            const delay =
                this.processor.queueSize > 0
                    ? 0
                    : this.pollIntervalMs;

            this.#schedule(delay);
        }
    }

    #sleep(ms) {
        return new Promise(resolve => {
            setTimeout(resolve, ms);
        });
    }
}