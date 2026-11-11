/* ══════════════════════════════════════════════════════════════════
   i18n.js — 结构化文案字典（中/英）
   组织方式：一个 key 对应一个 [中文, English] 数组，
   两种语言写在一起，改文案时不会只改一边而漏另一边。
   静态节点用 data-i18n / data-i18n-ph / data-i18n-aria 标注；
   动态文案（列表、提示）调用 t('key', {n: 3})。
   ══════════════════════════════════════════════════════════════════ */

export const LANG_KEY = 'atlas.lang';
export const LANGS = ['zh', 'en'];

export const DICT = {
  /* 导航 */
  'nav.overview': ['概览', 'Overview'],
  'nav.wall': ['相册', 'Albums'],
  'nav.planet': ['地球', 'Globe'],
  'nav.search': ['搜索', 'Search'],
  'nav.theme': ['主题', 'Theme'],
  'nav.more': ['更多操作', 'More'],
  'nav.lang': ['切换语言', 'Switch language'],
  'nav.brandHome': ['ATLAS 图册 · 回到顶部', 'ATLAS · Back to top'],

  /* 主题菜单 */
  'theme.title': ['主题', 'Theme'],
  'theme.noir': ['墨夜', 'Noir'],
  'theme.ivory': ['宣纸', 'Ivory'],
  'theme.slate': ['远山', 'Slate'],

  /* 菜单 */
  'menu.new': ['新建地标', 'New landmark'],
  'menu.settings': ['站点设置', 'Site settings'],
  'menu.export': ['导出作品集', 'Export portfolio'],

  /* 开篇 */
  'hero.kicker': ['私人地理志', 'PRIVATE ATLAS'],
  'hero.title1': ['去过的', 'Places'],
  'hero.title2': ['地方', "I've Been"],
  'hero.new': ['新建地标', 'New landmark'],
  'hero.globe': ['转动地球', 'Turn the globe'],
  'hero.statLandmarks': ['地标', 'Places'],
  'hero.statPhotos': ['照片', 'Photos'],
  'hero.statLatest': ['最近入库', 'Latest'],
  'hero.rail': ['向下', 'SCROLL'],
  'site.title': ['去过的地方', "I've Been"],
  'site.lede': ['一处地标，一本相册。先在地球上落一个点，再把那里的照片放进去——同一座城的片子待在一起，翻起来才像一次回来。',
    'One place, one album. Drop a pin on the globe first, then put that place\'s photos inside — keeping a city\'s frames together is what makes looking back feel like returning.'],

  /* 概览 */
  'ov.eyebrow': ['概览', 'OVERVIEW'],
  'ov.title': ['概览', 'Overview'],
  'ov.desc': ['最近翻动的几本，和这台机器记住的偏好。', 'Recently opened albums, and the preferences this machine remembers.'],
  'ov.new': ['新建地标', 'New landmark'],
  'ov.prev': ['上一本', 'Previous'],
  'ov.next': ['下一本', 'Next'],
  'ov.emptyTitle': ['还没有相册', 'No albums yet'],
  'ov.emptySub': ['先建一处地标', 'Create your first place'],
  'ov.tags': ['自动标签', 'Auto tags'],
  'ov.tagsNote': ['标签由坐标、时间与影像元数据推导，规则可解释、结果可复现。', 'Tags are derived from coordinates, dates and photo metadata — explainable and reproducible.'],
  'ov.reco': ['接下来', 'Next'],
  'ov.count': ['{n} 张', '{n} photos'],
  'ov.locked': ['已上锁', 'Locked'],
  'ov.lockedSub': ['已上锁 · 需单独私钥', 'Locked · album key required'],
  'ov.noTag': ['还没有地标，标签会在建第一本之后出现。', 'No places yet. Tags appear after your first album.'],

  /* 地球板块 */
  'planet.eyebrow': ['地球', 'ORBIT'],
  'planet.title1': ['把地球', 'Turn the'],
  'planet.title2': ['转过来', 'globe'],
  'planet.lede': ['每一处地标，都是球面上的一点。转动它，看点落在光的哪一侧——那是你去过的纬度。',
    'Every place is a point on the sphere. Turn it, and watch where it falls against the light — that is the latitude you have been to.'],
  'planet.count': ['{n} 处地标', '{n} places'],
  'planet.new': ['+ 落一处新的', '+ Drop a new one'],
  'planet.hint': ['拖动旋转 · 滚轮缩放 · 点击空白处落一个地标', 'Drag to rotate · Scroll to zoom · Click the surface to drop a pin'],
  'planet.auto': ['自转', 'Spin'],
  'planet.reset': ['正对', 'Reset'],
  'planet.loading': ['正在绘制地球', 'Rendering the globe'],
  'planet.noWebgl': ['这台设备暂不支持 WebGL', 'WebGL is unavailable on this device'],
  'planet.toastNoWebgl': ['这台设备不支持 WebGL，地球未能载入', 'WebGL is unavailable — the globe could not load'],
  'planet.empty': ['还没有地标', 'No places yet'],
  'planet.albumCount': ['{n} 张', '{n} photos'],

  /* 相册 */
  'wall.eyebrow': ['相册', 'COLLECTION'],
  'wall.title': ['相册', 'Albums'],
  'wall.desc': ['一处地标，一本。照片不裁切，只编排。', 'One album per place. Photos are never cropped, only arranged.'],
  'wall.new': ['新建地标', 'New landmark'],
  'wall.emptyTitle': ['还没有地标', 'No places yet'],
  'wall.emptySub': ['给一处地方起个名字，它就成了第一本相册。', 'Give a place a name and it becomes your first album.'],
  'wall.emptyCta': ['建第一本相册', 'Create the first album'],
  'wall.hint1': ['把照片拖到任意相册上即可入库', 'Drop photos onto any album to add them'],
  'wall.hint2': ['全部保存在本机浏览器', 'Everything stays in this browser'],
  'wall.photoCount': ['{n} 张', '{n} photos'],
  'wall.empty0': ['空', 'Empty'],
  'wall.unlocated': ['尚未落点', 'No coordinates yet'],

  /* 索引 */
  'idx.eyebrow': ['索引', 'INDEX'],
  'idx.title': ['索引', 'Index'],
  'idx.desc': ['按建制先后。悬停一行，可预览封面。', 'In creation order. Hover a row to preview its cover.'],
  'idx.colNo': ['№', '№'],
  'idx.colName': ['地标', 'Place'],
  'idx.colCoord': ['坐标', 'Coordinates'],
  'idx.colDate': ['时间', 'Date'],
  'idx.colCount': ['张数', 'Photos'],
  'idx.empty': ['还没有地标。先建一处，再往里放照片。', 'No places yet. Create one, then add photos.'],

  /* 册集 */
  'album.back': ['相册', 'Albums'],
  'album.edit': ['编辑', 'Edit'],
  'album.delete': ['删除', 'Delete'],
  'album.confirm': ['确定删除？', 'Delete?'],
  'album.lockedTitle': ['这本相册已上锁', 'This album is locked'],
  'album.lockedHint': ['输入这本册集的私钥，与其它册集互不影响。', 'Enter this album\'s key. Other albums are unaffected.'],
  'album.unlock': ['解锁', 'Unlock'],
  'album.wrongKey': ['私钥不正确', 'Incorrect key'],
  'album.unlocked': ['《{name}》已解锁 · 仅本次会话', '“{name}” unlocked · this session only'],
  'album.emptyTitle': ['这本还空着', 'This album is empty'],
  'album.emptySub': ['把照片拖进来，或者从下面选。', 'Drop photos here, or choose them below.'],
  'album.add': ['添加照片', 'Add photos'],
  'album.addHint': ['可多选 · 也可从桌面直接拖入 · 原图入库，不做滤镜', 'Select several · or drag from your desktop · originals kept, no filters'],
  'album.locate': ['在地球上查看', 'Show on globe'],

  /* 大图 */
  'lb.cover': ['设为封面', 'Set as cover'],
  'lb.isCover': ['已是封面', 'Cover'],
  'lb.hint': ['滚轮缩放 · 双击复位 · ← → 翻页', 'Scroll to zoom · Double-click to reset · ← → to browse'],

  /* 命令面板 */
  'pal.placeholder': ['搜索地标、照片，或输入命令', 'Search places, photos, or type a command'],
  'pal.places': ['地标', 'Places'],
  'pal.photos': ['照片', 'Photos'],
  'pal.commands': ['命令', 'Commands'],
  'pal.none': ['没有匹配的地标或照片。', 'No matching places or photos.'],
  'pal.count': ['{n} 项', '{n} results'],
  'pal.updown': ['选择', 'select'],
  'pal.enter': ['打开', 'open'],
  'act.new': ['新建地标', 'New landmark'],
  'act.planet': ['去地球看看', 'Go to the globe'],
  'act.index': ['去索引', 'Go to index'],
  'act.theme': ['切换主题', 'Switch theme'],
  'act.settings': ['站点设置', 'Site settings'],
  'act.export': ['导出作品集', 'Export portfolio'],

  /* 表单 */
  'dlg.newKicker': ['新建地标', 'NEW LANDMARK'],
  'dlg.editKicker': ['编辑地标', 'EDIT LANDMARK'],
  'dlg.newTitle': ['新建地标', 'New landmark'],
  'dlg.editTitle': ['编辑地标', 'Edit landmark'],
  'dlg.sub': ['一处地方，一本相册。', 'One place, one album.'],
  'dlg.name': ['地名', 'Name'],
  'dlg.namePh': ['里斯本', 'Lisbon'],
  'dlg.coord': ['坐标', 'Coordinates'],
  'dlg.coordPh': ['填写地名后自动定位', 'Auto-located from the name'],
  'dlg.auto': ['自动识别', 'AUTO'],
  'dlg.optional': ['选填', 'optional'],
  'dlg.date': ['时间', 'Date'],
  'dlg.datePh': ['2025 年 4 月', 'April 2025'],
  'dlg.note': ['一句话', 'One line'],
  'dlg.notePh': ['七丘之城的赭与青。', 'Ochre and teal in the city of seven hills.'],
  'dlg.color': ['标记色', 'Marker colour'],
  'dlg.key': ['私钥保护', 'Album key'],
  'dlg.keyPh': ['设置后，打开这本相册需单独验证', 'If set, this album asks for its own key'],
  'dlg.keyHint': ['每本册集的私钥彼此独立；不填则公开。', 'Each album key is independent. Leave empty to keep it public.'],
  'dlg.cancel': ['取消', 'Cancel'],
  'dlg.create': ['建这一本', 'Create album'],
  'dlg.save': ['保存', 'Save'],
  'dlg.errName': ['给这处地方一个名字。', 'Give this place a name.'],
  'geo.idle': ['填写地名后自动识别坐标', 'Coordinates are found from the name'],
  'geo.loading': ['正在解析坐标…', 'Resolving coordinates…'],
  'geo.fail': ['未找到坐标 · 可在地球上点选', 'Not found · pick the point on the globe'],
  'geo.retry': ['重新定位', 'Resolve again'],

  /* 设置 */
  'set.kicker': ['站点', 'SITE'],
  'set.title': ['站点设置', 'Site settings'],
  'set.sub': ['只改这台机器上看到的样子。', 'Changes apply only on this device.'],
  'set.name': ['名字', 'Name'],
  'set.cn': ['副标', 'Subtitle'],
  'set.titleField': ['开篇标题', 'Hero title'],
  'set.lede': ['开篇一句话', 'Hero line'],

  /* 保险库 */
  'vault.kicker': ['私人访问', 'PRIVATE ACCESS'],
  'vault.title': ['私钥', 'Key'],
  'vault.sub': ['输入私钥，进入保险库。', 'Enter your key to open the vault.'],
  'vault.submit': ['验证', 'Verify'],
  'vault.err': ['私钥不正确', 'Incorrect key'],
  'vault.note': ['私钥只在本机校验，不会发送到任何服务器。', 'The key is verified locally and never sent anywhere.'],
  'vault.panelKicker': ['保险库', 'VAULT'],
  'vault.panelTitle': ['保险库', 'Vault'],
  'vault.panelSub': ['导出加密备份，换设备或清空缓存后仍能完整恢复。', 'Export an encrypted backup — restore everything after switching devices or clearing the cache.'],
  'vault.lm': ['地标', 'Places'],
  'vault.ph': ['照片', 'Photos'],
  'vault.size': ['占用', 'Storage'],
  'vault.pass': ['备份口令', 'Backup passphrase'],
  'vault.passPh': ['至少 6 位', 'At least 6 characters'],
  'vault.export': ['导出加密备份', 'Export backup'],
  'vault.import': ['导入备份', 'Import backup'],
  'vault.exporting': ['正在打包…', 'Packing…'],
  'vault.exported': ['已导出', 'Exported'],
  'vault.note2': ['备份包含全部地标、照片与站点设置，以 AES-GCM 加密。口令遗失将无法解密。', 'The backup contains every place, photo and setting, encrypted with AES-GCM. A lost passphrase cannot be recovered.'],
  'vault.lock': ['锁定并退出', 'Lock and exit'],
  'vault.lockedToast': ['保险库已锁定', 'Vault locked'],
  'vault.exportedToast': ['备份已生成 · 请妥善保管文件与口令', 'Backup created — keep the file and passphrase safe'],
  'vault.imported': ['已恢复 {n} 处地标', 'Restored {n} places'],
  'vault.open': ['私钥', 'Key'],

  /* 页脚 */
  'foot.tag': ['私人地理志 · 一处地标，一本相册', 'A private atlas · one place, one album'],
  'foot.font': ['字体', 'Typefaces'],
  'foot.fontValue': ['Archivo Variable · 宋体', 'Archivo Variable · Songti'],
  'foot.store': ['收存', 'Archive'],
  'foot.data': ['数据', 'Data'],
  'foot.dataValue': ['浏览器本机 · 永不上传', 'On this device · never uploaded'],
  'foot.tex': ['地球纹理', 'Globe texture'],
  'foot.texValue': ['Solar System Scope · CC BY 4.0', 'Solar System Scope · CC BY 4.0'],
  'foot.keys': ['快捷键', 'Shortcuts'],
  'foot.kSearch': ['搜索与命令', 'Search & commands'],
  'foot.kNew': ['新建地标', 'New landmark'],
  'foot.kTheme': ['切换主题', 'Switch theme'],
  'foot.kExport': ['导出作品集', 'Export portfolio'],

  /* 通用 */
  'common.close': ['关闭', 'Close'],
  'common.prev': ['上一张', 'Previous'],
  'common.next': ['下一张', 'Next'],
  'common.delete': ['删除', 'Delete'],
  'common.view': ['查看', 'View'],
  'toast.saved': ['已保存', 'Saved'],
  'toast.removed': ['已移除', 'Removed'],
  'toast.pending': ['地标签好之后，这些照片会入这本书', 'These photos will be added once the place is created'],
  'toast.uploading': ['正在入库 {i} / {n}', 'Saving {i} / {n}'],
  'toast.added': ['{name} · 已加入 {n} 张', '{name} · {n} photos added'],
  'toast.addedSkip': ['{name} · 已加入 {n} 张 · {s} 张跳过', '{name} · {n} added · {s} skipped'],
  'toast.noImage': ['没有可用的图片', 'No usable images'],
  'toast.exportFirst': ['先放几张照片，再导出', 'Add a few photos before exporting'],
  'toast.exported': ['已导出 · 单个 HTML，双击可看', 'Exported · a single HTML file, just open it'],
  'toast.coverSet': ['已设为这本的封面', 'Set as this album\'s cover'],
  'toast.located': ['已定位 · {name}', 'Located · {name}'],
  'toast.synced': ['已在地球上标注 · {name}', 'Pinned on the globe · {name}']
};

