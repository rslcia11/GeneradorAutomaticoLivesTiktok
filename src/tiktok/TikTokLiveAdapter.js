import {
    TikTokLiveConnection,
    WebcastEvent
} from 'tiktok-live-connector';

export class TikTokLiveAdapter {

    constructor(username) {
        if (!username) {
            throw new Error('TikTok username is required');
        }

        this.username = username;
        this.connection = new TikTokLiveConnection(username, {});
        this.eventHandler = null;
    }

    onEvent(handler) {
        this.eventHandler = handler;
    }

    emit(event) {
        if (this.eventHandler) {
            this.eventHandler(event);
        }
    }

    registerListeners() {

        // Comentarios
        this.connection.on(WebcastEvent.CHAT, data => {
            this.emit({
                platform: 'tiktok',
                type: 'comment',
                timestamp: Date.now(),

                user: {
                    id: data.user?.id,
                    username: data.user?.displayId,
                    nickname: data.user?.nickname
                },

                content: data.content
            });
        });

        // Regalos
        this.connection.on(WebcastEvent.GIFT, data => {
            this.emit({
                platform: 'tiktok',
                type: 'gift',
                timestamp: Date.now(),

                user: {
                    id: data.user?.id,
                    username: data.user?.displayId,
                    nickname: data.user?.nickname
                },

                gift: {
                    id: data.giftId,
                    name: data.gift?.name,
                    diamondCount: data.gift?.diamondCount,
                    image: data.gift?.image?.urlList?.[0] ?? null,

                    repeatCount: data.repeatCount,
                    comboCount: data.comboCount,
                    repeatEnd: data.repeatEnd,
                    combo: data.gift?.combo
                }
            });
        });

        // Likes
        this.connection.on(WebcastEvent.LIKE, data => {
            this.emit({
                platform: 'tiktok',
                type: 'like',
                timestamp: Date.now(),

                user: {
                    id: data.user?.id,
                    username: data.user?.displayId,
                    nickname: data.user?.nickname
                },

                like: {
                    count: data.count,
                    total: data.total
                }
            });
        });

        // Follow
        this.connection.on(WebcastEvent.FOLLOW, data => {
            this.emit({
                platform: 'tiktok',
                type: 'follow',
                timestamp: Date.now(),

                user: {
                    id: data.user?.id,
                    username: data.user?.displayId,
                    nickname: data.user?.nickname
                },

                follow: {
                    count: data.followCount
                }
            });
        });

        // Share
        this.connection.on(WebcastEvent.SHARE, data => {
            this.emit({
                platform: 'tiktok',
                type: 'share',
                timestamp: Date.now(),

                user: {
                    id: data.user?.id,
                    username: data.user?.displayId,
                    nickname: data.user?.nickname
                },

                share: {
                    count: data.shareCount
                }
            });
        });

        // Entrada al LIVE
        this.connection.on(WebcastEvent.MEMBER, data => {
            this.emit({
                platform: 'tiktok',
                type: 'member',
                timestamp: Date.now(),

                user: {
                    id: data.user?.id,
                    username: data.user?.displayId,
                    nickname: data.user?.nickname
                },

                member: {
                    count: data.memberCount
                }
            });
        });

        // Información de audiencia
        this.connection.on(WebcastEvent.ROOM_USER, data => {
            this.emit({
                platform: 'tiktok',
                type: 'room_user',
                timestamp: Date.now(),

                room: {
                    viewers: data.total,
                    totalUsers: data.totalUser,
                    anonymous: data.anonymous
                }
            });
        });

        // Suscripciones
        this.connection.on(WebcastEvent.SUB_NOTIFY, data => {
            this.emit({
                platform: 'tiktok',
                type: 'subscription',
                timestamp: Date.now(),
                raw: data
            });
        });

        // Fin del LIVE
        this.connection.on(WebcastEvent.STREAM_END, data => {
            this.emit({
                platform: 'tiktok',
                type: 'stream_end',
                timestamp: Date.now(),
                raw: data
            });
        });
    }

    async connect() {

        this.registerListeners();

        const state = await this.connection.connect();

        return {
            platform: 'tiktok',
            username: this.username,
            roomId: state.roomId
        };
    }

    /** Lista cruda de regalos de la sala (nombre, precio, imagen). */
    async fetchGifts() {
        return this.connection.fetchAvailableGifts();
    }

    disconnect() {
        this.connection.disconnect();
    }
}