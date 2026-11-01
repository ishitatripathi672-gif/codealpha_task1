/* Itrakhana storefront: vanilla JS single-page app (hash routing) */
const main = document.getElementById('main');
const SIZES = { 3: 0.6, 6: 1, 12: 1.8 };          // keep in sync with server.js
const MAX_QTY = 10;
const state = { user: null, products: [], cart: [], family: '', q: '', next: null };

/* ---------- helpers ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
const price = (p, size) => Math.round(p.price * SIZES[size]);
const shippingFor = (sub) => (sub >= 999 ? 0 : 60);
const byId = (id) => state.products.find((p) => p.id === id);
const fmtDate = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

const WAVE = 'M-40 98' + ' q5 -4 10 0 t10 0'.repeat(9) + ' V190 H-40z';
const WAVE_B = 'M-40 95' + ' q5 -5 10 0 t10 0'.repeat(9) + ' V190 H-40z';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canHover = matchMedia('(hover: hover)').matches;

/* A small glass bottle, drawn in SVG. The liquid takes the attar's colour. */
let bottleId = 0;
const BODY = 'M38 40h24v14c0 6 20 14 20 38v62c0 8-6 14-14 14H32c-8 0-14-6-14-14V92c0-24 20-32 20-38z';
function bottle(color) {
  const id = 'b' + ++bottleId;
  return `<svg viewBox="0 0 100 180" aria-hidden="true" style="color:var(--ink)">
    <defs>
      <clipPath id="${id}"><path d="${BODY}"/></clipPath>
      <linearGradient id="${id}g" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".35" stop-color="#fff" stop-opacity=".1"/><stop offset=".75" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#fff" stop-opacity=".45"/></linearGradient>
      <linearGradient id="${id}c" x1="0" x2="1"><stop offset="0" stop-color="#8A6118"/><stop offset=".4" stop-color="#F6D77F"/><stop offset="1" stop-color="#9C6F1E"/></linearGradient>
      <linearGradient id="${id}l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></linearGradient>
    </defs>
    <ellipse cx="50" cy="172" rx="34" ry="5" fill="rgba(0,0,0,.2)"/>
    <circle cx="50" cy="5" r="4.5" fill="url(#${id}c)"/>
    <rect x="40" y="6" width="20" height="13" rx="4" fill="url(#${id}c)"/>
    <rect x="35" y="17" width="30" height="10" rx="3" fill="url(#${id}c)"/>
    <rect x="43" y="27" width="14" height="14" fill="rgba(255,255,255,.4)" stroke="currentColor" stroke-width="2"/>
    <path d="${BODY}" fill="rgba(255,255,255,.35)"/>
    <g clip-path="url(#${id})"><rect x="10" y="100" width="80" height="90" fill="${color}"/><path class="liq b" d="${WAVE_B}" fill="${color}" opacity=".55"/><path class="liq" d="${WAVE}" fill="${color}"/><rect x="10" y="94" width="80" height="96" fill="url(#${id}l)"/></g>
    <rect x="30" y="114" width="40" height="36" rx="3" fill="#FBF6E9" stroke="#B8862B" stroke-width="1"/>
    <path d="M36 124h28M40 132h20M44 140h12" stroke="#B8862B" stroke-width="1.6" stroke-linecap="round"/>
    <path d="${BODY}" fill="url(#${id}g)"/>
    <path d="${BODY}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M26 98c-2 14-2 34 0 50" stroke="rgba(255,255,255,.8)" stroke-width="3.5" stroke-linecap="round" fill="none"/>
    <path d="M44 56c-4 3-8 7-9 12" stroke="rgba(255,255,255,.7)" stroke-width="2.5" stroke-linecap="round" fill="none"/>
  </svg>`;
}

