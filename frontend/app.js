(function(){
"use strict";
try {
document.getElementById('year').textContent = new Date().getFullYear();

/* ============================================================
   API — the server database is the single source of truth.
   Nothing staff edit is ever kept only inside this browser: a change
   is either saved on the server (and so appears on every device) or it
   fails with a visible message. No silent local-only saves.
   ============================================================ */
const API = '/api';
class ApiError extends Error {
  constructor(message, status){ super(message); this.status = status; }
  get network(){ return this.status === 0; }
}
async function apiFetch(path, options={}, timeoutMs=20000){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeoutMs); // generous: free hosts "cold start" slowly
  try{
    const res = await fetch(API + path, {...options, signal: controller.signal});
    let data = null;
    try{ data = await res.json(); }catch(e){ /* empty body */ }
    if (!res.ok) throw new ApiError((data && data.error) || ('Request failed (' + res.status + ')'), res.status);
    return data;
  }catch(err){
    if (err instanceof ApiError) throw err;
    throw new ApiError(err && err.name === 'AbortError'
      ? 'The server took too long to respond. Please try again.'
      : 'Could not reach the server. Check your internet connection and try again.', 0);
  }finally{ clearTimeout(timer); }
}
let BACKEND_AVAILABLE = false;

function toast(message, kind, ms){
  const el = document.createElement('div');
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:min(92vw,460px);padding:12px 18px;border-radius:3px;font-weight:600;font-size:13.5px;line-height:1.4;z-index:99999;box-shadow:0 8px 28px rgba(0,0,0,.28);color:#fff;text-align:center;background:' + (kind === 'error' ? '#8a1f2b' : kind === 'warn' ? '#B08A3E' : '#332A22');
  document.body.appendChild(el);
  setTimeout(()=>{ el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(()=>el.remove(), 450); }, ms || 4500);
}
async function withBusy(btn, label, fn){
  if (!btn) return fn();
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = label;
  try{ return await fn(); } finally { btn.disabled = false; btn.textContent = original; }
}
function saveFailed(err){
  toast('Not saved: ' + ((err && err.message) || 'that photo could not be read — try a JPG or PNG.'), 'error', 7000);
  if (err && err.status === 404) refreshMenu(true); // e.g. someone removed that item on another device
}
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ============================================================
   DEFAULT DATA (verbatim from the Biscotti menu screenshots)
   Each category ships with a real photo URL (shown when the
   browser can load external images) AND an illustrated
   fallback (shown instantly, always works, no network needed).
   ============================================================ */
const DEFAULT_CATEGORIES = [
  { id:'classic', name:'Classic Collection', tagline:'Everyday classics, extraordinary flavour.', desc:'Timeless favourites, lovingly crafted with familiar flavours and beautifully balanced textures.',
    image:'hero-images/hero-classic.jpg', tone:'classic' },
  { id:'signature', name:'Signature Cakes', tagline:"Master baker's finest creations.", desc:'Bold, unique flavours and artful designs, created to make every celebration unforgettable.',
    image:'hero-images/hero-signature.jpg', tone:'signature' },
  { id:'premium', name:'Premium Cakes', tagline:'Taste the pinnacle of perfection.', desc:'Luxurious flavours, exquisite textures, and indulgent creations crafted for truly special moments.',
    image:'hero-images/hero-premium.jpg', tone:'premium' },
  { id:'fresh', name:'Fresh & Fruity Series', tagline:'Light, fresh, and naturally indulgent.', desc:'A refreshing celebration of vibrant fruits, delicate creams, and naturally delightful flavours.',
    image:'hero-images/hero-fresh.jpg', tone:'fresh' },
  { id:'cheesecake', name:'Baked Cheesecake Favourites', tagline:'The pinnacle of cheesecake perfection.', desc:'Rich, creamy, and beautifully baked, with irresistible flavours crafted for true cheesecake lovers.',
    image:'hero-images/hero-cheesecake.jpg', tone:'cheesecake' },
  { id:'royal', name:'Royal Delight Cakes', tagline:'A regal feast for the senses.', desc:'Opulent flavours, luxurious layers, and exquisite finishes designed to make every bite feel extraordinary.',
    image:'hero-images/hero-royal.jpg', tone:'royal' },
  { id:'regular', name:'Regular Cakes', tagline:'Simple flavours, infinite comfort.', desc:'Familiar favourites made with care— simple, delicious, and perfect for everyday celebrations.',
    image:'hero-images/hero-regular.jpg', tone:'regular' },
];

const DEFAULT_PRODUCTS = {
  classic:[
    {n:'Black Forest', p:750, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small size ₹430','Mini cake ₹280']},
    {n:'Litchy Butterscotch', p:950, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹530','Mini cake ₹370']},
    {n:'Dark Vancho', p:1050, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹580','Mini cake ₹400']},
    {n:'Chocolate Sachar Cake', p:900, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹470','Mini cake ₹340']},
    {n:'Praline Cake', p:950, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹530','Mini cake ₹370']},
    {n:'Fruit Vancho Cake', p:1050, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹580','Mini cake ₹400']},
    {n:'Choco Fancy Cake', p:950, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹530','Mini cake ₹370']},
    {n:'Milk Vancho Cake', p:1050, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹580','Mini cake ₹400']},
    {n:'Mango Cake', p:850, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹470','Mini cake ₹340']},
    {n:'Dates & Carrot Cake', p:550, t:[]},
    {n:'Choco Flacks Cake', p:800, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹450','Mini cake ₹320']},
    {n:'Choco Rock', p:1250, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹680','Mini cake ₹530']},
    {n:'Litchi Almond Cake', p:950, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹530','Mini cake ₹370']},
    {n:'Red Forest Cake', p:950, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹530','Mini cake ₹370']},
    {n:'Rich Blueberry Cake', p:1150, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹630','Mini cake ₹450']},
    {n:'Strawberry Cake', p:850, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹470','Mini cake ₹340']},
  ],
  signature:[
    {n:'Butterscotch Cake', p:950, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹530','Mini cake ₹370']},
    {n:'Pineapple Cake', p:850, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹470','Mini cake ₹340']},
    {n:'Nutty Bubbly Cake', p:1150, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹630','Mini cake ₹450']},
    {n:'White Forest Cake', p:800, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹450','Mini cake ₹320']},
    {n:'White Vancho Cake', p:1050, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹580','Mini cake ₹400']},
    {n:'Choco Nutlayer Cake', p:1050, t:['Pastry ₹100','Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹580','Mini cake ₹400']},
    {n:'Redvelvet Cake', p:1150, t:['2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹630','Small cake ₹450']},
    {n:'Choco Holiks Cake', p:1050, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹580','Mini cake ₹420']},
    {n:'Spanish Delight', p:1050, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹580','Mini cake ₹420']},
    {n:'Brownie Cake', p:1100, t:[]},
    {n:'Choco Truffle Cake', p:1150, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹630','Mini cake ₹450']},
    {n:'Irish Coffee Cake', p:1000, t:['Small Cake ₹550','Mini Cake ₹400','Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100']},
    {n:'Caramel Fudge Cake', p:1050, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹580','Mini cake ₹420']},
    {n:'Choco Fudge Cake', p:1050, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹580','Mini cake ₹420']},
    {n:'Lavender Cake', p:950, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100']},
    {n:'Vancho Delight Cake', p:1050, t:['Pastry ₹100','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Eggfree extra charge included','Small cake ₹580','Mini cake ₹400']},
    {n:'Honey Nut Cake', p:1050, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹630']},
    {n:'Oreo Cake', p:950, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹530','Mini cake ₹370']},
    {n:'Pista Cake', p:1050, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹580','Mini cake ₹400']},
  ],
  premium:[
    {n:'Lotus Biscoff Cake', p:1400, t:['2 Layer Charge/Kg ₹100','Tier Charge/Kg ₹100','Small cake ₹800']},
    {n:'Raffaello Cake', p:1500, t:['2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100']},
    {n:'Nutella Cake', p:1250, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹100','Tier Charge/Kg ₹100','Small cake ₹680','Mini cake ₹530']},
    {n:'Rich Choco Almond Cake', p:1500, t:['2 Layer Charge/Kg ₹100','Tier Charge/Kg ₹100']},
    {n:'Rainbow Cake', p:1300, t:[]},
    {n:'Cappuccino Cake', p:950, t:['Eggfree extra charge included','Tier Charge/Kg ₹100','Small cake ₹530','Mini cake ₹370']},
    {n:'Fruit & Nut Cake', p:1400, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹100','Tier Charge/Kg ₹100','Small cake ₹800','Mini cake ₹600']},
    {n:'Rich Chocolate Gateaux', p:1600, t:[]},
    {n:'Dry Fruits Cake', p:1400, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹100','Tier Charge/Kg ₹100','Small cake ₹800','Mini cake ₹600']},
    {n:'Malai Pista Cake', p:1150, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹630','Mini cake ₹450']},
    {n:'Choco Nut Cake', p:1300, t:['Small Cake ₹700','2 Layer Charge/Kg ₹100','Tier Charge/Kg ₹100','Mini cake ₹530']},
    {n:'Choco Red Velvet Cake', p:1400, t:['2 Layer Charge/Kg ₹100','Tier Charge/Kg ₹100','Small cake ₹800','Mini cake ₹600']},
    {n:'Ferrero Rocher Cake', p:1600, t:['Pastry ₹140','Tier Charge/Kg ₹100','2 Layer Charge/Kg ₹100']},
    {n:'Choco Hazelnut Cake', p:1700, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹100','Tier Charge/Kg ₹100','Small cake ₹900','Pastry ₹170']},
    {n:'Crunchy Nut Cake', p:1250, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹680','Mini cake ₹530']},
    {n:'Rich Almond Cake', p:1500, t:['2 Layer Charge/Kg ₹100','Tier Charge/Kg ₹100']},
    {n:'Choco Berry Almond Cake', p:1500, t:['2 Layer Charge/Kg ₹100','Tier Charge/Kg ₹100']},
    {n:'Red Vancho Cake', p:1150, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹630']},
  ],
  fresh:[
    {n:'Fruit Alize Cake', p:1400, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹100']},
    {n:'Choco Fruit Gateaux', p:1400, t:['Eggfree extra charge included']},
    {n:'Fresh Fruits Cake', p:1250, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹100']},
    {n:'Royal Fruit Gateaux', p:1600, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹100']},
  ],
  cheesecake:[
    {n:'Blueberry Cheese Cake', p:1600, t:[]},
  ],
  royal:[
    {n:'Pistachio Kunafa Gateaux', p:2100, t:[]},
    {n:'Berry Pistachio Gateaux', p:1900, t:[]},
  ],
  regular:[
    {n:'Vanilla Cake', p:680, t:['Eggfree extra charge included','2 Layer Charge/Kg ₹50','Tier Charge/Kg ₹100','Small cake ₹370','Mini cake ₹260']},
  ],
};

const BAKEROOM_IMAGE_DEFAULT = 'https://images.pexels.com/photos/17283922/pexels-photo-17283922.jpeg?auto=compress&cs=tinysrgb&w=1400';

/* Real Biscotti cake photography for the Bake Room gallery — substituted at
   build time: relative "gallery/xx.jpg" files for the deployed site, or
   inline base64 images for the single-file standalone preview. */
const GALLERY_IMAGES = ["gallery/gallery-01.jpg", "gallery/gallery-02.jpg", "gallery/gallery-03.jpg", "gallery/gallery-04.jpg", "gallery/gallery-05.jpg", "gallery/gallery-06.jpg", "gallery/gallery-07.jpg", "gallery/gallery-08.jpg", "gallery/gallery-09.jpg", "gallery/gallery-10.jpg", "gallery/gallery-11.jpg", "gallery/gallery-12.jpg", "gallery/gallery-13.jpg", "gallery/gallery-14.jpg", "gallery/gallery-15.jpg", "gallery/gallery-16.jpg", "gallery/gallery-17.jpg", "gallery/gallery-18.jpg", "gallery/gallery-19.jpg", "gallery/gallery-20.jpg", "gallery/gallery-21.jpg", "gallery/gallery-22.jpg", "gallery/gallery-23.jpg", "gallery/gallery-24.jpg", "gallery/gallery-25.jpg", "gallery/gallery-26.jpg", "gallery/gallery-27.jpg", "gallery/gallery-28.jpg", "gallery/gallery-29.jpg", "gallery/gallery-30.jpg", "gallery/gallery-31.jpg", "gallery/gallery-32.jpg", "gallery/gallery-33.jpg", "gallery/gallery-34.jpg"];

const MENU_CACHE_KEY = 'biscottiMenuCacheV3';   // read-only copy of the last menu the SERVER sent (for instant paint)
const ADMIN_SESSION_KEY = 'biscottiStaffSession'; // tab-only (sessionStorage) login token
// Earlier versions kept menu edits and the staff password in this browser. Those copies
// are obsolete (and the password one was a security risk), so clear them.
try{ localStorage.removeItem('biscottiMenuStateV2'); localStorage.removeItem('biscotti_auth_v1'); }catch(e){}

/* ============================================================
   ILLUSTRATED FALLBACK SYSTEM
   Every photo slot on the page shows a real <img> on top of an
   always-visible, hand-drawn cake illustration. If the photo
   can't load (offline preview, blocked network, broken link),
   the illustration underneath is what the visitor sees —
   so there is never a blank box.
   ============================================================ */
const TONES = {
  classic:    { base:'#4a2a1e', accent:'#8a3b2e', top:'cherry'   },
  signature:  { base:'#4a3416', accent:'#e8c988', top:'swirl'    },
  premium:    { base:'#3a1219', accent:'#d4af5a', top:'gold'     },
  fresh:      { base:'#47612f', accent:'#a3c96b', top:'fruit'    },
  cheesecake: { base:'#7a5f34', accent:'#f3e8d0', top:'cream'    },
  royal:      { base:'#3f4a1f', accent:'#d8be86', top:'gold'     },
  regular:    { base:'#7a5c3a', accent:'#f7ecd6', top:'rose'     },
  chocolate:  { base:'#2c1811', accent:'#6b3f2e', top:'drizzle'  },
  redvelvet:  { base:'#5c1520', accent:'#f3e8d0', top:'cream'    },
  caramel:    { base:'#6b4118', accent:'#d8a34b', top:'drizzle'  },
  coffee:     { base:'#3c2a1c', accent:'#a9825a', top:'bean'     },
  oreo:       { base:'#221c1a', accent:'#f3e8d0', top:'cream'    },
  rainbow:    { base:'#caa46a', accent:'#e8dcc4', top:'stripe'   },
  nutty:      { base:'#6b4726', accent:'#c98a3f', top:'nut'      },
  lavender:   { base:'#6f6187', accent:'#cdbfe0', top:'rose'     },
};

const KEYWORD_TONES = [
  [/cheesecake|cheese cake/i, 'cheesecake'],
  [/pistachio/i, 'royal'],
  [/red ?velvet/i, 'redvelvet'],
  [/carrot|dates/i, 'nutty'],
  [/rainbow/i, 'rainbow'],
  [/oreo/i, 'oreo'],
  [/caramel|butterscotch|toffee|fudge/i, 'caramel'],
  [/coffee|cappuccino|irish/i, 'coffee'],
  [/lavender/i, 'lavender'],
  [/almond|hazelnut|praline|dry ?fruit|crunchy|honey ?nut|nutty/i, 'nutty'],
  [/fruit|berry|strawberry|blueberry|mango|litchi|lychee|pineapple|fresh/i, 'fresh'],
  [/vanilla|white|milk/i, 'regular'],
  [/gold|kunafa|royal/i, 'royal'],
  [/choco|chocolate|dark|truffle|ferrero|nutella|brownie|biscoff|spanish|holiks|rock|flacks|raffaello/i, 'chocolate'],
];

function assignTone(catId, name){
  for (const [re, tone] of KEYWORD_TONES){
    if (re.test(name)) return tone;
  }
  const cat = DEFAULT_CATEGORIES.find(c=>c.id===catId);
  return (cat && cat.tone) || 'classic';
}

/* Real, royalty-free luxury cake photography (Pexels). Several photos per
   flavour tone where available, so cakes sharing a flavour family still get
   different photos from one another instead of all repeating the same shot. */
const PHOTO_POOL = {
  classic:    ['2147868'],
  signature:  ['34180404','29090620','369267','23384635'],
  premium:    ['29098354','20351331','35618231'],
  fresh:      ['3913295','3593430'],
  cheesecake: ['1126359'],
  royal:      ['13715795'],
  regular:    ['3593430','4110001','5729094'],
  chocolate:  ['2147868','369267'],
  redvelvet:  ['6133313'],
  caramel:    ['839220'],
  coffee:     ['2147857'],
  oreo:       ['2147868'],
  rainbow:    ['3913295','23384635'],
  nutty:      ['839220'],
  lavender:   ['36003102','10633531'],
};
function pexelsUrl(id, w){ return `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${w||800}`; }
function photoForTone(toneId){
  const ids = PHOTO_POOL[toneId] || PHOTO_POOL.classic;
  return pexelsUrl(ids[0]);
}
/* Picks a specific photo for one cake: same tone family, but a different
   entry in the pool per cake name (hashed), so identical-flavour cakes don't
   all show the exact same photo. */
function photoForProduct(toneId, name){
  const ids = PHOTO_POOL[toneId] || PHOTO_POOL.classic;
  const idx = hashSeed(name) % ids.length;
  return pexelsUrl(ids[idx]);
}

function cakeSVG(toneId, detailed){
  const t = TONES[toneId] || TONES.classic;
  const toppingMarks = {
    cherry:   (cx)=>`<circle cx="${cx}" cy="40" r="8" fill="#8a1f2b"/><circle cx="${cx+18}" cy="46" r="6" fill="#8a1f2b"/>`,
    swirl:    (cx)=>`<path d="M${cx-22} 44c6-10 20-10 26 0s20 10 26 0" stroke="${t.accent}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    gold:     (cx)=>`<path d="M${cx} 30l4 10 10 1-8 7 3 10-9-6-9 6 3-10-8-7 10-1z" fill="${t.accent}"/>`,
    fruit:    (cx)=>`<circle cx="${cx-18}" cy="42" r="6" fill="#c94b4b"/><circle cx="${cx}" cy="36" r="6" fill="#e0a63a"/><circle cx="${cx+18}" cy="42" r="6" fill="#7a9c4a"/>`,
    cream:    (cx)=>`<path d="M${cx-24} 46c4-12 44-12 48 0" stroke="${t.accent}" stroke-width="6" fill="none" stroke-linecap="round"/>`,
    rose:     (cx)=>`<circle cx="${cx}" cy="40" r="10" fill="none" stroke="${t.accent}" stroke-width="3"/><circle cx="${cx}" cy="40" r="4" fill="${t.accent}"/>`,
    drizzle:  (cx)=>`<path d="M${cx-26} 40q6 10 12 0t12 0 12 0 12 0 12 0" stroke="${t.accent}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    bean:     (cx)=>`<ellipse cx="${cx-12}" cy="40" rx="6" ry="9" fill="${t.accent}"/><ellipse cx="${cx+12}" cy="42" rx="6" ry="9" fill="${t.accent}"/>`,
    stripe:   (cx)=>`<rect x="${cx-24}" y="34" width="48" height="5" fill="#c94b4b"/><rect x="${cx-24}" y="41" width="48" height="5" fill="#e0a63a"/><rect x="${cx-24}" y="48" width="48" height="5" fill="#7a9c4a"/>`,
    nut:      (cx)=>`<circle cx="${cx-14}" cy="40" r="5" fill="${t.accent}"/><circle cx="${cx+2}" cy="36" r="5" fill="${t.accent}"/><circle cx="${cx+16}" cy="42" r="5" fill="${t.accent}"/>`,
  };
  const opShell = detailed ? 0.16 : 0.22;

  // Wide canvas for hero/banner slots so the cake sits centred with room to
  // breathe on both sides, instead of a near-square crop being stretched
  // and cropped top/bottom on a wide frame.
  const vbW = detailed ? 400 : 200;
  const cx = vbW / 2;
  const markFn = toppingMarks[t.top] || toppingMarks.cherry;
  const glow = detailed
    ? `<ellipse cx="${cx}" cy="108" rx="150" ry="120" fill="rgba(255,255,255,0.05)"/>`
    : '';

  return `<svg viewBox="0 0 ${vbW} 220" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Illustrated cake">
    <rect width="${vbW}" height="220" fill="${t.base}"/>
    ${glow}
    <ellipse cx="${cx}" cy="196" rx="82" ry="14" fill="rgba(0,0,0,0.18)"/>
    <path d="M${cx-72} 150h144v28c0 10-8 18-18 18h-108c-10 0-18-8-18-18v-28z" fill="rgba(255,255,255,${opShell})" stroke="rgba(255,255,255,0.4)" stroke-width="1.2"/>
    <path d="M${cx-60} 150c6-14 6-24 0-36h120c-6 12-6 22 0 36h-120z" fill="rgba(255,255,255,${opShell+0.05})" stroke="rgba(255,255,255,0.4)" stroke-width="1.2"/>
    <path d="M${cx-48} 114c5-12 5-20 0-30h96c-5 10-5 18 0 30h-96z" fill="rgba(255,255,255,${opShell+0.1})" stroke="rgba(255,255,255,0.4)" stroke-width="1.2"/>
    <path d="M${cx-36} 84c4-10 4-16 0-24h72c-4 8-4 14 0 24h-72z" fill="rgba(255,255,255,${opShell+0.16})" stroke="rgba(255,255,255,0.4)" stroke-width="1.2"/>
    ${markFn(cx)}
  </svg>`;
}

/* Deterministic small hash so each cake name maps to a consistent, unique
   colour nudge — every cake looks visually distinct, even ones sharing a
   flavour family, without needing a unique photo per item. */
function hashSeed(str){
  let h = 0;
  for (let i=0; i<str.length; i++){ h = (h*31 + str.charCodeAt(i)) >>> 0; }
  return h;
}
function variantFilterFor(name){
  const h = hashSeed(name);
  const hue = (h % 41) - 20;        // -20..+20 deg
  const sat = 92 + (h % 20);        // 92%..112%
  const light = 96 + (h % 10);      // 96%..106%
  return `hue-rotate(${hue}deg) saturate(${sat}%) brightness(${light}%)`;
}

function photoSlot(url, toneId, extraClass, detailed, variantName, eager){
  const filterStyle = variantName ? ` style="filter:${variantFilterFor(variantName)}"` : '';
  const loadingAttrs = eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
  return `<div class="photo-slot ${extraClass||''}" data-tone="${toneId}">
    <div class="photo-fallback"${filterStyle}>${cakeSVG(toneId, detailed)}</div>
    <img src="${esc(url)}" alt="" ${loadingAttrs} onerror="this.style.display='none'">
  </div>`;
}

/* ============================================================
   STATE
   ============================================================ */
function defaultState(){
  const categories = DEFAULT_CATEGORIES.map(c => ({...c}));
  const products = {};
  Object.keys(DEFAULT_PRODUCTS).forEach(k => products[k] = DEFAULT_PRODUCTS[k].map(p => ({...p, t:[...p.t]})));
  return { version:0, categories, products, bakeroomImage: BAKEROOM_IMAGE_DEFAULT, gallery:[...GALLERY_IMAGES], galleryIds:[] };
}
function normalizeMenu(m){
  const menu = { version:0, bakeroomImage: BAKEROOM_IMAGE_DEFAULT, gallery:[], galleryIds:[], ...m };
  menu.categories = (menu.categories || []).map(c => ({...c}));
  menu.products = menu.products || {};
  menu.categories.forEach(c => { if (!Array.isArray(menu.products[c.id])) menu.products[c.id] = []; });
  if (!Array.isArray(menu.gallery)) menu.gallery = [];
  if (!Array.isArray(menu.galleryIds)) menu.galleryIds = [];
  return menu;
}
function readMenuCache(){
  try{
    const c = JSON.parse(localStorage.getItem(MENU_CACHE_KEY));
    if (c && Array.isArray(c.categories) && c.categories.length && c.products) return c;
  }catch(e){}
  return null;
}
function writeMenuCache(menu){
  try{ localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(menu)); }catch(e){ /* cache only; never required */ }
}

let STATE = normalizeMenu(readMenuCache() || defaultState());
let ADMIN_TOKEN = null;
let menuEpoch = 0; // bumps whenever new menu data is applied, so a slow background refresh can't overwrite a newer save

function applyMenu(menu){
  menuEpoch++;
  STATE = normalizeMenu(menu);
  writeMenuCache(STATE);
  if (!STATE.categories.some(c => c.id === currentCatId) && STATE.categories.length) currentCatId = STATE.categories[0].id;
  renderSlides();
  renderTabs();
  renderPanel(currentCatId);
  renderGallery();
}

let refreshInFlight = null;
function refreshMenu(force){
  if (refreshInFlight) return refreshInFlight;
  const startedAtEpoch = menuEpoch;
  refreshInFlight = (async ()=>{
    try{
      const remote = await apiFetch('/menu');
      if (!remote || !Array.isArray(remote.categories) || !remote.products) throw new ApiError('Unexpected menu response', 500);
      BACKEND_AVAILABLE = true;
      if (force || (startedAtEpoch === menuEpoch && remote.version !== STATE.version)) applyMenu(remote);
      return true;
    }catch(err){
      BACKEND_AVAILABLE = false;
      return false;
    }finally{ refreshInFlight = null; }
  })();
  return refreshInFlight;
}

async function initState(){
  // Paint instantly from the last server copy (or bundled defaults) — the splash screen is
  // still covering the page — then fetch the live menu and swap it in.
  renderSlides();
  renderTabs();
  renderPanel(currentCatId);
  renderGallery();
  startAutoplay();

  for (let attempt = 0; attempt < 4; attempt++){
    if (await refreshMenu(false)) break;
    await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); // hosts can take a few seconds to wake up
  }

  // Keep every open device in step: poll gently, and re-check whenever the tab/app comes back.
  setInterval(()=>{ if (!document.hidden) refreshMenu(false); }, 30000);
  document.addEventListener('visibilitychange', ()=>{ if (!document.hidden) refreshMenu(false); });
  window.addEventListener('online', ()=>refreshMenu(false));
}

let ADMIN_ON = false;
let currentCatId = 'classic';

/* ============================================================
   SPLASH
   ============================================================ */
const splash = document.getElementById('splash');
function closeSplash(){ splash.classList.add('hide'); document.body.classList.remove('no-scroll'); }
document.body.classList.add('no-scroll');
splash.addEventListener('click', closeSplash);
splash.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') closeSplash(); });
setTimeout(closeSplash, 3800);

/* ============================================================
   HEADER / NAV
   ============================================================ */
document.getElementById('brandHome').addEventListener('click', () => window.scrollTo({top:0, behavior:'smooth'}));
const menuToggle = document.getElementById('menuToggle');
const mobileNav = document.getElementById('mobileNav');
menuToggle.addEventListener('click', ()=>{
  const isOpen = mobileNav.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', isOpen);
});
document.querySelectorAll('.mobile-nav a').forEach(a=>a.addEventListener('click', ()=>{
  mobileNav.classList.remove('open');
  menuToggle.setAttribute('aria-expanded', false);
}));

/* Header starts transparent over the hero photo, then turns solid once the
   page scrolls past it — no more solid white bar sitting above the hero. */
const siteHeader = document.querySelector('.site-header');
function updateHeaderScrollState(){
  siteHeader.classList.toggle('scrolled', window.scrollY > 40);
}
window.addEventListener('scroll', updateHeaderScrollState, {passive:true});
updateHeaderScrollState();

/* ============================================================
   HERO SLIDESHOW
   ============================================================ */
const slidesRoot = document.getElementById('slidesRoot');
const dotsRoot = document.getElementById('heroDots');
let current = 0;
let autoplayTimer;

function editIconSvg(){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>'; }
function trashIconSvg(){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>'; }
function imgIconSvg(){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5.5-5.5L9 17"/></svg>'; }
function whatsappIconSvg(){ return '<svg viewBox="0 0 32 32" fill="currentColor"><path d="M16.004 3C9.377 3 4 8.373 4 15c0 2.34.66 4.523 1.804 6.383L4 29l7.86-1.77A11.94 11.94 0 0 0 16.004 27C22.63 27 28 21.627 28 15S22.63 3 16.004 3zm0 21.8a9.76 9.76 0 0 1-4.98-1.36l-.357-.212-4.66 1.05 1.02-4.54-.233-.372A9.74 9.74 0 0 1 5.2 15c0-5.958 4.846-10.8 10.804-10.8S26.8 9.042 26.8 15 21.962 24.8 16.004 24.8zm5.55-7.98c-.303-.152-1.796-.886-2.075-.987-.278-.102-.48-.152-.683.152-.202.303-.784.987-.962 1.19-.177.203-.354.228-.657.076-.303-.152-1.28-.472-2.438-1.505-.902-.804-1.51-1.797-1.688-2.1-.177-.303-.019-.467.133-.618.137-.136.303-.354.455-.53.152-.178.202-.304.303-.507.101-.203.05-.38-.025-.531-.076-.152-.683-1.646-.936-2.253-.246-.591-.497-.511-.683-.52l-.582-.01c-.202 0-.531.076-.809.38-.278.303-1.06 1.036-1.06 2.528s1.086 2.933 1.238 3.136c.152.202 2.137 3.26 5.178 4.573.723.312 1.287.499 1.727.638.726.231 1.386.198 1.908.12.582-.087 1.796-.734 2.05-1.443.253-.708.253-1.316.177-1.443-.075-.127-.278-.203-.581-.355z"/></svg>'; }

function renderSlides(){
  slidesRoot.innerHTML = '';
  dotsRoot.innerHTML = '';
  if (current >= STATE.categories.length) current = 0;
  STATE.categories.forEach((cat, i)=>{
    const slide = document.createElement('div');
    slide.className = 'slide' + (i===current ? ' active' : '');
    slide.dataset.index = i;
    slide.innerHTML = `
      ${photoSlot(cat.image, cat.tone || assignTone(cat.id, cat.name), '', true, null, i===current)}
      <div class="slide-scrim"></div>
      <div class="slide-edit-controls">
        <button class="icon-btn" data-action="edit-slide" data-cat="${cat.id}" title="Edit slide text/photo">${editIconSvg()}</button>
      </div>
      <div class="slide-content">
        <div class="slide-copy">
          <span class="slide-eyebrow">COLLECTION ${String(i+1).padStart(2,'0')} / 0${STATE.categories.length}</span>
          <h1 class="slide-title">${esc(cat.name)}</h1>
          <p class="slide-tagline">&ldquo;${esc(cat.tagline)}&rdquo;</p>
          <p class="slide-desc">${esc(cat.desc)}</p>
          <div class="slide-actions">
            <button class="btn gold slide-cta" data-cat="${esc(cat.id)}">View ${esc(cat.name)}</button>
          </div>
        </div>
      </div>
    `;
    slidesRoot.appendChild(slide);

    const dot = document.createElement('button');
    dot.className = 'hero-dot' + (i===current ? ' active' : '');
    dot.setAttribute('aria-label', 'Go to ' + cat.name);
    dot.dataset.index = i;
    dotsRoot.appendChild(dot);
  });
}

function goToSlide(i){
  const slideEls = document.querySelectorAll('.slide');
  const dotEls = document.querySelectorAll('.hero-dot');
  if (!slideEls.length) return;
  slideEls[current].classList.remove('active');
  dotEls[current].classList.remove('active');
  current = (i + slideEls.length) % slideEls.length;
  slideEls[current].classList.add('active');
  dotEls[current].classList.add('active');
}
function nextSlide(){ goToSlide(current+1); }
function prevSlide(){ goToSlide(current-1); }
function startAutoplay(){ clearInterval(autoplayTimer); autoplayTimer = setInterval(nextSlide, 6000); }

document.getElementById('nextSlide').addEventListener('click', ()=>{ nextSlide(); startAutoplay(); });
document.getElementById('prevSlide').addEventListener('click', ()=>{ prevSlide(); startAutoplay(); });

const heroSection = document.getElementById('heroSlider');
let touchStartX = 0;
heroSection.addEventListener('touchstart', e=>{ touchStartX = e.touches[0].clientX; }, {passive:true});
heroSection.addEventListener('touchend', e=>{
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 40){ dx < 0 ? nextSlide() : prevSlide(); startAutoplay(); }
}, {passive:true});

slidesRoot.addEventListener('click', e=>{
  const cta = e.target.closest('.slide-cta');
  const editBtn = e.target.closest('[data-action="edit-slide"]');
  if (editBtn){ openSlideModal(editBtn.dataset.cat); return; }
  if (cta){ selectCategory(cta.dataset.cat); document.getElementById('menu').scrollIntoView({behavior:'smooth'}); }
});
dotsRoot.addEventListener('click', e=>{
  const d = e.target.closest('.hero-dot');
  if (!d) return;
  goToSlide(parseInt(d.dataset.index));
  startAutoplay();
});

/* ============================================================
   MENU TABS + PRODUCT LIST
   ============================================================ */
const tabsRoot = document.getElementById('tabs');
const panelRoot = document.getElementById('tabPanel');

function currency(n){ return '₹' + Number(n).toLocaleString('en-IN'); }

function renderTabs(){
  tabsRoot.innerHTML = '';
  STATE.categories.forEach(cat=>{
    const tab = document.createElement('button');
    tab.className = 'tab' + (cat.id === currentCatId ? ' active' : '');
    tab.textContent = cat.name;
    tab.dataset.cat = cat.id;
    tab.setAttribute('role','tab');
    tabsRoot.appendChild(tab);
  });
}

function renderPanel(catId){
  currentCatId = catId;
  const cat = STATE.categories.find(c=>c.id===catId);
  const items = STATE.products[catId] || [];

  const cards = items.map((item, idx)=>{
    const tone = assignTone(catId, item.n);
    return `
    <div class="product-card fade-in">
      ${photoSlot(item.img || photoForProduct(tone, item.n), tone, 'product-thumb', false, item.n)}
      <div class="product-body">
        <div class="product-top">
          <span class="product-name">${esc(item.n)}</span>
          <span class="product-price">${currency(item.p)}</span>
        </div>
        ${item.t.length ? `<div class="product-tags">${item.t.map(tag=>{
          const parts = tag.split(/(₹[\d,]+)/);
          return `<span class="tag">${esc(parts[0])}${parts[1] ? '<b>'+esc(parts[1])+'</b>' : ''}</span>`;
        }).join('')}</div>` : ''}
        <div class="product-action-row">
          <button class="icon-btn whatsapp customer-only" data-action="enquire-product" data-cat="${catId}" data-idx="${idx}" title="Ask about this cake on WhatsApp">${whatsappIconSvg()}</button>
          <button class="icon-btn edit-affordance" data-action="edit-product" data-cat="${catId}" data-idx="${idx}" title="Edit cake">${editIconSvg()}</button>
          <button class="icon-btn edit-affordance" data-action="delete-product" data-cat="${catId}" data-idx="${idx}" title="Delete cake">${trashIconSvg()}</button>
        </div>
      </div>
    </div>
  `;}).join('');

  panelRoot.innerHTML = `
    <div class="tab-panel-head fade-in">
      ${photoSlot(cat.image, cat.tone || assignTone(catId, cat.name), 'tab-panel-img', true)}
      <div class="tab-panel-text">
        <span class="count-pill">${items.length} cake${items.length!==1?'s':''}</span>
        <h3 class="cat-name">${esc(cat.name)}</h3>
        <span class="cat-tag">&ldquo;${esc(cat.tagline)}&rdquo;</span>
        <p class="cat-desc">${esc(cat.desc)}</p>
        <div class="panel-edit-row edit-affordance">
          <button class="btn small ghost" data-action="edit-slide" data-cat="${catId}">Edit collection text</button>
          <button class="btn small ghost" data-action="edit-cat-image" data-cat="${catId}">Change photo</button>
          <button class="btn small gold" data-action="add-product" data-cat="${catId}">+ Add New Cake</button>
        </div>
      </div>
    </div>
    <div class="product-grid">
      ${cards || '<p class="empty-note">No items listed for this collection yet.</p>'}
    </div>
  `;
}

function selectCategory(catId){
  currentCatId = catId;
  renderTabs();
  renderPanel(catId);
}

tabsRoot.addEventListener('click', e=>{
  const tab = e.target.closest('.tab');
  if (!tab) return;
  selectCategory(tab.dataset.cat);
});

panelRoot.addEventListener('click', e=>{
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'edit-product') openProductModal(btn.dataset.cat, parseInt(btn.dataset.idx));
  if (action === 'add-product') openProductModal(btn.dataset.cat, null);
  if (action === 'delete-product') deleteProduct(btn.dataset.cat, parseInt(btn.dataset.idx));
  if (action === 'edit-slide') openSlideModal(btn.dataset.cat);
  if (action === 'edit-cat-image') openCatImageModal(btn.dataset.cat);
  if (action === 'enquire-product') enquireProduct(btn.dataset.cat, parseInt(btn.dataset.idx));
});

let pendingEnquiry = null; // { type: 'product'|'bakeroom'|'gallery', ...details } for the Quick Cake Enquiry popup

function enquireProduct(catId, idx){
  pendingEnquiry = { type:'product', catId, idx };
  openEnquiryModal();
}

function enquireBakeroom(){
  pendingEnquiry = { type:'bakeroom' };
  openEnquiryModal();
}
document.querySelectorAll('[data-action="enquire-bakeroom"]').forEach(btn=>{
  btn.addEventListener('click', enquireBakeroom);
});

const enquiryModal = document.getElementById('enquiryModal');
const enquiryEggless = document.getElementById('enquiryEggless');

function closeEnquiryModal(){
  pendingEnquiry = null;
  closeModal(enquiryModal);
}

/* Fills the "Quick Cake Enquiry" popup for whatever was tapped: a menu cake,
   a Bake Room gallery photo, or the general Bake Room custom-cake button. */
function openEnquiryModal(){
  if (!pendingEnquiry) return;
  let thumb, name, sub;
  if (pendingEnquiry.type === 'product'){
    const item = STATE.products[pendingEnquiry.catId][pendingEnquiry.idx];
    const tone = assignTone(pendingEnquiry.catId, item.n);
    thumb = photoSlot(item.img || photoForProduct(tone, item.n), tone, '', false, item.n);
    name = item.n;
    sub = 'From ' + currency(item.p);
  } else if (pendingEnquiry.type === 'gallery'){
    const imgs = STATE.gallery || GALLERY_IMAGES;
    thumb = photoSlot(imgs[pendingEnquiry.idx], 'signature', '', false);
    name = 'Bake Room Custom Cake';
    sub = 'Made to order';
  } else {
    thumb = photoSlot(STATE.bakeroomImage || BAKEROOM_IMAGE_DEFAULT, 'signature', '', false);
    name = 'Your Custom Cake';
    sub = 'Designed just for you';
  }
  document.getElementById('enquiryThumb').innerHTML = thumb;
  document.getElementById('enquiryName').textContent = name;
  document.getElementById('enquiryPrice').textContent = sub;
  enquiryEggless.checked = false;
  openModal(enquiryModal);
}

document.getElementById('enquiryClose').addEventListener('click', closeEnquiryModal);
enquiryModal.addEventListener('click', e=>{ if (e.target === enquiryModal) closeEnquiryModal(); });
document.addEventListener('keydown', e=>{
  if (e.key === 'Escape' && enquiryModal.classList.contains('open')) closeEnquiryModal();
});

/**
 * Opens WhatsApp directly to the Biscotti number (8606994103) with the
 * enquiry pre-filled. WhatsApp's wa.me links can only pre-fill text, not
 * attach an actual image file — there's no web-based way to both open a
 * specific number AND hand over a real photo attachment at the same time
 * (the only way to attach a real file is the OS Share sheet, which can't
 * be pre-targeted to one number). So when the cake has a real, publicly
 * reachable photo URL, that link is included in the message text, which
 * WhatsApp will usually turn into a photo preview once opened; staff-
 * uploaded photos have no public URL, so there's nothing to link for those.
 */
/* WhatsApp's pre-filled link text is plain text. Its own bold syntax (*text*) would show literal
   asterisks in the message box until the message is sent, so "Eggfree" is written with Unicode
   bold letters instead: it looks bold immediately, and no asterisk ever appears.
   Cake / collection names are stripped of asterisks, and the percent-encoder also escapes
   ' ( ) ! ~ so the link survives WhatsApp's redirect intact. */
const waBold = text => Array.from(String(text)).map(ch => {
  const c = ch.codePointAt(0);
  if (c >= 65 && c <= 90)  return String.fromCodePoint(0x1D5D4 + c - 65);   // A–Z → 𝗔–𝗭
  if (c >= 97 && c <= 122) return String.fromCodePoint(0x1D5EE + c - 97);   // a–z → 𝗮–𝘇
  return ch;
}).join('');
const WA_BOLD_EGGFREE = waBold('Eggfree');
const waPlain = text => String(text).replace(/\*+/g, '');
const waEncode = text => encodeURIComponent(text).replace(/[!'()*~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function sendWhatsappEnquiry(msg, imgSrc){
  msg = msg.replace(/\*/g, ''); // never let an asterisk through
  if (imgSrc && !imgSrc.startsWith('data:')){
    const absoluteSrc = new URL(imgSrc, window.location.href).href;
    msg += `\n\n${absoluteSrc}`;
  }
  window.open(`https://wa.me/918606994103?text=${waEncode(msg)}`, '_blank', 'noopener');
}

document.getElementById('enquiryContinue').addEventListener('click', ()=>{
  if (!pendingEnquiry) return;
  const eggless = enquiryEggless.checked;
  let msg;
  let imgSrc = null;

  if (pendingEnquiry.type === 'product'){
    const { catId, idx } = pendingEnquiry;
    const item = STATE.products[catId][idx];
    const cat = STATE.categories.find(c=>c.id===catId);
    msg = `Hi Biscotti! I'd like to enquire about the ${waPlain(item.n)} from your ${waPlain(cat.name)}${eggless ? ` — ${WA_BOLD_EGGFREE}, please.` : '.'}`;
    // same photo the popup shows: staff-uploaded one, else the menu's default cake photo
    imgSrc = item.img || photoForProduct(assignTone(catId, item.n), item.n);
  } else if (pendingEnquiry.type === 'bakeroom'){
    msg = `Hi Biscotti! I'd like to design a custom cake for an upcoming celebration${eggless ? ` (${WA_BOLD_EGGFREE})` : ''}. Could you help?`;
    imgSrc = STATE.bakeroomImage || BAKEROOM_IMAGE_DEFAULT; // the Bake Room photo shown in the popup
  } else if (pendingEnquiry.type === 'gallery'){
    const imgs = STATE.gallery || GALLERY_IMAGES;
    imgSrc = imgs[pendingEnquiry.idx];
    msg = `Hi Biscotti! I saw this cake in your Bake Room gallery (photo ${pendingEnquiry.idx + 1}) and I'd like to enquire about getting something similar made${eggless ? ` — ${WA_BOLD_EGGFREE}, please.` : '.'}`;
  }

  sendWhatsappEnquiry(msg, imgSrc);
  closeEnquiryModal();
});

/* ============================================================
   ADMIN / STAFF LOGIN
   ============================================================ */
const loginModal = document.getElementById('loginModal');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const adminBar = document.getElementById('adminBar');

function openModal(el){ el.classList.add('open'); }
function closeModal(el){ el.classList.remove('open'); }

function openLoginModal(){
  loginError.classList.remove('show');
  document.getElementById('loginUsername').value='';
  document.getElementById('loginPassword').value='';
  openModal(loginModal);
}
document.getElementById('staffOpenBtnFooter').addEventListener('click', openLoginModal);
document.getElementById('loginCancel').addEventListener('click', ()=>closeModal(loginModal));
loginModal.addEventListener('click', e=>{ if (e.target === loginModal) closeModal(loginModal); });

loginForm.addEventListener('submit', async e=>{
  e.preventDefault();
  loginError.classList.remove('show');
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = loginForm.querySelector('button[type="submit"]');

  await withBusy(btn, 'Logging in…', async ()=>{
    try{
      const res = await apiFetch('/staff/login', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username, password})
      });
      ADMIN_TOKEN = res.token;
      try{ sessionStorage.setItem(ADMIN_SESSION_KEY, res.token); }catch(e){}
      enterAdmin();
      if (res.usingDefaultPassword){
        toast('You are still using the default staff password. Please tap "Change password" in the staff bar and set your own.', 'warn', 10000);
      }
    }catch(err){
      loginError.textContent = err.message || 'Incorrect username or password. Please try again.';
      loginError.classList.add('show');
    }
  });
});

/* ---- forgot password: request a reset link by email ---- */
const forgotPasswordModal = document.getElementById('forgotPasswordModal');
const forgotPasswordForm = document.getElementById('forgotPasswordForm');
const forgotPasswordError = document.getElementById('forgotPasswordError');
const forgotPasswordSuccess = document.getElementById('forgotPasswordSuccess');

document.getElementById('forgotPasswordLink').addEventListener('click', ()=>{
  closeModal(loginModal);
  forgotPasswordError.classList.remove('show');
  forgotPasswordSuccess.classList.remove('show');
  forgotPasswordForm.reset();
  openModal(forgotPasswordModal);
});
document.getElementById('forgotPasswordCancel').addEventListener('click', ()=>closeModal(forgotPasswordModal));
forgotPasswordModal.addEventListener('click', e=>{ if (e.target === forgotPasswordModal) closeModal(forgotPasswordModal); });

const FP_SUCCESS_DEFAULT = forgotPasswordSuccess.textContent;
forgotPasswordForm.addEventListener('submit', async e=>{
  e.preventDefault();
  forgotPasswordError.classList.remove('show');
  forgotPasswordSuccess.classList.remove('show');
  forgotPasswordSuccess.textContent = FP_SUCCESS_DEFAULT;
  const email = document.getElementById('fpEmail').value.trim();
  const btn = forgotPasswordForm.querySelector('button[type="submit"]');

  await withBusy(btn, 'Sending…', async ()=>{
    try{
      const res = await apiFetch('/staff/forgot-password', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email})
      });
      if (res.devResetUrl){
        // Local development only: the server never sends this in production.
        console.log('Dev mode (no SMTP configured) — reset link:', res.devResetUrl);
        forgotPasswordSuccess.textContent = `No email server is configured, so here is the reset link directly (local development only): ${res.devResetUrl}`;
      }
      forgotPasswordSuccess.classList.add('show');
    }catch(err){
      // Real problems (offline, rate-limited) are shown honestly; an unknown email is never revealed.
      forgotPasswordError.textContent = err.message || 'Something went wrong. Please try again.';
      forgotPasswordError.classList.add('show');
    }
  });
});

/* ---- reset password: opened automatically via ?resetToken=... in the URL ---- */
const resetPasswordModal = document.getElementById('resetPasswordModal');
const resetPasswordForm = document.getElementById('resetPasswordForm');
const resetPasswordError = document.getElementById('resetPasswordError');
let pendingResetToken = null;

(function checkForResetTokenInUrl(){
  const params = new URLSearchParams(window.location.search);
  const token = params.get('resetToken');
  if (!token) return;
  pendingResetToken = token;
  openModal(resetPasswordModal);
  // Clean the token out of the visible URL so it isn't sitting in the
  // address bar / browser history / any screenshot after this.
  params.delete('resetToken');
  const cleanUrl = window.location.pathname + (params.toString() ? `?${params}` : '') + window.location.hash;
  window.history.replaceState({}, '', cleanUrl);
})();

resetPasswordForm.addEventListener('submit', async e=>{
  e.preventDefault();
  resetPasswordError.classList.remove('show');
  const newPassword = document.getElementById('rpNewPassword').value;
  const confirmPassword = document.getElementById('rpConfirmPassword').value;

  if (newPassword !== confirmPassword){
    resetPasswordError.textContent = 'New password and confirmation do not match.';
    resetPasswordError.classList.add('show');
    return;
  }
  if (!pendingResetToken){
    resetPasswordError.textContent = 'Missing reset link details. Please use the link from your email again.';
    resetPasswordError.classList.add('show');
    return;
  }

  try{
    await apiFetch('/staff/reset-password', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token: pendingResetToken, newPassword })
    });
    pendingResetToken = null;
    closeModal(resetPasswordModal);
    toast('Password reset. You can now log in with your new password.');
    openLoginModal();
  }catch(err){
    resetPasswordError.textContent = err.message || 'This reset link is invalid or has expired. Please request a new one.';
    resetPasswordError.classList.add('show');
  }
});

function authHeaders(){
  return ADMIN_TOKEN ? {'Content-Type':'application/json', 'Authorization':'Bearer ' + ADMIN_TOKEN} : {'Content-Type':'application/json'};
}

/* Every staff write goes through here: it attaches the login token and, if the
   session has expired, drops back to the login screen with a clear message. */
async function adminFetch(path, options={}){
  try{
    return await apiFetch(path, {...options, headers:{...authHeaders(), ...(options.headers || {})}}, 45000);
  }catch(err){
    if (err.status === 401 && ADMIN_ON){
      leaveAdmin();
      toast('Your staff session expired. Please log in again.', 'error', 6000);
      openLoginModal();
    }
    throw err;
  }
}

function enterAdmin(){
  ADMIN_ON = true;
  document.body.classList.add('admin-on');
  adminBar.classList.add('on');
  closeModal(loginModal);
  renderPanel(currentCatId);
  refreshMenu(true); // make sure staff edit exactly what the server holds right now
}

function leaveAdmin(){
  ADMIN_ON = false;
  ADMIN_TOKEN = null;
  try{ sessionStorage.removeItem(ADMIN_SESSION_KEY); }catch(e){}
  document.body.classList.remove('admin-on');
  adminBar.classList.remove('on');
  renderPanel(currentCatId);
}
document.getElementById('exitAdminBtn').addEventListener('click', leaveAdmin);

document.getElementById('resetMenuBtn').addEventListener('click', async ()=>{
  if (!confirm('Reset the entire menu and slideshow back to the original Biscotti defaults on ALL devices? This cannot be undone.')) return;
  try{
    const res = await adminFetch('/reset', {method:'POST'});
    applyMenu(res.menu);
    toast('Menu reset to the original defaults.');
  }catch(err){ saveFailed(err); }
});

/* ---- change staff username / password, from inside staff mode ---- */
const changePasswordModal = document.getElementById('changePasswordModal');
const changePasswordForm = document.getElementById('changePasswordForm');
const changePasswordError = document.getElementById('changePasswordError');

function openChangePasswordModal(){
  changePasswordError.classList.remove('show');
  changePasswordForm.reset();
  apiFetch('/staff/me', {headers: authHeaders()})
    .then(me=>{ document.getElementById('cpNewEmail').value = me.email || ''; })
    .catch(()=>{ /* fine, leave blank */ });
  openModal(changePasswordModal);
}
document.getElementById('changePasswordBtn').addEventListener('click', openChangePasswordModal);
document.getElementById('changePasswordCancel').addEventListener('click', ()=>closeModal(changePasswordModal));
changePasswordModal.addEventListener('click', e=>{ if (e.target === changePasswordModal) closeModal(changePasswordModal); });

changePasswordForm.addEventListener('submit', async e=>{
  e.preventDefault();
  changePasswordError.classList.remove('show');
  const currentPassword = document.getElementById('cpCurrent').value;
  const newUsername = document.getElementById('cpNewUsername').value.trim();
  const newEmail = document.getElementById('cpNewEmail').value.trim();
  const newPassword = document.getElementById('cpNewPassword').value;
  const confirmPassword = document.getElementById('cpConfirmPassword').value;

  if (newPassword !== confirmPassword){
    changePasswordError.textContent = 'New password and confirmation do not match.';
    changePasswordError.classList.add('show');
    return;
  }
  const btn = changePasswordForm.querySelector('button[type="submit"]');
  await withBusy(btn, 'Saving…', async ()=>{
    try{
      const res = await adminFetch('/staff/change-password', {
        method:'POST', body: JSON.stringify({ currentPassword, newUsername, newEmail, newPassword })
      });
      ADMIN_TOKEN = res.token; // the old token was just retired — keep this device logged in
      try{ sessionStorage.setItem(ADMIN_SESSION_KEY, res.token); }catch(e){}
      closeModal(changePasswordModal);
      toast('Staff login updated. Other devices will need to log in again.');
    }catch(err){
      changePasswordError.textContent = err.message || 'Could not update. Please try again.';
      changePasswordError.classList.add('show');
    }
  });
});

/* ============================================================
   PRODUCT ADD / EDIT / DELETE
   ============================================================ */
const productModal = document.getElementById('productModal');
const productForm = document.getElementById('productForm');
let editingProduct = { cat:null, idx:null, id:null };

function openProductModal(catId, idx){
  const isNew = idx === null;
  const item = isNew ? null : STATE.products[catId][idx];
  if (!isNew && !item.id){
    toast('The menu is still loading from the server. Please try again in a moment.', 'warn');
    refreshMenu(true);
    return;
  }
  editingProduct = { cat:catId, idx:idx, id: isNew ? null : item.id };
  document.getElementById('productModalTitle').textContent = isNew ? 'Add a New Cake' : 'Edit Cake';
  document.getElementById('pfImage').value = '';
  if (isNew){
    document.getElementById('pfName').value = '';
    document.getElementById('pfPrice').value = '';
    document.getElementById('pfTags').value = '';
  } else {
    document.getElementById('pfName').value = item.n;
    document.getElementById('pfPrice').value = item.p;
    document.getElementById('pfTags').value = item.t.join(', ');
  }
  openModal(productModal);
}
document.getElementById('productCancel').addEventListener('click', ()=>closeModal(productModal));
productModal.addEventListener('click', e=>{ if (e.target === productModal) closeModal(productModal); });

productForm.addEventListener('submit', async e=>{
  e.preventDefault();
  const name = document.getElementById('pfName').value.trim();
  const price = parseFloat(document.getElementById('pfPrice').value);
  const tagsRaw = document.getElementById('pfTags').value.trim();
  const tags = tagsRaw ? tagsRaw.split(',').map(t=>t.trim()).filter(Boolean) : [];
  if (!name || isNaN(price)) return;

  const { cat, id } = editingProduct;
  const file = document.getElementById('pfImage').files[0];
  const btn = productForm.querySelector('button[type="submit"]');

  await withBusy(btn, 'Saving…', async ()=>{
    try{
      const payload = { n:name, p:price, t:tags };
      if (file) payload.img = await fileToDataUrl(file);   // omitted → the server keeps the current photo
      const res = id
        ? await adminFetch(`/products/${id}`, {method:'PUT', body: JSON.stringify(payload)})
        : await adminFetch(`/products/${cat}`, {method:'POST', body: JSON.stringify(payload)});
      applyMenu(res.menu);   // show exactly what the database now holds
      closeModal(productModal);
      toast('Saved — visible on every device.');
    }catch(err){ saveFailed(err); }
  });
});

async function deleteProduct(catId, idx){
  const item = STATE.products[catId][idx];
  if (!item.id){ toast('The menu is still loading from the server. Please try again in a moment.', 'warn'); refreshMenu(true); return; }
  if (!confirm(`Remove "${item.n}" from the menu?`)) return;
  try{
    const res = await adminFetch(`/products/${item.id}`, {method:'DELETE'});
    applyMenu(res.menu);
    toast('Removed.');
  }catch(err){ saveFailed(err); }
}

/* ============================================================
   SLIDE (collection text + photo) EDIT
   ============================================================ */
const slideModal = document.getElementById('slideModal');
const slideForm = document.getElementById('slideForm');
let editingSlideCat = null;

function openSlideModal(catId){
  editingSlideCat = catId;
  const cat = STATE.categories.find(c=>c.id===catId);
  document.getElementById('sfTagline').value = cat.tagline;
  document.getElementById('sfDesc').value = cat.desc;
  document.getElementById('sfImage').value = '';
  openModal(slideModal);
}
document.getElementById('slideCancel').addEventListener('click', ()=>closeModal(slideModal));
slideModal.addEventListener('click', e=>{ if (e.target === slideModal) closeModal(slideModal); });

function fileToDataUrl(file){
  // Compress/resize in the browser before this ever leaves the device.
  // Vercel's serverless functions hard-cap request AND response bodies at
  // 4.5MB — a raw phone photo (often 3-10MB) blows past that instantly, so
  // the save silently fails there even though it looked fine locally until
  // the next refresh pulled the old, unedited data back from the server.
  const MAX_DIMENSION = 900;
  const JPEG_QUALITY = 0.72;
  return new Promise((resolve, reject)=>{
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION){
        if (width > height){ height = Math.round(height * MAX_DIMENSION / width); width = MAX_DIMENSION; }
        else { width = Math.round(width * MAX_DIMENSION / height); height = MAX_DIMENSION; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
    };
    img.onerror = (err) => { URL.revokeObjectURL(objectUrl); reject(err); };
    img.src = objectUrl;
  });
}

slideForm.addEventListener('submit', async e=>{
  e.preventDefault();
  const catId = editingSlideCat;
  const tagline = document.getElementById('sfTagline').value.trim();
  const desc = document.getElementById('sfDesc').value.trim();
  const file = document.getElementById('sfImage').files[0];
  const btn = slideForm.querySelector('button[type="submit"]');

  await withBusy(btn, 'Saving…', async ()=>{
    try{
      const body = { tagline, desc };
      if (file) body.image = await fileToDataUrl(file);
      const res = await adminFetch(`/categories/${catId}`, {method:'PUT', body: JSON.stringify(body)});
      current = Math.max(0, res.menu.categories.findIndex(c=>c.id===catId)); // show the slide that was just edited
      applyMenu(res.menu);
      closeModal(slideModal);
      toast('Saved — visible on every device.');
    }catch(err){ saveFailed(err); }
  });
});

/* ============================================================
   CATEGORY (menu tab) PHOTO EDIT
   ============================================================ */
const catImageModal = document.getElementById('catImageModal');
const catImageForm = document.getElementById('catImageForm');
let editingCatImageId = null;

function openCatImageModal(catId){
  editingCatImageId = catId;
  document.getElementById('cfImage').value = '';
  openModal(catImageModal);
}
document.getElementById('catImageCancel').addEventListener('click', ()=>closeModal(catImageModal));
catImageModal.addEventListener('click', e=>{ if (e.target === catImageModal) closeModal(catImageModal); });

catImageForm.addEventListener('submit', async e=>{
  e.preventDefault();
  const file = document.getElementById('cfImage').files[0];
  if (!file) return;
  const btn = catImageForm.querySelector('button[type="submit"]');
  await withBusy(btn, 'Uploading…', async ()=>{
    try{
      const dataUrl = await fileToDataUrl(file);
      const res = await adminFetch(`/categories/${editingCatImageId}`, {method:'PUT', body: JSON.stringify({image: dataUrl})});
      applyMenu(res.menu);
      closeModal(catImageModal);
      toast('Photo saved — visible on every device.');
    }catch(err){ saveFailed(err); }
  });
});

/* ============================================================
   BAKE ROOM GALLERY
   ============================================================ */
/* ---- real custom cakes we've baked, with lightbox ---- */
const galleryGrid = document.getElementById('galleryGrid');

function renderGallery(){
  if (!galleryGrid) return;
  const imgs = STATE.gallery || GALLERY_IMAGES;
  galleryGrid.innerHTML = imgs.map((src, i)=>`
    <div class="gallery-item-wrap">
      <button class="gallery-item" data-idx="${i}" aria-label="View cake photo ${i+1} full size">
        <img src="${esc(src)}" alt="Custom cake by Biscotti" loading="lazy">
      </button>
      <button class="icon-btn gallery-whatsapp" data-action="enquire-gallery" data-idx="${i}" title="Ask about this cake on WhatsApp">${whatsappIconSvg()}</button>
      <button class="icon-btn gallery-delete edit-affordance" data-action="delete-gallery" data-idx="${i}" title="Remove photo">${trashIconSvg()}</button>
    </div>
  `).join('');
}
renderGallery();

const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
let lightboxIdx = 0;

function openLightbox(i){
  lightboxIdx = i;
  lightboxImg.src = (STATE.gallery || GALLERY_IMAGES)[i];
  lightbox.classList.add('open');
}
function closeLightbox(){ lightbox.classList.remove('open'); }
function lightboxStep(dir){
  const imgs = STATE.gallery || GALLERY_IMAGES;
  lightboxIdx = (lightboxIdx + dir + imgs.length) % imgs.length;
  lightboxImg.src = imgs[lightboxIdx];
}

if (galleryGrid){
  galleryGrid.addEventListener('click', async e=>{
    const delBtn = e.target.closest('[data-action="delete-gallery"]');
    if (delBtn){
      const idx = parseInt(delBtn.dataset.idx);
      const photoId = STATE.galleryIds && STATE.galleryIds[idx];
      if (!photoId){ toast('The gallery is still loading from the server. Please try again in a moment.', 'warn'); refreshMenu(true); return; }
      if (!confirm('Remove this photo from the Bake Room gallery?')) return;
      try{
        const res = await adminFetch(`/gallery/${photoId}`, {method:'DELETE'});
        applyMenu(res.menu);
        toast('Photo removed.');
      }catch(err){ saveFailed(err); }
      return;
    }
    const waBtn = e.target.closest('[data-action="enquire-gallery"]');
    if (waBtn){
      enquireGalleryPhoto(parseInt(waBtn.dataset.idx));
      return;
    }
    const btn = e.target.closest('.gallery-item');
    if (!btn) return;
    openLightbox(parseInt(btn.dataset.idx));
  });
}

function enquireGalleryPhoto(idx){
  pendingEnquiry = { type:'gallery', idx };
  openEnquiryModal();
}

document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
document.getElementById('lightboxPrev').addEventListener('click', ()=>lightboxStep(-1));
document.getElementById('lightboxNext').addEventListener('click', ()=>lightboxStep(1));
lightbox.addEventListener('click', e=>{ if (e.target === lightbox) closeLightbox(); });
document.addEventListener('keydown', e=>{
  if (!lightbox.classList.contains('open')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowRight') lightboxStep(1);
  if (e.key === 'ArrowLeft') lightboxStep(-1);
});

/* ---- add a new Bake Room photo (staff mode) ---- */
const addGalleryBtn = document.getElementById('addGalleryBtn');
const addGalleryInput = document.getElementById('addGalleryInput');
if (addGalleryBtn && addGalleryInput){
  addGalleryBtn.addEventListener('click', ()=> addGalleryInput.click());
  addGalleryInput.addEventListener('change', async ()=>{
    const file = addGalleryInput.files[0];
    if (!file) return;
    try{
      toast('Uploading photo…', null, 2500);
      const dataUrl = await fileToDataUrl(file);
      const res = await adminFetch('/gallery', {method:'POST', body: JSON.stringify({image: dataUrl})});
      applyMenu(res.menu);
      toast('Photo added — visible on every device.');
    }catch(err){ saveFailed(err); }
    addGalleryInput.value = '';
  });
}

/* ============================================================
   BOOT
   ============================================================ */
initState();

// Staying logged in across a page refresh (this tab only; closing the tab logs out).
(async function restoreStaffSession(){
  let saved = null;
  try{ saved = sessionStorage.getItem(ADMIN_SESSION_KEY); }catch(e){}
  if (!saved) return;
  ADMIN_TOKEN = saved;
  try{
    await apiFetch('/staff/me', {headers: authHeaders()});
    enterAdmin();
  }catch(err){
    ADMIN_TOKEN = null;
    if (err.status === 401){ try{ sessionStorage.removeItem(ADMIN_SESSION_KEY); }catch(e){} }
  }
})();

} catch (err) {
  console.error("Biscotti app failed to start:", err);
  var s = document.getElementById("splash");
  if (s) s.classList.add("hide");
  document.body.classList.remove("no-scroll");
}
})();
