// Memperbarui DOM "di tempat" (bukan mengganti seluruh innerHTML) agar:
//   - seleksi teks / blok untuk copy-paste TIDAK hilang saat data update,
//   - posisi scroll, hover, dan tombol yang sedang ditekan tetap utuh.
// Teks yang sedang terseleksi sengaja tidak diubah sampai seleksi dilepas, supaya yang Anda copy persis yang terlihat.
function hit(sel, n) {
    return !!sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.containsNode(n, true);
}
function syncAttrs(a, b) {
    for (const at of Array.from(b.attributes))
        if (a.getAttribute(at.name) !== at.value)
            a.setAttribute(at.name, at.value);
    for (const at of Array.from(a.attributes))
        if (!b.hasAttribute(at.name))
            a.removeAttribute(at.name);
    if (a instanceof HTMLInputElement && b instanceof HTMLInputElement)
        a.checked = b.checked;
}
function patchNode(live, next, parent, sel) {
    if (live.nodeType === 3 && next.nodeType === 3) {
        if (live.nodeValue !== next.nodeValue && !hit(sel, live))
            live.nodeValue = next.nodeValue;
        return;
    }
    if (live.nodeType === 1 && next.nodeType === 1 && live.tagName === next.tagName) {
        syncAttrs(live, next);
        patchChildren(live, next, sel);
        return;
    }
    if (hit(sel, live))
        return; // jenis node berubah tapi sedang diseleksi: tunda
    parent.replaceChild(next.cloneNode(true), live);
}
function patchChildren(live, next, sel) {
    const want = next.childNodes.length;
    for (let i = 0; i < want; i++) {
        const n = next.childNodes[i], l = live.childNodes[i];
        if (!l)
            live.appendChild(n.cloneNode(true));
        else
            patchNode(l, n, live, sel);
    }
    while (live.childNodes.length > want) {
        const last = live.lastChild;
        if (hit(sel, last))
            break; // jangan hapus yang sedang diseleksi
        live.removeChild(last);
    }
}
export function morph(root, html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    patchChildren(root, t.content, window.getSelection());
}
export function hasSelection() {
    const s = window.getSelection();
    return !!s && !s.isCollapsed && s.toString().length > 0;
}
