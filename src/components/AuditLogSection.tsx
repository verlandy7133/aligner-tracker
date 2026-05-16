// AuditLogSection — 看誰改了什麼（settings.audit 權限、通常 admin）
//
// 表格顯示最近寫操作、可 filter by user / entity / action
// 點 row 展開看 before/after JSON diff

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api-client';
import { usePermission, useAuth } from '../contexts/AuthContext';

type AuditEntry = {
  id: number;
  ts: string;
  userId: string;
  user: { username: string; displayName: string } | null;
  action: string;
  entity: string;
  entityId: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  clientId: string | null;
};

type UserShort = { id: string; username: string; displayName: string };

const ENTITY_LABEL: Record<string, string> = {
  patient: '病患',
  order: '下單',
  setting: '設定',
  user: '帳號',
};
const ACTION_LABEL: Record<string, string> = {
  create: '✚ 建立',
  update: '✎ 更新',
  delete: '✗ 刪除',
  'bulk-import': '📥 批次匯入',
};
const ACTION_COLOR: Record<string, string> = {
  create: 'text-emerald-400',
  update: 'text-sky-400',
  delete: 'text-rose-400',
  'bulk-import': 'text-violet-400',
};

export default function AuditLogSection() {
  const canView = usePermission('settings.audit');
  const { user: currentUser } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [users, setUsers] = useState<UserShort[]>([]);
  const [meta, setMeta] = useState<{ total: number; limit: number; offset: number; hasMore: boolean }>({
    total: 0, limit: 200, offset: 0, hasMore: false,
  });

  // filters
  const [filterUserId, setFilterUserId] = useState<string>('');
  const [filterEntity, setFilterEntity] = useState<string>('');
  const [filterAction, setFilterAction] = useState<string>('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const params: string[] = [];
      if (filterUserId) params.push(`userId=${encodeURIComponent(filterUserId)}`);
      if (filterEntity) params.push(`entity=${encodeURIComponent(filterEntity)}`);
      if (filterAction) params.push(`action=${encodeURIComponent(filterAction)}`);
      const qs = params.length > 0 ? `?${params.join('&')}` : '';
      const r = await api<{ data: AuditEntry[]; meta: typeof meta }>(`/api/audit-log${qs}`);
      setEntries(r.data);
      setMeta(r.meta);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'load failed');
    }
  }

  // 載 user list 給 filter dropdown 用（admin 也有 settings.users、所以可以叫 /api/users）
  async function loadUsers() {
    try {
      const r = await api<{ data: UserShort[] }>('/api/users');
      setUsers(r.data);
    } catch {
      // 沒 users.users 權限就算了、filter dropdown 顯示 user_id 不顯示名字
    }
  }

  useEffect(() => {
    if (canView) {
      loadUsers();
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  useEffect(() => {
    if (canView) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterUserId, filterEntity, filterAction]);

  const userMap = useMemo(() => {
    const m: Record<string, UserShort> = {};
    for (const u of users) m[u.id] = u;
    return m;
  }, [users]);

  if (!canView) {
    return (
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
        <header className="px-5 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-200">📜 操作紀錄 (audit log)</h2>
        </header>
        <div className="p-5 text-sm text-zinc-500">
          需 admin 權限 (settings.audit)。當前帳號（{currentUser?.displayName}）沒有此權限。
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">📜 操作紀錄 (audit log)</h2>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            共 {meta.total} 筆、顯示最新 {entries?.length ?? 0} 筆 (limit {meta.limit})
          </p>
        </div>
        <button
          onClick={refresh}
          className="px-2 py-1 rounded text-[11px] border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition"
        >
          ⟳ 重新整理
        </button>
      </header>

      {error && (
        <div className="mx-5 mt-3 px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* filters */}
      <div className="px-5 py-3 border-b border-zinc-800/60 flex items-center gap-2 flex-wrap text-xs">
        <span className="text-zinc-500">篩選</span>
        <select
          value={filterUserId}
          onChange={(e) => setFilterUserId(e.target.value)}
          className="px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-200"
        >
          <option value="">全部 user</option>
          <option value="system">system (Phase 1 系統)</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.displayName} ({u.username})</option>
          ))}
        </select>
        <select
          value={filterEntity}
          onChange={(e) => setFilterEntity(e.target.value)}
          className="px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-200"
        >
          <option value="">全部 entity</option>
          <option value="patient">病患</option>
          <option value="order">下單</option>
          <option value="setting">設定</option>
          <option value="user">帳號</option>
        </select>
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-200"
        >
          <option value="">全部 action</option>
          <option value="create">建立</option>
          <option value="update">更新</option>
          <option value="delete">刪除</option>
          <option value="bulk-import">批次匯入</option>
        </select>
        {(filterUserId || filterEntity || filterAction) && (
          <button
            onClick={() => { setFilterUserId(''); setFilterEntity(''); setFilterAction(''); }}
            className="px-2 py-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
          >
            清除
          </button>
        )}
      </div>

      <div className="p-5">
        {entries === null ? (
          <p className="text-sm text-zinc-500">載入中…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-zinc-500">沒有符合條件的記錄</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] text-zinc-500 uppercase">
              <tr>
                <th className="text-left font-medium pb-2 w-44">時間</th>
                <th className="text-left font-medium pb-2 w-36">user</th>
                <th className="text-left font-medium pb-2 w-24">action</th>
                <th className="text-left font-medium pb-2 w-16">entity</th>
                <th className="text-left font-medium pb-2">id / 連結</th>
                <th className="text-right font-medium pb-2 w-16">詳細</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {entries.map((e) => {
                const isExpanded = expanded === e.id;
                const userInfo = e.user || userMap[e.userId] || null;
                return (
                  <Fragment key={e.id}>
                    <tr className="hover:bg-zinc-800/30">
                      <td className="py-2 tabular text-zinc-400">{e.ts.replace('T', ' ').slice(0, 19)}</td>
                      <td className="py-2 text-zinc-300">
                        {userInfo ? `${userInfo.displayName}` : e.userId}
                        <span className="text-[10px] text-zinc-600 ml-1">{userInfo?.username && userInfo.username !== userInfo.displayName ? `(${userInfo.username})` : ''}</span>
                      </td>
                      <td className={`py-2 ${ACTION_COLOR[e.action] || 'text-zinc-400'}`}>
                        {ACTION_LABEL[e.action] || e.action}
                      </td>
                      <td className="py-2 text-zinc-400">{ENTITY_LABEL[e.entity] || e.entity}</td>
                      <td className="py-2 font-mono text-[10px] text-zinc-500">
                        {e.entity === 'patient' && e.entityId ? (
                          <Link to={`/patients/${e.entityId}`} className="text-sky-400 hover:text-sky-300">{e.entityId.slice(0, 8)}...</Link>
                        ) : (
                          e.entityId?.slice(0, 12) || '—'
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => setExpanded(isExpanded ? null : e.id)}
                          className="text-[10px] text-zinc-500 hover:text-zinc-200 px-2"
                        >
                          {isExpanded ? '收' : '展'}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-zinc-950/60">
                        <td colSpan={6} className="py-3 px-4">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <p className="text-[10px] text-zinc-500 mb-1 font-medium">變更前 (before)</p>
                              <pre className="text-[10px] text-zinc-400 font-mono whitespace-pre-wrap break-all max-h-60 overflow-y-auto bg-zinc-900/40 p-2 rounded">
                                {e.beforeJson ? prettyJson(e.beforeJson) : '(無 / 建立操作)'}
                              </pre>
                            </div>
                            <div>
                              <p className="text-[10px] text-zinc-500 mb-1 font-medium">變更後 (after)</p>
                              <pre className="text-[10px] text-zinc-400 font-mono whitespace-pre-wrap break-all max-h-60 overflow-y-auto bg-zinc-900/40 p-2 rounded">
                                {e.afterJson ? prettyJson(e.afterJson) : '(無 / 刪除操作)'}
                              </pre>
                            </div>
                          </div>
                          <p className="text-[10px] text-zinc-600 mt-2">
                            client_id: <code className="font-mono">{e.clientId || '(無)'}</code>
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <footer className="px-5 py-3 border-t border-zinc-800/60 text-[10px] text-zinc-500">
        紀錄保留所有寫操作（建立 / 更新 / 刪除 / 批次匯入）、含變更前後完整內容。
      </footer>
    </section>
  );
}

function prettyJson(s: string): string {
  try {
    const v = JSON.parse(s);
    return JSON.stringify(v, null, 2);
  } catch {
    return s;
  }
}
