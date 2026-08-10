# 知识库系统 UI & 数据模型优化

**日期**: 2026-08-03  
**状态**: 设计完成，待实施

---

## 背景

知识库层级文件夹系统上线后自测发现 4 个问题：
1. 知识库卡片布局：名称偏下、顶部空白
2. 文档必须选文件夹才能归属知识库，无法直接放在知识库下
3. 文档上传/管理页知识库选择为可选，应设为必选
4. 文档编辑弹窗中部门字段为手填 ID，应改为下拉选择器

---

## 一、数据模型变更

### 1.1 Document 实体新增 `kb_id`

||字段|类型|说明|
|------|------|------|
|新增|`kb_id`|uuid, nullable, FK → knowledge_bases.id, ON DELETE SET NULL|文档直接所属知识库|
|保留|`folder_id`|uuid, nullable, FK → folders.id, ON DELETE SET NULL|文档所属文件夹|

**关联规则：**
- 文档放在文件夹下：`kb_id` = 文件夹的 `kb_id`（服务端自动同步），`folder_id` = 文件夹 ID
- 文档直接放在知识库下：`kb_id` = 知识库 ID，`folder_id` = null
- 旧数据兼容：`kb_id` 为 null，`folder_id` 不为 null 时通过文件夹反查 KB
- 两者都为空：未归类文档（旧数据或手动清除）

### 1.2 后端 service 变更

**DocumentService：**
- `uploadStage1()`：新增 `kbId?: string` 参数；若传了 `folderId`，从文件夹读取 `kb_id` 覆盖；否则直接用传入的 `kbId`
- `list()`：`kb_id` 筛选直接走 `doc.kb_id` 索引（替代之前的"先查文件夹 ID 再 IN"方式）；`folder_id` 筛选保持不变
- `updateDocument()`：新增 `kb_id` 处理；若同时传 `folder_id` 则取文件夹的 `kb_id`

**KnowledgeBaseService：**
- `list()` 中 `docCount` 改为直接按 `kb_id` 计数（不再遍历文件夹）

---

## 二、新增 API

### 2.1 `GET /departments?keyword=`

||项目|说明|
|------|------|------|
|路由|`GET /departments`||
|Query|`keyword` (可选)|按名称 ILIKE 模糊搜索|
|返回|`{ id, name }[]`|按 name ASC 排序|

可直接放在 User 模块或新建独立 controller。

---

## 三、前端改动

### 3.1 知识库列表页 `KnowledgeBaseListPage`

- 知识库名称从 `Card.Meta title` 移到 `Card title`（显示在卡片顶部左侧）
- 三点操作图标仍在卡片右侧

### 3.2 文档上传页 `DocumentUploadPage`

- 知识库 Select：去掉 `allowClear`，改为必选
- 文件夹 TreeSelect：保持可选（disabled 逻辑不变）

### 3.3 文档管理页 `DocumentManagePage`

- 知识库 Select：默认不选（展示全部文档），保留 `allowClear`
- 文件夹 TreeSelect：保持可选

### 3.4 文档编辑弹窗 `DocumentEditModal`

- `dept_id` 字段：从 `<Input>` 改为 `<Select>` 下拉框
- 加载 `/departments` 接口，支持 `showSearch` + `filterOption` 本地过滤
- 新增 `kb_id` 的 TreeSelect（选知识库后出文件夹树）

### 3.5 文件夹浏览页 `FolderBrowsePage`

- `loadDocuments` 查询条件改为直接用 `kb_id`（不再 fallback 查文件夹 ID 集合）
- "根目录"概念：未选文件夹时展示 `kb_id = 当前KB` 且 `folder_id IS NULL` 的文档

---

## 四、实施范围

|序号|改动|类型|
|----|------|------|
|1|Document 实体新增 `kb_id` 列|后端|
|2|DocumentService 适配 `kb_id`|后端|
|3|KnowledgeBaseService `list()` docCount 改用 `kb_id`|后端|
|4|新增 `GET /departments` 接口（含 keyword）|后端|
|5|注册 Department 实体到模块|后端|
|6|知识库列表页卡片布局调整|前端|
|7|文档上传页 KB 必选|前端|
|8|文档编辑弹窗部门下拉 + KB 选择|前端|
|9|文件夹浏览页适配 `kb_id`|前端|

---

## 五、不涉及

- 部门 CRUD 管理（已有 departments 表，不做增删改页面）
- 知识库权限体系变更
- 文件夹移动文档功能（后续迭代）
