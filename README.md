# uknode

本地节点与连线编辑器。本轮支持节点创建、删除、移动，连线创建、删除、方向与说明编辑，以及 SQLite 自动增量保存和会话撤销重做。节点以短 ID 显示，没有名称、笔记等业务字段。页面使用原生控件与 React Flow 默认样式。

## 运行

需要 Node.js 24。在项目根目录运行：

```sh
npm ci
npm run dev
```

打开 http://127.0.0.1:5173 。同一命令启动 Vite 和本地 Fastify 服务，前端的 `/api` 请求代理到服务端。

正式本地运行：

```sh
npm run build
npm start
```

打开 http://127.0.0.1:3000 。Fastify 通过官方插件 `@fastify/static` 提供构建后的 HTML、JavaScript 和 CSS，页面与 API 同源。服务仅监听本机，不把 SQLite 文件交给浏览器读取。

数据库默认位于 `data/uknode.sqlite`，首次启动自动创建目录和数据库并执行迁移。可用 `UKNODE_DATA_DIR` 指定其他目录，`PORT` 修改后端端口。数据库、依赖和构建产物不提交 Git。请始终从项目根目录运行命令。

## 数据库定义与同步

**表结构的定义来源是 [`src/backend/schema.ts`](src/backend/schema.ts)**。里面明确声明表名、字段、主键、外键、索引和检查约束：

| 定义 | SQLite 表 | 职责 |
| --- | --- | --- |
| `baseNodes` | `base_nodes` | 节点 ID、创建与更新时间；没有业务字段 |
| `baseEdges` | `base_edges` | 两端节点 ID、方向、可选说明及时间 |
| `viewNodeLayouts` | `view_node_layouts` | 本轮单一画布的节点坐标 |
| `baseStoreState` | `base_store_state` | 当前修订号 |
| `baseBatchReceipts` | `base_batch_receipts` | 最近 1,000 个批次的幂等回执；没有操作内容 |

`base_schema_migrations` 由 Drizzle 管理，用于记录已执行的迁移；名称在 `drizzle.config.ts` 和服务启动配置中一致指定。

修改表结构的流程：

1. 修改 `src/backend/schema.ts`。
2. 运行 `npm run db:generate -- --name=变更名称`，由 Drizzle Kit 生成 `migrations/` 下的 SQL 与结构快照。
3. 查看生成的 SQL。变更已有数据前，先备份当前数据库。
4. 运行 `npm run db:migrate`，将迁移应用到 SQLite；启动服务也会应用尚未执行的迁移。
5. 将表定义和迁移文件一起提交。不要只改数据库而遗漏代码定义。

本轮初始迁移为 `migrations/0000_initial.sql`。启动服务不会按运行时对象猜测字段，也不会清空重建数据库。修改 schema.ts 后必须先生成迁移，才能把结构变化应用到数据库。已有数据上的破坏性结构变更仍需单独确认。

## 操作与保存

- 点击“新建节点”；拖动节点调整坐标。
- 从节点右侧连接点拖到另一节点左侧连接点创建连线。
- 点击连线，在右侧编辑可选说明和方向。普通连线允许成环、自连接和同端点多条边。
- 选中节点或连线，点击“删除选中”；删除节点会同时删除关联连线和坐标。
- 使用“撤销”“重做”或 Ctrl/⌘ Z、Ctrl/⌘ Shift Z。输入框内仍使用浏览器原生文字撤销。
- 拖动空白处平移，使用滚轮或画布控件缩放。

编辑先更新前端内存，并按对象合并待保存变更。拖动结束提交坐标；连线文字停止输入 500 毫秒后提交，失焦时立即提交。批次逐一发送到后端，事务内检查修订号并增量写入当前表。

发送中的批次固定 ID 和内容；期间的新修改进入下一批。响应丢失时重试相同批次，服务端先查幂等回执，避免重复执行。只在收到对应回执后显示已保存。失败时保留修改；修订冲突停止写入，不自动覆盖其他页面的数据。“重新读取”需要确认放弃本页尚未确认的修改。

前端最多保留当前会话 100 个撤销动作。没有永久历史或 IndexedDB 草稿恢复；异常关闭可能丢失尚未确认的修改。刷新会清空会话撤销记录。

## 代码位置与验证

- `src/frontend/`：页面、图数据状态、变更队列和会话撤销。
- `src/backend/`：本地服务、接口、Drizzle 表定义和 SQLite 事务。
- `src/shared/`：独立的节点、连线、坐标类型，以及增量提交协议。
- `migrations/`：Drizzle Kit 生成的结构迁移。
- `tests/`：真实 SQLite/Fastify 测试，以及通过 Axios 适配器验证保存队列。

```sh
npm test
npm run build
```

`npm run build` 包含前后端 TypeScript 检查。本轮范围见 `design.md` 的 1.3 节；其他产品目标留待逐轮确认。
