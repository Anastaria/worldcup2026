/**
 * App 内中文队名 → 英文别名（用于和足球数据 API 返回的英文队名匹配）。
 * 每个中文名给若干常见英文写法，匹配时做小写 + 去标点的宽松包含比较。
 */
export const EN_ALIASES = {
  '墨西哥': ['Mexico'],
  '南非': ['South Africa'],
  '韩国': ['Korea Republic', 'South Korea', 'Korea'],
  '捷克': ['Czechia', 'Czech Republic'],
  '加拿大': ['Canada'],
  '波黑': ['Bosnia and Herzegovina', 'Bosnia-Herzegovina', 'Bosnia'],
  '卡塔尔': ['Qatar'],
  '瑞士': ['Switzerland'],
  '巴西': ['Brazil'],
  '摩洛哥': ['Morocco'],
  '海地': ['Haiti'],
  '苏格兰': ['Scotland'],
  '美国': ['United States', 'USA', 'United States of America'],
  '巴拉圭': ['Paraguay'],
  '澳大利亚': ['Australia'],
  '土耳其': ['Turkiye', 'Türkiye', 'Turkey'],
  '德国': ['Germany'],
  '库拉索': ['Curacao', 'Curaçao'],
  '科特迪瓦': ['Cote d\'Ivoire', 'Côte d\'Ivoire', 'Ivory Coast'],
  '厄瓜多尔': ['Ecuador'],
  '荷兰': ['Netherlands', 'Holland'],
  '日本': ['Japan'],
  '瑞典': ['Sweden'],
  '突尼斯': ['Tunisia'],
  '比利时': ['Belgium'],
  '埃及': ['Egypt'],
  '伊朗': ['Iran', 'IR Iran'],
  '新西兰': ['New Zealand'],
  '西班牙': ['Spain'],
  '佛得角': ['Cape Verde', 'Cabo Verde'],
  '沙特阿拉伯': ['Saudi Arabia'],
  '乌拉圭': ['Uruguay'],
  '法国': ['France'],
  '塞内加尔': ['Senegal'],
  '伊拉克': ['Iraq'],
  '挪威': ['Norway'],
  '阿根廷': ['Argentina'],
  '阿尔及利亚': ['Algeria'],
  '奥地利': ['Austria'],
  '约旦': ['Jordan'],
  '葡萄牙': ['Portugal'],
  '刚果(金)': ['DR Congo', 'Congo DR', 'Democratic Republic of the Congo', 'Congo'],
  '乌兹别克斯坦': ['Uzbekistan'],
  '哥伦比亚': ['Colombia'],
  '英格兰': ['England'],
  '克罗地亚': ['Croatia'],
  '加纳': ['Ghana'],
  '巴拿马': ['Panama'],
};

// 归一化：小写、去音标/标点/空格，便于宽松比较
export function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // 去音标
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// API 返回的英文队名是否对应某个中文队名
export function apiNameMatchesCn(apiName, cnName) {
  const aliases = EN_ALIASES[cnName];
  if (!aliases) return false;
  const a = normName(apiName);
  if (!a) return false;
  return aliases.some(al => {
    const n = normName(al);
    return a === n || a.includes(n) || n.includes(a);
  });
}