/* ---------- cart ---------- */
function cartCount() { return state.cart.reduce((n, l) => n + l.qty, 0); }
function updateBadge() {
  const el = document.getElementById('cart-count');
  const n = cartCount();
  const grew = n > (+el.textContent || 0);
  el.textContent = n;
  el.hidden = n === 0;
  if (grew) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
}
function saveGuestCart() {
  if (state.user) return;
  try { localStorage.setItem('itra-cart', JSON.stringify(state.cart)); } catch { /* storage unavailable */ }
}
function loadGuestCart() {
  try { return JSON.parse(localStorage.getItem('itra-cart') || '[]'); } catch { return []; }
}
function qtyOf(pid, size) {
  const l = state.cart.find((c) => c.product_id === pid && c.size === size);
  return l ? l.qty : 0;
}
async function setQty(pid, size, qty) {
  const p = byId(pid);
  const cap = Math.min(MAX_QTY, p ? p.stock : MAX_QTY);
  const clamped = Math.max(0, Math.min(qty, cap));
  if (qty > cap) toast(cap === MAX_QTY ? `You can order up to ${MAX_QTY} of each size.` : `Only ${cap} left in stock.`);
  const i = state.cart.findIndex((c) => c.product_id === pid && c.size === size);
  if (i >= 0) { if (clamped === 0) state.cart.splice(i, 1); else state.cart[i].qty = clamped; }
  else if (clamped > 0) state.cart.push({ product_id: pid, size, qty: clamped });
  updateBadge();
  if (state.user) await api('/cart', { method: 'PUT', body: { product_id: pid, size, qty: clamped } });
  else saveGuestCart();
}
function totals() {
  const subtotal = state.cart.reduce((s, l) => { const p = byId(l.product_id); return s + (p ? price(p, l.size) * l.qty : 0); }, 0);
  const shipping = state.cart.length ? shippingFor(subtotal) : 0;
  return { subtotal, shipping, total: subtotal + shipping };
}

/* ---------- session ---------- */
async function loadProducts() { state.products = (await api('/products')).products; }
function updateNav() {
  const auth = document.getElementById('nav-auth');
  document.getElementById('nav-orders').hidden = !state.user;
  auth.textContent = state.user ? 'Log out' : 'Log in';
  auth.setAttribute('href', state.user ? '#/logout' : '#/login');
  const path = location.hash.slice(1) || '/';
  document.querySelectorAll('.top nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + path));
}
async function afterLogin(user) {
  state.user = user;
  const r = await api('/cart/merge', { method: 'POST', body: { items: state.cart } });
  state.cart = r.items;
  try { localStorage.removeItem('itra-cart'); } catch { /* ignore */ }
  updateBadge();
}

/* ---------- motion helpers ---------- */
function wisps(n) {
  return `<div class="wisps" aria-hidden="true">${Array.from({ length: n }, (_, i) =>
    `<span style="left:${10 + Math.round(Math.random() * 80)}%;animation-delay:${(-Math.random() * 6).toFixed(2)}s;animation-duration:${(5 + Math.random() * 3).toFixed(1)}s;--dx:${Math.round(Math.random() * 60 - 30)}px"></span>`).join('')}</div>`;
}
let io;
function renderGrid() {
  const grid = document.getElementById('grid');
  grid.innerHTML = gridHtml();
  if (io) io.disconnect();
  const cards = [...grid.querySelectorAll('.card')];
  if (reduced || !('IntersectionObserver' in window)) { cards.forEach((c) => c.classList.add('in')); return; }
  io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
  }), { rootMargin: '0px 0px -8% 0px' });
  cards.forEach((c, i) => { c.style.setProperty('--i', i % 4); io.observe(c); });
}
function flyToCart(from) {
  if (reduced || !from) return;
  const a = from.getBoundingClientRect(), b = document.querySelector('.cart-link').getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'fly';
  el.style.left = a.left + a.width / 2 - 9 + 'px';
  el.style.top = a.top + a.height / 2 - 9 + 'px';
  document.body.appendChild(el);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  el.animate([
    { transform: 'translate(0,0) scale(1)', opacity: 1 },
    { transform: `translate(${dx * 0.55}px, ${dy - 90}px) scale(1.3)`, opacity: 1, offset: 0.45 },
    { transform: `translate(${dx}px, ${dy}px) scale(.3)`, opacity: .3 },
  ], { duration: 750, easing: 'cubic-bezier(.4,0,.6,1)' }).onfinish = () => el.remove();
}
function setTheme(next, x, y) {
  const apply = () => {
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('itra-theme', next); } catch { /* ignore */ }
    syncThemeBtn();
  };
  if (!document.startViewTransition || reduced) { apply(); return; }
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.startViewTransition(apply).ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 650, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' });
  }).catch(() => {});
}
function syncThemeBtn() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const b = document.getElementById('theme');
  b.setAttribute('aria-pressed', dark);
  b.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
}

