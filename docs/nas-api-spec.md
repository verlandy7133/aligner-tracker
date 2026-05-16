# NAS API Server 升級規格

**版本**：v0.6.0（規劃中）
**寫於**：2026-05-16
**前置**：當前 Stage B v0.5.6 為 read-only viewer（`server/index.js` 5 endpoints）
**目標**：升級成讀寫 API + SQLite，讓 D 機 / 筆電 / iPad 多機同時編輯不撞、即時可見
**範圍**：Phase 1（雙寫）+ Phase 2（純 API）兩階段

---

## 0. 名詞 & 標記

- **`[REUSABLE]`** — 此區段內容未來其他 App 可直接複用（infra / framework）
- **`[DOMAIN]`** — 此區段為矯正追蹤專屬（schema / 業務邏輯）
- **「server」** = Stage B Docker container（NAS 上跑）
- **「client」** = Web App（D 機 / 筆電 / iPad Safari）

---

## 1. 系統架構

```
                            [NAS - Synology DS918+]
                          ┌──────────────────────┐
                          │  aligner-viewer 容器  │
                          │  Express + SQLite    │
                          │  + SSE               │
                          │  /data (NAS folder)  │
                          │   ├─ db.sqlite       │  ← 真相
                          │   ├─ 病患資料夾/...   │  ← 照片
                          │   └─ backup/*.json   │  ← 每日備份
                          └──────────┬───────────┘
                                     │ HTTP/SSE
                ┌────────────────────┼────────────────────┐
                │                    │                    │
              [D 機]              [筆電]               [iPad]
            PWA in Chrome       PWA in Chrome        Safari (read-only)
            IndexedDB cache     IndexedDB cache      no cache
```

### 資料流（寫操作）
```
client: 改 patient
   ↓
DataLayer.updatePatient()
   ↓
   ├─→ IndexedDB (本機快取、樂觀寫入)
   └─→ POST /api/patients/:id
         ↓
       SQLite UPDATE
         ↓
       SSE broadcast → 其他 client
         ↓
       其他 client DataLayer.applyRemote()
         ↓
       其他 client IndexedDB UPDATE
```

### 資料流（讀操作 / 啟動）
```
client 啟動
   ↓
GET /api/snapshot?since=<last_seen_ts>
   ↓
server 回增量（或全量）
   ↓
client IndexedDB bulkPut
   ↓
GET /events (SSE 持久連線、聽即時變更)
```

---

## 2. SQLite Schema `[DOMAIN]`

**檔位置**：`/data/db.sqlite`（容器內 `/data` 對應 NAS `n歐耐恩n/0矯正追蹤/`）

### 2.1 `patients`

對照當前 Dexie v9 schema（[`src/db.ts:139`](../src/db.ts) + [`src/types/Patient.ts:94`](../src/types/Patient.ts)）。

```sql
CREATE TABLE patients (
  id                       TEXT PRIMARY KEY,
  chart_no                 TEXT NOT NULL,
  name                     TEXT NOT NULL,
  birthday                 TEXT,                  -- ISO date 或 null
  product_line             TEXT NOT NULL,         -- 'invisalign' | 'riyue' | 'zenyum' | 'retainer'
  status                   TEXT NOT NULL,         -- 'active' | 'paused' | 'completed' | 'transferred-out'
  track                    TEXT,                  -- 'new-design' | 'old-design' | null
  refinement_level         INTEGER NOT NULL DEFAULT 0,
  order_date               TEXT,
  start_date               TEXT,
  total_aligners_upper     INTEGER,
  current_aligner_upper    INTEGER,
  total_aligners_lower     INTEGER,
  current_aligner_lower    INTEGER,
  cycle_days               INTEGER NOT NULL DEFAULT 14,
  last_visit               TEXT,
  next_visit               TEXT,
  has_consent              INTEGER NOT NULL DEFAULT 0,
  consent_pdf_path         TEXT,
  scan_info                TEXT,
  doctor                   TEXT,
  auu_id                   TEXT,
  flags                    TEXT NOT NULL DEFAULT '[]',  -- JSON array
  notes                    TEXT NOT NULL DEFAULT '',
  source_folder            TEXT NOT NULL DEFAULT '',     -- relative to dataRoot
  all_source_folders       TEXT NOT NULL DEFAULT '[]',   -- JSON array of relatives
  markdown_note            TEXT NOT NULL DEFAULT '',
  photos                   TEXT NOT NULL DEFAULT '{}',   -- JSON: Partial<Record<PhotoSlot, PhotoMeta>>

  -- 共通欄位
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  created_by               TEXT NOT NULL DEFAULT 'system',   -- auth 預留
  updated_by               TEXT NOT NULL DEFAULT 'system',   -- auth 預留
  version                  INTEGER NOT NULL DEFAULT 1        -- 樂觀鎖
);
CREATE INDEX idx_patients_chart_no    ON patients(chart_no);
CREATE INDEX idx_patients_name        ON patients(name);
CREATE INDEX idx_patients_status      ON patients(status);
CREATE INDEX idx_patients_product     ON patients(product_line);
CREATE INDEX idx_patients_next_visit  ON patients(next_visit);
CREATE INDEX idx_patients_order_date  ON patients(order_date);
CREATE INDEX idx_patients_doctor      ON patients(doctor);
CREATE INDEX idx_patients_updated_at  ON patients(updated_at);
```

