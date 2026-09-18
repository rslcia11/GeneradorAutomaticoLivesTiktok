/**
 * Dirección del WebSocket a partir de la dirección de la página.
 *
 * El socket vive en el mismo servidor que sirvió el overlay, en la ruta
 * `ws` RELATIVA: si la página está en `/beto/`, el socket es `/beto/ws`, y
 * el proxy enruta ambos al mismo proceso. Con HTTPS pasa a `wss` solo.
 * La clave `?key=` de la página viaja también; el hash no.
 *
 * @param {{ href: string, protocol: string, search: string }} location
 */
export function socketUrl(location) {
    const url = new URL('ws', location.href);

    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = location.search;
    url.hash = '';

    return url.href;
}
