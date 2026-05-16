// UserManagementSection — admin 帳號管理（settings.users 權限）
//
// 列所有 user、新增、編輯（含 permission 勾選）、改密碼、刪除
// 顯示在 SettingsPage（v0.6.1 新增）

import { useEffect, useState } from 'react';
import { api, apiPost, apiPut, apiDelete } from '../lib/api-client';
import { useAuth, usePermission, type CurrentUser } from '../contexts/AuthContext';

// 跟 server lib/permissions.js 同步
const PERMISSION_GROUPS: Record<string, string[]> = {
  patient: ['patient.view', 'patient.create', 'patient.edit', 'patient.delete', 'patient.notes', 'patient.photos', 'patient.consent'],
  order: ['order.view', 'order.create', 'order.edit', 'order.delete'],
  settings: ['settings.preferences', 'settings.doctors', 'settings.labs', 'settings.data', 'settings.users', 'settings.audit'],
};
const PERMISSION_LABEL: Record<string, string> = {
  'patient.view': '看病患詳細頁',
  'patient.create': '新增病患',
  'patient.edit': '改基本資料',
  'patient.delete': '刪病患',
  'patient.notes': '改筆記 / 病歷',
  'patient.photos': '管照片 slot',
  'patient.consent': '管授權書 PDF',
  'order.view': '看下單記錄',
  'order.create': '新增下單',
  'order.edit': '改下單記錄',
  'order.delete': '刪下單',
  'settings.preferences': '改 UI 偏好',
  'settings.doctors': '管醫師清單',
  'settings.labs': '管技工所清單',
  'settings.data': '匯入 / 合併 / 健檢 / restore',
  'settings.users': '管帳號（最高權限）',
  'settings.audit': '看 audit_log',
};
const ALL_PERMISSIONS = Object.values(PERMISSION_GROUPS).flat();
const ROLE_TEMPLATES: Record<string, string[]> = {
  admin: ALL_PERMISSIONS,
  doctor: ['patient.view', 'patient.create', 'patient.edit', 'patient.delete', 'patient.notes', 'patient.photos', 'patient.consent', 'order.view', 'order.create', 'order.edit', 'order.delete', 'settings.preferences'],
  'order-clerk': ['patient.view', 'order.view', 'order.create', 'order.edit'],
  assistant: ['patient.view', 'patient.create', 'patient.edit', 'patient.delete', 'patient.notes', 'patient.photos', 'patient.consent', 'order.view', 'order.create', 'order.edit', 'order.delete', 'settings.preferences', 'settings.doctors', 'settings.labs'],
  viewer: ['patient.view', 'order.view'],
  custom: [],
};
const ROLE_LABEL: Record<string, string> = {
  admin: '管理員',
  doctor: '醫師',
  'order-clerk': '下單助理',
  assistant: '助理',
  viewer: '唯讀',
  custom: '自訂',
};

type User = CurrentUser & { createdAt: string; lastLoginAt: string | null };

