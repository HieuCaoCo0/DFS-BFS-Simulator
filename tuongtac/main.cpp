#include <iostream>
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <stack>
#include <queue>
#include <string>
#include <algorithm>
#include "httplib.h"

using namespace std;

class Graph
{
private:
    unordered_set<int> vertices;
    unordered_map<int, vector<int>> adj;     
    unordered_map<int, vector<int>> rev_adj; 

    struct Edge { int u, v; };
    vector<Edge> undirected_edges;
    unordered_map<int, vector<int>> undir_adj;

    void rebuildUndirected()
    {
        undirected_edges.clear();
        undir_adj.clear();
        for (int u : vertices)
        {
            for (int v : adj[u])
            {
                undirected_edges.push_back({u, v});
                undir_adj[u].push_back(v);
                undir_adj[v].push_back(u);
            }
        }
    }

public:
    void clear()
    {
        vertices.clear();
        adj.clear();
        rev_adj.clear();
        rebuildUndirected();
    }
    
    int getFirstVertex() {
        return vertices.empty() ? -1 : *vertices.begin();
    }

    void addVertex(int v) { vertices.insert(v); }

    void addEdge(int u, int v)
    {
        vertices.insert(u);
        vertices.insert(v);
        if (find(adj[u].begin(), adj[u].end(), v) == adj[u].end())
        {
            adj[u].push_back(v);
            rev_adj[v].push_back(u);
            rebuildUndirected();
        }
    }

    void removeEdge(int u, int v)
    {
        adj[u].erase(remove(adj[u].begin(), adj[u].end(), v), adj[u].end());
        rev_adj[v].erase(remove(rev_adj[v].begin(), rev_adj[v].end(), u), rev_adj[v].end());
        rebuildUndirected();
    }

    void removeVertex(int v)
    {
        if (vertices.erase(v))
        {
            adj.erase(v);
            rev_adj.erase(v);

            for (auto &pair : adj)
            {
                pair.second.erase(remove(pair.second.begin(), pair.second.end(), v), pair.second.end());
            }
            for (auto &pair : rev_adj)
            {
                pair.second.erase(remove(pair.second.begin(), pair.second.end(), v), pair.second.end());
            }
            rebuildUndirected();
        }
    }

    void dfs(int v, unordered_map<int, vector<int>> &graphList, unordered_map<int, bool> &visited, int ignore_u = -1, int ignore_v = -1)
    {
        visited[v] = true;
        for (int neighbor : graphList[v])
        {
            if ((v == ignore_u && neighbor == ignore_v) || (v == ignore_v && neighbor == ignore_u))
                continue;
            if (!visited[neighbor])
                dfs(neighbor, graphList, visited, ignore_u, ignore_v);
        }
    }

    void bfs(int start, unordered_map<int, vector<int>> &graphList, unordered_map<int, bool> &visited, int ignore_u = -1, int ignore_v = -1)
    {
        queue<int> q;
        q.push(start);
        visited[start] = true;
        while (!q.empty())
        {
            int v = q.front();
            q.pop();
            for (int neighbor : graphList[v])
            {
                if ((v == ignore_u && neighbor == ignore_v) || (v == ignore_v && neighbor == ignore_u))
                    continue;
                if (!visited[neighbor])
                {
                    visited[neighbor] = true;
                    q.push(neighbor);
                }
            }
        }
    }

    bool isConnected(string method, int startNode, unordered_map<int, vector<int>> &graphList, int ignore_u = -1, int ignore_v = -1)
    {
        if (vertices.empty()) return true;
        unordered_map<int, bool> visited;
        for (int v : vertices) visited[v] = false;

        if (method == "DFS") dfs(startNode, graphList, visited, ignore_u, ignore_v);
        else bfs(startNode, graphList, visited, ignore_u, ignore_v);

        for (int v : vertices)
            if (!visited[v]) return false;
        return true;
    }

    string checkSCC(string method, int startNode)
    {
        if (vertices.empty()) return "[-] LỖI: Đồ thị trống!";
        if (startNode == -1 || vertices.find(startNode) == vertices.end())
            return "[-] LỖI: Đỉnh bắt đầu không hợp lệ!";

        string log = "=== KIỂM TRA LIÊN THÔNG MẠNH (" + method + " từ đỉnh " + to_string(startNode) + ") ===\n";

        if (!isConnected(method, startNode, adj))
            return log + "[-] KẾT QUẢ: KHÔNG liên thông mạnh.\nLý do: Không thể đi tới tất cả các đỉnh bằng " + method + " (chiều đi).";
        if (!isConnected(method, startNode, rev_adj))
            return log + "[-] KẾT QUẢ: KHÔNG liên thông mạnh.\nLý do: Không thể đi ngược từ tất cả các đỉnh về điểm xuất phát bằng " + method + " (chiều ngược).";

        return log + "[+] KẾT QUẢ: ĐỒ THỊ LIÊN THÔNG MẠNH.\nLý do: " + method + " chiều đi và chiều ngược đều duyệt hết toàn bộ đồ thị.";
    }

