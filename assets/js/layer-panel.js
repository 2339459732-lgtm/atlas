/* ══════════════════════════════════════════════════════════════════
   layer-panel.js — 图层仪表面板

   信息层级（从外到内共四层）：
     1. 组（基底 / 地表 / 深空 / 注记）——回答"它属于哪一类"
     2. 行（名称 · 编号 · 来源徽章 · 开关）——回答"它是什么、开没开"
     3. 摘要一行——回答"打开后看到什么"
     4. 展开详情——参数、来源、许可、单独显示、复制编号

   面板只读 store 的状态，不自己维护开关；所有变更都走 store.toggle()。
   这样 URL、localStorage、渲染三处永远一致。
   ══════════════════════════════════════════════════════════════════ */

import { GROUPS, LAYERS, PRESETS, PROVENANCE } from './layers.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortId = id => id.split('.')[0];

export function createLayerPanel({ panel, list, presets, countEl, noticeEl, getLang, store, onClose }) {
  const tabs = panel.querySelector('#lyr-tabs');
  let open = new Set();
  let noticeTimer = 0;
  const lang = () => (getLang() === 'en' ? 'en' : 'zh');

  function totals() {
    let mb = 0, ms = 0;
    for (const l of LAYERS) {
      if (!store.has(l.id)) continue;
      mb += l.cost?.vramMB || 0;
      ms += l.cost?.ms || 0;
    }
    return { mb, ms: Math.round(ms * 10) / 10 };
  }

  function build() {
    const L = lang();
    /* 预设 */
    presets.innerHTML = PRESETS.map(p =>
      `<button type="button" class="lyr-seg" data-preset="${p.id}" aria-pressed="false">${L === 'zh' ? p.zh : p.en}</button>`
    ).join('');

    list.innerHTML = GROUPS.map(g => {
      const rows = LAYERS.filter(l => l.group === g.id);
      if (!rows.length) return '';
      return `<section class="lyr-sec" data-group="${g.id}">
        <header class="lyr-sec__head">
          <span class="lyr-sec__no">${g.no}</span>
          <h4>${L === 'zh' ? g.zh : g.en}</h4>
          <small>${L === 'zh' ? g.descZh : g.descEn}</small>
        </header>
        ${rows.map(l => row(l, L)).join('')}
      </section>`;
    }).join('');

    if (tabs) {
      tabs.innerHTML = GROUPS.map(g =>
        `<button type="button" class="lyr-tab" data-tab="${g.id}" aria-pressed="false"><i>${g.no}</i>${L === 'zh' ? g.zh : g.en}</button>`
      ).join('');
      tabs.querySelectorAll('[data-tab]').forEach(b => {
        b.addEventListener('click', () => {
          const sec = list.querySelector(`[data-group="${b.dataset.tab}"]`);
          if (!sec) return;
          list.scrollTo({ top: Math.max(0, sec.offsetTop - list.offsetTop - 2), behavior: 'smooth' });
          tabs.querySelectorAll('[data-tab]').forEach(x => {
            x.dataset.active = String(x === b);
            x.setAttribute('aria-pressed', String(x === b));
          });
        });
      });
    }

    list.querySelectorAll('[data-id]').forEach(node => bindRow(node));
    presets.querySelectorAll('[data-preset]').forEach(b => {
      b.addEventListener('click', () => {
        const p = PRESETS.find(x => x.id === b.dataset.preset);
        if (p) store.setPreset(p.ids);
      });
    });
    sync();
  }

  function row(l, L) {
    const pv = PROVENANCE[l.provenance] || PROVENANCE.der;
    const title = l.title[L], sum = l.summary[L];
    const openNow = open.has(l.id);
    return `<article class="lyr-row" data-id="${l.id}" data-on="no" data-locked="${l.locked ? 'yes' : 'no'}">
      <div class="lyr-row__top">
        ${l.locked
          ? `<span class="lyr-row__lock" title="${L === 'zh' ? '常开' : 'Always on'}"><i></i></span>`
          : `<button type="button" class="lyr-sw" role="switch" aria-checked="false" aria-label="${esc(title)}">
               <span class="lyr-sw__track"><span class="lyr-sw__dot"></span></span>
             </button>`}
        <div class="lyr-row__text">
          <div class="lyr-row__line">
            <b>${esc(title)}</b>
            <em class="lyr-row__code">${shortId(l.id)}</em>
            <span class="lyr-badge" data-tone="${pv.tone}">${L === 'zh' ? pv.zh : pv.en}</span>
            ${l.live ? `<span class="lyr-live" aria-hidden="true"></span>` : ''}
            <button type="button" class="lyr-row__more" aria-expanded="${openNow}" aria-label="${L === 'zh' ? '详情' : 'Details'}">
              <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="13" cy="8" r="1.1"/></svg>
            </button>
          </div>
          <p class="lyr-row__sum">${esc(sum)}</p>
        </div>
      </div>
      <div class="lyr-row__detail" ${openNow ? '' : 'hidden'}>
        <p>${esc(sum)}</p>
        <ul class="lyr-row__params">${(l.params?.[L] || []).map(v => `<li>${esc(v)}</li>`).join('')}</ul>
        <div class="lyr-row__meta">
          ${(l.sources || []).map(s => s.url
            ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a><em>${esc(s.license || '')}</em>`
            : `<span>${esc(s.name)}</span><em>${esc(s.license || '')}</em>`).join('')}
        </div>
        <div class="lyr-row__acts">
          <button type="button" data-act="solo">${L === 'zh' ? '仅此层' : 'Solo'}</button>
          <button type="button" data-act="copy">${L === 'zh' ? '复制编号' : 'Copy ID'}</button>
          <span class="lyr-row__budget">${l.cost?.vramMB || 0} MB · ${l.cost?.ms || 0} ms</span>
        </div>
      </div>
    </article>`;
  }

  function bindRow(node) {
    const id = node.dataset.id;
    const spec = LAYERS.find(l => l.id === id);
    const sw = node.querySelector('.lyr-sw');
    sw?.addEventListener('click', e => {
      e.stopPropagation();
      store.toggle(id);
    });
    node.querySelector('.lyr-row__more')?.addEventListener('click', e => {
      e.stopPropagation();
      const d = node.querySelector('.lyr-row__detail');
      const btn = e.currentTarget;
      const next = d.hidden;
      d.hidden = !next;
      btn.setAttribute('aria-expanded', String(next));
      if (next) open.add(id); else open.delete(id);
    });
    node.querySelector('[data-act="solo"]')?.addEventListener('click', e => {
      e.stopPropagation();
      store.setPreset([id, ...(spec.requires || [])]);
      flash(lang() === 'zh' ? `只保留「${spec.title.zh}」` : `Solo: ${spec.title.en}`);
    });
    node.querySelector('[data-act="copy"]')?.addEventListener('click', e => {
      e.stopPropagation();
      const text = id;
      navigator.clipboard?.writeText(text).then(
        () => flash(lang() === 'zh' ? `已复制 ${text}` : `Copied ${text}`),
        () => flash(text)
      );
    });
  }

  function sync() {
    const L = lang();
    const ids = store.ids();
    list.querySelectorAll('.lyr-row').forEach(node => {
      const id = node.dataset.id;
      const on = store.has(id);
      node.dataset.on = on ? 'yes' : 'no';
      const sw = node.querySelector('.lyr-sw');
      if (sw) {
        sw.setAttribute('aria-checked', String(on));
        sw.setAttribute('aria-label', `${LAYERS.find(l => l.id === id).title[L]} · ${on ? (L === 'zh' ? '开' : 'on') : (L === 'zh' ? '关' : 'off')}`);
      }
    });
    const active = PRESETS.find(p => p.ids.length === ids.length && p.ids.every(x => ids.includes(x)));
    presets.querySelectorAll('[data-preset]').forEach(b => {
      const on = !!active && active.id === b.dataset.preset;
      b.dataset.active = String(on);
      b.setAttribute('aria-pressed', String(on));
    });
    if (countEl) countEl.textContent = `${String(ids.length).padStart(2, '0')}/${String(LAYERS.length).padStart(2, '0')}`;
    const t = totals();
    const foot = panel.querySelector('.lyr-foot__stat');
    if (foot) foot.textContent = `≈ ${t.mb} MB · ${t.ms} ms`;
    panel.dataset.count = String(ids.length);
  }

  function flash(msg) {
    if (!noticeEl) return;
    noticeEl.textContent = msg;
    noticeEl.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { noticeEl.hidden = true; }, 3200);
  }

  /* 展开状态不因语言切换丢失 */
  function rebuild() { build(); }

  panel.querySelector('.lyr__close')?.addEventListener('click', () => onClose?.());

  return { build, sync, rebuild, flash, toggle: (force) => {
    const next = force == null ? panel.dataset.open !== 'yes' : force;
    panel.dataset.open = next ? 'yes' : 'no';
    return next;
  } };
}
