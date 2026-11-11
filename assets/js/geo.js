/* ══════════════════════════════════════════════════════════════════
   geo.js — 地名 → 坐标，以及为地标写一句约 25 字的中文介绍。
   坐标来源：维基百科坐标接口（多语言，含重定向）+ OpenStreetMap Nominatim。
   都是公开数据，不编造：查不到就返回 null，由调用方退回手动落点。
   ══════════════════════════════════════════════════════════════════ */

const cache = new Map();

function fetchJSON(url, ms = 6000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } })
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null)
    .finally(() => clearTimeout(timer));
}

/* 标题相似度：完全同名 > 以查询开头 > 包含 */
function titleScore(title, q) {
  const t = String(title || '').toLowerCase();
  const s = q.toLowerCase();
  if (t === s) return 100;
  if (t.startsWith(s)) return 78;
  if (t.includes(s)) return 58;
  if (s.includes(t) && t.length >= 2) return 44;
  return 18;
}

async function wiki(lang, q) {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&generator=search` +
    `&gsrsearch=${encodeURIComponent(q)}&gsrlimit=5&prop=coordinates&format=json&origin=*`;
  const j = await fetchJSON(url);
  const pages = j?.query?.pages ? Object.values(j.query.pages) : [];
  return pages
    .filter(p => p.coordinates && p.coordinates[0])
    .map(p => ({
      lat: +p.coordinates[0].lat,
      lng: +p.coordinates[0].lon,
      title: p.title,
      source: `Wikipedia · ${lang}`,
      score: titleScore(p.title, q) + (p.index != null ? Math.max(0, 12 - p.index * 3) : 0)
    }));
}

async function osm(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5` +
    `&accept-language=zh-CN&q=${encodeURIComponent(q)}`;
  const j = await fetchJSON(url);
  if (!Array.isArray(j)) return [];
  const good = new Set(['city', 'town', 'village', 'administrative', 'state', 'country', 'county', 'region', 'province']);
  return j.map(x => ({
    lat: +x.lat,
    lng: +x.lon,
    title: (x.display_name || '').split(',')[0] || q,
    display: x.display_name,
    source: 'OpenStreetMap',
    score: titleScore((x.display_name || '').split(',')[0], q) * 0.6
      + (good.has(x.addresstype) ? 45 : 8)
      + Math.min(20, (+x.importance || 0) * 20)
  }));
}

export async function geocode(name) {
  const q = String(name || '').trim();
  if (q.length < 2) return null;
  if (cache.has(q)) return cache.get(q);

  const results = await Promise.all([wiki('zh', q), wiki('en', q), osm(q)]);
  const all = results.flat().filter(c => isFinite(c.lat) && isFinite(c.lng));
  if (!all.length) { cache.set(q, null); return null; }

  all.sort((a, b) => b.score - a.score);
  const best = all[0];
  const out = { lat: best.lat, lng: best.lng, label: best.title, source: best.source, alternatives: all.slice(1, 4) };
  cache.set(q, out);
  return out;
}

/* ───────── 一句 25 字左右的介绍 ───────── */

const LOW = ['海风咸味', '正午树影', '潮湿晚风', '榕下光斑', '退潮后的沙'];
const MID = ['旧城钟声', '长街灯火', '雨后石板', '半开木窗', '教堂影子'];
const HIGH = ['长夜落雪', '极昼天光', '冷杉影子', '结冰湖面', '低垂的云'];

const CLOSE = [
  '把整座城的时间都放慢了',
  '像一封一直没有寄出的信',
  '安静得像一句没有说完的耳语',
  '被傍晚的光留住了很久',
  '一直没有走远，也没有靠近',
  '把远方写得很轻，很慢'
];

const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function num2cn(n) {
  n = Math.round(Math.abs(n));
  if (n <= 10) return CN_NUM[n];
  if (n < 20) return '十' + (n % 10 ? CN_NUM[n % 10] : '');
  if (n < 100) {
    const t = Math.floor(n / 10), o = n % 10;
    return CN_NUM[t] + '十' + (o ? CN_NUM[o] : '');
  }
  return String(n);
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const pick = (arr, seed) => arr[seed % arr.length];

export function composeIntro({ name = '', lat = null, lng = null, date = '' } = {}) {
  const seed = hash(name + '|' + (date || '') + '|' + (lat == null ? '' : lat.toFixed(1)));
  const abs = lat == null ? 35 : Math.abs(lat);
  const zone = abs < 23.5 ? LOW : abs < 55 ? MID : HIGH;
  const scene = pick(zone, seed);
  const close = pick(CLOSE, seed >> 3);

  const dir = lat == null ? '' : (lat >= 0 ? '北纬' : '南纬');
  const latWord = lat == null ? '' : `${dir}${num2cn(abs)}度`;

  const m = /(\d{4})\s*[年./-]\s*(\d{1,2})?/.exec(String(date || ''));
  const months = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  const seasonWord = m && m[2]
    ? `${months[Math.min(11, Math.max(0, +m[2] - 1))]}月的`
    : '';

  /* 优先用「季节 + 地名」的写法，读起来最像人写的 */
  const patterns = [];
  if (seasonWord) patterns.push(`${seasonWord}${name}，${scene}${close}。`);
  if (latWord) patterns.push(`${latWord}的${scene}，${close}。`);
  patterns.push(`${name}的${scene}，${close}。`);

  /* 先挑长度落在 20–30 字的，再取最接近 25 的 */
  const fit = patterns.filter(p => p.length >= 20 && p.length <= 30);
  const pool = fit.length ? fit : patterns;
  let best = pool[0];
  let bestGap = Infinity;
  for (const p of pool) {
    const gap = Math.abs(p.length - 25);
    if (gap < bestGap) { bestGap = gap; best = p; }
  }
  return best;
}
