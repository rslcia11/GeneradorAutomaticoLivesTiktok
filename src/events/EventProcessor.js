import {
    EventRuleEngine,
    ACTION
} from '../rules/EventRuleEngine.js';

import {
    PriorityQueue
} from '../rules/PriorityQueue.js';

export class EventProcessor {

    constructor({
        ruleEngine = new EventRuleEngine(),
        queue = new PriorityQueue(),
        onVisualEvent = null
    } = {}) {

        this.ruleEngine = ruleEngine;
        this.queue = queue;
        this.onVisualEvent = onVisualEvent;

        this.stats = {
            received: 0,
            ignored: 0,
            visual: 0,
            queued: 0,
            priority: 0,
            dropped: 0
        };
    }

    process(event) {
        this.stats.received++;

        const decision = this.ruleEngine.evaluate(event);

        switch (decision.action) {

            case ACTION.IGNORE:
                this.stats.ignored++;

                return {
                    decision,
                    queued: false
                };

            case ACTION.VISUAL:
                this.stats.visual++;

                this.#emitVisual(event);

                return {
                    decision,
                    queued: false
                };

            case ACTION.QUEUE:
                return this.#enqueue(
                    event,
                    decision,
                    false
                );

            case ACTION.PRIORITY:
                return this.#enqueue(
                    event,
                    decision,
                    true
                );

            default:
                this.stats.ignored++;

                return {
                    decision,
                    queued: false
                };
        }
    }

    next() {
        return this.queue.dequeue();
    }

    peek() {
        return this.queue.peek();
    }

    clear() {
        this.queue.clear();
    }

    get queueSize() {
        return this.queue.size;
    }

    getStats() {
        return {
            ...this.stats,
            queueSize: this.queue.size
        };
    }

    #enqueue(event, decision, isPriority) {

        const queueItem = {
            event,
            decision,
            queuedAt: Date.now()
        };

        const result = this.queue.enqueue(
            queueItem,
            decision.priority
        );

        if (!result.accepted) {
            this.stats.dropped++;

            return {
                decision,
                queued: false,
                dropped: result.dropped
            };
        }

        if (result.dropped !== null) {
            this.stats.dropped++;
        }

        if (isPriority) {
            this.stats.priority++;
        } else {
            this.stats.queued++;
        }

        return {
            decision,
            queued: true,
            dropped: result.dropped
        };
    }

    #emitVisual(event) {
        if (typeof this.onVisualEvent !== 'function') {
            return;
        }

        try {
            this.onVisualEvent(event);
        } catch (error) {
            console.error(
                '❌ Error procesando evento visual:',
                error
            );
        }
    }
}