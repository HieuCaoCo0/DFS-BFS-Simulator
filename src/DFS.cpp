#include <bits/stdc++.h>

using namespace std;

vector<int> adj[1005] , t_adj[1005];
bool visited[1005];
stack<int> st;
int n, m;
int dem = 0;
void nhap(){

    cin >> n >> m;
    for(int i = 0; i < m;i++){
        int x, y; cin >> x >> y;
        adj[x].push_back(y);
        t_adj[y].push_back(x);
    }
    memset(visited, false, sizeof(visited));

}
void dfs1(int u){
    visited[u] = true;
    for(int v : adj[u]){
        if(!visited[v])
        dfs1(v);
    }
    st.push(u);
}
void dfs2(int u){
    visited[u] = true;
    for(int v : t_adj[u]){
        if(!visited[v])
        dfs2(v);
    }

}
void kosaraju(){
    for(int i = 1; i <= n; i++){
        if(!visited[i]) dfs1(i);
    }
    memset(visited, false, sizeof(visited));
    int scc = 0;
    while(!st.empty()){
        int u = st.top(); st.pop();
        if(!visited[u]){
            dfs2(u);
            ++dem;
        }
    }
    if(dem == 1) cout << 1 << endl;
    else cout << 0 << endl;
}

int main(){
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

    nhap();
    kosaraju();



    return 0;
}