/* ---------- pages ---------- */
function card(p) {
  const out = p.stock === 0;
  const low = !out && p.stock <= 5;
  return `<a class="card" href="#/p/${esc(p.slug)}" style="--c:${esc(p.color)}">
    ${out ? '<span class="tag out">Sold out</span>' : low ? `<span class="tag">${p.stock} left</span>` : ''}
    <div class="art">${bottle(p.color)}</div>
    <h3>${esc(p.name)}</h3>
    <div class="fam">${esc(p.family)}</div>
    <p class="notes">${esc(p.top_note)}, ${esc(p.heart_note.toLowerCase())}, ${esc(p.base_note.toLowerCase())}</p>
    <div class="foot-row">
      <span class="price">${inr(p.price)} <small class="muted">/ 6 ml</small></span>
      <button class="btn small" data-add="${p.id}" ${out ? 'disabled' : ''}>Add to cart</button>
    </div>
  </a>`;
}

function gridHtml() {
  const q = state.q.toLowerCase();
  const list = state.products.filter((p) =>
    (!state.family || p.family === state.family) &&
    (!q || [p.name, p.tagline, p.top_note, p.heart_note, p.base_note].join(' ').toLowerCase().includes(q)));
  return list.length ? list.map(card).join('')
    : '<div class="empty" style="grid-column:1/-1"><h3>Nothing matches that search</h3><p class="muted">Try a scent like rose, wood or earth, or clear the filter.</p></div>';
}

/* ---------- hero: pick a scent, the whole stage changes colour ---------- */
let heroTimer;
function heroInfo(p) {
  return `<p class="tagline">${esc(p.tagline)}</p>
    <div class="cta-row"><a class="btn gold" href="#/p/${esc(p.slug)}">Try ${esc(p.name)}, 3 ml for ${inr(price(p, 3))}</a>
    <a class="btn ghost" href="#catalog" data-scroll="catalog">See all ${state.products.length}</a></div>`;
}
function heroMarkup(list) {
  const p = list[0];
  const title = 'Perfume that smells like a place, not a mall.';
  return `<section class="hero2" id="hero" style="--c:${esc(p.color)}">
    <div class="hero2-copy">
      <h1 aria-label="${title}">${title.split(' ').map((w, i) => `<span class="w" aria-hidden="true" style="--i:${i}">${w}</span>`).join(' ')}</h1>
      <p class="lead">Alcohol-free attars from Kannauj, distilled in copper and rested in sandalwood oil. Pick one below and see how it looks.</p>
      <div class="picker" role="group" aria-label="Preview an attar">${list.map((x, i) =>
        `<button class="pick" data-hero="${i}" aria-pressed="${i === 0}" style="--c:${esc(x.color)}"><span class="dot"></span>${esc(x.name)}</button>`).join('')}</div>
      <div class="hero2-info" id="hero-info" aria-live="polite">${heroInfo(p)}</div>
    </div>
    <div class="hero2-stage" aria-hidden="true">
      <div class="big-name" id="big-name">${esc(p.name)}</div>${wisps(12)}
      <div class="hero-bottle" id="hero-bottle">${bottle(p.color)}</div>
    </div>
  </section>`;
}
function startHero(list) {
  clearInterval(heroTimer);
  const sec = document.getElementById('hero');
  let cur = 0, hover = false, clicked = false;
  document.documentElement.style.setProperty('--hero-c', list[0].color);
  const show = (i) => {
    cur = i; const p = list[i];
    sec.style.setProperty('--c', p.color);
    document.documentElement.style.setProperty('--hero-c', p.color);
    for (const [id, html] of [['hero-bottle', bottle(p.color)], ['big-name', esc(p.name)]]) {
      const el = document.getElementById(id);
      el.innerHTML = html; el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap');
    }
    document.getElementById('hero-info').innerHTML = heroInfo(p);
    sec.querySelectorAll('.pick').forEach((b, j) => b.setAttribute('aria-pressed', j === i));
  };
  sec.addEventListener('click', (e) => { const b = e.target.closest('[data-hero]'); if (b) { clicked = true; show(+b.dataset.hero); } });
  sec.addEventListener('pointerenter', () => { hover = true; });
  sec.addEventListener('pointerleave', () => { hover = false; });
  if (!reduced) heroTimer = setInterval(() => { if (!hover && !clicked && !document.hidden) show((cur + 1) % list.length); }, 4500);
}

