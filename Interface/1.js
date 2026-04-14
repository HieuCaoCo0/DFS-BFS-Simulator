const fs = require("fs");

// Đọc input (Node.js)
const input = fs.readFileSync(0, "utf-8").trim().split(/\s+/).map(Number);

let idx = 0;
const n = input[idx++], m = input[idx++];

// Danh sách kề
const a = Array.from({ length: n + 1 }, () => []);
const b = Array.from({ length: n + 1 }, () => []);

// Nhập cạnh
for (let i = 0; i < m; i++) {
    const u = input[idx++], k = input[idx++];
    a[u].push(k);   // đồ thị gốc
    b[k].push(u);   // đồ thị đảo
}

// BFS
function bfs(s, g, visited) {
    const q = [];
    q.push(s);
    visited[s] = true;

    while (q.length > 0) {
        const u = q.shift(); // lấy phần tử đầu

        for (const x of g[u]) {
            if (!visited[x]) {
                visited[x] = true;
                q.push(x);
            }
        }
    }
}

// Solve
function solve() {
    let visited = new Array(n + 1).fill(false);

    // BFS đồ thị gốc
    bfs(1, a, visited);
    for (let i = 1; i <= n; i++) {
        if (!visited[i]) {
            console.log("NO");
            return;
        }
    }

    // BFS đồ thị đảo
    visited.fill(false);
    bfs(1, b, visited);
    for (let i = 1; i <= n; i++) {
        if (!visited[i]) {
            console.log("NO");
            return;
        }
    }

    console.log("YES");
}

solve();