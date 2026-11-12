#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build-gazetteer.py — 世界城市地名库生成器

输入：ref/cities5000.txt（GeoNames cities5000，CC BY 4.0）
输出：assets/data/gazetteer.js

规则：
  · 只收录人口 >= 50000 的城市（约 5 千条，够覆盖"能叫出名字的地方"）；
  · 中文名优先取自 alternatenames 里的 CJK 候选（简体/繁体都收，
    取最短且不含怪字符的一条）；取不到的用策展覆盖表，再取不到为 null
    （界面显示英文名 + 中文国名）；
  · 排序按人口降序：搜索时先命中大城市的体验更好；
  · 体积：紧凑数组字面量，懒加载（import()），不阻塞首屏。

运行：python ref/build-gazetteer.py
"""
import io, json, re, sys

SRC = 'ref/cities5000.txt'
OUT = 'assets/data/gazetteer.js'

CJK = re.compile(r'[\u3400-\u9fff]')
GOOD_ZH = re.compile(r'^[\u3400-\u9fff·、\-—（）()\s]{1,18}$')

# 策展覆盖：中文名缺失或别名质量差的著名城市（ASCII 名小写 → 简体中文名）
OVERRIDES = {
    'paris': '巴黎', 'london': '伦敦', 'new york city': '纽约', 'tokyo': '东京',
    'kyoto': '京都', 'osaka': '大阪', 'seoul': '首尔', 'singapore': '新加坡',
    'bangkok': '曼谷', 'istanbul': '伊斯坦布尔', 'cairo': '开罗',
    'lisbon': '里斯本', 'reykjavik': '雷克雅未克', 'berlin': '柏林',
    'munich': '慕尼黑', 'frankfurt am main': '法兰克福', 'hamburg': '汉堡',
    'rome': '罗马', 'milan': '米兰', 'venice': '威尼斯', 'florence': '佛罗伦萨',
    'madrid': '马德里', 'barcelona': '巴塞罗那', 'amsterdam': '阿姆斯特丹',
    'brussels': '布鲁塞尔', 'vienna': '维也纳', 'prague': '布拉格',
    'budapest': '布达佩斯', 'warsaw': '华沙', 'moscow': '莫斯科',
    'saint petersburg': '圣彼得堡', 'stockholm': '斯德哥尔摩', 'oslo': '奥斯陆',
    'copenhagen': '哥本哈根', 'helsinki': '赫尔辛基', 'reykjavík': '雷克雅未克',
    'dublin': '都柏林', 'edinburgh': '爱丁堡', 'geneva': '日内瓦',
    'zurich': '苏黎世', 'athens': '雅典', 'washington': '华盛顿',
    'washington, d.c.': '华盛顿', 'san francisco': '旧金山',
    'los angeles': '洛杉矶', 'chicago': '芝加哥', 'boston': '波士顿',
    'seattle': '西雅图', 'miami': '迈阿密', 'las vegas': '拉斯维加斯',
    'toronto': '多伦多', 'vancouver': '温哥华', 'montreal': '蒙特利尔',
    'mexico city': '墨西哥城', 'havana': '哈瓦那', 'rio de janeiro': '里约热内卢',
    'sao paulo': '圣保罗', 'buenos aires': '布宜诺斯艾利斯',
    'santiago': '圣地亚哥', 'lima': '利马', 'bogota': '波哥大',
    'dubai': '迪拜', 'tel aviv': '特拉维夫', 'jerusalem': '耶路撒冷',
    'beirut': '贝鲁特', 'casablanca': '卡萨布兰卡', 'nairobi': '内罗毕',
    'cape town': '开普敦', 'johannesburg': '约翰内斯堡', 'lagos': '拉各斯',
    'mumbai': '孟买', 'new delhi': '新德里', 'delhi': '德里',
    'bengaluru': '班加罗尔', 'maldives': '马累', 'colombo': '科伦坡',
    'kathmandu': '加德满都', 'dhaka': '达卡', 'yangon': '仰光',
    'hanoi': '河内', 'ho chi minh city': '胡志明市', 'manila': '马尼拉',
    'jakarta': '雅加达', 'kuala lumpur': '吉隆坡', 'phnom penh': '金边',
    'vientiane': '万象', 'ulaanbaatar': '乌兰巴托', 'tashkent': '塔什干',
    'almaty': '阿拉木图', 'tehran': '德黑兰', 'baghdad': '巴格达',
    'riyadh': '利雅得', 'ankara': '安卡拉', 'kiev': '基辅', 'kyiv': '基辅',
    'buenos aires ciudad autonoma': '布宜诺斯艾利斯',
    'sydney': '悉尼', 'melbourne': '墨尔本', 'brisbane': '布里斯班',
    'perth': '珀斯', 'auckland': '奥克兰', 'wellington': '惠灵顿',
    'auckland city': '奥克兰', 'honolulu': '檀香山', 'anchorage': '安克雷奇',
    'caribbean': '加勒比', 'nice': '尼斯', 'marseille': '马赛',
    'lyon': '里昂', 'bordeaux': '波尔多', 'strasbourg': '斯特拉斯堡',
    'naples': '那不勒斯', 'turin': '都灵', 'seville': '塞维利亚',
    'valencia': '瓦伦西亚', 'porto': '波尔图', 'rotterdam': '鹿特丹',
    'luxembourg': '卢森堡', 'salzburg': '萨尔茨堡', 'innsbruck': '因斯布鲁克',
    'dresden': '德累斯顿', 'cologne': '科隆', 'stuttgart': '斯图加特',
    'nuremberg': '纽伦堡', 'krakow': '克拉科夫', 'gdansk': '格但斯克',
    'wroclaw': '弗罗茨瓦夫', 'belgrade': '贝尔格莱德', 'zagreb': '萨格勒布',
    'ljubljana': '卢布尔雅那', 'sarajevo': '萨拉热窝', 'skopje': '斯科普里',
    'tirana': '地拉那', 'bucharest': '布加勒斯特', 'sofia': '索非亚',
    'athens city': '雅典', 'riga': '里加', 'tallinn': '塔林', 'vilnius': '维尔纽斯',
    'reykjavíkurborg': '雷克雅未克', 'doha': '多哈', 'muscat': '马斯喀特',
    'kuwait city': '科威特城', 'amman': '安曼', 'damascus': '大马士革',
    'sanaa': '萨那', 'addis ababa': '亚的斯亚贝巴', 'khartoum': '喀土穆',
    'tunis': '突尼斯', 'algiers': '阿尔及尔', 'dakar': '达喀尔',
    'accra': '阿克拉', 'abidjan': '阿比让', 'kinshasa': '金沙萨',
    'luanda': '罗安达', 'maputo': '马普托', 'antananarivo': '塔那那利佛',
    'harare': '哈拉雷', 'lusaka': '卢萨卡', 'kampala': '坎帕拉',
    'dar es salaam': '达累斯萨拉姆', 'mombasa': '蒙巴萨',
    'kyoto-shi': '京都', 'london borough': '伦敦', 'paris city': '巴黎',
}

# 中文国名（覆盖常见旅行目的地；缺的回落为国码大写）
CC_ZH = {
    'AD': '安道尔', 'AE': '阿联酋', 'AF': '阿富汗', 'AG': '安提瓜和巴布达',
    'AL': '阿尔巴尼亚', 'AM': '亚美尼亚', 'AO': '安哥拉', 'AR': '阿根廷',
    'AT': '奥地利', 'AU': '澳大利亚', 'AZ': '阿塞拜疆', 'BA': '波黑',
    'BD': '孟加拉国', 'BE': '比利时', 'BF': '布基纳法索', 'BG': '保加利亚',
    'BH': '巴林', 'BI': '布隆迪', 'BJ': '贝宁', 'BN': '文莱', 'BO': '玻利维亚',
    'BR': '巴西', 'BS': '巴哈马', 'BT': '不丹', 'BW': '博茨瓦纳',
    'BY': '白俄罗斯', 'BZ': '伯利兹', 'CA': '加拿大', 'CD': '刚果（金）',
    'CF': '中非', 'CG': '刚果（布）', 'CH': '瑞士', 'CI': '科特迪瓦',
    'CL': '智利', 'CM': '喀麦隆', 'CN': '中国', 'CO': '哥伦比亚',
    'CR': '哥斯达黎加', 'CU': '古巴', 'CV': '佛得角', 'CY': '塞浦路斯',
    'CZ': '捷克', 'DE': '德国', 'DJ': '吉布提', 'DK': '丹麦', 'DO': '多米尼加',
    'DZ': '阿尔及利亚', 'EC': '厄瓜多尔', 'EE': '爱沙尼亚', 'EG': '埃及',
    'ER': '厄立特里亚', 'ES': '西班牙', 'ET': '埃塞俄比亚', 'FI': '芬兰',
    'FJ': '斐济', 'FR': '法国', 'GA': '加蓬', 'GB': '英国', 'GD': '格林纳达',
    'GE': '格鲁吉亚', 'GH': '加纳', 'GM': '冈比亚', 'GN': '几内亚',
    'GQ': '赤道几内亚', 'GR': '希腊', 'GT': '危地马拉', 'GW': '几内亚比绍',
    'GY': '圭亚那', 'HN': '洪都拉斯', 'HR': '克罗地亚', 'HT': '海地',
    'HU': '匈牙利', 'ID': '印度尼西亚', 'IE': '爱尔兰', 'IL': '以色列',
    'IN': '印度', 'IQ': '伊拉克', 'IR': '伊朗', 'IS': '冰岛', 'IT': '意大利',
    'JM': '牙买加', 'JO': '约旦', 'JP': '日本', 'KE': '肯尼亚',
    'KG': '吉尔吉斯斯坦', 'KH': '柬埔寨', 'KR': '韩国', 'KW': '科威特',
    'KZ': '哈萨克斯坦', 'LA': '老挝', 'LB': '黎巴嫩', 'LK': '斯里兰卡',
    'LR': '利比里亚', 'LS': '莱索托', 'LT': '立陶宛', 'LU': '卢森堡',
    'LV': '拉脱维亚', 'LY': '利比亚', 'MA': '摩洛哥', 'MC': '摩纳哥',
    'MD': '摩尔多瓦', 'ME': '黑山', 'MG': '马达加斯加', 'MK': '北马其顿',
    'ML': '马里', 'MM': '缅甸', 'MN': '蒙古', 'MR': '毛里塔尼亚',
    'MT': '马耳他', 'MU': '毛里求斯', 'MV': '马尔代夫', 'MW': '马拉维',
    'MX': '墨西哥', 'MY': '马来西亚', 'MZ': '莫桑比克', 'NA': '纳米比亚',
    'NE': '尼日尔', 'NG': '尼日利亚', 'NI': '尼加拉瓜', 'NL': '荷兰',
    'NO': '挪威', 'NP': '尼泊尔', 'NZ': '新西兰', 'OM': '阿曼',
    'PA': '巴拿马', 'PE': '秘鲁', 'PG': '巴布亚新几内亚', 'PH': '菲律宾',
    'PK': '巴基斯坦', 'PL': '波兰', 'PS': '巴勒斯坦', 'PT': '葡萄牙',
    'PY': '巴拉圭', 'QA': '卡塔尔', 'RO': '罗马尼亚', 'RS': '塞尔维亚',
    'RU': '俄罗斯', 'RW': '卢旺达', 'SA': '沙特阿拉伯', 'SD': '苏丹',
    'SE': '瑞典', 'SG': '新加坡', 'SI': '斯洛文尼亚', 'SK': '斯洛伐克',
    'SL': '塞拉利昂', 'SN': '塞内加尔', 'SO': '索马里', 'SR': '苏里南',
    'SS': '南苏丹', 'SV': '萨尔瓦多', 'SY': '叙利亚', 'SZ': '斯威士兰',
    'TD': '乍得', 'TG': '多哥', 'TH': '泰国', 'TJ': '塔吉克斯坦',
    'TM': '土库曼斯坦', 'TN': '突尼斯', 'TR': '土耳其', 'TT': '特立尼达和多巴哥',
    'TW': '中国台湾', 'TZ': '坦桑尼亚', 'UA': '乌克兰', 'UG': '乌干达',
    'US': '美国', 'UY': '乌拉圭', 'UZ': '乌兹别克斯坦', 'VA': '梵蒂冈',
    'VE': '委内瑞拉', 'VN': '越南', 'YE': '也门', 'ZA': '南非',
    'ZM': '赞比亚', 'ZW': '津巴布韦', 'XK': '科索沃', 'HK': '中国香港',
    'MO': '中国澳门', 'GL': '格陵兰', 'PR': '波多黎各', 'TL': '东帝汶',
}


def zh_candidate(alternates):
    """从别名串里挑一条像样的中文名：纯 CJK（可带 ·、括号、连字符）。
    优先双字以上（'沪' 让位给 '上海'），再去掉多余的行政区后缀。"""
    best = None
    for part in (alternates or '').split(','):
        s = part.strip()
        if not s or not CJK.search(s):
            continue
        if not GOOD_ZH.match(s):
            continue
        s = s.replace('（', '(').replace('）', ')')
        if len(s) > 2:
            s = re.sub(r'[市县区镇乡]$', '', s)
        if len(s) < 2:
            continue
        # 优先 2 字及以上，其次更短（'新宮' 优于 '新宮市'）
        if best is None or len(s) < len(best):
            best = s
    return best


def main():
    rows = []
    seen = set()
    with io.open(SRC, encoding='utf-8') as f:
        for line in f:
            cols = line.rstrip('\n').split('\t')
            if len(cols) < 15:
                continue
            _, name, asciiname, alternates, lat, lng, fcl, fcode, cc, *_rest = cols
            pop = int(cols[14] or 0)
            if fcl != 'P' or pop < 50000:
                continue
            try:
                la, ln = float(lat), float(lng)
            except ValueError:
                continue
            if not (-90 <= la <= 90 and -180 <= ln <= 180):
                continue
            key = asciiname.lower()
            if key in seen:
                continue
            seen.add(key)
            zh = OVERRIDES.get(key) or zh_candidate(alternates)
            rows.append((zh, asciiname, cc, la, ln, pop))

    rows.sort(key=lambda r: -r[5])
    n_zh = sum(1 for r in rows if r[0])
    print('cities:', len(rows), 'with zh:', n_zh, 'countries:', len({r[2] for r in rows}))

    cc_map = json.dumps(CC_ZH, ensure_ascii=False, separators=(',', ':'))
    body = ',\n'.join(
        '[%s,%s,%s,%s,%s,%d]' % (
            json.dumps(r[0], ensure_ascii=False) if r[0] else 'null',
            json.dumps(r[1], ensure_ascii=False),
            json.dumps(r[2]),
            repr(round(r[3], 4)), repr(round(r[4], 4)), r[5]
        ) for r in rows
    )

    with io.open(OUT, 'w', encoding='utf-8') as f:
        f.write('''/* ══════════════════════════════════════════════════════════════
   gazetteer.js — 世界城市地名库（生成文件，勿手改）

   生成：python ref/build-gazetteer.py
   来源：GeoNames cities5000（CC BY 4.0，https://www.geonames.org/）
   口径：人口 ≥ 50,000 的城市；中文名优先取别名里的 CJK 候选，
        其次取策展覆盖表；两者都没有时为 null。
   条目：[中文名|null, 英文名, 国码, 纬度, 经度, 人口]，
        按人口降序——搜索时大城市排在前面。
   加载：懒加载（import()），只在新建地标的联想与识别时用到。
   ══════════════════════════════════════════════════════════════════ */

export const CC_ZH = %s;

export const GAZETTEER = [
%s
];
''' % (cc_map, body))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