const STEPS = [
  ['Flowers meet copper', 'Petals or roots go into a copper pot (deg) and are heated over a wood fire. The scented steam travels through a bamboo pipe into a second pot.',
   '<svg viewBox="0 0 120 100" aria-hidden="true"><path class="steam" d="M42 36c-7-8 7-12 0-20"/><path class="steam s2" d="M58 36c-7-8 7-12 0-20"/><path class="steam s3" d="M74 36c-7-8 7-12 0-20"/><path d="M26 48h68l-6 38H32z" fill="#C8713A" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><rect x="22" y="42" width="76" height="8" rx="3" fill="#E39A5E" stroke="currentColor" stroke-width="2.5"/></svg>'],
  ['Sandalwood catches the scent', 'In the second pot, sandalwood oil absorbs the fragrance, drop by drop, over days. This is why attars are oil-based and have no alcohol.',
   '<svg viewBox="0 0 120 100" aria-hidden="true"><path class="drop" d="M60 8c8 14 12 20 12 27a12 12 0 0 1-24 0c0-7 4-13 12-27z" fill="#F0A12B" stroke="currentColor" stroke-width="2.5"/><path d="M24 62h72c0 18-14 28-36 28S24 80 24 62z" fill="#E2B66D" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><ellipse cx="60" cy="62" rx="36" ry="7" fill="#F4D79A" stroke="currentColor" stroke-width="2.5"/></svg>'],
  ['Rest, then bottle', 'The oil is left to settle and mellow for weeks to months, then poured into small vials. A little goes a long way.',
   ''],
];
function processHtml() {
  return `<section class="make" aria-labelledby="make-h">
    <h2 id="make-h">How an attar is made</h2>
    <div class="steps">${STEPS.map(([t, d, svg], i) => `<article class="step"><div class="step-art">${svg || bottle('#E2B66D')}</div>
      <h3><span class="n">${i + 1}</span> ${t}</h3><p>${d}</p></article>`).join('')}</div>
  </section>
  <section class="trust" aria-label="Why buy here"><div><b>Alcohol-free</b><span>Pure oils, no sprays</span></div><div><b>Try before you commit</b><span>3 ml vials from ${inr(Math.min(...state.products.map((p) => price(p, 3))))}</span></div><div><b>Free delivery</b><span>On orders of ₹999 and up</span></div></section>`;
}

function home() {
  const families = [...new Set(state.products.map((p) => p.family))];
  const heroList = ['mitti', 'gulab', 'shamama', 'khus', 'chandan', 'motia'].map((x) => state.products.find((p) => p.slug === x)).filter(Boolean);
  main.innerHTML = `
    ${heroMarkup(heroList)}
    <div class="marquee" aria-hidden="true"><div>${[0, 1].map(() => state.products.map((p) => `<span>${esc(p.name)}</span>`).join('')).join('')}</div></div>
    <section id="catalog" aria-label="Attars">
      <div class="toolbar">
        <div class="chips" role="group" aria-label="Scent family">
          <button class="chip" data-family="" aria-pressed="${!state.family}">All</button>
          ${families.map((f) => `<button class="chip" data-family="${esc(f)}" aria-pressed="${state.family === f}">${esc(f)}</button>`).join('')}
        </div>
        <input class="search" id="search" type="search" placeholder="Search rose, wood, earth…" aria-label="Search attars" value="${esc(state.q)}">
      </div>
      <div class="grid" id="grid"></div>
    </section>
    ${processHtml()}`;
  document.getElementById('search').addEventListener('input', (e) => { state.q = e.target.value; renderGrid(); });
  renderGrid();
  startHero(heroList);
}

