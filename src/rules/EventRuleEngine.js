const ACTION = Object.freeze({
    IGNORE: 'ignore',
    VISUAL: 'visual',
    QUEUE: 'queue',
    PRIORITY: 'priority'
});

const PRIORITY = Object.freeze({
    LOW: 10,
    NORMAL: 50,
    HIGH: 80,
    CRITICAL: 100
});

export class EventRuleEngine {

    constructor(config = {}) {
        this.config = {
            commentsEnabled: true,
            giftsEnabled: true,
            followsEnabled: true,
            sharesEnabled: true,

            minGiftDiamondsForPriority: 10,

            ...config
        };
    }

    evaluate(event) {
        if (!event || typeof event.type !== 'string') {
            return this.#ignore('invalid_event');
        }

        switch (event.type) {

            case 'comment':
                return this.#evaluateComment(event);

            case 'gift':
                return this.#evaluateGift(event);

            case 'follow':
                return this.#evaluateFollow(event);

            case 'share':
                return this.#evaluateShare(event);

            case 'subscription':
                return this.#evaluateSubscription(event);

            case 'like':
            case 'room_user':
                return this.#visual(event);

            case 'member':
                return this.#ignore('high_frequency_event');

            case 'stream_end':
                return {
                    action: ACTION.VISUAL,
                    priority: PRIORITY.CRITICAL,
                    reason: 'stream_ended',
                    event
                };

            default:
                return this.#ignore('unsupported_event');
        }
    }

    #evaluateComment(event) {
        if (!this.config.commentsEnabled) {
            return this.#ignore('comments_disabled');
        }

        const content = event.content?.trim();

        if (!content) {
            return this.#ignore('empty_comment');
        }

        return {
            action: ACTION.QUEUE,
            priority: PRIORITY.NORMAL,
            reason: 'valid_comment',
            event
        };
    }

    #evaluateGift(event) {
        if (!this.config.giftsEnabled) {
            return this.#ignore('gifts_disabled');
        }

        /*
         * Los regalos con combo pueden generar múltiples eventos.
         * Solo procesamos como acción final cuando repeatEnd = 1.
         */
        if (
            event.gift?.combo === true &&
            Number(event.gift?.repeatEnd) !== 1
        ) {
            return this.#ignore('gift_combo_in_progress');
        }

        const diamondCount =
            Number(event.gift?.diamondCount) || 0;

        const repeatCount =
            Number(event.gift?.repeatCount) || 1;

        const totalDiamonds =
            diamondCount * repeatCount;

        if (
            totalDiamonds >=
            this.config.minGiftDiamondsForPriority
        ) {
            return {
                action: ACTION.PRIORITY,
                priority: PRIORITY.HIGH,
                reason: 'high_value_gift',
                metadata: {
                    totalDiamonds
                },
                event
            };
        }

        return {
            action: ACTION.QUEUE,
            priority: PRIORITY.HIGH,
            reason: 'gift',
            metadata: {
                totalDiamonds
            },
            event
        };
    }

    #evaluateFollow(event) {
        if (!this.config.followsEnabled) {
            return this.#ignore('follows_disabled');
        }

        return {
            action: ACTION.VISUAL,
            priority: PRIORITY.LOW,
            reason: 'follow',
            event
        };
    }

    #evaluateShare(event) {
        if (!this.config.sharesEnabled) {
            return this.#ignore('shares_disabled');
        }

        return {
            action: ACTION.VISUAL,
            priority: PRIORITY.LOW,
            reason: 'share',
            event
        };
    }

    #evaluateSubscription(event) {
        return {
            action: ACTION.PRIORITY,
            priority: PRIORITY.HIGH,
            reason: 'subscription',
            event
        };
    }

    #visual(event) {
        return {
            action: ACTION.VISUAL,
            priority: PRIORITY.LOW,
            reason: 'visual_only',
            event
        };
    }

    #ignore(reason) {
        return {
            action: ACTION.IGNORE,
            priority: PRIORITY.LOW,
            reason
        };
    }
}

export {
    ACTION,
    PRIORITY
};