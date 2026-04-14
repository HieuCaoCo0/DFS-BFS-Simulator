(function () {
    'use strict';

    const canvas = document.getElementById('graphCanvas');
    const ctx = canvas.getContext('2d');

    // Chỉnh màu tươi và bắt mắt hơn để phù hợp với hiệu ứng Glow
    const COL = {
        unvisited: '#3b82f6', // Xanh biển nhạt
        active: '#fbbf24',    // Vàng neon
        visited: '#10b981',   // Xanh ngọc dạ quang
        path: '#06b6d4',      // Xanh lơ (cyan)
        bridge: '#ef4444',    // Đỏ cờ
        edge: '#94a3b8',      // Xám viền
        edgeHighlight: '#ef4444',
    };

    let vertices = [];
    let edges = [];
    let directed = false;

    let dragId = null;
    let steps = [];
    let stepIndex = 0;
    let playTimer = null;
    let lastStructureRows = [];
    let lastResultRows = [];

    // Biến dùng để loop animation lắc lư
    let currentSnap = null;
    
    // --- Quản lý Zoom (Khai báo duy nhất tại đây) ---
    let zoomLevel = 1.0; 

    const $ = (id) => document.getElementById(id);

    function normId(s) {
        return String(s == null ? '' : s).trim();
    }

    function vertexById(id) {
        return vertices.find((v) => v.id === id);
    }

    function canonicalUndirected(u, v) {
        return u <= v ? [u, v] : [v, u];
    }

    function buildAdj(asUndirected) {
        const adj = {};
        vertices.forEach((v) => (adj[v.id] = []));
        const seen = new Set();
        const add = (a, b) => {
            if (a === b) return;
            const key = a + '\0' + b;
            if (seen.has(key)) return;
            seen.add(key);
            adj[a].push(b);
        };
        edges.forEach((e) => {
            if (e.u === e.v) return;
            if (asUndirected || !directed) {
                add(e.u, e.v);
                add(e.v, e.u);
            } else {
                if (!adj[e.u].includes(e.v)) adj[e.u].push(e.v);
            }
        });
        return adj;
    }

    function weakComponentCount() {
        const adj = buildAdj(true);
        const seen = {};
        let c = 0;
        vertices.forEach((v) => {
            if (seen[v.id]) return;
            c++;
            const q = [v.id];
            seen[v.id] = true;
            while (q.length) {
                const u = q.pop();
                (adj[u] || []).forEach((w) => {
                    if (!seen[w]) {
                        seen[w] = true;
                        q.push(w);
                    }
                });
            }
        });
        return c;
    }

    function defaultLayout() {
        const n = vertices.length;
        if (!n) return;
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        const r = Math.min(canvas.width, canvas.height) * 0.32;
        vertices.forEach((v, i) => {
            const a = (2 * Math.PI * i) / n - Math.PI / 2;
            v.x = cx + r * Math.cos(a);
            v.y = cy + r * Math.sin(a);
        });
    }

    function seedDemo() {
        vertices = [
            { id: '0', x: 120, y: 200 },
            { id: '1', x: 280, y: 120 },
            { id: '2', x: 480, y: 160 },
            { id: '3', x: 400, y: 300 },
            { id: '4', x: 200, y: 320 },
        ];
        directed = true;
        edges = [
            { u: '0', v: '1' },
            { u: '1', v: '2' },
            { u: '2', v: '3' },
            { u: '3', v: '1' },
            { u: '4', v: '0' },
        ];
        $('directedSelect').value = 'directed';
        defaultLayout();
    }

    function fillSelects() {
        const ss = $('startSelect');
        const es = $('endSelect');
        if (!ss || !es) return;
        ss.innerHTML = '';
        es.innerHTML = '';
        vertices.forEach((v) => {
            const o1 = document.createElement('option');
            o1.value = v.id;
            o1.textContent = v.id;
            ss.appendChild(o1);
            const o2 = document.createElement('option');
            o2.value = v.id;
            o2.textContent = v.id;
            es.appendChild(o2);
        });
    }

    function setStatus(t) {
        $('simStatus').textContent = t;
    }

    function applyDirectedFromUI() {
        const mode = $('modeSelect') ? $('modeSelect').value : 'traverse';
        if (mode === 'orient') {
            // "Định chiều được" ở đây: đồ thị VÔ HƯỚNG có thể định hướng để trở thành liên thông mạnh hay không (Robbins).
            // Vì vậy luôn ép về vô hướng trong chế độ này.
            directed = false;
            const ds = $('directedSelect');
            if (ds) ds.value = 'undirected';
            return;
        }
        directed = $('directedSelect').value === 'directed';
    }

    function getWobblePos(v) {
        if (!v) return { x: 0, y: 0 };
        if (v.id === dragId) return { x: v.x, y: v.y };

        // Snap to whole pixels to avoid shimmering/blur from sub-pixel jitter.
        // (The visual "wobble" remains, but the graph looks crisper.)
        const time = Date.now() / 1500;
        const hash = v.id.charCodeAt(0) || 0;
        const x = v.x + Math.sin(time + hash) * 1;
        const y = v.y + Math.cos(time + hash * 2) * 1;
        return { x: Math.round(x), y: Math.round(y) };
    }

    function edgeIsHighlighted(e, h) {
        if (!h || h.u == null || h.v == null) return false;
        if (directed) {
            return e.u === h.u && e.v === h.v;
        }
        const [ea, eb] = canonicalUndirected(e.u, e.v);
        const [ha, hb] = canonicalUndirected(h.u, h.v);
        return ea === ha && eb === hb;
    }

    function drawEdge(e, snap) {
        const a = vertexById(e.u);
        const b = vertexById(e.v);
        if (!a || !b) return;

        const pA = getWobblePos(a);
        const pB = getWobblePos(b);

        const isCurved = directed && edges.some(edge => edge.u === e.v && edge.v === e.u);

        let color = COL.edge;
        // CHỈNH SỬA: Tăng độ dày cạnh lên 2 để sắc nét, không bị mờ
        let width = 2; 
        let isDashed = false;

        if (snap && snap.hiddenEdge && edgeIsHighlighted(e, snap.hiddenEdge)) {
            color = '#475569';
            isDashed = true;
        } else {
            const hl = snap && snap.highlightEdge && edgeIsHighlighted(e, snap.highlightEdge);
            const bridge = snap && snap.bridges && snap.bridges.some((p) => (p[0] === e.u && p[1] === e.v) || (p[0] === e.v && p[1] === e.u));
            if (hl) {
                color = COL.edgeHighlight;
                width = 4;
            } else if (bridge) {
                color = COL.bridge;
                width = 3;
            }
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash(isDashed ? [5, 5] : []);

        const dx = pB.x - pA.x;
        const dy = pB.y - pA.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = dx / len;
        const ny = dy / len;

        const r = 22; 
        const sx = pA.x + nx * r;
        const sy = pA.y + ny * r;
        const ex = pB.x - nx * r;
        const ey = pB.y - ny * r;

        let cpX = 0, cpY = 0; 
        let headDx, headDy;

        ctx.beginPath();
        if (isCurved) {
            const curveOffset = 30;
            const midX = (sx + ex) / 2;
            const midY = (sy + ey) / 2;
            const perpX = -ny;
            const perpY = nx;
            
            cpX = midX + perpX * curveOffset;
            cpY = midY + perpY * curveOffset;
            
            ctx.moveTo(sx, sy);
            ctx.quadraticCurveTo(cpX, cpY, ex, ey);
            
            const t = 1; 
            headDx = 2 * (1 - t) * (cpX - sx) + 2 * t * (ex - cpX);
            headDy = 2 * (1 - t) * (cpY - sy) + 2 * t * (ey - cpY);
        } else {
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            headDx = dx;
            headDy = dy;
        }
        ctx.stroke();
        ctx.setLineDash([]);

        if (directed) {
            const hLen = Math.hypot(headDx, headDy) || 1;
            const hnx = headDx / hLen;
            const hny = headDy / hLen;

            const ah = 12;
            const aw = 7;
            const lx = ex - hnx * ah - hny * aw;
            const ly = ey - hny * ah + hnx * aw;
            const rx = ex - hnx * ah + hny * aw;
            const ry = ey - hny * ah - hnx * aw;

            ctx.beginPath();
            ctx.moveTo(ex, ey);
            ctx.lineTo(lx, ly);
            ctx.lineTo(rx, ry);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
        }
    }

    function hslComponent(k, total) {
        const h = Math.round((360 * k) / Math.max(total, 1)) % 360;
        return `hsl(${h}, 80%, 50%)`;
    }

    function drawGraph(snap) {
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        ctx.save();
        const cx = w / 2;
        const cy = h / 2;
        ctx.translate(cx, cy);
        ctx.scale(zoomLevel, zoomLevel);
        ctx.translate(-cx, -cy);

        const nc = (snap && snap.nodeColor) || {};
        const comp = (snap && snap.componentOf) || null;

        const drawnUndirected = new Set();
        edges.forEach((e) => {
            if (!directed) {
                const [a, b] = canonicalUndirected(e.u, e.v);
                const key = a + '\0' + b;
                if (drawnUndirected.has(key)) return;
                drawnUndirected.add(key);
            }
            drawEdge(e, snap);
        });

        vertices.forEach((v) => {
            let baseColor = COL.unvisited;
            const st = nc[v.id] || 'unvisited';
            if (st === 'active') baseColor = COL.active;
            else if (st === 'visited') baseColor = COL.visited;
            else if (st === 'path') baseColor = COL.path;
            else if (st === 'unvisited') baseColor = COL.unvisited;
            if (comp && comp[v.id] != null) {
                const total = snap.componentCount || 1;
                baseColor = hslComponent(comp[v.id], total);
            }

            const p = getWobblePos(v); 
            const radius = 18;

            // VẼ ĐỈNH (Tắt toàn bộ hiệu ứng bóng)
            ctx.beginPath();
            ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = baseColor;
            ctx.fill(); // Không dùng shadowColor và shadowBlur nữa
            
            // Viền đỉnh (Tăng độ nét)
            ctx.strokeStyle = '#1e293b'; 
            ctx.lineWidth = 1.5; 
            ctx.stroke();

            // VẼ CHỮ (Tắt toàn bộ hiệu ứng bóng)
            ctx.fillStyle = '#ffffff'; 
            ctx.font = 'bold 15px "Times New Roman", Times, serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(v.id, p.x, p.y); // Không dùng shadowColor và shadowBlur nữa
        });

        ctx.restore();
    }

    function snapshotBase(msg, vertexLabel) {
        return {
            msg: msg || '',
            vertexLabel: vertexLabel != null ? String(vertexLabel) : '—',
            nodeColor: {},
            stack: [],
            queue: [],
            bridges: null,
            componentOf: null,
            componentCount: 0,
            kosPhase: null,
            finishStack: [],
            remainingFinish: [],
            highlightEdge: null,
            hiddenEdge: null,
            orientSub: null,
        };
    }

    function cloneColors(s) {
        return { ...s.nodeColor };
    }

    function pushStep(arr, snap) {
        arr.push(JSON.parse(JSON.stringify(snap)));
    }

    function buildBFSTraversal(start) {
        const steps = [];
        const adj = buildAdj(false);
        const dist = {};
        const parent = {};
        vertices.forEach((v) => {
            dist[v.id] = -1;
        });
        const q = [start];
        dist[start] = 0;
        let stepNum = 0;

        const s0 = snapshotBase('Khởi tạo BFS từ ' + start, start);
        vertices.forEach((v) => (s0.nodeColor[v.id] = v.id === start ? 'active' : 'unvisited'));
        s0.queue = [...q];
        s0.stepNum = stepNum++;
        pushStep(steps, s0);

        while (q.length) {
            const u = q.shift();
            const s1 = snapshotBase('Lấy khỏi hàng đợi: ' + u, u);
            s1.nodeColor = cloneColors(steps[steps.length - 1].nodeColor);
            vertices.forEach((v) => {
                if (s1.nodeColor[v.id] === 'active' && v.id !== u) s1.nodeColor[v.id] = 'visited';
            });
            s1.nodeColor[u] = 'active';
            s1.queue = [...q];
            if (parent[u] != null) {
                s1.highlightEdge = { u: parent[u], v: u };
            }
            s1.stepNum = stepNum++;
            pushStep(steps, s1);

            (adj[u] || []).forEach((w) => {
                if (dist[w] < 0) {
                    dist[w] = dist[u] + 1;
                    parent[w] = u;
                    q.push(w);
                    const s2 = snapshotBase('Thăm kề ' + w + ' từ ' + u + ' (cạnh ' + u + '→' + w + ')', w);
                    s2.nodeColor = cloneColors(steps[steps.length - 1].nodeColor);
                    s2.nodeColor[w] = 'visited';
                    s2.queue = [...q];
                    s2.highlightEdge = { u, v: w };
                    s2.stepNum = stepNum++;
                    pushStep(steps, s2);
                } else {
                    const sk = snapshotBase('Cạnh ' + u + '→' + w + ': đỉnh đã thăm, bỏ qua', u);
                    sk.nodeColor = cloneColors(steps[steps.length - 1].nodeColor);
                    sk.queue = [...q];
                    sk.highlightEdge = { u, v: w };
                    sk.stepNum = stepNum++;
                    pushStep(steps, sk);
                }
            });

            const s3 = snapshotBase('Đánh dấu đã xét ' + u, u);
            s3.nodeColor = cloneColors(steps[steps.length - 1].nodeColor);
            s3.nodeColor[u] = 'visited';
            s3.queue = [...q];
            s3.highlightEdge = null;
            s3.stepNum = stepNum++;
            pushStep(steps, s3);
        }

        const end = $('endSelect').value;
        const sEnd = snapshotBase('Hoàn tất BFS', '—');
        sEnd.nodeColor = cloneColors(steps[steps.length - 1].nodeColor);
        if (vertexById(end) && dist[end] >= 0) {
            let cur = end;
            while (cur != null) {
                sEnd.nodeColor[cur] = 'path';
                cur = parent[cur];
            }
        }
        sEnd.stepNum = stepNum;
        sEnd.dist = { ...dist };
        sEnd.parent = { ...parent };
        pushStep(steps, sEnd);

        return { steps, dist, parent };
    }

    function buildDFSTraversal(start) {
        const steps = [];
        const adj = buildAdj(false);
        const visited = {};
        const parent = {};
        let stepNum = 0;

        function snap(msg, cur, stack, highlightEdge) {
            const s = snapshotBase(msg, cur);
            vertices.forEach((v) => {
                if (!visited[v.id]) s.nodeColor[v.id] = 'unvisited';
                else if (v.id === cur) s.nodeColor[v.id] = 'active';
                else s.nodeColor[v.id] = 'visited';
            });
            s.stack = [...stack];
            if (highlightEdge) s.highlightEdge = highlightEdge;
            s.stepNum = stepNum++;
            pushStep(steps, s);
        }

        function dfs(u, stack) {
            visited[u] = true;
            snap('Vào DFS(' + u + ')', u, stack, null);
            const stack2 = [...stack, u];
            snap('Đẩy vào stack', u, stack2, null);

            (adj[u] || []).forEach((w) => {
                if (!visited[w]) {
                    parent[w] = u;
                    snap(
                        'Duyệt cạnh (' + u + '→' + w + '), gọi DFS(' + w + ')',
                        u,
                        stack2,
                        { u, v: w }
                    );
                    dfs(w, stack2);
                } else {
                    snap('Cạnh (' + u + '→' + w + '): đã thăm, bỏ qua', u, stack2, { u, v: w });
                }
            });

            snap('Rời DFS(' + u + ')', u, stack, null);
        }

        dfs(start, []);

        const end = $('endSelect').value;
        const sEnd = snapshotBase('Hoàn tất DFS', '—');
        const last = steps[steps.length - 1];
        sEnd.nodeColor = { ...last.nodeColor };
        vertices.forEach((v) => {
            if (sEnd.nodeColor[v.id] === 'active') sEnd.nodeColor[v.id] = 'visited';
        });
        if (vertexById(end) && visited[end]) {
            let cur = end;
            while (cur != null) {
                sEnd.nodeColor[cur] = 'path';
                cur = parent[cur];
            }
        }
        sEnd.stack = [];
        sEnd.stepNum = stepNum;
        sEnd.visited = { ...visited };
        sEnd.parent = { ...parent };
        pushStep(steps, sEnd);

        return { steps, visited, parent };
    }

    function buildTarjanSteps() {
        const steps = [];
        const adj = buildAdj(false);
        let idx = 0;
        const index = {};
        const low = {};
        const stack = [];
        const onStack = {};
        let stepNum = 0;

        function colorFromState(u) {
            const nc = {};
            vertices.forEach((v) => {
                if (index[v.id] == null) nc[v.id] = 'unvisited';
                else if (onStack[v.id]) nc[v.id] = v.id === u ? 'active' : 'visited';
                else nc[v.id] = 'visited';
            });
            return nc;
        }

        function rec(msg, u, highlightEdge) {
            const s = snapshotBase(msg, u);
            s.nodeColor = colorFromState(u);
            s.stack = [...stack];
            if (highlightEdge) s.highlightEdge = highlightEdge;
            s.stepNum = stepNum++;
            pushStep(steps, s);
        }

        function strongConnect(u) {
            index[u] = idx;
            low[u] = idx;
            idx++;
            stack.push(u);
            onStack[u] = true;
            rec('Tarjan: đặt index/low, đẩy ' + u + ' vào stack', u, null);

            (adj[u] || []).forEach((v) => {
                if (index[v] == null) {
                    rec('Cạnh (' + u + '→' + v + '): chưa thăm, gọi đệ quy', u, { u, v });
                    strongConnect(v);
                    low[u] = Math.min(low[u], low[v]);
                    rec('Cập nhật low[' + u + '] = ' + low[u] + ' (từ con)', u, { u, v });
                } else if (onStack[v]) {
                    low[u] = Math.min(low[u], index[v]);
                    rec('Cạnh ngược tới ' + v + ' trên stack: low[' + u + ']=' + low[u], u, { u, v });
                } else {
                    rec('Cạnh (' + u + '→' + v + '): cross (đã đóng SCC)', u, { u, v });
                }
            });

            if (low[u] === index[u]) {
                const comp = [];
                let w;
                do {
                    w = stack.pop();
                    onStack[w] = false;
                    comp.push(w);
                } while (w !== u);
                rec('Pop TPLTM: {' + comp.join(',') + '}', u, null);
            }
        }

        vertices.forEach((v) => {
            if (index[v.id] == null) {
                rec('Bắt đầu đỉnh nguồn mới: ' + v.id, v.id, null);
                strongConnect(v.id);
            }
        });

        const comps = computeSCCMeta();
        const sFinal = snapshotBase('Kết quả: tô màu theo TPLTM', '—');
        sFinal.componentOf = {};
        comps.forEach((c, i) => c.forEach((id) => (sFinal.componentOf[id] = i)));
        sFinal.componentCount = comps.length;
        vertices.forEach((v) => (sFinal.nodeColor[v.id] = 'visited'));
        sFinal.stepNum = stepNum;
        pushStep(steps, sFinal);

        return { steps, comps };
    }

    function buildTransposeAdj() {
        const adj = buildAdj(false);
        const rev = {};
        vertices.forEach((v) => (rev[v.id] = []));
        vertices.forEach((u) => {
            (adj[u.id] || []).forEach((v) => {
                if (!rev[v].includes(u.id)) rev[v].push(u.id);
            });
        });
        return rev;
    }

    function buildKosarajuSteps() {
        const steps = [];
        const adj = buildAdj(false);
        const revAdj = buildTransposeAdj();
        let stepNum = 0;
        const visited1 = {};
        const finishStack = [];

        function snapK(msg, v, o) {
            const s = snapshotBase(msg, v);
            s.stepNum = stepNum++;
            s.kosPhase = o.phase;
            s.finishStack = o.finishStack ? o.finishStack.slice() : [];
            s.remainingFinish = o.remainingFinish ? o.remainingFinish.slice() : [];
            s.queue = o.queue ? o.queue.slice() : [];
            s.stack = o.dfsStack ? o.dfsStack.slice() : [];
            s.nodeColor = o.nodeColor && Object.keys(o.nodeColor).length ? o.nodeColor : {};
            if (!Object.keys(s.nodeColor).length) {
                vertices.forEach((vv) => (s.nodeColor[vv.id] = 'unvisited'));
            }
            if (o.highlightEdge) s.highlightEdge = { u: o.highlightEdge.u, v: o.highlightEdge.v };
            pushStep(steps, s);
        }

        function dfs1(u, dfsStack) {
            visited1[u] = true;
            const st = dfsStack.concat([u]);
            const ncEnter = {};
            vertices.forEach((vv) => {
                if (!visited1[vv.id]) ncEnter[vv.id] = 'unvisited';
                else if (st.includes(vv.id)) ncEnter[vv.id] = vv.id === u ? 'active' : 'visited';
                else ncEnter[vv.id] = 'visited';
            });
            snapK('GĐ1 (trên G): DFS vào ' + u, u, {
                phase: 1,
                finishStack: finishStack.slice(),
                dfsStack: st,
                nodeColor: ncEnter,
            });

            (adj[u] || []).forEach((w) => {
                if (!visited1[w]) {
                    const ncE = {};
                    vertices.forEach((vv) => {
                        if (!visited1[vv.id]) ncE[vv.id] = 'unvisited';
                        else if (st.includes(vv.id)) ncE[vv.id] = vv.id === u ? 'active' : 'visited';
                        else ncE[vv.id] = 'visited';
                    });
                    snapK('GĐ1: duyệt cạnh ' + u + '→' + w, u, {
                        phase: 1,
                        finishStack: finishStack.slice(),
                        dfsStack: st,
                        nodeColor: ncE,
                        highlightEdge: { u, v: w },
                    });
                    dfs1(w, st);
                }
            });

            finishStack.push(u);
            const ncDone = {};
            vertices.forEach((vv) => {
                ncDone[vv.id] = visited1[vv.id] ? 'visited' : 'unvisited';
            });
            snapK('GĐ1: hoàn thành ' + u + ' → đẩy vào L (stack thứ tự hoàn thành)', u, {
                phase: 1,
                finishStack: finishStack.slice(),
                dfsStack: dfsStack,
                nodeColor: ncDone,
            });
        }

        vertices.forEach((v) => {
            if (!visited1[v.id]) dfs1(v.id, []);
        });

        snapK(
            'GĐ1 xong. L = [' + finishStack.join(', ') + ']. Tiếp theo: G^T và BFS theo thứ tự ngược L.',
            '—',
            {
                phase: 1,
                finishStack: finishStack.slice(),
                dfsStack: [],
                nodeColor: (function () {
                    const nc = {};
                    vertices.forEach((vv) => (nc[vv.id] = 'visited'));
                    return nc;
                })(),
            }
        );

        snapK('G^T: đảo chiều mọi cạnh. GĐ2: pop từ cuối L, mỗi đỉnh chưa gán → BFS trên G^T.', '—', {
            phase: 2,
            finishStack: finishStack.slice(),
            remainingFinish: finishStack.slice(),
            queue: [],
            nodeColor: (function () {
                const nc = {};
                vertices.forEach((vv) => (nc[vv.id] = 'unvisited'));
                return nc;
            })(),
        });

        const assigned = {};
        let compIdx = 0;
        const work = finishStack.slice();

        function colorP2(focusId, q, ci) {
            const nc = {};
            vertices.forEach((vv) => {
                const a = assigned[vv.id];
                if (a == null) nc[vv.id] = 'unvisited';
                else if (a === ci) nc[vv.id] = vv.id === focusId ? 'active' : 'visited';
                else nc[vv.id] = 'visited';
            });
            return nc;
        }

        function colorP2All() {
            const nc = {};
            vertices.forEach((vv) => {
                nc[vv.id] = assigned[vv.id] != null ? 'visited' : 'unvisited';
            });
            return nc;
        }

        while (work.length) {
            const root = work.pop();
            if (assigned[root] != null) {
                snapK('GĐ2: lấy ' + root + ' từ cuối L — đã thuộc TPLTM trước đó', root, {
                    phase: 2,
                    remainingFinish: work.slice(),
                    queue: [],
                    nodeColor: colorP2All(),
                });
                continue;
            }

            compIdx++;
            const q = [root];
            assigned[root] = compIdx;

            snapK('GĐ2 BFS trên G^T: gốc TPLTM mới là ' + root, root, {
                phase: 2,
                remainingFinish: work.slice(),
                queue: q.slice(),
                nodeColor: colorP2(root, q, compIdx),
            });

            while (q.length) {
                const x = q.shift();
                snapK('GĐ2 BFS: lấy ' + x + ' khỏi hàng đợi', x, {
                    phase: 2,
                    remainingFinish: work.slice(),
                    queue: q.slice(),
                    nodeColor: colorP2(x, q, compIdx),
                });

                (revAdj[x] || []).forEach((y) => {
                    if (assigned[y] == null) {
                        assigned[y] = compIdx;
                        q.push(y);
                        snapK('GĐ2: enqueue kề ' + y + ' (cạnh trên G^T, trong G là ' + y + '→' + x + ')', y, {
                            phase: 2,
                            remainingFinish: work.slice(),
                            queue: q.slice(),
                            nodeColor: colorP2(y, q, compIdx),
                            highlightEdge: { u: y, v: x },
                        });
                    }
                });
            }

            snapK('GĐ2: hoàn thành TPLTM số ' + compIdx, '—', {
                phase: 2,
                remainingFinish: work.slice(),
                queue: [],
                nodeColor: colorP2All(),
            });
        }

        const byComp = {};
        vertices.forEach((v) => {
            const c = assigned[v.id];
            if (c != null) {
                if (!byComp[c]) byComp[c] = [];
                byComp[c].push(v.id);
            }
        });
        const comps = Object.keys(byComp)
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => byComp[k]);

        const sFinal = snapshotBase('Kết quả Kosaraju: tô màu theo từng TPLTM', '—');
        sFinal.componentOf = {};
        comps.forEach((c, i) => c.forEach((id) => (sFinal.componentOf[id] = i)));
        sFinal.componentCount = comps.length;
        vertices.forEach((v) => (sFinal.nodeColor[v.id] = 'visited'));
        sFinal.stepNum = stepNum;
        sFinal.kosPhase = 2;
        sFinal.finishStack = finishStack.slice();
        pushStep(steps, sFinal);

        return { steps, comps };
    }

    function computeSCCMeta() {
        const adj = buildAdj(false);
        let idx = 0;
        const index = {};
        const low = {};
        const stack = [];
        const onStack = {};
        const comps = [];

        function strongConnect(u) {
            index[u] = idx;
            low[u] = idx;
            idx++;
            stack.push(u);
            onStack[u] = true;
            (adj[u] || []).forEach((v) => {
                if (index[v] == null) {
                    strongConnect(v);
                    low[u] = Math.min(low[u], low[v]);
                } else if (onStack[v]) {
                    low[u] = Math.min(low[u], index[v]);
                }
            });
            if (low[u] === index[u]) {
                const comp = [];
                let w;
                do {
                    w = stack.pop();
                    onStack[w] = false;
                    comp.push(w);
                } while (w !== u);
                comps.push(comp);
            }
        }
        vertices.forEach((v) => {
            if (index[v.id] == null) strongConnect(v.id);
        });
        return comps;
    }

    function buildBridgeSteps() {
        const steps = [];
        const adj = buildAdj(true);
        let timer = 0;
        const disc = {};
        const low = {};
        const parent = {};
        const bridges = [];
        let stepNum = 0;

        function snap(msg, u, highlightEdge) {
            const s = snapshotBase(msg, u);
            vertices.forEach((v) => {
                if (disc[v.id] == null) s.nodeColor[v.id] = 'unvisited';
                else if (v.id === u) s.nodeColor[v.id] = 'active';
                else s.nodeColor[v.id] = 'visited';
            });
            s.bridges = bridges.map((b) => [...b]);
            if (highlightEdge) s.highlightEdge = highlightEdge;
            s.stepNum = stepNum++;
            pushStep(steps, s);
        }

        function dfs(u, p) {
            disc[u] = low[u] = ++timer;
            parent[u] = p;
            snap('Thăm ' + u + ', disc/low=' + disc[u], u, null);

            (adj[u] || []).forEach((v) => {
                if (disc[v] == null) {
                    snap('Cây DFS: (' + u + '-' + v + ')', u, { u, v });
                    dfs(v, u);
                    low[u] = Math.min(low[u], low[v]);
                    snap('Cập nhật low[' + u + ']=' + low[u] + ' sau con ' + v, u, { u, v });
                    if (low[v] > disc[u]) {
                        bridges.push([u, v]);
                        snap('Phát hiện cầu: ' + u + '—' + v, u, { u, v });
                    }
                } else if (v !== p) {
                    low[u] = Math.min(low[u], disc[v]);
                    snap('Cạnh ngược tới ' + v + ', low[' + u + ']=' + low[u], u, { u, v });
                }
            });
        }

        vertices.forEach((v) => {
            if (disc[v.id] == null) {
                snap('Thành phần liên thông mới, gốc ' + v.id, v.id, null);
                dfs(v.id, null);
            }
        });

        const wcc = weakComponentCount();
        const bridgeFree = bridges.length === 0;
        const orientable = wcc === 1 && bridgeFree;
        const sFinal = snapshotBase(
            orientable
                ? 'Kết luận: đồ thị vô hướng liên thông và không có cầu → có định chiều mạnh (định lý Robbins).'
                : 'Kết luận: không đủ điều kiện định chiều mạnh (cần liên thông và không cầu).',
            '—'
        );
        sFinal.nodeColor = {};
        vertices.forEach((v) => (sFinal.nodeColor[v.id] = 'visited'));
        sFinal.bridges = bridges.map((b) => [...b]);
        sFinal.orientable = orientable;
        sFinal.weakComp = wcc;
        sFinal.stepNum = stepNum;
        pushStep(steps, sFinal);

        return { steps, bridges, orientable, weakComp: wcc };
    }

    function getUniqueUndirectedEdges() {
        const seen = new Set();
        const out = [];
        edges.forEach((e) => {
            if (e.u === e.v) return;
            const [x, y] = canonicalUndirected(e.u, e.v);
            const key = x + '\0' + y;
            if (seen.has(key)) return;
            seen.add(key);
            out.push([x, y]);
        });
        out.sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : p[1] < q[1] ? -1 : p[1] > q[1] ? 1 : 0));
        return out;
    }

    function adjWithoutUndirectedEdge(adj, a, b) {
        const c = {};
        vertices.forEach((v) => {
            c[v.id] = (adj[v.id] || []).filter((x) => !((v.id === a && x === b) || (v.id === b && x === a)));
        });
        return c;
    }

    function reachableBFSUndirected(adj, start, goal) {
        if (start === goal) return true;
        const seen = { [start]: true };
        const q = [start];
        while (q.length) {
            const u = q.shift();
            const nbr = adj[u] || [];
            for (let i = 0; i < nbr.length; i++) {
                const w = nbr[i];
                if (w === goal) return true;
                if (!seen[w]) {
                    seen[w] = true;
                    q.push(w);
                }
            }
        }
        return false;
    }

    function computeBridgesBFS() {
        const fullAdj = buildAdj(true);
        const bridges = [];
        getUniqueUndirectedEdges().forEach(([a, b]) => {
            const tempAdj = adjWithoutUndirectedEdge(fullAdj, a, b);
            if (!reachableBFSUndirected(tempAdj, a, b)) bridges.push([a, b]);
        });
        return bridges;
    }

    function buildBridgeStepsBFS() {
        const steps = [];
        const fullAdj = buildAdj(true);
        const bridges = [];
        let stepNum = 0;
        const pairList = getUniqueUndirectedEdges();

        function colorBFS(seen, activeId, qArr) {
            const nc = {};
            vertices.forEach((v) => {
                const id = v.id;
                if (!seen[id]) nc[id] = 'unvisited';
                else if (id === activeId) nc[id] = 'active';
                else nc[id] = 'visited';
            });
            return nc;
        }

        function allVisitedNC() {
            const nc = {};
            vertices.forEach((v) => (nc[v.id] = 'visited'));
            return nc;
        }

        function pushSnap(msg, vl, opts) {
            const s = snapshotBase(msg, vl);
            s.stepNum = stepNum++;
            s.bridges = bridges.map((br) => [...br]);
            s.orientSub = 'bfs';
            s.queue = opts && opts.queue ? opts.queue.slice() : [];
            s.hiddenEdge = opts && opts.hiddenEdge ? { u: opts.hiddenEdge.u, v: opts.hiddenEdge.v } : null;
            s.highlightEdge = opts && opts.highlightEdge ? { u: opts.highlightEdge.u, v: opts.highlightEdge.v } : null;
            const nc = opts && opts.nodeColor;
            vertices.forEach((v) => {
                s.nodeColor[v.id] = nc && nc[v.id] != null ? nc[v.id] : 'unvisited';
            });
            pushStep(steps, s);
        }

        pairList.forEach(([a, b]) => {
            const adj = adjWithoutUndirectedEdge(fullAdj, a, b);
            const hidden = { u: a, v: b };

            pushSnap(
                'Thử cạnh ' + a + '—' + b + ': tạm bỏ cạnh (nét đứt); BFS từ ' + a + ' để xem có đường tới ' + b + ' không',
                a,
                { queue: [], hiddenEdge: hidden, nodeColor: colorBFS({}, null, []) }
            );

            const seen = { [a]: true };
            let q = [a];
            let reachedB = a === b;

            pushSnap('BFS: xếp hàng đợi gốc ' + a, a, {
                queue: q.slice(),
                hiddenEdge: hidden,
                nodeColor: colorBFS(seen, a, q),
            });

            outer: while (q.length && !reachedB) {
                const u = q.shift();
                pushSnap('BFS: lấy ' + u + ' khỏi hàng đợi', u, {
                    queue: q.slice(),
                    hiddenEdge: hidden,
                    nodeColor: colorBFS(seen, u, q),
                });

                if (u === b) {
                    reachedB = true;
                    break outer;
                }

                const nbr = adj[u] || [];
                for (let i = 0; i < nbr.length; i++) {
                    if (reachedB) break outer;
                    const w = nbr[i];
                    pushSnap('BFS: xét cạnh ' + u + '—' + w, u, {
                        queue: q.slice(),
                        hiddenEdge: hidden,
                        highlightEdge: { u, v: w },
                        nodeColor: colorBFS(seen, u, q),
                    });
                    if (!seen[w]) {
                        seen[w] = true;
                        q.push(w);
                        if (w === b) reachedB = true;
                        pushSnap(
                            'BFS: thêm ' + w + ' vào hàng đợi' + (w === b ? ' (đã tới ' + b + ')' : ''),
                            w,
                            {
                                queue: q.slice(),
                                hiddenEdge: hidden,
                                highlightEdge: { u, v: w },
                                nodeColor: colorBFS(seen, w, q),
                            }
                        );
                        if (reachedB) break outer;
                    }
                }
            }

            if (!reachedB) {
                bridges.push([a, b]);
                pushSnap(
                    '→ Cạnh ' + a + '—' + b + ' là CẦU (trong G \\ {cạnh này} không còn đường giữa hai đầu mút)',
                    '—',
                    { queue: [], hiddenEdge: hidden, nodeColor: allVisitedNC() }
                );
            } else {
                pushSnap(
                    '→ Cạnh ' + a + '—' + b + ' không phải cầu (hai đầu mút vẫn liên thông khi bỏ cạnh)',
                    '—',
                    { queue: [], hiddenEdge: hidden, nodeColor: allVisitedNC() }
                );
            }
        });

        const wcc = weakComponentCount();
        const bridgeFree = bridges.length === 0;
        const orientable = wcc === 1 && bridgeFree;
        const sFinal = snapshotBase(
            orientable
                ? 'Kết luận: đồ thị vô hướng liên thông và không có cầu → có định chiều mạnh (định lý Robbins).'
                : 'Kết luận: không đủ điều kiện định chiều mạnh (cần liên thông và không cầu).',
            '—'
        );
        sFinal.nodeColor = {};
        vertices.forEach((v) => (sFinal.nodeColor[v.id] = 'visited'));
        sFinal.bridges = bridges.map((br) => [...br]);
        sFinal.orientable = orientable;
        sFinal.weakComp = wcc;
        sFinal.stepNum = stepNum;
        sFinal.hiddenEdge = null;
        sFinal.orientSub = 'bfs';
        sFinal.queue = [];
        pushStep(steps, sFinal);

        return { steps, bridges, orientable, weakComp: wcc };
    }

    function updateInfoPanel(snap) {
        $('infoWeak').textContent = String(weakComponentCount());
        const mode = $('modeSelect').value;
        if ((mode === 'scc' || mode === 'kosaraju') && directed) {
            const comps = computeSCCMeta();
            $('infoScc').textContent = String(comps.length);
        } else if (mode === 'scc' || mode === 'kosaraju') {
            $('infoScc').textContent = '— (chọn có hướng)';
        } else {
            $('infoScc').textContent = directed ? String(computeSCCMeta().length) : String(weakComponentCount());
        }

        if (snap && snap.orientable != null) {
            $('infoOrient').textContent = snap.orientable ? 'Có (Robbins)' : 'Không';
        } else {
            $('infoOrient').textContent = '—';
        }

        if (typeof stepIndex === 'number' && steps && steps.length) {
            $('infoStep').textContent = String(stepIndex + 1) + ' / ' + String(steps.length);
        } else {
            $('infoStep').textContent = snap && snap.stepNum != null ? String(snap.stepNum) : '0';
        }
        $('infoVertex').textContent = snap && snap.vertexLabel != null ? snap.vertexLabel : '—';
        $('infoMsg').textContent = snap && snap.msg ? snap.msg : '—';
    }

    function renderStructureTable(mode, algo) {
        const tbody = $('structureTable').querySelector('tbody');
        tbody.innerHTML = '';
        const title = $('structureTitle');
        const col2 = $('structureCol2');
        
        let noteEl = $('structureNote');
        if (!noteEl) {
            noteEl = document.createElement('div');
            noteEl.id = 'structureNote';
            noteEl.style.fontSize = '0.9rem';
            noteEl.style.color = '#e2e8f0';
            noteEl.style.marginBottom = '12px';
            noteEl.style.lineHeight = '1.4';
            noteEl.style.padding = '10px';
            noteEl.style.backgroundColor = 'rgba(251, 191, 36, 0.1)'; 
            noteEl.style.borderLeft = '3px solid #facc15';           
            noteEl.style.borderRadius = '5px';
            title.parentNode.insertBefore(noteEl, title.nextSibling);
        }

        if (mode === 'traverse' && algo === 'bfs') {
            title.textContent = 'Hàng đợi (Queue)';
            col2.textContent = 'Hàng đợi';
            noteEl.style.display = 'none';
        } else if (mode === 'traverse') {
            title.textContent = 'Ngăn xếp (Stack)';
            col2.textContent = 'Stack';
            noteEl.style.display = 'none';
        } else if (mode === 'orient') {
            const isBFS = $('orientAlgoSelect').value === 'bfs';
            title.textContent = isBFS ? 'Hàng đợi BFS (thử từng cạnh)' : 'Các bước DFS (tìm cầu)';
            col2.textContent = 'Ghi chú';
            noteEl.style.display = 'block';
            noteEl.innerHTML = isBFS 
                ? '💡 <strong style="color:#3b82f6">Queue:</strong> Dùng để lan truyền BFS, kiểm tra xem còn đường đi giữa u và v khi giả lập bỏ đi cạnh (u,v) hay không.'
                : '💡 <strong style="color:#3b82f6">Đệ quy DFS:</strong> Đi sâu vào đồ thị để cập nhật thời gian thăm (disc) và giá trị low, qua đó xác định Cầu.';
        } else if (mode === 'kosaraju') {
            title.textContent = 'Kosaraju: DFS stack / L + BFS queue (G^T)';
            col2.textContent = 'Cấu trúc';
            noteEl.style.display = 'block';
            noteEl.innerHTML = '💡 <strong style="color:#3b82f6">DFS Stack:</strong> Phục vụ đệ quy GĐ1.<br>💡 <strong style="color:#fbbf24">Mảng L:</strong> Lưu thứ tự hoàn thành của các đỉnh (chờ GĐ2).<br>💡 <strong style="color:#10b981">BFS Queue:</strong> Lan truyền trên G^T để gom nhóm TPLTM.';
        } else {
            title.textContent = 'Stack Tarjan (TPLTM)';
            col2.textContent = 'Stack';
            noteEl.style.display = 'block';
            noteEl.innerHTML = '💡 <strong style="color:#3b82f6">Stack:</strong> Lưu trữ các đỉnh thuộc một TPLTM tiềm năng. Đỉnh chỉ được Pop ra khi phát hiện nó là gốc của TPLTM (low = index).';
        }

        lastStructureRows.forEach((row) => {
            const tr = document.createElement('tr');
            if (row.isDivider) {
                tr.innerHTML = `<td colspan="2" style="text-align: center; color: #facc15; background: rgba(251, 191, 36, 0.15); font-weight: bold; letter-spacing: 1px; padding: 12px; border-top: 2px dashed #facc15; border-bottom: 2px dashed #facc15; border-radius: 6px;">${row.val}</td>`;
            } else {
                tr.innerHTML = `<td>${row.step}</td><td>${row.val}</td>`;
            }
            tbody.appendChild(tr);
        });
    }

    function renderResultTable(mode, snap) {
        const tbody = $('resultTable').querySelector('tbody');
        const col2 = $('resultCol2');
        tbody.innerHTML = '';

        if (mode === 'traverse' && snap && snap.dist) {
            col2.textContent = 'Khoảng cách BFS';
            vertices.forEach((v) => {
                const tr = document.createElement('tr');
                const d = snap.dist[v.id];
                tr.innerHTML = '<td>' + v.id + '</td><td>' + (d < 0 ? '∞' : String(d)) + '</td>';
                tbody.appendChild(tr);
            });
            return;
        }
        if (mode === 'traverse' && snap && snap.visited) {
            col2.textContent = 'Đã thăm DFS';
            vertices.forEach((v) => {
                const tr = document.createElement('tr');
                tr.innerHTML = '<td>' + v.id + '</td><td>' + (snap.visited[v.id] ? 'Có' : 'Không') + '</td>';
                tbody.appendChild(tr);
            });
            return;
        }
        if ((mode === 'scc' || mode === 'kosaraju') && snap && snap.componentOf) {
            col2.textContent = 'Chỉ số TPLTM';
            vertices.forEach((v) => {
                const tr = document.createElement('tr');
                const c = snap.componentOf[v.id];
                tr.innerHTML = '<td>' + v.id + '</td><td>' + (c == null ? '—' : String(c)) + '</td>';
                tbody.appendChild(tr);
            });
            return;
        }
        if (mode === 'orient') {
            col2.textContent = 'Cầu (u—v)';
            const br = (snap && snap.bridges) || [];
            if (!br.length) {
                const tr = document.createElement('tr');
                tr.innerHTML = '<td colspan="2">Không có cầu</td>';
                tbody.appendChild(tr);
            } else {
                br.forEach((b) => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = '<td>' + b[0] + '</td><td>' + b[1] + '</td>';
                    tbody.appendChild(tr);
                });
            }
            return;
        }
        col2.textContent = 'Thông tin';
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="2">Chạy mô phỏng để xem</td>';
        tbody.appendChild(tr);
    }

    function showStep(i) {
        if (!steps.length) return;
        stepIndex = Math.max(0, Math.min(i, steps.length - 1));
        const snap = steps[stepIndex];
        
        currentSnap = snap; 
        updateInfoPanel(snap);

        lastStructureRows = [];
        const mode = $('modeSelect').value;
        const algo = $('algoSelect').value;
        
        for (let si = 0; si <= stepIndex; si++) {
            const s = steps[si];
            if (!s) continue;
            
            if (mode === 'kosaraju' && si > 0) {
                const prevS = steps[si - 1];
                if (prevS.kosPhase === 1 && s.kosPhase === 2) {
                    lastStructureRows.push({
                        isDivider: true,
                        val: '✨ CHUYỂN GIAI ĐOẠN 2: LẬT NGƯỢC ĐỒ THỊ (G^T) ✨'
                    });
                }
            }

            const stepLabel = s.stepNum != null ? String(s.stepNum) : String(si);
            if (mode === 'traverse' && algo === 'bfs' && Array.isArray(s.queue)) {
                lastStructureRows.push({ step: stepLabel, val: '[' + s.queue.join(', ') + ']' });
            } else if (mode === 'traverse' && algo === 'dfs' && Array.isArray(s.stack)) {
                lastStructureRows.push({ step: stepLabel, val: '[' + s.stack.join(', ') + ']' });
            } else if (mode === 'scc' && Array.isArray(s.stack)) {
                lastStructureRows.push({ step: stepLabel, val: '[' + s.stack.join(', ') + ']' });
            } else if (mode === 'kosaraju') {
                const bits = [];
                if (s.kosPhase != null) bits.push('GĐ' + s.kosPhase);
                if (Array.isArray(s.stack) && s.stack.length) bits.push('DFS:[' + s.stack.join(', ') + ']');
                if (Array.isArray(s.finishStack) && s.finishStack.length) bits.push('L:[' + s.finishStack.join(', ') + ']');
                if (Array.isArray(s.remainingFinish) && s.remainingFinish.length) bits.push('L còn:[' + s.remainingFinish.join(', ') + ']');
                if (Array.isArray(s.queue) && s.queue.length) bits.push('BFS:[' + s.queue.join(', ') + ']');
                
                if (s.msg && s.msg.includes('Tiếp theo: G^T')) continue;
                if (s.msg && s.msg.includes('BẮT ĐẦU GIAI ĐOẠN 2')) continue;
                
                const val = bits.length ? bits.join(' | ') : (s.msg || '—');
                if (val && val !== '—') lastStructureRows.push({ step: stepLabel, val: val });
                else if (s.msg) {
                    const short = s.msg.length > 52 ? s.msg.slice(0, 49) + '…' : s.msg;
                    lastStructureRows.push({ step: stepLabel, val: short });
                }
            } else if (mode === 'orient' && s.orientSub === 'bfs') {
                const qstr = Array.isArray(s.queue) ? 'Q:[' + s.queue.join(', ') + ']' : '';
                const hid =
                    s.hiddenEdge && s.hiddenEdge.u != null ? 'bỏ ' + s.hiddenEdge.u + '—' + s.hiddenEdge.v : '';
                const m = s.msg ? (s.msg.length > 40 ? s.msg.slice(0, 37) + '…' : s.msg) : '';
                const val = [qstr, hid, m].filter(Boolean).join(' | ') || '—';
                lastStructureRows.push({ step: stepLabel, val: val });
            } else if (mode === 'orient' && s.msg) {
                const short = s.msg.length > 56 ? s.msg.slice(0, 53) + '…' : s.msg;
                lastStructureRows.push({ step: stepLabel, val: short });
            }
        }
        renderStructureTable(mode, algo);

        let resSnap = snap;
        if (mode === 'traverse' && stepIndex < steps.length - 1) {
            resSnap = steps[steps.length - 1];
        }
        if ((mode === 'scc' || mode === 'kosaraju') && stepIndex < steps.length - 1) {
            resSnap = steps[steps.length - 1];
        }
        renderResultTable(mode, resSnap);
    }

    function clearTimer() {
        if (playTimer) {
            clearInterval(playTimer);
            playTimer = null;
        }
    }

    function buildSimulation() {
        clearTimer();
        applyDirectedFromUI();
        const mode = $('modeSelect').value;
        const algo = $('algoSelect').value;

        if (vertices.length === 0) {
            alert('Thêm ít nhất một đỉnh.');
            return;
        }

        steps = [];
        lastStructureRows = [];
        stepIndex = 0;

        if (mode === 'traverse') {
            $('questLabel').textContent = algo === 'bfs' ? 'Duyệt BFS' : 'Duyệt DFS';
            const start = $('startSelect').value;
            if (!vertexById(start)) {
                alert('Chọn đỉnh bắt đầu hợp lệ.');
                return;
            }
            const built = algo === 'bfs' ? buildBFSTraversal(start) : buildDFSTraversal(start);
            steps = built.steps;
        } else if (mode === 'scc') {
            $('questLabel').textContent = 'Tìm TPLTM (Tarjan — DFS)';
            if (!directed) {
                alert('TPLTM áp dụng cho đồ thị có hướng. Hãy chọn "Có hướng" hoặc dùng chế độ định chiều / duyệt.');
                setStatus('Lỗi cấu hình');
                currentSnap = null;
                return;
            }
            const built = buildTarjanSteps();
            steps = built.steps;
        } else if (mode === 'kosaraju') {
            $('questLabel').textContent = 'Tìm TPLTM (Kosaraju: DFS + BFS trên G^T)';
            if (!directed) {
                alert('TPLTM áp dụng cho đồ thị có hướng. Hãy chọn "Có hướng".');
                setStatus('Lỗi cấu hình');
                currentSnap = null;
                return;
            }
            const built = buildKosarajuSteps();
            steps = built.steps;
        } else if (mode === 'orient') {
            // Đảm bảo đang ở vô hướng cho bài toán "định chiều được hay không"
            directed = false;
            const oa = $('orientAlgoSelect').value;
            $('questLabel').textContent =
                oa === 'bfs' ? 'Định chiều (BFS — thử từng cạnh)' : 'Định chiều (DFS — low)';
            const built = oa === 'bfs' ? buildBridgeStepsBFS() : buildBridgeSteps();
            steps = built.steps;
        }

        setStatus('Đã tạo — sẵn sàng chạy');
        stepIndex = 0;
        showStep(0);
    }

    function play() {
        if (!steps.length) buildSimulation();
        if (!steps.length) return;
        clearTimer();
        const ms = parseInt($('speedInput').value, 10) || 800;
        setStatus('Đang chạy');
        playTimer = setInterval(() => {
            if (stepIndex >= steps.length - 1) {
                clearTimer();
                setStatus('Hoàn tất');
                return;
            }
            stepIndex++;
            showStep(stepIndex);
        }, ms);
    }

    function pause() {
        clearTimer();
        setStatus('Tạm dừng');
    }

    function stepFwd() {
        clearTimer();
        if (!steps.length) buildSimulation();
        if (stepIndex < steps.length - 1) stepIndex++;
        showStep(stepIndex);
        setStatus('Step');
    }

    function resetSim() {
        clearTimer();
        stepIndex = 0;
        if (steps.length) showStep(0);
        else {
            currentSnap = null;
            updateInfoPanel(null);
        }
        setStatus('Ready');
    }

    function checkResult() {
        applyDirectedFromUI();
        const mode = $('modeSelect').value;
        if ((mode === 'scc' || mode === 'kosaraju') && directed) {
            const comps = computeSCCMeta();
            const snap = snapshotBase('Kiểm tra: tô theo TPLTM', '—');
            snap.componentOf = {};
            comps.forEach((c, i) => c.forEach((id) => (snap.componentOf[id] = i)));
            snap.componentCount = comps.length;
            vertices.forEach((v) => (snap.nodeColor[v.id] = 'visited'));
            currentSnap = snap;
            $('infoScc').textContent = String(comps.length);
            renderResultTable(mode, snap);
            setStatus('Đã áp màu TPLTM');
            return;
        }
        if (mode === 'orient') {
            directed = false;
            const res = (function () {
                const wcc = weakComponentCount();
                if ($('orientAlgoSelect').value === 'bfs') {
                    const br = computeBridgesBFS();
                    return { bridges: br, orientable: wcc === 1 && br.length === 0, weakComp: wcc };
                }
                const adj = buildAdj(true);
                let timer = 0;
                const disc = {};
                const low = {};
                const bridges = [];
                function dfs(u, p) {
                    disc[u] = low[u] = ++timer;
                    (adj[u] || []).forEach((v) => {
                        if (disc[v] == null) {
                            dfs(v, u);
                            low[u] = Math.min(low[u], low[v]);
                            if (low[v] > disc[u]) bridges.push([u, v]);
                        } else if (v !== p) {
                            low[u] = Math.min(low[u], disc[v]);
                        }
                    });
                }
                vertices.forEach((v) => {
                    if (disc[v.id] == null) dfs(v.id, null);
                });
                return { bridges, orientable: wcc === 1 && bridges.length === 0, weakComp: wcc };
            })();
            const snap = snapshotBase('', '—');
            snap.bridges = res.bridges;
            snap.orientable = res.orientable;
            vertices.forEach((v) => (snap.nodeColor[v.id] = 'visited'));
            currentSnap = snap;
            $('infoWeak').textContent = String(res.weakComp);
            $('infoOrient').textContent = res.orientable ? 'Có (Robbins)' : 'Không';
            renderResultTable('orient', snap);
            setStatus('Đã kiểm tra cầu / định chiều');
            return;
        }
        buildSimulation();
        if (steps.length) showStep(steps.length - 1);
    }

    // --- ZOOM LOGIC ---
    const canvasWrap = document.querySelector('.canvas-wrap');
    if (canvasWrap) {
        canvasWrap.style.position = 'relative';
        const zoomContainer = document.createElement('div');
        zoomContainer.style.position = 'absolute';
        zoomContainer.style.bottom = '15px';
        zoomContainer.style.right = '15px';
        zoomContainer.style.display = 'flex';
        zoomContainer.style.flexDirection = 'column';
        zoomContainer.style.gap = '8px';

        const btnZoomIn = document.createElement('button');
        btnZoomIn.className = 'btn';
        btnZoomIn.innerHTML = '➕';
        btnZoomIn.style.padding = '6px 12px';
        btnZoomIn.title = 'Phóng to';
        btnZoomIn.onclick = () => { zoomLevel = Math.min(zoomLevel * 1.2, 3.0); };

        const btnZoomOut = document.createElement('button');
        btnZoomOut.className = 'btn';
        btnZoomOut.innerHTML = '➖';
        btnZoomOut.style.padding = '6px 12px';
        btnZoomOut.title = 'Thu nhỏ';
        btnZoomOut.onclick = () => { zoomLevel = Math.max(zoomLevel / 1.2, 0.3); };

        zoomContainer.appendChild(btnZoomIn);
        zoomContainer.appendChild(btnZoomOut);
        canvasWrap.appendChild(zoomContainer);
    }

    canvas.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        if (ev.deltaY < 0) {
            zoomLevel = Math.min(zoomLevel * 1.1, 3.0);
        } else {
            zoomLevel = Math.max(zoomLevel / 1.1, 0.3);
        }
    });

    function canvasPos(ev) {
        const r = canvas.getBoundingClientRect();
        const scaleX = canvas.width / r.width;
        const scaleY = canvas.height / r.height;
        
        const lx = (ev.clientX - r.left) * scaleX;
        const ly = (ev.clientY - r.top) * scaleY;
        
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        
        return {
            x: (lx - cx) / zoomLevel + cx,
            y: (ly - cy) / zoomLevel + cy,
        };
    }

    function hitVertex(mx, my) {
        for (let i = vertices.length - 1; i >= 0; i--) {
            const v = vertices[i];
            const p = getWobblePos(v); 
            if (Math.hypot(mx - p.x, my - p.y) <= 20) return v.id;
        }
        return null;
    }

    canvas.addEventListener('mousedown', (ev) => {
        const { x, y } = canvasPos(ev);
        dragId = hitVertex(x, y);
    });
    canvas.addEventListener('mousemove', (ev) => {
        if (!dragId) return;
        const { x, y } = canvasPos(ev);
        const v = vertexById(dragId);
        if (v) {
            v.x = Math.max(22, Math.min(canvas.width - 22, x));
            v.y = Math.max(22, Math.min(canvas.height - 22, y));
        }
    });
    window.addEventListener('mouseup', () => {
        dragId = null;
    });

    $('btnAddVertex').addEventListener('click', () => {
        const id = normId($('addVertexInput').value);
        if (!id) return;
        if (vertexById(id)) {
            alert('Đỉnh đã tồn tại.');
            return;
        }
        vertices.push({
            id,
            x: 80 + Math.random() * (canvas.width - 160),
            y: 80 + Math.random() * (canvas.height - 160),
        });
        fillSelects();
        steps = [];
        currentSnap = null;
        $('infoWeak').textContent = String(weakComponentCount());
        $('addVertexInput').value = ''; 
    });

    $('btnDelVertex').addEventListener('click', () => {
        const id = normId($('delVertexInput').value);
        if (!id) return;
        vertices = vertices.filter((v) => v.id !== id);
        edges = edges.filter((e) => e.u !== id && e.v !== id);
        fillSelects();
        steps = [];
        currentSnap = null;
        $('infoWeak').textContent = String(weakComponentCount());
        $('delVertexInput').value = '';
    });

    $('btnAddEdge').addEventListener('click', () => {
        let u = normId($('edgeU').value);
        let v = normId($('edgeV').value);
        if (!u || !v) return;
        if (!vertexById(u) || !vertexById(v)) {
            alert('Đỉnh u, v phải tồn tại.');
            return;
        }
        applyDirectedFromUI();
        if (!directed) {
            const [a, b] = canonicalUndirected(u, v);
            u = a;
            v = b;
        }
        const exists = directed
            ? edges.some((e) => e.u === u && e.v === v)
            : edges.some((e) => {
                  const [x, y] = canonicalUndirected(e.u, e.v);
                  return x === u && y === v;
              });
        if (exists) {
            alert('Cạnh đã có.');
            return;
        }
        edges.push({ u, v });
        steps = [];
        currentSnap = null;
        $('infoWeak').textContent = String(weakComponentCount());
        $('edgeU').value = '';
        $('edgeV').value = '';
        $('edgeU').focus();
    });

    $('btnDelEdge').addEventListener('click', () => {
        let u = normId($('edgeU').value);
        let v = normId($('edgeV').value);
        applyDirectedFromUI();
        if (!directed) {
            const [a, b] = canonicalUndirected(u, v);
            edges = edges.filter((e) => {
                const [x, y] = canonicalUndirected(e.u, e.v);
                return !(x === a && y === b);
            });
        } else {
            edges = edges.filter((e) => !(e.u === u && e.v === v));
        }
        steps = [];
        currentSnap = null;
        $('infoWeak').textContent = String(weakComponentCount());
        $('edgeU').value = '';
        $('edgeV').value = '';
    });

    $('btnLayout').addEventListener('click', () => {
        defaultLayout();
    });

    $('btnUpdateWeak').addEventListener('click', () => {
        $('infoWeak').textContent = String(weakComponentCount());
        applyDirectedFromUI();
        $('infoScc').textContent = directed ? String(computeSCCMeta().length) : String(weakComponentCount());
    });

    $('btnBuildSim').addEventListener('click', () => buildSimulation());
    $('btnPlay').addEventListener('click', () => play());
    $('btnPause').addEventListener('click', () => pause());
    $('btnStep').addEventListener('click', () => stepFwd());
    $('btnReset').addEventListener('click', () => resetSim());
    $('btnCheck').addEventListener('click', () => checkResult());

    function syncOrientAlgoField() {
        const el = $('orientAlgoField');
        if (!el) return;
        const show = $('modeSelect').value === 'orient';
        el.classList.toggle('is-orient-only-hidden', !show);
    }

    function syncAlgoTraversePanel() {
        const m = $('modeSelect').value;
        const wrap = $('algoTraverseWrap');
        const tarjanHint = $('algoTarjanHint');
        const kosHint = $('algoKosarajuHint');
        const orientHint = $('algoOrientHint');
        const orientRead = $('algoOrientReadonly');
        if (!wrap || !tarjanHint || !kosHint) return;
        const showSelect = m === 'traverse';
        wrap.classList.toggle('algo-mode-panel-hidden', !showSelect);
        tarjanHint.classList.toggle('algo-mode-panel-hidden', m !== 'scc');
        kosHint.classList.toggle('algo-mode-panel-hidden', m !== 'kosaraju');
        if (orientHint) {
            orientHint.classList.toggle('algo-mode-panel-hidden', m !== 'orient');
        }
        if (orientRead && m === 'orient') {
            orientRead.textContent =
                $('orientAlgoSelect').value === 'bfs'
                    ? 'BFS (hàng đợi — thử từng cạnh, kiểm tra liên thông)'
                    : 'DFS (đệ quy / stack — thời gian thăm & low)';
        }
        if (m === 'scc') {
            $('algoSelect').value = 'dfs';
        }
        renderStructureTable(m, $('algoSelect').value);
    }

    $('modeSelect').addEventListener('change', () => {
        const m = $('modeSelect').value;
        $('algoSelect').disabled = m !== 'traverse';

        // Chế độ "định chiều": chỉ áp dụng cho đồ thị vô hướng, nên khóa lựa chọn có hướng.
        const ds = $('directedSelect');
        if (ds) {
            if (m === 'orient') {
                ds.value = 'undirected';
                ds.disabled = true;
            } else {
                ds.disabled = false;
            }
        }
        applyDirectedFromUI();

        syncOrientAlgoField();
        syncAlgoTraversePanel();
        if (m === 'scc') $('questLabel').textContent = 'TPLTM (DFS Tarjan)';
        if (m === 'kosaraju') $('questLabel').textContent = 'TPLTM (Kosaraju)';
        if (m === 'orient') {
            $('questLabel').textContent =
                $('orientAlgoSelect').value === 'bfs' ? 'Định chiều (BFS — thử cạnh)' : 'Định chiều (DFS — low)';
        }
        if (m === 'traverse') $('questLabel').textContent = 'Duyệt đồ thị';
    });

    $('orientAlgoSelect').addEventListener('change', () => {
        if ($('modeSelect').value === 'orient') {
            $('questLabel').textContent =
                $('orientAlgoSelect').value === 'bfs' ? 'Định chiều (BFS — thử cạnh)' : 'Định chiều (DFS — low)';
            syncAlgoTraversePanel();
        }
    });

    $('directedSelect').addEventListener('change', () => {
        applyDirectedFromUI();
    });

    $('addVertexInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            $('btnAddVertex').click();
        }
    });

    $('delVertexInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            $('btnDelVertex').click();
        }
    });

    $('edgeU').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'ArrowRight') {
            e.preventDefault();
            $('edgeV').focus(); 
        }
    });

    $('edgeV').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            $('btnAddEdge').click(); 
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            $('edgeU').focus(); 
        }
    });

    function init() {
        seedDemo();
        fillSelects();
        syncOrientAlgoField();
        syncAlgoTraversePanel();
        $('algoSelect').disabled = $('modeSelect').value !== 'traverse';
        $('infoWeak').textContent = String(weakComponentCount());
        $('infoScc').textContent = String(computeSCCMeta().length);
        currentSnap = null;
        updateInfoPanel(null);
        renderStructureTable('traverse', 'bfs');
        renderResultTable('traverse', null);
        
        requestAnimationFrame(function loop() {
            drawGraph(currentSnap);
            requestAnimationFrame(loop);
        });
    }

    init();
})();