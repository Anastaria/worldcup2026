/**
 * 数据源：百度搜索（尽力而为，反爬/格式多变，成功率不保证）
 * 逐场搜索 "主队 客队 世界杯 比分 日期"，从结果 HTML 解析比分。
 */

export const id = 'baidu';

export function available() { return true; }

// 从百度搜索 HTML 中尽力解析出 home:away 比分
function parseScore(html, home, away) {
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
  const re = /(\d{1,2})\s*[:：\-–]\s*(\d{1,2})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const idx = m.index;
    const ctx = text.slice(Math.max(0, idx - 70), idx + 70);
    const hi = ctx.indexOf(home);
    const ai = ctx.indexOf(away);
    if (hi >= 0 && ai >= 0) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      if (a >= 0 && a <= 20 && b >= 0 && b <= 20) {
        return hi <= ai ? { home: a, away: b } : { home: b, away: a };
      }
    }
  }
  return null;
}

async function fetchOne(fx) {
  const query = `${fx.home} ${fx.away} 世界杯 比分 ${fx.dateLabel}`;
  const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      cf: { cacheTtl: 0 },
    });
  } catch (e) {
    return null;
  }
  if (!res.ok) return null;
  const html = await res.text();
  return parseScore(html, fx.home, fx.away);
}

export async function resolve(pending, env) {
  const out = [];
  for (const fx of pending) {
    const score = await fetchOne(fx);
    if (score) out.push({ id: fx.id, home: score.home, away: score.away, info: `${fx.home} ${score.home}:${score.away} ${fx.away}` });
    await new Promise(s => setTimeout(s, 300)); // 轻微间隔降低限频
  }
  return { results: out, note: `baidu_try=${pending.length}` };
}
