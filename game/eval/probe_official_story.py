# -*- coding: utf-8 -*-
"""探测官方故事 API：按悬疑向筛选 + 抽详情看篇幅/角色/结构"""
import json, urllib.request

def get(url):
    req = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'hackathon-eval/0.1'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))

stories = get('https://api.zhihu.com/km-indep-home/hackathon/v2/story/list')
print(f'总数: {len(stories)}\n')

# 悬疑相关关键词标签
KEY = ['悬疑', '反转', '惊悚', '推理', '脑洞']
print('=== 悬疑/反转向候选 ===')
cands = [s for s in stories if any(k in (s.get('labels') or []) for k in KEY)]
for s in cands:
    print(f"{s['work_id']} | {s['title']} | {','.join(s.get('labels') or [])} | {s.get('description', '')[:60]}")

print('\n=== 详情探测（前4篇候选） ===')
for s in cands[:4]:
    d = get(f"https://api.zhihu.com/km-indep-home/hackathon/v2/story/{s['work_id']}")
    content = d.get('content', '')
    paras = [p for p in content.split('\n') if p.strip()]
    print(f"--- {d.get('chapter_name')} | 作者: {d.get('author_name')} | {len(content)}字 / {len(paras)}段")
    print(f"    导语: {d.get('introduction', '')[:80]}")
    print(f"    开头: {paras[0][:60] if paras else ''}")
