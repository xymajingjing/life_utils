# life_utils

个人生活工具集合（本地优先、零构建、无账号）。

> 部署验证：token 认证 + 推送链路已通（2026-09-08）

## 工具

| 工具 | 路径 | 说明 |
|------|------|------|
| 健身记录 (well-kit) | [well-kit/](well-kit/) | 训练/饮食/体重记录与卡路里收支管理 |

## 在线访问

- 健身记录：https://xymajingjing.github.io/life_utils/well-kit/

## 特点

- **零构建单页**：纯 HTML+CSS+原生 JS，无框架、无依赖，双击即用。
- **本地优先**：所有数据存浏览器 localStorage，不上传、无账号。
- **数据可迁移**：应用内支持导出/导入 JSON，换设备/浏览器时可迁移。

## 本地运行

任选其一：
1. 直接双击 `well-kit/index.html` 用浏览器打开。
2. 起本地静态服务：`node -e "require('http').createServer((q,s)=>{const f=require('fs'),p=require('path');const r=p.join(__dirname,'well-kit',decodeURIComponent(q.url).split('?')[0].replace('/',''));f.readFile(r,(e,d)=>{if(e){s.writeHead(404);s.end('404')}else{s.writeHead(200,{'Content-Type':{''.html':'text/html','.css':'text/css','.js':'text/javascript'}[p.extname(r)]||'application/octet-stream'});s.end(d)}})}).listen(8791)"`

## 目录结构

```
life_utils/
└── well-kit/          # 健身记录应用
    ├── index.html
    ├── styles.css
    ├── data.js        # 动作库(含MET) + 食物库(300条)
    ├── core.js        # 纯逻辑：MET/BMR/宏量/单位换算/报表聚合
    └── app.js         # 视图/路由/持久化
```
