import { TikTokLiveAdapter } from './tiktok/TikTokLiveAdapter.js';

const username = process.env.TIKTOK_USERNAME?.trim();
if (!username) throw new Error('Pon TIKTOK_USERNAME=tu_usuario en .env');

const tiktok = new TikTokLiveAdapter(username);

tiktok.onEvent(event => {
    console.log('\n========== EVENTO NORMALIZADO ==========');
    console.dir(event, { depth: null });
    console.log('========================================\n');
});

try {
    console.log(`Conectando con @${username}...`);

    const session = await tiktok.connect();

    console.log('✅ ADAPTER CONECTADO');
    console.log(`Room ID: ${session.roomId}`);
    console.log('Esperando eventos...\n');

} catch (error) {
    console.error('❌ ERROR DEL ADAPTER');
    console.error(error);
}