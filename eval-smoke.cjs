// Eval smoke: proves public/app.js top-level evaluation completes (catches TDZ/order bugs).
function el() {
  const t = {
    children: [], dataset: {}, style: {}, options: [], value: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, append() {}, remove() {}, setPointerCapture() {},
    querySelector: () => el(), querySelectorAll: () => [],
    getContext: () => new Proxy({}, { get: (o, k) => (k === 'canvas' ? null : () => {}) }),
    play: () => Promise.resolve(),
  };
  return new Proxy(t, {
    get(o, k) { if (k in o) return o[k]; return typeof k === 'string' ? undefined : undefined; },
    set(o, k, v) { o[k] = v; return true; },
  });
}
global.document = {
  getElementById: () => el(),
  createElement: () => el(),
  createTextNode: () => el(),
  querySelectorAll: () => [],
  querySelector: () => el(),
};
global.fetch = () => Promise.reject(new Error('no-net'));
global.location = { reload() {} };
require('./public/app.js');
setTimeout(() => console.log('eval-smoke: PASS (top-level eval completed)'), 100);
