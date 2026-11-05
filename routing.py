"""Deterministic shared dependency routing, matching the browser planner."""
from collections import deque

def dependency_routes(branch):
    by_id = {t['id']: t for t in branch['talents']}
    children = sorted((t for t in branch['talents'] if t.get('requires')), key=lambda t: (t['row'], t['col'], t['id']))
    def distance(t):
        p = by_id[t['requires']]
        return abs(t['row']-p['row']) + abs(t['col']-p['col'])
    best, missing = {}, float('inf')
    for order in range(4):
        ordered = children if order == 0 else list(reversed(children)) if order == 1 else sorted(children, key=lambda t: ((1 if order == 2 else -1)*distance(t), t['id']))
        planned, cells, edges = {}, set(), set()
        for child in ordered:
            parent = by_id[child['requires']]
            start, target = (parent['row'], parent['col']), (child['row'], child['col'])
            occupied = {(t['row'], t['col']) for t in branch['talents'] if t['id'] not in (parent['id'], child['id'])}
            previous, queue, path = {start: None}, deque([start]), None
            while queue:
                r, c = current = queue.popleft()
                if current == target:
                    path, at = [], current
                    while at is not None:
                        path.append(at)
                        at = previous[at]
                    path.reverse()
                    break
                for nxt in ((r+1,c),(r,c+1),(r,c-1),(r-1,c)):
                    nr,nc = nxt
                    edge = frozenset((current,nxt))
                    if not 0 <= nr < branch['rows'] or not 0 <= nc < 4 or nxt in occupied or nxt in previous or nxt in cells or edge in edges:
                        continue
                    previous[nxt] = current
                    queue.append(nxt)
            planned[child['id']] = path
            if path:
                cells.update(path[1:-1])
                edges.update(frozenset((a,b)) for a,b in zip(path,path[1:]))
        count = sum(path is None for path in planned.values())
        if count < missing:
            best, missing = planned, count
        if not count:
            break
    return best
