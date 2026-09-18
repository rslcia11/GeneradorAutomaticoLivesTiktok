export class PriorityQueue {

    constructor({ maxSize = 100 } = {}) {
        if (!Number.isInteger(maxSize) || maxSize <= 0) {
            throw new Error('maxSize debe ser un entero mayor que 0');
        }

        this.maxSize = maxSize;
        this.items = [];
        this.sequence = 0;
    }

    enqueue(item, priority = 0) {
        const normalizedPriority = Number(priority);

        if (!Number.isFinite(normalizedPriority)) {
            throw new Error('priority debe ser un número válido');
        }

        const entry = {
            item,
            priority: normalizedPriority,
            sequence: this.sequence++
        };

        /*
         * Si todavía hay capacidad, simplemente agregamos.
         */
        if (this.items.length < this.maxSize) {
            this.items.push(entry);
            this.#sort();

            return {
                accepted: true,
                dropped: null
            };
        }

        /*
         * Cola llena:
         *
         * Buscamos el elemento menos importante.
         * Si hay varios con la misma prioridad,
         * descartamos el más nuevo de ellos.
         */
        const worstIndex = this.#findWorstIndex();
        const worst = this.items[worstIndex];

        /*
         * El nuevo elemento no merece desplazar
         * a ninguno de los existentes.
         */
        if (entry.priority <= worst.priority) {
            return {
                accepted: false,
                dropped: item
            };
        }

        /*
         * El nuevo elemento tiene mayor prioridad.
         * Reemplazamos al menos importante.
         */
        const [removed] = this.items.splice(
            worstIndex,
            1,
            entry
        );

        this.#sort();

        return {
            accepted: true,
            dropped: removed.item
        };
    }

    dequeue() {
        const entry = this.items.shift();

        return entry?.item ?? null;
    }

    peek() {
        return this.items[0]?.item ?? null;
    }

    clear() {
        this.items.length = 0;
    }

    get size() {
        return this.items.length;
    }

    get isEmpty() {
        return this.items.length === 0;
    }

    get isFull() {
        return this.items.length >= this.maxSize;
    }

    hasUser(userId) {
        if (userId == null) return false;
        return this.items.some(entry => {
            const u = entry.item?.event?.user;
            return (u?.id ?? u?.username) === userId;
        });
    }

    /*
     * Devuelve una copia para diagnóstico.
     * No exponemos directamente this.items.
     */
    snapshot() {
        return this.items.map(entry => ({
            item: entry.item,
            priority: entry.priority,
            sequence: entry.sequence
        }));
    }

    #sort() {
        this.items.sort((a, b) => {
            /*
             * Mayor prioridad primero.
             */
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }

            /*
             * Misma prioridad:
             * primero el que llegó antes.
             */
            return a.sequence - b.sequence;
        });
    }

    #findWorstIndex() {
        let worstIndex = 0;

        for (let i = 1; i < this.items.length; i++) {
            const current = this.items[i];
            const worst = this.items[worstIndex];

            if (current.priority < worst.priority) {
                worstIndex = i;
                continue;
            }

            /*
             * A igualdad de prioridad consideramos
             * menos valioso al que llegó más tarde.
             */
            if (
                current.priority === worst.priority &&
                current.sequence > worst.sequence
            ) {
                worstIndex = i;
            }
        }

        return worstIndex;
    }
}