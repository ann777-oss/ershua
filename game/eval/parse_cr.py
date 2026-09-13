# -*- coding: utf-8 -*-
"""解析 CodeRabbit NDJSON finding"""
import json

for line in open(r'd:\知乎黑客松\game\eval\reports\p1_coderabbit_raw.txt', encoding='utf-8-sig'):
    line = line.strip()
    if not line.startswith('{'):
        continue
    try:
        ev = json.loads(line)
    except Exception:
        continue
    if ev.get('type') == 'finding':
        text = ev.get('codegenInstructions', '')
        # 提取正文（去掉安全前缀）
        body = text.split('validate.\n\n')[-1] if 'validate.' in text else text
        print('[%s] %s' % (ev['severity'].upper(), ev['fileName']))
        print('  ' + body.strip().replace('\n', ' ')[:500])
        print()
