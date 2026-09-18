const GIFT_TEMPLATES = [
    '¡Gracias @{user} por las {gift}! El mago las recibe con gratitud ✨',
    '¡@{user} tus {gift} alimentan la magia de esta noche! 🔮',
    '¡Muchas gracias @{user}! Que el universo te devuelva tus {gift} multiplicadas 🌟',
    '¡@{user} gracias por las {gift}! Las estrellas anotan tu generosidad 🙏',
    '¡Que honor recibir tus {gift}, @{user}! La energía de hoy brilla más fuerte 🔥',
    '¡Gracias @{user}! Tus {gift} son combustible para la magia del mago ✨',
    '¡@{user} el mago agradece profundamente tus {gift}! Bendiciones para ti 🌙'
];

const SUBSCRIPTION_TEMPLATES = [
    '¡Bienvenido @{user} a la familia del mago! Tu apoyo es sagrado 🙏',
    '¡@{user} gracias por unirte! Las estrellas te acompañan desde hoy ✨',
    '¡@{user} el mago te da la bienvenida! Juntos exploramos el universo 🔮',
    '¡Gracias @{user} por tu suscripción! Que la magia te guíe siempre 🌟'
];

function pick(templates) {
    return templates[Math.floor(Math.random() * templates.length)];
}

function fill(template, vars) {
    return template
        .replace('{user}', vars.user ?? 'amigo')
        .replace('{gift}', vars.gift ?? 'regalo');
}

export class ThankYouTemplates {

    generate({ event } = {}) {
        const username =
            event?.user?.username ?? 'amigo';

        if (event?.type === 'gift') {
            const giftName =
                event.gift?.name ?? 'regalo';

            const text = fill(
                pick(GIFT_TEMPLATES),
                { user: username, gift: giftName }
            );

            return {
                text,
                intent: 'thanks',
                metadata: { provider: 'template', eventType: 'gift' }
            };
        }

        if (event?.type === 'subscription') {
            const text = fill(
                pick(SUBSCRIPTION_TEMPLATES),
                { user: username }
            );

            return {
                text,
                intent: 'thanks',
                metadata: { provider: 'template', eventType: 'subscription' }
            };
        }

        const error = new Error(
            `ThankYouTemplates no soporta evento tipo: ${event?.type}`
        );
        error.code = 'TEMPLATE_UNSUPPORTED_EVENT';
        throw error;
    }
}