export default function UserManagementSection() {
  const canManage = usePermission('settings.users');
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[] | null>(null);
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const r = await api<{ data: User[] }>('/api/users');
      setUsers(r.data);
    } catch (e: any) {
      setError(e?.message || 'load failed');
    }
  }

  useEffect(() => {
    if (canManage) refresh();
  }, [canManage]);

  if (!canManage) {
    return (
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
        <header className="px-5 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-200">👤 帳號管理</h2>
        </header>
        <div className="p-5 text-sm text-zinc-500">
          需 admin 權限。當前帳號（{currentUser?.displayName}）沒有 settings.users 權限。
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30">
      <header className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">👤 帳號管理</h2>
        <button
          onClick={() => setEditing('new')}
          className="px-3 py-1.5 rounded-md text-xs bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition"
        >
          + 新增帳號
        </button>
      </header>

      {error && (
        <div className="mx-5 mt-3 px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
          ⚠️ {error}
        </div>
      )}

      <div className="p-5">
        {users === null ? (
          <p className="text-sm text-zinc-500">載入中…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-zinc-500">沒帳號（理論上不會、bootstrap admin 應該至少有一個）</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-zinc-500 uppercase">
              <tr>
                <th className="text-left font-medium pb-2">帳號</th>
                <th className="text-left font-medium pb-2">顯示名稱</th>
                <th className="text-left font-medium pb-2">角色</th>
                <th className="text-left font-medium pb-2">權限數</th>
                <th className="text-left font-medium pb-2">狀態</th>
                <th className="text-left font-medium pb-2">最後登入</th>
                <th className="text-right font-medium pb-2">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-zinc-800/30">
                  <td className="py-2 font-mono text-zinc-300">{u.username}</td>
                  <td className="py-2 text-zinc-300">{u.displayName}</td>
                  <td className="py-2 text-zinc-400">{ROLE_LABEL[u.role] || u.role}</td>
                  <td className="py-2 text-zinc-400">{u.permissions.length}</td>
                  <td className="py-2">
                    {u.isActive ? (
                      <span className="text-emerald-400">✓ 啟用</span>
                    ) : (
                      <span className="text-zinc-500">停用</span>
                    )}
                  </td>
                  <td className="py-2 text-zinc-500 text-xs">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('zh-TW') : '從未'}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => setEditing(u)}
                      className="text-xs text-sky-400 hover:text-sky-300 px-2"
                    >
                      ✎ 編輯
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <UserEditModal
          target={editing}
          currentUserId={currentUser?.id}
          onClose={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </section>
  );
}

// ─── 編輯彈窗 ─────────────────────────────────────────
function UserEditModal({
  target,
  currentUserId,
  onClose,
}: {
  target: User | 'new';
  currentUserId: string | undefined;
  onClose: () => void;
}) {
  const isNew = target === 'new';
  const t = isNew ? null : (target as User);

  const [username, setUsername] = useState(t?.username || '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(t?.displayName || '');
  const [role, setRole] = useState(t?.role || 'order-clerk');
  const [permissions, setPermissions] = useState<string[]>(
    t?.permissions || ROLE_TEMPLATES['order-clerk'],
  );
  const [isActive, setIsActive] = useState(t?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyRoleTemplate(r: string) {
    setRole(r);
    if (r !== 'custom') {
      setPermissions(ROLE_TEMPLATES[r] || []);
    }
  }

  function togglePerm(p: string) {
    setPermissions((prev) => {
      const next = prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p];
      setRole('custom'); // 個別勾選 → role 變自訂
      return next;
    });
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      if (isNew) {
        await apiPost('/api/users', { username, password, displayName, role, permissions });
      } else {
        await apiPut(`/api/users/${t!.id}`, { displayName, role, permissions, isActive });
        if (password) {
          await apiPost(`/api/users/${t!.id}/password`, { newPassword: password });
        }
      }
      onClose();
    } catch (e: any) {
      setError(e?.message || 'save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!t) return;
    if (t.id === currentUserId) {
      setError('不能刪除自己');
      return;
    }
    if (!confirm(`確定刪除帳號 ${t.username}？此動作無法復原。`)) return;
    setSaving(true);
    try {
      await apiDelete(`/api/users/${t.id}`);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'delete failed');
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-6 overflow-y-auto bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl my-8">
        <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-zinc-100">
            {isNew ? '新增帳號' : `編輯：${t!.username}`}
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-xl w-8 h-8">×</button>
        </header>

        {error && (
          <div className="mx-6 mt-3 px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
            ⚠️ {error}
          </div>
        )}

        <div className="p-6 space-y-4">
          {/* 基本資訊 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">帳號 {!isNew && '(不能改)'}</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={!isNew}
                className="w-full px-3 py-2 rounded-md bg-zinc-900 border border-zinc-700 text-sm text-zinc-100 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">顯示名稱</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-zinc-900 border border-zinc-700 text-sm text-zinc-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              密碼 {!isNew && '(留空 = 不改)'}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={4}
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-md bg-zinc-900 border border-zinc-700 text-sm text-zinc-100"
            />
          </div>

          {!isNew && (
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="accent-sky-500"
              />
              啟用此帳號
            </label>
          )}

          {/* Role template */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">角色（套權限 template）</label>
            <select
              value={role}
              onChange={(e) => applyRoleTemplate(e.target.value)}
              className="px-3 py-2 rounded-md bg-zinc-900 border border-zinc-700 text-sm text-zinc-100"
            >
              {Object.entries(ROLE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v} ({ROLE_TEMPLATES[k]?.length ?? 0} 權限)
                </option>
              ))}
            </select>
            <p className="text-[10px] text-zinc-500 mt-1">
              選 template → 自動勾選對應權限。下面個別勾選 → role 變自訂。
            </p>
          </div>

          {/* Permission 勾選 */}
          <div className="space-y-3">
            <p className="text-xs text-zinc-400">權限勾選 ({permissions.length}/{ALL_PERMISSIONS.length})</p>
            {Object.entries(PERMISSION_GROUPS).map(([group, perms]) => (
              <div key={group} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
                <p className="text-xs font-medium text-zinc-300 mb-2 uppercase">{group}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {perms.map((p) => (
                    <label key={p} className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer hover:text-zinc-100">
                      <input
                        type="checkbox"
                        checked={permissions.includes(p)}
                        onChange={() => togglePerm(p)}
                        className="accent-sky-500"
                      />
                      <span className="font-mono text-[10px] text-zinc-500 w-32">{p}</span>
                      <span>{PERMISSION_LABEL[p] || p}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <footer className="px-6 py-3 border-t border-zinc-800 flex items-center justify-between">
          <div>
            {!isNew && t!.id !== currentUserId && (
              <button
                onClick={handleDelete}
                disabled={saving}
                className="px-3 py-1.5 rounded-md text-xs border border-rose-700/40 text-rose-400 hover:bg-rose-500/10 transition"
              >
                刪除帳號
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-md text-sm border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-md text-sm bg-sky-500 text-zinc-950 font-medium hover:bg-sky-400 transition disabled:opacity-50"
            >
              {saving ? '儲存中...' : '儲存'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