function product(slug) {
  const p = state.products.find((x) => x.slug === slug);
  if (!p) return notFound();
  let size = 6, qty = 1;
  const out = p.stock === 0;
  main.innerHTML = `
    <div class="crumb"><a href="#/" class="link">← All attars</a></div>
    <div class="detail" style="--c:${esc(p.color)}">
      <div class="stage">${wisps(8)}${bottle(p.color)}</div>
      <div>
        <div class="fam">${esc(p.family)}</div>
        <h1 style="font-size:clamp(2.2rem,4.5vw,3.2rem)">${esc(p.name)}</h1>
        <p class="lead" style="font-size:1.2rem">${esc(p.tagline)}</p>
        <p>${esc(p.description)}</p>
        <div class="pyramid" aria-label="Scent notes">
          <div class="layer"><b>Opens with</b><span>${esc(p.top_note)}</span></div>
          <div class="layer"><b>Heart</b><span>${esc(p.heart_note)}</span></div>
          <div class="layer"><b>Dries down to</b><span>${esc(p.base_note)}</span></div>
        </div>
        <div class="sizes" role="radiogroup" aria-label="Vial size">
          ${Object.keys(SIZES).map((s) => `<button class="size" role="radio" data-size="${s}" aria-checked="${+s === size}">${s} ml<small>${inr(price(p, +s))}</small></button>`).join('')}
        </div>
        <div class="buy">
          <div class="qty"><button aria-label="Decrease quantity" data-q="-1">−</button><span id="q" aria-live="polite">1</span><button aria-label="Increase quantity" data-q="1">+</button></div>
          <button class="btn gold" id="add" ${out ? 'disabled' : ''}>${out ? 'Sold out' : `Add to cart · ${inr(price(p, size))}`}</button>
        </div>
        <p class="muted" style="margin-top:1rem">${out ? 'This one is sold out for now.' : p.stock <= 5 ? `Only ${p.stock} left.` : 'In stock.'} Free delivery on orders of ₹999 and up.</p>
      </div>
    </div>`;
  const refresh = () => {
    document.getElementById('q').textContent = qty;
    if (!out) document.getElementById('add').textContent = `Add to cart · ${inr(price(p, size) * qty)}`;
    document.querySelectorAll('.size').forEach((b) => b.setAttribute('aria-checked', +b.dataset.size === size));
  };
  main.querySelectorAll('.size').forEach((b) => b.addEventListener('click', () => { size = +b.dataset.size; refresh(); }));
  main.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => { qty = Math.max(1, Math.min(MAX_QTY, qty + +b.dataset.q)); refresh(); }));
  document.getElementById('add').addEventListener('click', async () => {
    try { await setQty(p.id, size, qtyOf(p.id, size) + qty); flyToCart(document.getElementById('add')); toast(`${p.name}, ${size} ml added to your cart`); }
    catch (e) { toast(e.message); }
  });
}