**設計決策**：
- `flags` / `photos` / `all_source_folders` 用 JSON 字串存（SQLite 不支援 array、複雜結構）。讀寫時 server 端 JSON.parse / JSON.stringify
- `version` 欄位給樂觀鎖用（client 帶舊版本 → server 拒絕、回最新值）
- 不分多表（patient_photos, patient_flags）— 維持跟 Dexie 結構一致、降低 migrate 風險
- `updated_at` 索引給 SSE 增量同步用

### 2.2 `orders`

```sql
CREATE TABLE orders (
  id                       TEXT PRIMARY KEY,
  patient_id               TEXT NOT NULL,
  patient_chart_no         TEXT NOT NULL,
  patient_name             TEXT NOT NULL,
  date                     TEXT NOT NULL,
  doctor                   TEXT NOT NULL DEFAULT '',
  batch_type               TEXT NOT NULL DEFAULT '',
  aligner_range            TEXT NOT NULL DEFAULT '',
  progress                 TEXT NOT NULL,    -- 5 種 ProgressStatus
  expected_date            TEXT,
  actual_date              TEXT,
  next_step                TEXT NOT NULL DEFAULT '',
  notes                    TEXT NOT NULL DEFAULT '',
  lab                      TEXT NOT NULL DEFAULT '',

  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  created_by               TEXT NOT NULL DEFAULT 'system',
  updated_by               TEXT NOT NULL DEFAULT 'system',
  version                  INTEGER NOT NULL DEFAULT 1,

  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);
CREATE INDEX idx_orders_patient_id    ON orders(patient_id);
CREATE INDEX idx_orders_chart_no      ON orders(patient_chart_no);
CREATE INDEX idx_orders_date          ON orders(date);
CREATE INDEX idx_orders_doctor        ON orders(doctor);
CREATE INDEX idx_orders_progress      ON orders(progress);
CREATE INDEX idx_orders_lab           ON orders(lab);
CREATE INDEX idx_orders_updated_at    ON orders(updated_at);
```

### 2.3 `settings`

```sql
CREATE TABLE settings (
  key                      TEXT PRIMARY KEY,
  value                    TEXT NOT NULL,    -- JSON
  updated_at               TEXT NOT NULL,
  updated_by               TEXT NOT NULL DEFAULT 'system'
);
```

### 2.4 `audit_log` `[REUSABLE]`

```sql
CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,             -- ISO datetime
  user_id      TEXT NOT NULL DEFAULT 'system',
  action       TEXT NOT NULL,             -- 'create' | 'update' | 'delete' | 'bulk-import'
  entity       TEXT NOT NULL,             -- 'patient' | 'order' | 'setting'
  entity_id    TEXT,                      -- nullable for bulk ops
  before_json  TEXT,                      -- 變更前（update/delete 才有）
  after_json   TEXT,                      -- 變更後（create/update 才有）
  client_id    TEXT                       -- 哪台機（debug 用）
);
CREATE INDEX idx_audit_ts        ON audit_log(ts);
CREATE INDEX idx_audit_entity    ON audit_log(entity, entity_id);
CREATE INDEX idx_audit_user      ON audit_log(user_id);
```

**保留策略**：保留 90 天，每天自動清。

### 2.5 `users` `[REUSABLE]`（Phase 1 不啟用、schema 先放）

```sql
CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  username        TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,             -- argon2id
  display_name    TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'viewer',   -- 'admin' | 'doctor' | 'assistant' | 'viewer'
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_login_at   TEXT
);
```

Phase 1：表存在但無 row、API 全 bypass auth。Phase 2 / 3 才啟用。

### 2.6 `migrations` `[REUSABLE]`

```sql
CREATE TABLE migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL,
  notes      TEXT
);
```

Migration runner pattern：類似 Dexie 的版本機制，server 啟動時跑未執行的 migration。

---

## 3. API Endpoints

