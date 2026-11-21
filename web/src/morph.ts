// Memperbarui DOM "di tempat" (bukan mengganti seluruh innerHTML) agar:
//   - seleksi teks / blok untuk copy-paste TIDAK hilang saat data update,
//   - posisi scroll, hover, dan tombol yang sedang ditekan tetap utuh.
// Teks yang sedang terseleksi sengaja tidak diubah sampai seleksi dilepas, supaya yang Anda copy persis yang terlihat.

function hit(sel: Selection | null, n: Node): boolean {
  return !!sel && !sel.isCollapsed && sel.rangeCount > 0 && sel.containsNode(n, true);
}

function syncAttrs(a: Element, b: Element): void {
  for (const at of Array.from(b.attributes)) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
  for (const at of Array.from(a.attributes)) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
  if (a instanceof HTMLInputElement && b instanceof HTMLInputElement) a.checked = b.checked;
}

function patchNode(live: Node, next: Node, parent: Node, sel: Selection | null): void {
  if (live.nodeType === 3 && next.nodeType === 3) {
    if (live.nodeValue !== next.nodeValue && !hit(sel, live)) live.nodeValue = next.nodeValue;
    return;
  }
  if (live.nodeType === 1 && next.nodeType === 1 && (live as Element).tagName === (next as Element).tagName) {
    syncAttrs(live as Element, next as Element);
    patchChildren(live, next, sel);
    return;
  }
  if (hit(sel, live)) return;                       // jenis node berubah tapi sedang diseleksi: tunda
  parent.replaceChild(next.cloneNode(true), live);
}

function patchChildren(live: Node, next: Node, sel: Selection | null): void {
  const want = next.childNodes.length;
  for (let i = 0; i < want; i++) {
    const n = next.childNodes[i], l = live.childNodes[i];
    if (!l) live.appendChild(n.cloneNode(true));
    else patchNode(l, n, live, sel);
  }
  while (live.childNodes.length > want) {
    const last = live.lastChild as Node;
    if (hit(sel, last)) break;                      // jangan hapus yang sedang diseleksi
    live.removeChild(last);
  }
}

export function morph(root: Element, html: string): void {
  const t = document.createElement('template');
  t.innerHTML = html;
  patchChildren(root, t.content, window.getSelection());
}

export function hasSelection(): boolean {
  const s = window.getSelection();
  return !!s && !s.isCollapsed && s.toString().length > 0;
}
