/**
 * ¿Este comentario es una pregunta para las cartas?
 *
 * Importa porque la lectura gratis es UNA por persona cada 24 h. Si un
 * "qué lindo tu gato" la gastara, esa persona se queda sin lectura sin
 * haber preguntado nada. Solo las preguntas consumen la cuota.
 *
 * En el chat de un LIVE casi nadie escribe signos de interrogación, así
 * que no alcanza con buscar "?": se reconocen también las formas con las
 * que la gente pregunta de verdad ("me amara", "dime algo", "que ves").
 *
 * Ante la duda, NO es pregunta: equivocarse hacia un lado quema la lectura
 * del día ("me ire a dormir" no debe contar); hacia el otro, la persona
 * recibe un saludo que la invita a preguntar y no pierde nada.
 */

/* Acentos fuera: en el chat se escribe "que", "como", "cuando". */
const sinAcentos = text =>
    text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/*
 * Palabras interrogativas AL PRINCIPIO del mensaje (tras un saludo o un
 * "y", "pero"): "como me ira", "cuando llega". En medio son otra cosa:
 * "me encanta como hablas", "cuando quieras".
 */
const ARRANQUE = /^(?:(?:hola|buenas|oye|mago|maestro|y|pero|mmm|eh)\s+)*(?:como|cuando|donde|cual|cuales|cuanto|cuanta|quien|quienes|por que|para que|xq|pq|acaso)\b/;

/* "que" solo cuenta acompañado: suelto está en cualquier frase. */
const QUE_PREGUNTA =
    /\bque\s+(?:dice|dicen|ves|ve|pasa|pasara|hay|me|le|nos|va|sera|significa|opinas|piensas|debo|puedo|hago|tengo|viene|espera|onda)\b/;

/* Pedir una lectura, con o sin signos. */
const PETICIONES =
    /\b(?:dime|dile|digame|leeme|lee(?:r)?me|echame|tirame|saca(?:me)?|consulta|consejo|ayuda(?:me)?|quiero saber|necesito saber|me gustaria saber|pregunta|preguntar|lectura|tirada|tarot|carta|cartas|mi signo|mi futuro|sera que)\b/;

/*
 * Futuro y condicional de los verbos con los que se pregunta por el
 * destino: "volvera", "me amara", "tendre", "podria". Raíces fijas, no
 * terminaciones sueltas ("historia" no es verbo), y sin los verbos de uso
 * general (ir, ser, estar, hacer): "me ire a dormir" y "seria genial" no
 * preguntan nada.
 */
const FUTUROS =
    /\b(?:tendr|podr|habr|vendr|volver|regresar|amar|querr|casar|quedar|ganar|perder|sanar|curar|llegar|lograr|conseguir|encontrar|funcionar|mejorar|cambiar|durar|pasar)(?:e|a|as|an|emos|ia|ias|ian)\b/;

/* Con muy pocas palabras no hay pregunta que valga una lectura. */
const MIN_PALABRAS = 3;

/**
 * @param {string} content texto del comentario
 * @returns {boolean}
 */
export function isQuestion(content) {

    if (typeof content !== 'string') {
        return false;
    }

    const text = content.trim();

    if (text === '') {
        return false;
    }

    if (/[?¿]/.test(text)) {
        return true;
    }

    const plano = sinAcentos(text);

    if (plano.split(/\s+/).length < MIN_PALABRAS) {
        return false;
    }

    return ARRANQUE.test(plano) || QUE_PREGUNTA.test(plano) || PETICIONES.test(plano) || FUTUROS.test(plano);
}