**Base URL**：`http://192.168.0.220:8080/api`（內網）

### 3.1 既有保留 `[REUSABLE]`

| Method | Path | 變更 |
|:--|:--|:--|
| GET | `/api/health` | 加 `dbExists` / `dbVersion` / `userCount` |
| GET | `/api/files` | 不變 |
| GET | `/api/image` | 不變 |
| GET | `/api/file` | 不變 |
| GET | `/api/snapshot` | 改成從 SQLite 讀（不再讀 sync.json）；保留 sync.json fallback for Phase 1 |

### 3.2 新增：Patients `[DOMAIN]`

```
GET    /api/patients                  → 全部（or with ?since=<iso-ts> 增量）
GET    /api/patients/:id              → 單筆
POST   /api/patients                  → 新增 (body: Patient without id, server 生 id)
PUT    /api/patients/:id              → 全量更新 (body: Patient, 帶 version 樂觀鎖)
PATCH  /api/patients/:id              → 部分更新 (body: 部分欄位 + version)
DELETE /api/patients/:id              → 刪除
POST   /api/patients/bulk             → 批次 upsert (匯入用)
```

**Response 範例**：
```json
{
  "data": { /* Patient 物件 */ },
  "version": 7
}
```

**樂觀鎖錯誤**：
```json
{
  "error": "version_conflict",
  "currentVersion": 8,
  "yourVersion": 7,
  "current": { /* server 端最新值 */ }
}
```
Client 收到 → 比對差異、決定要 force / discard / merge。

### 3.3 新增：Orders `[DOMAIN]`

```
GET    /api/orders                   → 全部 (?since= / ?patientId= filter)
GET    /api/orders/:id
POST   /api/orders
PUT    /api/orders/:id
PATCH  /api/orders/:id
DELETE /api/orders/:id
POST   /api/orders/bulk
```

### 3.4 新增：Settings `[DOMAIN]`

```
GET    /api/settings                 → 全部 key-value
GET    /api/settings/:key
PUT    /api/settings/:key            → upsert
DELETE /api/settings/:key
```

### 3.5 新增：Backup / Restore `[REUSABLE]`

```
GET    /api/backup                   → 下載完整 JSON（同 sync.json 格式、給 client 手動下載）
POST   /api/restore                  → 上傳 JSON 全量還原（admin only、Phase 2+）
GET    /api/backup/auto              → 列出 server 端自動備份檔
```

### 3.6 新增：SSE 即時推播 `[REUSABLE]`

```
GET    /events                       → text/event-stream
```

**訊息格式**：

```
event: patient.updated
data: {"id":"abc","version":8,"updatedBy":"system","ts":"2026-05-16T..."}

event: patient.created
data: {"id":"xyz","version":1,"updatedBy":"system","ts":"..."}

event: patient.deleted
data: {"id":"abc","ts":"..."}

event: order.updated
data: {"id":"o123","patientId":"abc","version":3,"ts":"..."}

event: bulk.imported
data: {"entity":"patient","count":377,"ts":"..."}

event: heartbeat
data: {"ts":"..."}
```

**設計**：
- 每 30s 一個 heartbeat（防中間 proxy 砍連線）
- Client 帶 `Last-Event-ID` header → server 從該 id 開始補推
- Server 保留最近 100 筆事件 in-memory（client 短暫斷線後 reconnect 可補）
- 超過 100 筆 → client 直接重 GET `/api/snapshot?since=<ts>` 補

### 3.7 新增：Auth stub `[REUSABLE]`

```
POST   /api/auth/login               → Phase 2+ 才實作；Phase 1 回 501 Not Implemented
POST   /api/auth/logout
GET    /api/auth/me                  → Phase 1 回 {user: 'system', role: 'admin'}
```

---

## 4. 共通 Request / Response 約定 `[REUSABLE]`

### 4.1 Request Headers

```
Content-Type:    application/json
X-User-Id:       (optional)  Phase 1 ignored, Phase 2+ 改用 Authorization
X-Client-Id:     (optional)  client 自己塞 UUID、SSE 廣播時排除自己
Authorization:   (Phase 2+)  Bearer <JWT>
```

### 4.2 Response 包裝

```json
{
  "data": { /* 主要內容 */ },
  "meta": { "version": 8, "updatedAt": "...", "serverTime": "..." }
}
```

錯誤：
```json
{
  "error": "<error_code>",
  "message": "<人話描述>",
  "details": { /* 視情況 */ }
}
```

常用錯誤碼：`not_found` / `version_conflict` / `validation_error` / `unauthorized` / `forbidden` / `internal_error`

### 4.3 HTTP Status

