import { useMemo, useState, type FormEvent } from 'react';
import type { DiscoverySnapshot, RouterConnection } from '@home-network-topology/shared';

import { createRouterConnection, runRouterDiscovery, testRouterConnection, type RuntimeConfigSummary } from '../api/topology';

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
  baseUrl: 'https://192.168.1.1',
  username: 'root',
  passwordEnvVar: 'OPENWRT_PASSWORD',
  sshHost: '',
  sshPort: '22',
  identityFileEnvVar: '',
};

export function RouterSetupPanel({ routers, runtimeConfig, onRoutersChange, onDiscoveryComplete }: RouterSetupPanelProps) {
  const [form, setForm] = useState<RouterFormState>(defaultForm);
  const [status, setStatus] = useState<RouterActionStatus>({ kind: 'idle', message: 'Ready to configure router connections.' });
  const configuredRouterIds = useMemo(() => new Set(routers.map((router) => router.id)), [routers]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const router = toRouterConnection(form);
    setStatus({ kind: 'saving', message: `Saving ${router.label}…` });

    try {
      const saved = await createRouterConnection(router);
      onRoutersChange([...routers.filter((entry) => entry.id !== saved.id), saved].sort((left, right) => left.label.localeCompare(right.label)));
      setStatus({ kind: 'success', message: `${saved.label} saved. Test the SSH connection before discovery.` });
      setForm({ ...defaultForm, id: '', label: '', baseUrl: form.baseUrl, username: form.username, passwordEnvVar: form.passwordEnvVar, sshPort: form.sshPort });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to save router connection' });
    }
  };

  const testRouter = async (router: RouterConnection) => {
    setStatus({ kind: 'testing', message: `Testing SSH connection to ${router.label}…` });
    try {
      const result = await testRouterConnection(router.id);
      setStatus({ kind: result.reachable ? 'success' : 'error', message: result.reachable ? `${router.label} is reachable.` : `${router.label} did not pass the SSH test.` });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Connection test failed' });
    }
  };

  const discover = async (router: RouterConnection) => {
    setStatus({ kind: 'discovering', message: `Running discovery on ${router.label}…` });
    try {
      const snapshot = await runRouterDiscovery(router.id);
      onDiscoveryComplete(snapshot);
      setStatus({ kind: 'success', message: `Discovery finished for ${router.label}. Captured snapshot ${snapshot.id}.` });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Discovery failed' });
    }
  };

  return (
    <section className="setup-panel" aria-label="Router connection setup" data-testid="router-setup-panel">
      <div className="setup-intro">
        <div>
          <p className="eyebrow">Router setup</p>
          <h2>Create, test, and discover OpenWrt routers</h2>
          <p>{runtimeConfig?.ui.setupHelpText ?? 'Store only environment variable names for SSH secrets here. The backend resolves passwords or identity files from the container environment at runtime.'}</p>
        </div>
        <ConfigSummary runtimeConfig={runtimeConfig} />
      </div>

      <div className="setup-grid">
        <form className="setup-form" onSubmit={submit}>
          <label>
            <span>Router ID</span>
            <input value={form.id} onChange={(event) => setForm({ ...form, id: event.target.value })} placeholder="main-router" required />
          </label>
          <label>
            <span>Display label</span>
            <input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="Main router" required />
          </label>
          <label>
            <span>Web UI URL</span>
            <input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://192.168.1.1" required />
          </label>
          <label>
            <span>SSH username</span>
            <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="root" required />
          </label>
          <label>
            <span>Password env var</span>
            <input value={form.passwordEnvVar} onChange={(event) => setForm({ ...form, passwordEnvVar: event.target.value })} placeholder="OPENWRT_PASSWORD" required />
          </label>
          <label>
            <span>SSH host override</span>
            <input value={form.sshHost} onChange={(event) => setForm({ ...form, sshHost: event.target.value })} placeholder="Optional, defaults to Web UI host" />
          </label>
          <label>
            <span>SSH port</span>
            <input inputMode="numeric" value={form.sshPort} onChange={(event) => setForm({ ...form, sshPort: event.target.value })} placeholder="22" />
          </label>
          <label>
            <span>Identity file env var</span>
            <input value={form.identityFileEnvVar} onChange={(event) => setForm({ ...form, identityFileEnvVar: event.target.value })} placeholder="OPENWRT_IDENTITY_FILE" />
          </label>
          <div className="button-row">
            <button type="submit" disabled={status.kind === 'saving'}>{configuredRouterIds.has(form.id) ? 'Update router' : 'Create router'}</button>
          </div>
        </form>

        <div className="router-list">
          <div className={`setup-status setup-status--${status.kind}`} role="status">{status.message}</div>
          {routers.length > 0 ? routers.map((router) => (
            <article key={router.id} className="router-card" data-testid={`router-card-${router.id}`}>
              <div>
                <h3>{router.label}</h3>
                <p>{router.baseUrl}</p>
                <span>{router.username} · secret from {router.passwordEnvVar}</span>
              </div>
              <div className="button-row">
                <button type="button" className="ghost-button" onClick={() => testRouter(router)} disabled={status.kind === 'testing' || status.kind === 'discovering'}>Test connection</button>
                <button type="button" onClick={() => discover(router)} disabled={status.kind === 'testing' || status.kind === 'discovering'}>Run discovery</button>
              </div>
            </article>
          )) : (
            <div className="router-card router-card--empty">
              <h3>No routers configured</h3>
              <p>Create one here or mount a YAML config at `TOPOLOGY_CONFIG_PATH` to bootstrap router definitions.</p>
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
        <dt>Config file</dt>
        <dd>{runtimeConfig?.loaded ? 'Mounted' : 'Not mounted'}</dd>
      </div>
      <div>
        <dt>Bootstrap routers</dt>
        <dd>{runtimeConfig?.routerCount ?? 0}</dd>
      </div>
      <div>
        <dt>Data directory</dt>
        <dd>{runtimeConfig?.dataDirectory ?? 'Environment/default'}</dd>
      </div>
    </dl>
  );
}

function toRouterConnection(form: RouterFormState): RouterConnection {
  const sshPort = Number(form.sshPort);
  return {
    id: form.id.trim(),
    label: form.label.trim(),
    baseUrl: form.baseUrl.trim(),
    username: form.username.trim(),
    passwordEnvVar: form.passwordEnvVar.trim(),
    sshHost: optionalText(form.sshHost),
    sshPort: Number.isInteger(sshPort) && sshPort > 0 ? sshPort : undefined,
    identityFileEnvVar: optionalText(form.identityFileEnvVar),
  };
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