let lang = 'zh';

export function getLang() { return lang; }
export function setLang(next) {
  lang = LANGS.includes(next) ? next : 'zh';
  try { localStorage.setItem(LANG_KEY, lang); } catch {}
  document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en');
  document.documentElement.setAttribute('data-lang', lang);
}
export function initLang() {
  let saved = null;
  try { saved = localStorage.getItem(LANG_KEY); } catch {}
  if (!saved) saved = (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  setLang(saved);
}

export function t(key, vars) {
  const row = DICT[key];
  let s = row ? row[lang === 'zh' ? 0 : 1] : key;
  if (vars) {
    for (const k of Object.keys(vars)) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
  }
  return s;
}

/* 把 data-i18n* 标注的节点刷一遍 */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(n => {
    const key = n.dataset.i18n;
    if (DICT[key]) n.textContent = t(key);
  });
  root.querySelectorAll('[data-i18n-ph]').forEach(n => {
    const key = n.dataset.i18nPh;
    if (DICT[key]) n.setAttribute('placeholder', t(key));
  });
  root.querySelectorAll('[data-i18n-aria]').forEach(n => {
    const key = n.dataset.i18nAria;
    if (DICT[key]) n.setAttribute('aria-label', t(key));
  });
  root.querySelectorAll('[data-i18n-title]').forEach(n => {
    const key = n.dataset.i18nTitle;
    if (DICT[key]) n.setAttribute('title', t(key));
  });
}