| Code | 用途 |
|:--|:--|
| 200 | 成功 (GET / PUT / PATCH) |
| 201 | 建立成功 (POST) |
| 204 | 刪除成功 (DELETE) |
| 400 | 請求格式錯 / 驗證失敗 |
| 401 | 未登入（Phase 2+） |
| 403 | 已登入但無權限 |
| 404 | 資源不存在 |
| 409 | version conflict |
| 500 | server 內部錯 |

---

## 5. 一次性遷移：sync.json → SQLite

### 5.1 來源

D 機目前最新的 `sync.json` 在 `D:\診所nas 矯正追蹤\SynologyDrive\sync.json`。

格式：見 [`src/lib/backup.ts:23`](../src/lib/backup.ts) `BackupFile` type。

### 5.2 流程

**腳本位置**：`server/migrate/from-sync-json.mjs`

```bash
node server/migrate/from-sync-json.mjs <sync.json> <db.sqlite>
```

**步驟**：
1. 讀 sync.json → 驗 `version` 欄位（1 or 2）
2. 開 SQLite、跑所有 CREATE TABLE
3. `BEGIN TRANSACTION`
4. `INSERT OR REPLACE INTO patients` for each patient
   - JSON 欄位（flags / photos / allSourceFolders）`JSON.stringify`
   - boolean 欄位（hasConsent）轉 0/1
   - `created_by` / `updated_by` 預設 `'system'`
   - `version` 預設 `1`
5. 同樣灌 `orders` / `settings`
6. `INSERT INTO migrations (version, applied_at, notes) VALUES (1, NOW(), 'initial from sync.json v<X>')`
7. `COMMIT`
8. 跑 `SELECT COUNT(*)` 確認筆數對得上

**冪等性**：可重跑（每筆 `INSERT OR REPLACE`）。

### 5.3 路徑處理

sync.json v2 內 `sourceFolder` / `consentPdfPath` 已是 relative path（[`src/lib/path-normalize.ts`](../src/lib/path-normalize.ts)）。SQLite 直接存 relative，**不再 prepend dataRoot**。

API 層回給 client 時也回 relative，client 自己決定要不要組 absolute（PWA 內網路徑） vs API 路徑（`/api/image?path=...`）。

---

## 6. Server 實作 `[REUSABLE]`

### 6.1 檔案結構

```
server/
├─ index.js                  ← 主 entry（現有檔案、拆出 routes）
├─ package.json
├─ db/
│   ├─ schema.sql            ← CREATE TABLE 全部
│   ├─ migrations/
│   │   ├─ 001_initial.sql
│   │   ├─ 002_add_auu_id.sql
│   │   └─ ...
│   └─ db.js                 ← better-sqlite3 connection + migration runner
├─ routes/
│   ├─ patients.js
│   ├─ orders.js
│   ├─ settings.js
│   ├─ backup.js
│   └─ auth.js               ← Phase 1 stub
├─ events/
│   └─ sse.js                ← SSE broadcaster
├─ middleware/
│   ├─ audit.js              ← audit_log 寫入
│   ├─ optimistic-lock.js    ← version 檢查
│   └─ auth.js               ← Phase 1 fake user
├─ migrate/
│   └─ from-sync-json.mjs    ← 一次性遷移腳本
└─ lib/
    ├─ json-fields.js        ← stringify/parse helper
    └─ logger.js
```

### 6.2 SQLite 用 Node 內建 `node:sqlite`（無 native build）

**決策變更（2026-05-16 開工日）**：原 spec 寫 `better-sqlite3`，實測 D 機 Windows 沒 Visual Studio 編不過。改用 Node v22.5+ 內建的 `node:sqlite` 模組：

```js
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/data/db.sqlite');
db.exec('CREATE TABLE ...');
db.prepare('INSERT INTO t VALUES(?)').run(42);
db.prepare('SELECT * FROM t WHERE id=?').get(42);
```

**好處**：
- 完全不用 native build → Windows / Linux / Docker 都簡單
- 零額外依賴
- API 跟 better-sqlite3 幾乎一致（prepare / run / get / all）
- 容器 image 不需 `apk add python3 make g++`

**代價**：
- 需要 Node ≥ 22.5（v22.5-v23 要 `--experimental-sqlite` flag；v24+ 穩定）
- Dockerfile base 從 `node:20-alpine` 升到 `node:22-alpine`（或 `node:24-alpine`）

**dependencies 維持只有 express**：

```json
{
  "dependencies": {
    "express": "^5.0.0"
  }
}
```

### 6.3 SSE Broadcaster 設計