function cartPage() {
  if (!state.cart.length) {
    main.innerHTML = `<div class="empty"><h2>Your cart is empty</h2><p class="muted">Start with a 3 ml vial of something you've never smelled before.</p><a class="btn" href="#/">Browse the attars</a></div>`;
    return;
  }
  const t = totals();
  main.innerHTML = `
    <h1 style="font-size:2.4rem">Your cart</h1>
    <div class="two">
      <div class="panel">
        ${state.cart.map((l) => { const p = byId(l.product_id); if (!p) return ''; return `
          <div class="line">
            ${bottle(p.color)}
            <div>
              <a href="#/p/${esc(p.slug)}"><strong>${esc(p.name)}</strong></a> <span class="muted">· ${l.size} ml</span>
              <div class="meta">
                <div class="qty"><button aria-label="Decrease ${esc(p.name)}" data-pid="${p.id}" data-size="${l.size}" data-d="-1">−</button><span>${l.qty}</span><button aria-label="Increase ${esc(p.name)}" data-pid="${p.id}" data-size="${l.size}" data-d="1">+</button></div>
                <button class="link" data-pid="${p.id}" data-size="${l.size}" data-d="remove">Remove</button>
              </div>
            </div>
            <div class="price">${inr(price(p, l.size) * l.qty)}</div>
          </div>`; }).join('')}
      </div>
      <aside class="panel">
        <h2 style="font-size:1.4rem">Summary</h2>
        <div class="sum"><span>Subtotal</span><span>${inr(t.subtotal)}</span></div>
        <div class="sum"><span>Delivery</span><span>${t.shipping ? inr(t.shipping) : 'Free'}</span></div>
        ${t.shipping ? `<p class="muted" style="font-size:.9rem;margin:.25rem 0 0">Add ${inr(999 - t.subtotal)} more for free delivery.</p>` : ''}
        <div class="sum total"><span>Total</span><span>${inr(t.total)}</span></div>
        <a class="btn gold" style="width:100%;margin-top:1rem" href="#/checkout">Checkout</a>
      </aside>
    </div>`;
}

function checkout() {
  if (!state.user) { state.next = '#/checkout'; toast('Log in to place your order.'); location.hash = '#/login'; return; }
  if (!state.cart.length) { location.hash = '#/cart'; return; }
  const t = totals();
  main.innerHTML = `
    <h1 style="font-size:2.4rem">Checkout</h1>
    <div class="two">
      <form class="panel" id="co" novalidate>
        <h2 style="font-size:1.4rem">Delivery details</h2>
        <div class="row">
          <div class="field"><label for="name">Full name</label><input id="name" name="name" autocomplete="name" required value="${esc(state.user.name)}"></div>
          <div class="field"><label for="phone">Mobile number</label><input id="phone" name="phone" inputmode="numeric" autocomplete="tel-national" maxlength="10" required></div>
        </div>
        <div class="field"><label for="address">Address</label><textarea id="address" name="address" rows="3" autocomplete="street-address" required></textarea></div>
        <div class="row">
          <div class="field"><label for="city">City</label><input id="city" name="city" autocomplete="address-level2" required></div>
          <div class="field"><label for="pincode">Pincode</label><input id="pincode" name="pincode" inputmode="numeric" maxlength="6" autocomplete="postal-code" required></div>
        </div>
        <h2 style="font-size:1.4rem">Payment</h2>
        <label class="radio"><input type="radio" name="payment_method" value="COD" checked> Cash on delivery</label>
        <label class="radio"><input type="radio" name="payment_method" value="UPI"> UPI on delivery</label>
        <p class="err" id="co-err" role="alert"></p>
        <button class="btn gold" id="place" type="submit">Place order · ${inr(t.total)}</button>
      </form>
      <aside class="panel">
        <h2 style="font-size:1.4rem">Your order</h2>
        ${state.cart.map((l) => { const p = byId(l.product_id); return p ? `<div class="sum"><span>${esc(p.name)} ${l.size} ml × ${l.qty}</span><span>${inr(price(p, l.size) * l.qty)}</span></div>` : ''; }).join('')}
        <div class="sum"><span>Delivery</span><span>${t.shipping ? inr(t.shipping) : 'Free'}</span></div>
        <div class="sum total"><span>Total</span><span>${inr(t.total)}</span></div>
      </aside>
    </div>`;
  document.getElementById('co').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('place'), err = document.getElementById('co-err');
    err.textContent = '';
    btn.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(e.target));
      const { id } = await api('/orders', { method: 'POST', body });
      state.cart = [];
      updateBadge();
      await loadProducts();            // stock has changed
      location.hash = '#/order/' + id;
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });
}

