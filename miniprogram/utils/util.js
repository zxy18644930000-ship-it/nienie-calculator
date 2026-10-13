const pad2 = (n) => String(n).padStart(2, '0');
const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const cents = (p) => Math.round((Number(p) || 0) * 100);

function fmtMoney(c) {
  const v = c / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function genOrderNo() {
  const d = new Date();
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' +
    pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}

function fmtTime(ts) {
  const d = new Date(ts);
  return (d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

module.exports = { pad2, uid, cents, fmtMoney, genOrderNo, fmtTime };
