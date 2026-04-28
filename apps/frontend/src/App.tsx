import { useEffect, useState } from 'react';
import '@xyflow/react/dist/style.css';

import { APP_NAME, type DiscoverySnapshot, type RouterConnection } from '@home-network-topology/shared';

import { fetchRouterConnections, fetchRuntimeConfig, fetchTopologyData, type RuntimeConfigSummary } from './api/topology';
import { RouterSetupPanel } from './components/RouterSetupPanel';
import { TopologyCanvas } from './components/TopologyCanvas';
import type { TopologyData } from './types/topology';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; topologyData: TopologyData | null; routers: RouterConnection[]; runtimeConfig: RuntimeConfigSummary | null; topologyError?: string }
  | { status: 'error'; message: string };

type ActiveView = 'topology' | 'setup';

export default function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [activeView, setActiveView] = useState<ActiveView>('topology');

  const loadAppData = async (signal?: AbortSignal) => {
    try {
      const [runtimeConfig, routers, topologyResult] = await Promise.all([
        fetchRuntimeConfig(signal),
        fetchRouterConnections(signal),
        fetchTopologyData(signal).then(
          (data) => ({ ok: true as const, data }),
            (error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : '无法加载拓扑数据' }),
        ),
      ]);

      if (signal?.aborted) {
        return;
      }

      const nextView = runtimeConfig.ui.defaultView ?? (topologyResult.ok ? 'topology' : 'setup');
      setActiveView(nextView);
      setLoadState({
        status: 'ready',
        topologyData: topologyResult.ok ? topologyResult.data : null,
        topologyError: topologyResult.ok ? undefined : topologyResult.message,
        routers,
        runtimeConfig,
      });
    } catch (error: unknown) {
      if (!signal?.aborted) {
        setLoadState({ status: 'error', message: error instanceof Error ? error.message : '无法加载应用数据' });
      }
    }
  };

  useEffect(() => {
    const controller = new AbortController();

    void loadAppData(controller.signal);

    return () => controller.abort();
  }, []);

  return (
    <main className="app-shell">
      <header className="shell-header">
        <div>
          <p className="eyebrow">家庭网络拓扑</p>
          <h1>{APP_NAME}</h1>
        </div>
        <nav aria-label="主导航">
          <button type="button" className={activeView === 'topology' ? 'nav-pill is-active' : 'nav-pill'} aria-current={activeView === 'topology' ? 'page' : undefined} onClick={() => setActiveView('topology')}>拓扑图</button>
          <button type="button" className={activeView === 'setup' ? 'nav-pill is-active' : 'nav-pill'} aria-current={activeView === 'setup' ? 'page' : undefined} onClick={() => setActiveView('setup')}>路由器接入</button>
          <span>手动修正</span>
        </nav>
      </header>

      {loadState.status === 'loading' ? <LoadingState /> : null}
      {loadState.status === 'error' ? <ErrorState message={loadState.message} /> : null}
      {loadState.status === 'ready' && activeView === 'setup' ? (
        <RouterSetupPanel
          routers={loadState.routers}
          runtimeConfig={loadState.runtimeConfig}
          onRoutersChange={(routers) => setLoadState({ ...loadState, routers, topologyData: loadState.topologyData ? { ...loadState.topologyData, routers } : null })}
          onDiscoveryComplete={(snapshot) => handleDiscoveryComplete(snapshot, loadState, setLoadState)}
        />
      ) : null}
      {loadState.status === 'ready' && activeView === 'topology' ? (
        loadState.topologyData
          ? <TopologyCanvas data={loadState.topologyData} onDataChange={(topologyData) => setLoadState({ ...loadState, topologyData, routers: [...topologyData.routers] })} />
          : <TopologyMissingState message={loadState.topologyError ?? '还没有捕获拓扑快照。'} onSetup={() => setActiveView('setup')} />
      ) : null}
    </main>
  );
}

function handleDiscoveryComplete(snapshot: DiscoverySnapshot, current: Extract<LoadState, { status: 'ready' }>, setLoadState: (state: LoadState) => void) {
  void fetchTopologyData()
    .then((topologyData) => {
      setLoadState({ ...current, topologyData, routers: [...topologyData.routers], topologyError: undefined });
    })
    .catch((error: unknown) => {
        setLoadState({ ...current, topologyError: error instanceof Error ? error.message : `发现 ${snapshot.id} 已完成，但拓扑刷新失败。` });
    });
}

function LoadingState() {
  return (
    <section className="status-card" data-testid="topology-loading-state">
      <span className="status-orb" aria-hidden="true" />
      <p className="eyebrow">正在加载拓扑</p>
      <h2>正在组合最新发现的网络图。</h2>
      <p>正在读取 `/api/topology/graph`、路由器详情和最新快照元数据。</p>
    </section>
  );
}

function ErrorState({ message }: Readonly<{ message: string }>) {
  return (
    <section className="status-card status-card--error" data-testid="topology-error-state" role="alert">
      <p className="eyebrow">拓扑不可用</p>
      <h2>无法加载网络图 API。</h2>
      <p>{message}</p>
    </section>
  );
}

function TopologyMissingState({ message, onSetup }: Readonly<{ message: string; onSetup: () => void }>) {
  return (
    <section className="status-card" data-testid="topology-missing-state">
      <p className="eyebrow">需要先发现</p>
      <h2>当前还没有可展示的拓扑。</h2>
      <p>{message}</p>
      <div className="button-row">
        <button type="button" onClick={onSetup}>打开路由器接入</button>
      </div>
    </section>
  );
}
