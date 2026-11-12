/* ══════════════════════════════════════════════════════════
   exif.js — 从 JPEG 里读拍摄参数。没有就返回 null。
   只解析 APP1 / TIFF IFD0 + ExifIFD 里那十来个常用 tag。
   ══════════════════════════════════════════════════════════ */

const TAG = { MAKE: 0x010f, MODEL: 0x0110, EXIF_IFD: 0x8769, DATE: 0x0132 };
const EXIF_TAG = { F: 0x829d, SS: 0x829a, ISO: 0x8827, FL: 0x920a, DATE: 0x9003, LENS: 0xa434 };

function readIfd(dv, little, ifdOffset, tiffBase) {
  const out = {};
  const count = dv.getUint16(ifdOffset, little);
  for (let i = 0; i < count; i++) {
    const e = ifdOffset + 2 + i * 12;
    const tag = dv.getUint16(e, little);
    const type = dv.getUint16(e + 2, little);
    const num = dv.getUint32(e + 4, little);
    const valOff = e + 8;

    const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] || 1;
    const bytes = size * num;
    const dataOff = bytes > 4 ? tiffBase + dv.getUint32(valOff, little) : valOff;
    if (dataOff < 0 || dataOff + bytes > dv.byteLength) continue;

    if (type === 2) {
      let s = '';
      for (let k = 0; k < num; k++) {
        const c = dv.getUint8(dataOff + k);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      out[tag] = s.trim();
    } else if (type === 3) {
      out[tag] = dv.getUint16(dataOff, little);
    } else if (type === 4) {
      out[tag] = dv.getUint32(dataOff, little);
    } else if (type === 5) {
      const n = dv.getUint32(dataOff, little);
      const d = dv.getUint32(dataOff + 4, little);
      out[tag] = d ? n / d : 0;
    } else if (type === 10) {
      const n = dv.getInt32(dataOff, little);
      const d = dv.getInt32(dataOff + 4, little);
      out[tag] = d ? n / d : 0;
    }
  }
  return out;
}

function parseTiff(dv, base) {
  const little = dv.getUint16(base) === 0x4949;
  if (!little) { /* big-endian 同样支持，下面统一用 getUint16 的 little 参数 */ }
  const ifd0Off = base + dv.getUint32(base + 4, little);
  if (ifd0Off <= base || ifd0Off >= dv.byteLength) return null;

  const t0 = readIfd(dv, little, ifd0Off, base);
  let t1 = {};
  if (t0[TAG.EXIF_IFD]) {
    const off = base + t0[TAG.EXIF_IFD];
    if (off > base && off < dv.byteLength) t1 = readIfd(dv, little, off, base);
  }

  const raw = {
    make: (t0[TAG.MAKE] || '').replace(/\0/g, '').trim(),
    model: (t0[TAG.MODEL] || '').replace(/\0/g, '').trim(),
    lens: (t1[EXIF_TAG.LENS] || '').trim(),
    f: t1[EXIF_TAG.F] || 0,
    ss: t1[EXIF_TAG.SS] || 0,
    iso: t1[EXIF_TAG.ISO] || 0,
    fl: t1[EXIF_TAG.FL] || 0,
    date: (t1[EXIF_TAG.DATE] || t0[TAG.DATE] || '').trim()
  };

  /* 只有拍摄时间也算有用的 EXIF：它决定照片在相册里的排序，
     没有理由因为缺相机型号就把整条丢掉。 */
  if (!raw.model && !raw.make && !raw.f && !raw.fl && !raw.date) return null;

  /* make 常常已经包含在 model 里（"NIKON CORPORATION" + "NIKON Z 6"）。
     保留厂商原本的大小写，别把 EOS 改成 Eos。 */
  let camera = raw.model || raw.make;
  if (raw.make && raw.model && !raw.model.toUpperCase().includes(raw.make.split(' ')[0].toUpperCase())) {
    camera = `${raw.make} ${raw.model}`;
  }

  const out = {
    camera: camera || '',
    f: raw.f ? `f/${(+raw.f).toFixed(raw.f % 1 ? 1 : 0)}` : '',
    ss: fmtShutter(raw.ss),
    iso: raw.iso ? `ISO ${raw.iso}` : '',
    fl: raw.fl ? `${Math.round(raw.fl)}mm` : '',
    date: fmtDate(raw.date),
    /* 排序用的时间戳。EXIF 的 DateTimeOriginal 是「拍摄地当地时间」
       且不带时区，这里按本机时区解释——只用于排序，不用于展示绝对值。 */
    ts: parseTime(raw.date)
  };

  Object.keys(out).forEach(k => { if (!out[k]) delete out[k]; });
  return Object.keys(out).length ? out : null;
}

function fmtShutter(v) {
  if (!v) return '';
  if (v >= 1) return `${Number(v.toFixed(1))}s`;
  const d = Math.round(1 / v);
  return `1/${d}s`;
}

function parseTime(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s || '');
  if (!m) return 0;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  return Number.isFinite(t) ? t : 0;
}

function fmtDate(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(s || '');
  if (!m) return '';
  return `${m[1]}.${m[2]}`;
}


export async function readExif(blob) {
  try {
    const head = await blob.slice(0, 192 * 1024).arrayBuffer();
    const dv = new DataView(head);
    if (dv.byteLength < 16) return null;
    if (dv.getUint16(0) !== 0xffd8) return null;

    let off = 2;
    while (off + 4 < dv.byteLength) {
      if (dv.getUint8(off) !== 0xff) break;
      const marker = dv.getUint16(off);
      const len = dv.getUint16(off + 2);
      if (marker === 0xffe1) {
        const s = off + 4;
        if (dv.getUint32(s) === 0x45786966) return parseTiff(dv, s + 6);
      }
      if (marker === 0xffda) break;
      off += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}
