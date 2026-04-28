import { useMemo, useState, type FormEvent } from 'react';
import type { DiscoverySnapshot, RouterConnection } from '@home-network-topology/shared';

import {
  createRouterConnection,
  deleteRouterConnection,
  runRouterDiscovery,
  testCandidateRouterConnection,
  testRouterConnection,
  updateRouterConnection,
  type RuntimeConfigSummary,
} from '../api/topology';

type RouterSetupPanelProps = Readonly<{
  routers: readonly RouterConnection[];
  runtimeConfig: RuntimeConfigSummary | null;
  onRoutersChange: (routers: RouterConnection[]) => void;
  onDiscoveryComplete: (snapshot: DiscoverySnapshot) => void;
}>;

type RouterFormState = Readonly<{
  id: string;
  label: string;
  baseUrl: string;
  username: string;
  passwordEnvVar: string;
  sshHost: string;
  sshPort: string;
  identityFileEnvVar: string;
}>;

type RouterActionStatus = Readonly<{
  kind: 'idle' | 'saving' | 'testing' | 'discovering' | 'success' | 'error';
  message: string;
}>;

const defaultForm: RouterFormState = {
  id: '',
  label: '',
  baseUrl: '192.168.1.1',
  username: 'root',
  passwordEnvVar: '',
  sshHost: '',
  sshPort: '22',
  identityFileEnvVar: '',
};

