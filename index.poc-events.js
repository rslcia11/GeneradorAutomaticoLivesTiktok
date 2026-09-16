import {
    TikTokLiveConnection,
    WebcastEvent
} from 'tiktok-live-connector';

const tiktokUsername = 'tarotdebeto.co';

const connection = new TikTokLiveConnection(tiktokUsername, {});

console.log(`Intentando conectar al LIVE de @${tiktokUsername}...`);

connection.connect()
    .then(state => {
        console.log('✅ CONECTADO AL LIVE');
        console.log(`Room ID: ${state.roomId}`);
        console.log('Esperando comentarios...\n');
    })
    .catch(error => {
        console.error('❌ ERROR AL CONECTAR');
        console.error(error);
    });

connection.on(WebcastEvent.CHAT, data => {
    console.log(`💬 @${data.user?.displayId}: ${data.content}`);
});
// ===== SUSCRIPCIONES =====
connection.on(WebcastEvent.SUB_NOTIFY, data => {
    console.log('\n========== SUB_NOTIFY ==========');
    console.dir(data, { depth: 5 });
    console.log('================================\n');
});

// ===== FIN DEL LIVE =====
connection.on(WebcastEvent.STREAM_END, data => {
    console.log('\n========== STREAM_END ==========');
    console.dir(data, { depth: 5 });
    console.log('===============================\n');
});

// ===== REGALOS / COMBOS =====
// Ya tenemos GIFT escuchándose arriba.
// Este bloque resumido nos permitirá estudiar repeatCount,
// comboCount y repeatEnd sin revisar objetos gigantes.
connection.on(WebcastEvent.GIFT, data => {
    console.log('\n========== GIFT / COMBO ==========');
    console.log({
        username: data.user?.displayId,
        giftId: data.giftId,
        giftName: data.gift?.name,
        diamondCount: data.gift?.diamondCount,
        repeatCount: data.repeatCount,
        comboCount: data.comboCount,
        repeatEnd: data.repeatEnd,
        combo: data.gift?.combo
    });
    console.log('==================================\n');
});