function orderLines(o) {
  return o.items.map((i) => `<div class="sum"><span>${esc(i.product_name)} ${i.size} ml × ${i.qty}</span><span>${inr(i.unit_price * i.qty)}</span></div>`).join('') +
    `<div class="sum"><span>Delivery</span><span>${o.shipping ? inr(o.shipping) : 'Free'}</span></div>
     <div class="sum total"><span>Total · ${esc(o.payment_method)}</span><span>${inr(o.total)}</span></div>`;
}

async function orderDone(id) {
  if (!state.user) { state.next = '#/order/' + id; location.hash = '#/login'; return; }
  const { order: o } = await api('/orders/' + id);
  main.innerHTML = `
    <div class="auth done">
      <div style="--ink:var(--ink)">${bottle('#F0A12B')}</div>
      <h1 style="font-size:2.4rem">Order #${o.id} is placed</h1>
      <p class="muted" style="margin-inline:auto">We'll deliver to ${esc(o.name)}, ${esc(o.address)}, ${esc(o.city)} ${esc(o.pincode)}. Pay when it arrives.</p>
      <div class="panel" style="text-align:left">${orderLines(o)}</div>
      <p style="margin-top:1.5rem"><a class="btn" href="#/">Keep shopping</a></p>
    </div>`;
}

async function orders() {
  if (!state.user) { state.next = '#/orders'; location.hash = '#/login'; return; }
  const { orders: list } = await api('/orders');
  main.innerHTML = `<h1 style="font-size:2.4rem">Your orders</h1>` + (list.length
    ? list.map((o) => `<article class="panel order"><header><strong>Order #${o.id}</strong><span class="muted">${fmtDate(o.created_at)}</span><span class="status">${esc(o.status)}</span></header>${orderLines(o)}</article>`).join('')
    : `<div class="empty"><p class="muted" style="margin-inline:auto">You haven't ordered anything yet.</p><a class="btn" href="#/">Browse the attars</a></div>`);
}

function authPage(mode) {
  const reg = mode === 'register';
  main.innerHTML = `
    <form class="panel auth" id="auth" novalidate>
      <h1 style="font-size:2.2rem">${reg ? 'Create your account' : 'Welcome back'}</h1>
      ${reg ? '<div class="field"><label for="name">Name</label><input id="name" name="name" autocomplete="name" required></div>' : ''}
      <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" minlength="8" required>${reg ? '<small class="muted">At least 8 characters.</small>' : ''}</div>
      <p class="err" id="auth-err" role="alert"></p>
      <button class="btn gold" style="width:100%" type="submit">${reg ? 'Create account' : 'Log in'}</button>
      <p class="muted" style="margin:1rem 0 0">${reg ? 'Already have an account? <a href="#/login">Log in</a>' : 'New here? <a href="#/register">Create an account</a>'}</p>
    </form>`;
  document.getElementById('auth').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('auth-err');
    err.textContent = '';
    try {
      const { user } = await api('/auth/' + mode, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      await afterLogin(user);
      toast(`Hi ${user.name.split(' ')[0]}!`);
      const dest = state.next || '#/';
      state.next = null;
      location.hash = dest;
    } catch (ex) { err.textContent = ex.message; }
  });
}

async function logout() {
  await api('/auth/logout', { method: 'POST' });
  state.user = null; state.cart = loadGuestCart();
  updateBadge();
  toast('You are logged out.');
  location.hash = '#/';
}

function notFound() {
  main.innerHTML = `<div class="empty"><h2>We couldn't find that page</h2><a class="btn" href="#/">Back to the shop</a></div>`;
}

/* ---------- router & global events ---------- */
const routes = [
  [/^\/$/, home], [/^\/p\/([\w-]+)$/, product], [/^\/cart$/, cartPage], [/^\/checkout$/, checkout],
  [/^\/orders$/, orders], [/^\/order\/(\d+)$/, orderDone],
  [/^\/login$/, () => authPage('login')], [/^\/register$/, () => authPage('register')], [/^\/logout$/, logout],
];