```js
// events/sse.js
class SseBroadcaster {
  constructor() {
    this.clients = new Map();  // clientId → res
    this.recent = [];           // last 100 events
  }

  subscribe(req, res, lastEventId) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');  // disable nginx buffering
    res.write(':\n\n');

    const id = req.headers['x-client-id'] || crypto.randomUUID();
    this.clients.set(id, res);

    // Replay missed events if Last-Event-ID present
    if (lastEventId) {
      const startIdx = this.recent.findIndex(e => e.id === lastEventId);
      if (startIdx >= 0) {
        for (const e of this.recent.slice(startIdx + 1)) this._send(res, e);
      }
    }

    req.on('close', () => this.clients.delete(id));
  }

  broadcast(eventName, data, excludeClientId = null) {
    const event = { id: Date.now() + '-' + Math.random(), event: eventName, data };
    this.recent.push(event);
    if (this.recent.length > 100) this.recent.shift();
    for (const [clientId, res] of this.clients) {
      if (clientId === excludeClientId) continue;
      this._send(res, event);
    }
  }

  _send(res, e) {
    res.write(`id: ${e.id}\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
  }

  // 30s heartbeat
  startHeartbeat() {
    setInterval(() => this.broadcast('heartbeat', { ts: new Date().toISOString() }), 30_000);
  }
}
```

### 6.4 樂觀鎖 middleware `[REUSABLE]`

```js
// middleware/optimistic-lock.js
export function checkVersion(table) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'POST') return next();
    const id = req.params.id;
    const incoming = req.body.version;
    if (incoming == null) {
      return res.status(400).json({ error: 'validation_error', message: 'version required' });
    }
    const row = db.prepare(`SELECT version FROM ${table} WHERE id = ?`).get(id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (row.version !== incoming) {
      const current = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
      return res.status(409).json({
        error: 'version_conflict',
        currentVersion: row.version,
        yourVersion: incoming,
        current,
      });
    }
    next();
  };
}
```

### 6.5 Audit middleware `[REUSABLE]`

```js
// middleware/audit.js
export function audit(entity) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'OPTIONS') return next();
    const origJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const action = req.method === 'POST' ? 'create' :
                       req.method === 'DELETE' ? 'delete' : 'update';
        db.prepare(`
          INSERT INTO audit_log (ts, user_id, action, entity, entity_id, after_json, client_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          new Date().toISOString(),
          req.headers['x-user-id'] || 'system',
          action,
          entity,
          req.params.id || (body.data && body.data.id) || null,
          JSON.stringify(body.data),
          req.headers['x-client-id'] || null,
        );
      }
      return origJson(body);
    };
    next();
  };
}
```

---

## 7. Client 改造

### 7.1 DataLayer 抽象層 `[REUSABLE]`

新增 `src/lib/data-layer.ts`，把現有所有 Dexie 直接呼叫都包進來：

```ts
// 抽象介面
export interface DataLayer {
  // Patients
  getPatient(id: string): Promise<Patient | null>;
  listPatients(filter?: PatientFilter): Promise<Patient[]>;
  createPatient(p: Omit<Patient, 'id' | 'createdAt' | 'updatedAt'>): Promise<Patient>;
  updatePatient(id: string, patch: Partial<Patient>): Promise<Patient>;
  deletePatient(id: string): Promise<void>;
  bulkPutPatients(patients: Patient[]): Promise<void>;

  // Orders / Settings 同形狀

  // 事件
  onChange(cb: (event: ChangeEvent) => void): () => void;  // unsubscribe
  isOnline(): boolean;
  onConnectivityChange(cb: (online: boolean) => void): () => void;
}
```

**兩個實作**：

1. `DexieDataLayer` — 現有行為（Phase 1 fallback）
2. `ApiDataLayer` — fetch + IndexedDB cache + SSE

Phase 1 用 `ApiDataLayer` 包 `DexieDataLayer`（雙寫）：
```
ApiDataLayer.updatePatient()
  → DexieDataLayer.updatePatient()   // 本機快寫、UI 不卡
  → fetch PATCH /api/patients/:id    // 同步推 server
  → 收 SSE 訊號 → reconcile          // server 端 version 為準
```

Phase 2 拆掉 DexieDataLayer 雙寫，純 API + IndexedDB 當離線快取。

### 7.2 既有檔案改造清單

所有直接 `import { db } from './db'` 的檔案都改成 `import { dataLayer } from './lib/data-layer'`。

掃了一遍會影響到：
- `src/lib/backup.ts`
- `src/lib/merge-patients.ts`
- `src/lib/reapply-excel.ts`
- `src/lib/path-migration.ts`
- `src/lib/folder-rescan.ts`
- `src/pages/PatientList.tsx`
- `src/pages/PatientDetailPage.tsx`
- `src/pages/OrderTracking.tsx`
- `src/pages/SettingsPage.tsx`
- `src/pages/DebugPanel.tsx`
- 各種小 component / hook

工時估計：**改造約 30-40 個檔案**、平均每檔 5 分鐘 = 2.5-3 小時純機械工。

### 7.3 離線偵測 UX `[REUSABLE]`

新元件 `src/components/OnlineStatus.tsx`：

```
[線上] 綠點 + 「同步中」字樣 → SSE 連線正常
[離線] 紅點 + 「離線中、所有寫入已停用」橫幅
[同步中] 黃點 + 「正在拉取最新資料...」
```

**離線時**：
- 所有寫操作按鈕 `disabled`、hover 顯示 tooltip「目前離線、無法修改」
- 唯讀內容仍可看（IndexedDB 快取）
- 重連後自動 GET `/api/snapshot?since=<lastSeenTs>` 補增量

**狀態偵測**：
- SSE 連線狀態
- 加 `/api/health` ping fallback（每 60s）

### 7.4 useDataLayer hook（React 整合）

```ts
// src/hooks/useDataLayer.ts
export function usePatient(id: string) {
  const [patient, setPatient] = useState<Patient | null>(null);
  useEffect(() => {
    let alive = true;
    dataLayer.getPatient(id).then(p => alive && setPatient(p));
    const unsub = dataLayer.onChange(e => {
      if (e.entity === 'patient' && e.id === id) {
        dataLayer.getPatient(id).then(p => alive && setPatient(p));
      }
    });
    return () => { alive = false; unsub(); };
  }, [id]);
  return patient;
}
```

換掉現有 `useLiveQuery(() => db.patients.get(id))`。

---

## 8. Phase 1 雙寫策略

### 8.1 目標

讓筆電 / D 機看到對方剛改的東西、**不要砍掉重練**。

### 8.2 詳細流程

```
[D 機改 patient]
  1. UI 樂觀 update (React state)
  2. ApiDataLayer.updatePatient()
     ├─ Dexie UPDATE (本機快取、即時 UI)
     └─ fetch PATCH /api/patients/:id
            ↓
       [Server]
        2a. SQLite UPDATE + bump version
        2b. INSERT audit_log
        2c. SSE broadcast "patient.updated" (exclude D 機 X-Client-Id)
            ↓
       [筆電收到 SSE]
        2d. ApiDataLayer 從 server fetch 該 patient 最新值
        2e. Dexie UPDATE
        2f. React useLiveQuery 自動 re-render
```

### 8.3 失敗處理

| 失敗點 | 行為 |
|:--|:--|
| Dexie 寫失敗 | 整個操作 rollback、UI 跳錯 |
| API 連不上 | 本機 Dexie 已寫、跳 toast「本機已存、雲端同步失敗、請檢查網路」、進 retry queue |
| API 回 409 conflict | 跳 modal「server 有更新版本、要套用 server 版 / 強推你的版本？」 |
| API 回 500 | 跳 toast「server 錯誤、請稍後再試」 |

**Retry queue**：localStorage 存「待 retry 操作」，App 啟動 + 重連時自動跑。

### 8.4 回滾路徑

如果 Phase 1 上線後出大包：
1. 改 client env `VITE_API_BASE=''` → 跳過 API 呼叫、純 Dexie
2. 改 server 容器（Container Manager）關掉 → 不影響 client
3. sync.json 機制仍可手動 push/pull（fallback）

**前提**：Phase 1 期間 sync.json 機制不拆、保留至少 1 個月。

---

## 9. Phase 2 純 API 切換 checkpoint

進入 Phase 2 條件（**全部**滿足）：

- [ ] Phase 1 上線 ≥ 14 天無重大 bug
- [ ] 兩台機並發測試 ≥ 50 筆編輯無資料丟失
- [ ] SSE 平均 round-trip < 500ms
- [ ] 離線斷網測試：重連後 100% 資料 catch-up
- [ ] audit_log 行數合理（每次寫 = 1 row）
- [ ] 主上實際工作流順手、不再用「推到 NAS」按鈕

Phase 2 動作：
1. DataLayer 拿掉 Dexie 雙寫、改純 API
2. IndexedDB 只當快取（讀失敗時 fallback）
3. 移除「推到 NAS / 從 NAS 拉取」按鈕
4. sync.json 機制留作離線備份（每天 server 自動 dump 一份）

---

## 10. 部署

### 10.1 沿用現有流程

- `scripts/build-stage-b.mjs` 不變
- `scripts/hooks/post-commit` 不變
- Drive Client 自動 sync tar 不變
- DSM Container Manager 載入 tar 不變

### 10.2 容器設定差異

| 項目 | v0.5.6 (現在) | v0.6.0 (升級後) |
|:--|:--|:--|
| 共用資料夾 | `/data` (ro) | `/data` (rw — 要寫 db.sqlite) |
| Volume | 無 | 加 named volume 給 db backup（可選） |
| Env vars | `PORT` `DATA_PATH` | 加 `DB_PATH=/data/db.sqlite` `BACKUP_PATH=/data/backup` |
| 重啟策略 | 自動 | 自動 |

**注意**：`/data` 從 ro 改 rw → 第一次部署要在 DSM 重建 container（mount 不能熱改）。

### 10.3 第一次部署 checklist

```
[ ] D 機本地測試：docker run + 灌 sync.json → 確認 API 全 OK
[ ] D 機跑 migrate/from-sync-json.mjs → 產 db.sqlite
[ ] 把 db.sqlite 放到 NAS n歐耐恩n/0矯正追蹤/db.sqlite
[ ] DSM 停舊 aligner-viewer container
[ ] DSM 載入 aligner-viewer-0.6.0.tar
[ ] 建新 container：/data rw mount
[ ] 啟動、ping /api/health 確認 dbExists: true
[ ] D 機 client 切到新版、測 1-2 筆編輯
[ ] 筆電 client 切到新版、確認 SSE 收到 D 機改動
[ ] iPad 確認 read-only 視角仍 OK
```

---

## 11. Auth 預留設計 `[REUSABLE]`

**Phase 1 不實作、但 schema / API / client 預留所有接口**。

### 11.1 已預留

- ✅ `users` 表存在
- ✅ 所有 record 有 `created_by` / `updated_by`
- ✅ API 接受 `X-User-Id` header（Phase 1 忽略）
- ✅ `audit_log` 每筆寫 user_id
- ✅ Client 有 currentUser context（Phase 1 hardcode `{id:'system', role:'admin'}`）
- ✅ `/api/auth/me` endpoint 存在（Phase 1 回 fake user）

### 11.2 Phase 2 / 3 加入的（不在這份 spec 範圍）

- 真實 login flow（POST /api/auth/login）
- JWT / session token
- Auth middleware（驗 token + 塞 req.user）
- Role middleware（requireRole('admin')）
- Client 登入頁 + 路由保護
- 角色感知 UI（hide / disable 按鈕）

預估工時：**2.5-3 天**。詳見 `100_Todo/projects/2026-05-07_aligner-login-permissions.md`（該文件需在 Phase 1 上線後更新成 server-based 版本）。

---

## 12. 風險與緩解

| # | 風險 | 機率 | 影響 | 緩解 |
|:--|:--|:--|:--|:--|
| 1 | better-sqlite3 在 Synology DSM Docker 編譯失敗 | 中 | 高 | Dockerfile 加 `apk add python3 make g++`；備案：sqlite3 (npm pure JS) |
| 2 | SSE 在 iOS Safari 不穩 | 中 | 中 | 加 polling fallback (`/api/changes?since=`)、heartbeat |
| 3 | 兩台同時編同一 patient → 409 conflict UX 設計糟 | 高 | 中 | 早期測試重點；conflict UI 寫清楚 |
| 4 | NAS 寫 SQLite over Drive folder → 鎖檔 | 低 | 高 | db.sqlite 放容器 named volume、不放 Drive sync 資料夾 |
| 5 | Phase 1 雙寫不一致（Dexie OK / API 失敗） | 中 | 中 | retry queue + 啟動時 reconcile |
| 6 | Migration 跑壞、377 個 patient 沒進去 | 低 | 災難 | migrate 腳本先在副本測；保留原 sync.json |
| 7 | iPad Safari 不支援 fetch 某些選項 | 低 | 低 | 不用 fancy options（streaming body etc.） |
| 8 | audit_log 爆量 | 中 | 低 | 90 天 retention + 每天清 |

---

## 13. 工時拆解

### Server 端

| 任務 | 工時 |
|:--|:--:|
| SQLite schema + migration runner | 0.5 天 |
| from-sync-json.mjs 遷移腳本 | 0.5 天 |
| patients CRUD + 樂觀鎖 | 0.5 天 |
| orders CRUD | 0.3 天 |
| settings CRUD | 0.2 天 |
| audit middleware | 0.3 天 |
| SSE broadcaster | 0.5 天 |
| backup / restore endpoints | 0.2 天 |
| Dockerfile 更新（better-sqlite3 native build） | 0.3 天 |
| 健康檢查 + log + 啟動 boilerplate | 0.2 天 |
| **小計** | **3.5 天** |

### Client 端

| 任務 | 工時 |
|:--|:--:|
| DataLayer 抽象層介面 | 0.3 天 |
| DexieDataLayer 實作（包現有） | 0.3 天 |
| ApiDataLayer 實作（fetch + cache） | 0.7 天 |
| SSE listener + reconcile | 0.5 天 |
| 樂觀鎖 conflict UI | 0.4 天 |
| OnlineStatus 元件 + 離線寫操作 disable | 0.4 天 |
| useDataLayer hook（換掉 useLiveQuery） | 0.3 天 |
| 30-40 個檔案機械替換 | 0.5 天 |
| retry queue + reconcile on reconnect | 0.4 天 |
| currentUser context（auth stub） | 0.2 天 |
| **小計** | **4 天** |

### 測試 + 部署

| 任務 | 工時 |
|:--|:--:|
| 兩台機並發測試（編輯、刪除、conflict） | 0.5 天 |
| 離線斷網測試 | 0.3 天 |
| Migration 用副本測 | 0.3 天 |
| 容器更新 + 第一次部署 | 0.3 天 |
| iPad 視角檢查 | 0.2 天 |
| 寫使用文件 / 部署 SOP | 0.4 天 |
| **小計** | **2 天** |

**合計：9.5 天**（粗估、實際抓 10-12 天含 buffer）

---

## 14. 開工前還需主上拍板的問題

1. **client 識別**：D 機 / 筆電在 audit_log 怎麼區分？
   - 建議：每台機第一次跑時生 UUID 存 localStorage，當 client_id；可選擇加自訂機器名
2. **db.sqlite 放哪**：
   - 選 A：容器 named volume（隔離、不被 Drive 同步搗亂）← 建議
   - 選 B：`/data/db.sqlite`（混在 NAS 共用資料夾、Drive 可能誤同步）
3. **照片仍走 file 路徑還是上傳到 server**：
   - 維持現狀（照片在 NAS file system、API 用 `/api/image?path=`）← 建議
4. **dataRoot 設定怎麼處理**：
   - Phase 1 後 client 還需要 dataRoot 嗎？路徑都從 server 來
   - 建議：保留 client dataRoot 設定、用於「在資源管理器開啟」之類本機檔案操作
5. **iPad 是否需要 token 才能讀**：
   - Phase 1：否，純內網信任
   - Phase 2：iPad 用 viewer 帳號 token，跟桌機共用同一容器

---

## 附錄 A：API 對照 Dexie 操作

| 現在的 Dexie call | Phase 1 後改成 |
|:--|:--|
| `db.patients.get(id)` | `dataLayer.getPatient(id)` |
| `db.patients.toArray()` | `dataLayer.listPatients()` |
| `db.patients.put(p)` | `dataLayer.createPatient(p)` 或 `updatePatient(id, p)` |
| `db.patients.update(id, patch)` | `dataLayer.updatePatient(id, patch)` |
| `db.patients.delete(id)` | `dataLayer.deletePatient(id)` |
| `db.patients.bulkPut(ps)` | `dataLayer.bulkPutPatients(ps)` |
| `useLiveQuery(() => db.patients.toArray())` | `usePatients()` hook |
| `useLiveQuery(() => db.patients.get(id))` | `usePatient(id)` hook |

---

## 附錄 B：未來其他 App 套用此模式時的「重用清單」

| 檔案 / 模組 | 拿來改一改就能用 |
|:--|:--|
| `server/db/db.js`（migration runner） | ✅ 完全通用 |
| `server/middleware/audit.js` | ✅ 完全通用 |
| `server/middleware/optimistic-lock.js` | ✅ 改個 table 名 |
| `server/events/sse.js` | ✅ 完全通用 |
| `server/migrate/from-sync-json.mjs` | ❌ 每個 App 業務不同 |
| `Dockerfile` | ✅ 完全通用 |
| `scripts/build-stage-b.mjs` | ✅ 改 image 名即可 |
| `scripts/hooks/post-commit` | ✅ 完全通用 |
| `src/lib/data-layer.ts`（抽象介面） | ✅ 介面共用、實作客製 |
| `src/components/OnlineStatus.tsx` | ✅ 完全通用 |
| `src/hooks/useDataLayer.ts`（hook 模式） | ✅ 完全通用 |

**結論**：未來第 2、第 3 個 App 套這個架構時、約 **70% server infra + 60% client infra 可直接複製**。Domain 層（schema / routes / UI）每個 App 重寫。

---

**EOF**
