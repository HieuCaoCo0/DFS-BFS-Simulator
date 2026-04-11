#include <bits/stdc++.h>
using namespace std;
int n,m;
vector<int> a[100005],b[100005];
bool v[100005];
void bfs(int s,vector<int> g[]){
    queue<int> q;
    q.push(s);
    v[s]=true;
    while(!q.empty()){
        int u=q.front();
        q.pop();
        for(int x:g[u]){
            if(!v[x]){
                v[x]=true;
                q.push(x);
            }
        }
    }
}
void solve(){
    cin>>n>>m;
    for(int i=0;i<m;i++){
        int u,k;
        cin>>u>>k;
        a[u].push_back(k);
        b[k].push_back(u);
    }
    memset(v,false,sizeof(v));
    bfs(1,a);
    for(int i=1;i<=n;i++){
        if(!v[i]){
            cout<<"NO";
            return;
        }
    }
    memset(v,false,sizeof(v));
    bfs(1,b);
    for(int i=1;i<=n;i++){
        if(!v[i]){
            cout<<"NO";
            return;
        }
    }
    cout<<"YES";
}
int main(){
    solve();
}
