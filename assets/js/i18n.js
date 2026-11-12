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
  'acct.aria': ['账号', 'Account'],
  'acct.title': ['账号', 'Account'],
  'acct.me': ['我的账号', 'My account'],
  'acct.login': ['登录', 'Sign in'],
  'acct.register': ['注册', 'Sign up'],
  'acct.create': ['创建账号', 'Create account'],
  'acct.name': ['账号', 'Account name'],
  'acct.pass': ['密码', 'Password'],
  'acct.pass2': ['确认密码', 'Confirm password'],
  'acct.migrate': ['把本机现有作品导入此账号', 'Import this browser’s works into this account'],
  'acct.note': ['账号与作品只保存在本机浏览器，密码经 PBKDF2 派生后存储，明文不落盘。',
                'Accounts and works stay in this browser only. Passwords are stored as PBKDF2 digests — never in plain text.'],
  'acct.places': ['地标', 'Places'],
  'acct.photos': ['照片', 'Photos'],
  'acct.switch': ['切换账号', 'Switch account'],
  'acct.logout': ['退出登录', 'Sign out'],
  'acct.signedIn': ['已登录', 'Signed in'],
  'acct.hello': ['已创建《{name}》', 'Welcome, {name}'],
  'acct.back': ['欢迎回来，{name}', 'Welcome back, {name}'],
  'acct.bye': ['已退出登录', 'Signed out'],
  'acct.moved': ['本机作品已导入', 'local works imported'],
  'acct.e.nameEmpty': ['请填写账号', 'Enter an account name'],
  'acct.e.nameInvalid': ['账号需 3–24 位，可用字母、数字、中文、下划线与点', '3–24 characters: letters, digits, CJK, underscore or dot'],
  'acct.e.nameTaken': ['这个账号已被占用', 'That account name is taken'],
  'acct.e.pwEmpty': ['请填写密码', 'Enter a password'],
  'acct.e.pwShort': ['密码至少 8 位', 'Password must be at least 8 characters'],
  'acct.e.pwMismatch': ['两次输入的密码不一致', 'Passwords do not match'],
  'acct.e.bad': ['账号或密码不正确', 'Wrong account or password'],
  'acct.e.storage': ['本机存储已满，无法创建账号', 'Local storage is full — cannot create the account'],
  'acct.e.generic': ['操作失败，请重试', 'Something went wrong — try again'],
  'acct.e.nameReserved': ['这个账号名不可用', 'That name is reserved'],
  'acct.e.pwLong': ['密码不能超过 72 位', 'Password must be at most 72 characters'],
  'acct.e.pwWeak': ['密码太简单，换一个', 'That password is too simple'],
  'acct.e.pwCommon': ['这是常见密码，换一个', 'That is a commonly used password'],
  'acct.e.pwSame': ['新密码不能与当前密码相同', 'The new password must differ from the current one'],
  'acct.e.badRecovery': ['账号或恢复码不正确', 'Wrong account or recovery code'],
  'acct.e.noRecovery': ['这个账号还没有恢复码，无法重置', 'This account has no recovery code'],
  'acct.e.crypto': ['当前环境不支持加密（需要 https）', 'Encryption is unavailable here (https required)'],
  'acct.e.rate': ['尝试次数过多，请 {s} 秒后再试', 'Too many attempts — try again in {s}s'],
  'acct.e.deleteName': ['账号名不一致，未删除', 'The account name does not match'],

  'acct.change': ['修改密码', 'Change password'],
  'acct.changeSub': ['修改后立即生效；其他设备上的登录状态不受影响。',
                     'Takes effect immediately; sessions on other devices are unaffected.'],
  'acct.oldPass': ['当前密码', 'Current password'],
  'acct.newPass': ['新密码', 'New password'],
  'acct.recovery': ['恢复码', 'Recovery code'],
  'acct.recoveryCode': ['恢复码', 'Recovery code'],
  'acct.recoveryRegen': ['这个账号已设置恢复码。生成新码会立即作废旧码。',
                         'A recovery code is already set. Generating a new one invalidates the old one immediately.'],
  'acct.recoverySub': ['恢复码是第二把钥匙：忘记密码时用它重设。生成新码会作废旧码。',
                       'A recovery code is a second key for resetting your password. Generating a new one invalidates the old one.'],
  'acct.recoveryNew': ['生成恢复码', 'Generate recovery code'],
  'acct.recoveryHint': ['只显示这一次。请抄下来或存进密码管理器；丢失后无法找回账号。',
                        'Shown only once. Write it down or store it in a password manager — losing it means losing access.'],
  'acct.copy': ['复制', 'Copy'],
  'acct.copied': ['已复制', 'Copied'],
  'acct.savedIt': ['我已保存', 'I saved it'],
  'acct.forgot': ['忘记密码？用恢复码重设', 'Forgot password? Use a recovery code'],
  'acct.backLogin': ['返回登录', 'Back to sign in'],
  'acct.reset': ['重设密码', 'Reset password'],
  'acct.delete': ['删除账号', 'Delete account'],
  'acct.deleteSub': ['删除本机账号会同时删除这台设备上的地标与照片，不可恢复。云端副本不受影响。',
                     'Deleting this local account removes its places and photos on this device. This cannot be undone; the cloud copy is untouched.'],
  'acct.deleteName': ['输入账号名确认', 'Type the account name to confirm'],
  'acct.deleteDone': ['账号已删除', 'Account deleted'],
  'acct.passChanged': ['密码已修改', 'Password changed'],
  'acct.strength0': ['强度：弱', 'Strength: weak'],
  'acct.strength1': ['强度：一般', 'Strength: fair'],
  'acct.strength2': ['强度：好', 'Strength: good'],
  'acct.strength3': ['强度：强', 'Strength: strong'],
  'music.toggle': ['背景音乐', 'Background music'],
  'music.tap': ['点击播放背景音乐', 'Click to play the soundtrack'],
  'music.on': ['音乐已开启', 'Music on'],
  'music.off': ['音乐已关闭', 'Music off'],
  'nav.lang': ['切换语言', 'Switch language'],
  'nav.brandHome': ['ATLAS 图册 · 回到顶部', 'ATLAS · Back to top'],
  'brand.cn': ['图册', 'ATLAS'],

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
  'hero.title1': ['经纬所及', 'Meridians'],
  'hero.title2': ['皆成图册', 'of Memory'],
  'hero.new': ['新建地标', 'New landmark'],
  'hero.globe': ['转动地球', 'Turn the globe'],
  'hero.statLandmarks': ['地标', 'Places'],
  'hero.statPhotos': ['照片', 'Photos'],
  'hero.statLatest': ['最近入库', 'Latest'],
  'hero.latest': ['最近落点', 'Latest'],
  'hero.rail': ['向下', 'SCROLL'],
  'site.title': ['经纬所及', 'Meridians of Memory'],
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
  'reco.fill': ['补全', 'Fill in'],
  'reco.fillText': ['给《{name}》再补几张，凑成一组。', 'Add a few more to “{name}” to make a set.'],
  'reco.revisit': ['回访', 'Revisit'],
  'reco.revisitText': ['《{name}》已经 {n} 天没有新照片。', '“{name}” has had no new photos for {n} days.'],
  'reco.peer': ['关联', 'Pair'],
  'reco.peerText': ['《{a}》与《{b}》纬度相近，适合并在一起看。', '“{a}” and “{b}” sit at similar latitudes — worth viewing together.'],
  'reco.backup': ['备份', 'Backup'],
  'reco.backupText': ['还没有导出备份。备份入口在页脚的「私钥」里。', 'No backup yet — the entry sits under “Key” in the footer.'],
  'reco.start': ['开始', 'Start'],
  'reco.startText': ['一切就绪。新建一处地标，第一本相册就开始了。', 'All set. Create a place and the first album begins.'],
  'ov.noTag': ['还没有地标，标签会在建第一本之后出现。', 'No places yet. Tags appear after your first album.'],

  /* 地球板块 */
  'planet.eyebrow': ['地球', 'ORBIT'],
  'planet.title1': ['把地球', 'Turn the'],
  'planet.title2': ['转过来', 'globe'],
  'planet.lede': ['每一处地标，都是球面上的一点。转动它，看点落在光的哪一侧——那是你去过的纬度。',
    'Every place is a point on the sphere. Turn it, and watch where it falls against the light — that is the latitude you have been to.'],
  'planet.count': ['{n} 处地标', '{n} places'],
  'planet.new': ['+ 落一处新的', '+ Drop a new one'],
  'planet.hint': ['拖动旋转 · 滚轮缩放 · 点击球面落一处地标', 'Drag to rotate · Scroll to zoom · Click the surface to drop a pin'],
  'planet.auto': ['自转', 'Spin'],
  'planet.reset': ['正对', 'Reset'],
  'planet.live': ['实时', 'Live'],
  'planet.quality': ['画质', 'Quality'],
  'planet.loadingRes': ['正在载入 {r} 贴图…', 'Loading {r} textures…'],
  'planet.resDone': ['画质已切换到 {r}', 'Quality set to {r}'],
  'planet.resFail': ['{r} 贴图载入失败，已保留原画质', 'Could not load {r} textures — kept the previous quality'],
  'planet.liveTitle': ['按真实时间同步光照与地球转向', 'Sync daylight and rotation to real time'],
  'planet.zoomIn': ['放大', 'Zoom in'],
  'planet.zoomOut': ['缩小', 'Zoom out'],
  'planet.loading': ['正在绘制地球', 'Rendering the globe'],
  'planet.noWebgl': ['这台设备暂不支持 WebGL', 'WebGL is unavailable on this device'],
  'planet.toastNoWebgl': ['这台设备不支持 WebGL，地球未能载入', 'WebGL is unavailable — the globe could not load'],
  'planet.empty': ['还没有地标', 'No places yet'],
  'planet.albumCount': ['{n} 张', '{n} photos'],
  'planet.markerAria': ['{name} · {n} 张照片', '{name} · {n} photos'],

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
  'wall.coverAlt': ['{name} 封面', '{name} — cover'],
  'wall.open': ['打开相册', 'Open album'],
  'wall.openAlt': ['打开《{name}》', 'Open “{name}”'],

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

  /* 手记 */
  /* 云同步 */
  'cloud.title': ['云同步', 'Cloud sync'],
  'cloud.sub': ['用 WorkBuddy 账号登录，作品和照片在任意设备上都能打开。',
                'Sign in with WorkBuddy to open your albums and photos on any device.'],
  'cloud.signIn': ['使用 WorkBuddy 登录', 'Sign in with WorkBuddy'],
  'cloud.syncNow': ['立即同步', 'Sync now'],
  'cloud.retry': ['重试同步', 'Retry sync'],
  'cloud.signOut': ['退出云同步', 'Disconnect'],
  'cloud.connected': ['已连接 · {name}', 'Connected · {name}'],
  'cloud.syncing': ['正在同步…', 'Syncing…'],
  'cloud.uploading': ['正在上传照片 {i}/{n}', 'Uploading photo {i}/{n}'],
  'cloud.synced': ['已同步 {a} 本 · {p} 张', '{a} albums · {p} photos synced'],
  'cloud.failed': ['同步失败：{msg}', 'Sync failed: {msg}'],
  'cloud.offline': ['当前地址未绑定云服务，作品只保存在本机', 'Cloud is not available on this address — works stay on this device'],
  'cloud.done': ['已与云端同步', 'Synced with cloud'],
  'cloud.signedOut': ['已断开云同步', 'Cloud disconnected'],
  'cloud.paused': ['云端已连接，但这份数据属于另一个本机账号。',
                   'Cloud is connected, but the synced data belongs to another local account.'],
  'cloud.enableHere': ['在此账号下启用云同步', 'Enable sync for this account'],

  'memoir.kicker': ['手记', 'RECOLLECTION'],
  'memoir.blank': ['写下这次的感觉', 'Write how it felt'],
  'memoir.phTitle': ['一句话', 'One line'],
  'memoir.phBody': ['从哪一刻开始觉得来对了？', 'Which moment made it worth the trip?'],
  'memoir.moodLabel': ['余味', 'Aftertaste'],
  'memoir.m0': ['平常', 'Fair'],
  'memoir.m1': ['喜欢', 'Fond'],
  'memoir.m2': ['难忘', 'Unforgettable'],
  'memoir.m3': ['想再去', 'Go again'],
  'memoir.save': ['保存', 'Save'],
  'memoir.cancel': ['取消', 'Cancel'],
  'memoir.count': ['{n}/800', '{n}/800'],
  'memoir.tip': ['Ctrl / ⌘ + Enter 保存 · Esc 取消', 'Ctrl / ⌘ + Enter to save · Esc to cancel'],
  'memoir.needText': ['先写点什么，再保存。', 'Write something before saving.'],
  'memoir.saved': ['已保存 · {t}', 'Saved · {t}'],
  'memoir.at': ['写于 {t}', 'Written {t}'],
  'memoir.toastSaved': ['手记已保存', 'Note saved'],

  /* 大图 */
  'lb.cover': ['设为封面', 'Set as cover'],
  'lb.isCover': ['已是封面', 'Cover'],
  'lb.view': ['查看 {name}', 'View {name}'],
  'lb.del': ['删除 {name}', 'Delete {name}'],
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
  'vault.health': ['数据', 'Data'],
  'vault.ok': ['正常', 'OK'],
  'vault.warn': ['{n} 项提示', '{n} notices'],
  'vault.bad': ['{n} 项异常', '{n} issues'],
  'vault.stats': ['{a} 处地标 · {b} 张照片', '{a} places · {b} photos'],
  'vault.pass': ['备份口令', 'Backup passphrase'],
  'vault.passPh': ['至少 6 位', 'At least 6 characters'],
  'vault.export': ['导出加密备份', 'Export backup'],
  'vault.import': ['导入备份', 'Import backup'],
  'vault.repair': ['整理数据', 'Clean up'],
  'vault.repairDone': ['已整理：移除 {n} 条无效记录', 'Cleaned up: {n} invalid records removed'],
  'vault.repairNone': ['数据已是最新，无需整理', 'Nothing to clean up'],
  'vault.exporting': ['正在打包…', 'Packing…'],
  'vault.exported': ['已导出', 'Exported'],
  'vault.note2': ['备份包含全部地标、照片与站点设置，以 AES-GCM 加密。口令遗失将无法解密。', 'The backup contains every place, photo and setting, encrypted with AES-GCM. A lost passphrase cannot be recovered.'],
  'vault.lock': ['锁定并退出', 'Lock and exit'],
  'vault.lockedToast': ['保险库已锁定', 'Vault locked'],
  'vault.exportedToast': ['备份已生成 · 请妥善保管文件与口令', 'Backup created — keep the file and passphrase safe'],
  'vault.imported': ['已恢复 {n} 处地标', 'Restored {n} places'],
  'vault.open': ['私钥', 'Key'],

  /* 页脚 */
  'foot.credit': ['星空为程序化渲染 · 地球影像 NASA Blue Marble',
                  'Star field rendered procedurally · Earth imagery: NASA Blue Marble'],
  'foot.rights': ['© 2026 ATLAS · 保留所有权利，未经许可不得演绎', '© 2026 ATLAS · All rights reserved. No derivatives without permission.'],
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

  /* 入口门禁 */
  'gate.title': ['私钥', 'Private key'],
  'gate.sub': ['输入私钥，进入图册。', 'Enter the key to open the atlas.'],
  'gate.enter': ['进入', 'Enter'],
  'gate.err': ['私钥不正确', 'Incorrect key'],
  'gate.note': ['私钥仅在本机校验，不会上传。', 'The key is checked locally and never uploaded.'],

  /* 通用 */
  'common.close': ['关闭', 'Close'],
  'common.prev': ['上一张', 'Previous'],
  'common.next': ['下一张', 'Next'],
  'common.delete': ['删除', 'Delete'],
  'common.view': ['查看', 'View'],
  'common.photo': ['照片', 'Photo'],
  'common.untitled': ['未命名', 'Untitled'],
  'common.swatch': ['颜色 {c}', 'Colour {c}'],
  'common.stats': ['{a} 处地标 · {b} 张照片', '{a} places · {b} photos'],
  'toast.saved': ['已保存', 'Saved'],
  'toast.removed': ['已移除', 'Removed'],
  'toast.pending': ['地标签好之后，这些照片会入这本书', 'These photos will be added once the place is created'],
  'toast.uploading': ['正在入库 {i} / {n}', 'Saving {i} / {n}'],
  'toast.added': ['{name} · 已加入 {n} 张', '{name} · {n} photos added'],
  'toast.addedSkip': ['{name} · 已加入 {n} 张 · {s} 张跳过', '{name} · {n} added · {s} skipped'],
  'toast.noImage': ['没有可用的图片', 'No usable images'],
  'toast.noSpace': ['本机存储满了，先导出备份再删几张', 'Local storage is full — export a backup, then remove a few photos'],
  'toast.corrupt': ['本地数据读取失败，已保留能恢复的部分', 'Local data could not be read — recovered what was intact'],
  'toast.dataFixed': ['数据体检：修正 {n} 项', 'Data check: {n} items repaired'],
  'toast.exportFirst': ['先放几张照片，再导出', 'Add a few photos before exporting'],
  'toast.exported': ['已导出 · 单个 HTML，双击可看', 'Exported · a single HTML file, just open it'],
  'toast.coverSet': ['已设为这本的封面', 'Set as this album\'s cover'],
  'toast.located': ['已定位 · {name}', 'Located · {name}'],
  'toast.exportFail': ['导出失败', 'Export failed'],
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

/* 英文单复数：1 photo / 2 photos */
const SINGULAR = { 'wall.photoCount': '1 photo', 'ov.count': '1 photo', 'planet.albumCount': '1 photo' };

export function t(key, vars) {
  if (lang === 'en' && vars && vars.n === 1 && SINGULAR[key]) return SINGULAR[key];
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
