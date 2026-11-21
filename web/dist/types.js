export const ORDER = ['W', 'D', 'S', 'M'];
export const NAME = { W: 'Weekly', D: 'Daily', S: 'Sessional', M: 'Micro' };
export const KEYS = ['VAH', 'POC', 'VAL'];
// Desimal harga mengikuti ukuran point simbol dari feed (mis. XAUUSD OANDA point 0.001 -> 3 desimal).
export function decimalsOf(point) {
    if (!(point > 0))
        return 2;
    for (let n = 0; n <= 8; n++) {
        const scaled = point * 10 ** n;
        if (Math.abs(scaled - Math.round(scaled)) < 1e-9)
            return n;
    }
    return 8;
}