export function RouterSetupPanel({ routers, runtimeConfig, onRoutersChange, onDiscoveryComplete }: RouterSetupPanelProps) {
  const [form, setForm] = useState<RouterFormState>(defaultForm);
  const [status, setStatus] = useState<RouterActionStatus>({ kind: 'idle', message: '先填写路由器信息，再测试连接。测试通过后才能保存。' });
  const [editingRouterId, setEditingRouterId] = useState<string | null>(null);
  const [testedSignature, setTestedSignature] = useState<string | null>(null);
  const candidateRouter = useMemo(() => toRouterConnection(form), [form]);
  const candidateSignature = useMemo(() => signatureForRouter(candidateRouter), [candidateRouter]);
  const testPassed = testedSignature === candidateSignature;
  const isEditing = editingRouterId !== null;
  const saveLabel = isEditing ? '保存修改' : '添加路由器';
  const busy = status.kind === 'saving' || status.kind === 'testing' || status.kind === 'discovering';

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const router = candidateRouter;
    if (!testPassed) {
      setStatus({ kind: 'error', message: '请先测试当前表单，连接成功后再保存。' });
      return;
    }

    setStatus({ kind: 'saving', message: `正在保存 ${router.label}…` });

    try {
      const saved = isEditing ? await updateRouterConnection(router) : await createRouterConnection(router);
      onRoutersChange([...routers.filter((entry) => entry.id !== saved.id), saved].sort((left, right) => left.label.localeCompare(right.label)));
      setStatus({ kind: 'success', message: `${saved.label} 已保存，可以运行发现。` });
      setForm({ ...defaultForm, username: form.username, passwordEnvVar: form.passwordEnvVar, sshPort: form.sshPort, identityFileEnvVar: form.identityFileEnvVar });
      setEditingRouterId(null);
      setTestedSignature(null);
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : '路由器保存失败' });
    }
  };

  const testCandidate = async () => {
    const router = candidateRouter;
    setForm(routerToForm(router));
    setTestedSignature(null);
    setStatus({ kind: 'testing', message: `正在测试 ${router.label || router.id || '当前路由器'} 的 SSH 连接…` });

    try {
      const result = await testCandidateRouterConnection(router);
      if (result.reachable) {
        setTestedSignature(signatureForRouter(router));
      }
      setStatus({ kind: result.reachable ? 'success' : 'error', message: result.reachable ? `已确认 WebUI 地址：${router.baseUrl}。连接测试通过，现在可以保存。` : `已确认 WebUI 地址：${router.baseUrl}，但连接测试未通过。请检查 SSH 主机、端口或密钥。` });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : '连接测试失败' });
    }
  };

  const testRouter = async (router: RouterConnection) => {
    setStatus({ kind: 'testing', message: `正在测试 ${router.label} 的 SSH 连接…` });
    try {
      const result = await testRouterConnection(router.id);
      setStatus({ kind: result.reachable ? 'success' : 'error', message: result.reachable ? `${router.label} 可连接。` : `${router.label} 未通过 SSH 测试。` });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : '连接测试失败' });
    }
  };

  const discover = async (router: RouterConnection) => {
    setStatus({ kind: 'discovering', message: `正在发现 ${router.label} 的网络拓扑…` });
    try {
      const snapshot = await runRouterDiscovery(router.id);
      onDiscoveryComplete(snapshot);
      setStatus({ kind: 'success', message: `${router.label} 发现完成，快照 ${snapshot.id} 已保存。` });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : '发现失败' });
    }
  };

  const editRouter = (router: RouterConnection) => {
    setEditingRouterId(router.id);
    setForm(routerToForm(router));
    setTestedSignature(null);
    setStatus({ kind: 'idle', message: `正在编辑 ${router.label}。如有修改，请重新测试连接后保存。` });
  };

  const deleteRouter = async (router: RouterConnection) => {
    setStatus({ kind: 'saving', message: `正在删除 ${router.label}…` });
    try {
      await deleteRouterConnection(router.id);
      onRoutersChange(routers.filter((entry) => entry.id !== router.id));
      if (editingRouterId === router.id) {
        resetForm();
      }
      setStatus({ kind: 'success', message: `${router.label} 已删除。` });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : '删除失败' });
    }
  };

  const resetForm = () => {
    setForm(defaultForm);
    setEditingRouterId(null);
    setTestedSignature(null);
    setStatus({ kind: 'idle', message: '已清空表单。添加前请先测试连接。' });
  };

  const updateForm = (next: RouterFormState) => {
    setForm(next);
    setTestedSignature(null);
  };

  return (
    <section className="setup-panel" aria-label="路由器连接设置" data-testid="router-setup-panel">
      <div className="setup-intro">
        <div>
          <p className="eyebrow">路由器接入</p>
          <h2>先测试，再保存，最后发现 OpenWrt 拓扑</h2>
          <p>{runtimeConfig?.ui.setupHelpText ?? '使用 SSH 密钥或本机代理连接路由器。这里只保存挂载密钥的环境变量名，不保存 SSH 密钥或密码。'}</p>
          <div className="setup-flow" aria-label="设置流程">
            <span>1 填写主机</span>
            <span>2 测试 SSH</span>
            <span>3 保存并发现</span>
          </div>
        </div>
        <ConfigSummary runtimeConfig={runtimeConfig} />
      </div>

      <div className="setup-grid">
        <form className="setup-form" onSubmit={submit}>
          <div className="form-heading">
            <div>
              <p className="eyebrow">{isEditing ? '编辑配置' : '新增配置'}</p>
              <h3>{isEditing ? `修改 ${editingRouterId}` : '添加一台路由器'}</h3>
            </div>
            {testPassed ? <span className="test-badge test-badge--ready">已测试</span> : <span className="test-badge">待测试</span>}
          </div>
          <label>
            <span>路由器 ID</span>
            <input value={form.id} onChange={(event) => updateForm({ ...form, id: event.target.value })} placeholder="zhu-router" required disabled={isEditing} />
          </label>
          <label>
            <span>显示名称</span>
            <input value={form.label} onChange={(event) => updateForm({ ...form, label: event.target.value })} placeholder="主路由" required />
          </label>
          <label>
            <span>WebUI 主机或 URL</span>
            <input value={form.baseUrl} onChange={(event) => updateForm({ ...form, baseUrl: event.target.value })} placeholder="192.168.31.1" required />
            <small>可直接填写 IP/域名；未写协议时默认补全为 https://。也支持显式 http:// 或 https://。</small>
          </label>
          <label>
            <span>SSH 用户名</span>
            <input value={form.username} onChange={(event) => updateForm({ ...form, username: event.target.value })} placeholder="root" required />
          </label>
          <label>
            <span>密码环境变量（预留）</span>
            <input value={form.passwordEnvVar} onChange={(event) => updateForm({ ...form, passwordEnvVar: event.target.value })} placeholder="当前版本不使用 SSH 密码" />
          </label>
          <label>
            <span>SSH 主机覆盖</span>
            <input value={form.sshHost} onChange={(event) => updateForm({ ...form, sshHost: event.target.value })} placeholder="可选，默认使用 WebUI 主机" />
          </label>
          <label>
            <span>SSH 端口</span>
            <input inputMode="numeric" value={form.sshPort} onChange={(event) => updateForm({ ...form, sshPort: event.target.value })} placeholder="22" />
          </label>
          <label>
            <span>密钥文件环境变量</span>
            <input value={form.identityFileEnvVar} onChange={(event) => updateForm({ ...form, identityFileEnvVar: event.target.value })} placeholder="OPENWRT_IDENTITY_FILE" />
          </label>
          <div className="button-row">
            <button type="button" className="ghost-button" onClick={testCandidate} disabled={busy}>测试连接</button>
            <button type="submit" disabled={busy || !testPassed}>{saveLabel}</button>
            {isEditing ? <button type="button" className="ghost-button" onClick={resetForm} disabled={busy}>取消编辑</button> : null}
          </div>
          {!testPassed ? <p className="form-note">保存按钮会在当前表单通过测试后启用；任何字段变更都会要求重新测试。</p> : null}
        </form>

        <div className="router-list">
          <div className={`setup-status setup-status--${status.kind}`} role="status">{status.message}</div>
          {routers.length > 0 ? routers.map((router) => (
            <article key={router.id} className="router-card" data-testid={`router-card-${router.id}`}>
              <div>
                <h3>{router.label}</h3>
                <p>{router.baseUrl}</p>
                <span>{router.username} · {router.identityFileEnvVar ? `密钥来自 ${router.identityFileEnvVar}` : '使用 SSH 密钥或代理认证'}</span>
              </div>
              <div className="button-row">
                <button type="button" className="ghost-button" onClick={() => editRouter(router)} disabled={busy}>编辑</button>
                <button type="button" className="ghost-button" onClick={() => testRouter(router)} disabled={busy}>测试</button>
                <button type="button" onClick={() => discover(router)} disabled={busy}>运行发现</button>
                <button type="button" className="danger-button" onClick={() => deleteRouter(router)} disabled={busy}>删除</button>
              </div>
            </article>
          )) : (
            <div className="router-card router-card--empty">
              <h3>还没有路由器</h3>
              <p>在左侧添加一台 OpenWrt 路由器，或通过 `TOPOLOGY_CONFIG_PATH` 挂载 YAML 配置进行初始化。</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ConfigSummary({ runtimeConfig }: Readonly<{ runtimeConfig: RuntimeConfigSummary | null }>) {
  return (
    <dl className="config-summary" data-testid="runtime-config-summary">
      <div>
        <dt>配置文件</dt>
        <dd>{runtimeConfig?.loaded ? '已挂载' : '未挂载'}</dd>
      </div>
      <div>
        <dt>初始路由器</dt>
        <dd>{runtimeConfig?.routerCount ?? 0}</dd>
      </div>
      <div>
        <dt>数据目录</dt>
        <dd>{runtimeConfig?.dataDirectory ?? '环境变量/默认值'}</dd>
      </div>
    </dl>
  );
}

function toRouterConnection(form: RouterFormState): RouterConnection {
  const sshPort = Number(form.sshPort);
  return {
    id: form.id.trim(),
    label: form.label.trim(),
    baseUrl: normalizeWebUiUrl(form.baseUrl),
    username: form.username.trim(),
    passwordEnvVar: optionalText(form.passwordEnvVar),
    sshHost: optionalText(form.sshHost),
    sshPort: Number.isInteger(sshPort) && sshPort > 0 ? sshPort : undefined,
    identityFileEnvVar: optionalText(form.identityFileEnvVar),
  };
}

function routerToForm(router: RouterConnection): RouterFormState {
  return {
    id: router.id,
    label: router.label,
    baseUrl: router.baseUrl,
    username: router.username,
    passwordEnvVar: router.passwordEnvVar ?? '',
    sshHost: router.sshHost ?? '',
    sshPort: router.sshPort ? String(router.sshPort) : '22',
    identityFileEnvVar: router.identityFileEnvVar ?? '',
  };
}

function normalizeWebUiUrl(value: string): string {
  const trimmed = value.trim();
  const withScheme = /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return url.toString().replace(/\/$/u, '');
  } catch {
    return withScheme;
  }
}

function signatureForRouter(router: RouterConnection): string {
  return JSON.stringify(router);
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