async function route() {
  const path = location.hash.slice(1) || '/';
  if (path.startsWith('catalog')) return;                    // in-page anchor on the home page
  clearInterval(heroTimer); document.documentElement.style.removeProperty('--hero-c');
  const hit = routes.map(([re, fn]) => [path.match(re), fn]).find(([m]) => m);
  try {
    if (hit) await hit[1](...hit[0].slice(1)); else notFound();
  } catch (e) {
    main.innerHTML = `<div class="empty"><h2>Something went wrong</h2><p class="muted" style="margin-inline:auto">${esc(e.message)}</p><a class="btn" href="#/">Back to the shop</a></div>`;
  }
  updateNav();
  window.scrollTo(0, 0);
  main.classList.remove('page-in'); void main.offsetWidth; main.classList.add('page-in');
}

document.addEventListener('click', async (e) => {
  const th = e.target.closest('#theme');
  if (th) {
    const r = th.getBoundingClientRect();
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', r.left + r.width / 2, r.top + r.height / 2);
    return;
  }
  const add = e.target.closest('[data-add]');
  if (add) {                                            // quick add from a product card
    e.preventDefault(); e.stopPropagation();
    const p = byId(+add.dataset.add);
    try { await setQty(p.id, 6, qtyOf(p.id, 6) + 1); flyToCart(add); toast(`${p.name}, 6 ml added to your cart`); } catch (ex) { toast(ex.message); }
    return;
  }
  const fam = e.target.closest('[data-family]');
  if (fam) {
    state.family = fam.dataset.family;
    document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.family === state.family));
    renderGrid();
    return;
  }
  const jump = e.target.closest('[data-scroll]');
  if (jump) { e.preventDefault(); document.getElementById(jump.dataset.scroll).scrollIntoView({ behavior: 'smooth' }); return; }
  const line = e.target.closest('[data-pid][data-d]');     // cart page controls
  if (line) {
    const pid = +line.dataset.pid, size = +line.dataset.size;
    try {
      await setQty(pid, size, line.dataset.d === 'remove' ? 0 : qtyOf(pid, size) + +line.dataset.d);
      cartPage();
    } catch (ex) { toast(ex.message); }
  }
});

window.addEventListener('hashchange', route);

if (canHover && !reduced) {                 // gentle 3D tilt on product cards
  document.addEventListener('pointermove', (e) => {
    const c = e.target.closest && e.target.closest('.card');
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--ry', (((e.clientX - r.left) / r.width) - .5) * 10 + 'deg');
    c.style.setProperty('--rx', (-(((e.clientY - r.top) / r.height) - .5)) * 8 + 'deg');
  });
  document.addEventListener('pointerout', (e) => {
    const c = e.target.closest && e.target.closest('.card');
    if (c && !c.contains(e.relatedTarget)) { c.style.removeProperty('--rx'); c.style.removeProperty('--ry'); }
  });
}
syncThemeBtn();
if (canHover && !reduced) {                 // soft light that follows the cursor
  const glow = document.createElement('div');
  glow.className = 'glow';
  document.body.appendChild(glow);
  document.addEventListener('pointermove', (e) => { glow.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`; glow.style.opacity = 1; });
  document.addEventListener('pointerleave', () => { glow.style.opacity = 0; });
}

(async function init() {
  try {
    await loadProducts();
    const { user } = await api('/auth/me');
    state.user = user;
    if (user) {
      const r = await api('/cart/merge', { method: 'POST', body: { items: loadGuestCart() } });
      state.cart = r.items;
      try { localStorage.removeItem('itra-cart'); } catch { /* ignore */ }
    } else state.cart = loadGuestCart();
  } catch (e) { main.innerHTML = `<div class="empty"><h2>The shop can't load right now</h2><p class="muted" style="margin-inline:auto">${esc(e.message)}</p></div>`; return; }
  updateBadge();
  route();
})();