    string checkOrientable(string method, int startNode)
    {
        if (vertices.empty()) return "[-] LỖI: Đồ thị trống!";
        if (startNode == -1 || vertices.find(startNode) == vertices.end())
            return "[-] LỖI: Đỉnh bắt đầu không hợp lệ!";

        string log = "=== KIỂM TRA ĐỊNH CHIỀU ĐƯỢC (" + method + " từ đỉnh " + to_string(startNode) + ") ===\n";
        rebuildUndirected();

        if (!isConnected(method, startNode, undir_adj))
            return log + "[-] KẾT QUẢ: KHÔNG ĐỊNH CHIỀU ĐƯỢC.\nLý do: Bản thân đồ thị (khi coi là vô hướng) không liên thông.";

        int bridge_count = 0;
        vector<string> bridges;
        for (auto edge : undirected_edges)
        {
            if (!isConnected(method, startNode, undir_adj, edge.u, edge.v))
            {
                bridge_count++;
                bridges.push_back(to_string(edge.u) + " - " + to_string(edge.v));
            }
        }

        if (bridge_count > 0)
        {
            log += "[-] KẾT QUẢ: KHÔNG ĐỊNH CHIỀU ĐƯỢC.\nLý do: Phát hiện " + to_string(bridge_count) + " cạnh CẦU:\n";
            for (string b : bridges) log += "  -> " + b + "\n";
            return log;
        }

        return log + "[+] KẾT QUẢ: ĐỒ THỊ ĐỊNH CHIỀU ĐƯỢC.\nLý do: Đồ thị liên thông và hoàn toàn KHÔNG có cạnh cầu.";
    }
};

int main()
{
    httplib::Server svr;
    Graph g;

    svr.Get("/add-edge", [&](const httplib::Request &req, httplib::Response &res) {
        if (req.has_param("u") && req.has_param("v")) {
            g.addEdge(stoi(req.get_param_value("u")), stoi(req.get_param_value("v")));
            res.set_header("Access-Control-Allow-Origin", "*");
            res.set_content("OK", "text/plain");
        } 
    });

    svr.Get("/remove-edge", [&](const httplib::Request &req, httplib::Response &res) {
        if (req.has_param("u") && req.has_param("v")) {
            g.removeEdge(stoi(req.get_param_value("u")), stoi(req.get_param_value("v")));
            res.set_header("Access-Control-Allow-Origin", "*");
            res.set_content("OK", "text/plain");
        } 
    });

    svr.Get("/remove-vertex", [&](const httplib::Request &req, httplib::Response &res) {
        if (req.has_param("u")) {
            g.removeVertex(stoi(req.get_param_value("u")));
            res.set_header("Access-Control-Allow-Origin", "*");
            res.set_content("OK", "text/plain");
        } 
    });

    // API MỚI: Phục vụ khôi phục đỉnh bị xóa bằng Ctrl + Z
    svr.Get("/add-vertex", [&](const httplib::Request &req, httplib::Response &res) {
        if (req.has_param("u")) {
            g.addVertex(stoi(req.get_param_value("u")));
            res.set_header("Access-Control-Allow-Origin", "*");
            res.set_content("OK", "text/plain");
        } 
    });

    svr.Get("/check-scc", [&](const httplib::Request &req, httplib::Response &res) {
        string method = req.has_param("method") ? req.get_param_value("method") : "DFS";
        int startNode = req.has_param("start") ? stoi(req.get_param_value("start")) : g.getFirstVertex();
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content(g.checkSCC(method, startNode), "text/plain"); 
    });

    svr.Get("/check-orientable", [&](const httplib::Request &req, httplib::Response &res) {
        string method = req.has_param("method") ? req.get_param_value("method") : "DFS";
        int startNode = req.has_param("start") ? stoi(req.get_param_value("start")) : g.getFirstVertex();
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content(g.checkOrientable(method, startNode), "text/plain"); 
    });

    svr.Get("/reset", [&](const httplib::Request &req, httplib::Response &res) {
        g.clear();
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content("OK", "text/plain"); 
    });

    cout << "Server C++ (Ho tro DFS/BFS & Undo) dang chay tai: http://localhost:8080\n";
    svr.listen("localhost", 8080);
    return 0;
}
