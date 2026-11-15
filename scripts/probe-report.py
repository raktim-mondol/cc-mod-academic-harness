#!/usr/bin/env python3
"""Summarise one probe-run scenario: result text, cost, probe log and tool events.
Never prints secret values (the probe server logs only length and a hash)."""
import json, os, sys
name = sys.argv[1]
d = os.path.expanduser(f'~/.cache/ah-cc-p0/out/{name}/')
print('== stderr:', open(d + 'stderr.txt').read().strip()[:300])
try:
    for l in open(d + 'stream.jsonl'):
        try: m = json.loads(l)
        except Exception: continue
        t = m.get('type')
        if t == 'assistant':
            for c in m['message']['content']:
                if c.get('type') == 'tool_use': print('TOOL_USE', c['name'], json.dumps(c['input'])[:200])
        elif t == 'user':
            c = m['message']['content']
            if isinstance(c, list):
                for b in c:
                    if b.get('type') == 'tool_result':
                        print('TOOL_RESULT', 'ERR' if b.get('is_error') else 'ok', json.dumps(b.get('content'))[:300])
        elif t == 'result':
            print('RESULT', json.dumps(m.get('result'))[:300], '| cost', m.get('total_cost_usd'), '| turns', m.get('num_turns'), '| denials', json.dumps(m.get('permission_denials'))[:300])
except FileNotFoundError:
    pass
try:
    print('== probe log')
    for l in open(d + 'probe.jsonl'):
        m = json.loads(l)
        dd = json.dumps(m['data'])
        if m['kind'] == 'initialize': dd = '(initialize; see env)'
        print(f"{m['src']:6} {m['kind']:26} {dd[:260]}")
except FileNotFoundError:
    print('(no probe log)')
