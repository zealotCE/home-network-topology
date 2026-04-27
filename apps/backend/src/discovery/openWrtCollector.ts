import { randomUUID } from 'node:crypto';

import type { DiscoveryCommandResult, DiscoverySnapshot, RouterConnection } from '@home-network-topology/shared';

import { runSshCommand, type RunSshCommandOptions, type SshCommandResult } from '../sshCommand.js';

export type DiscoveryCommandSpec = Readonly<{
  label: string;
  command: readonly string[];
}>;

export type OpenWrtDiscoveryCollectorOptions = Readonly<{
  timeoutMs?: number;
  runCommand?: (options: RunSshCommandOptions) => Promise<SshCommandResult>;
  now?: () => Date;
  createId?: () => string;
  env?: NodeJS.ProcessEnv;
}>;

export type RouterConnectionTestResult = Readonly<{
  routerId: string;
  reachable: boolean;
  command: DiscoveryCommandResult;
}>;

export const OPENWRT_DISCOVERY_COMMANDS: readonly DiscoveryCommandSpec[] = [
  { label: 'network_interfaces', command: ['ubus', 'call', 'network.interface', 'dump'] },
  { label: 'wireless_status', command: ['ubus', 'call', 'wireless', 'status'] },
  { label: 'iwinfo_summary', command: ['iwinfo'] },
  {
    label: 'iwinfo_assoclist',
    command: ['sh', '-c', 'for iface in $(iwinfo 2>/dev/null | sed -n "s/^\\([^ ]*\\) .*ESSID:.*/\\1/p"); do echo "## $iface"; iwinfo "$iface" assoclist; done'],
  },
  {
    label: 'hostapd_clients',
    command: ['sh', '-c', 'for sock in /var/run/hostapd-*/* /var/run/hostapd/*; do [ -S "$sock" ] || continue; echo "## $sock"; hostapd_cli -p "$(dirname "$sock")" -i "$(basename "$sock")" all_sta; done'],
  },
  { label: 'ip_neighbors', command: ['ip', 'neigh'] },
  { label: 'dhcp_leases', command: ['sh', '-c', 'cat /tmp/dhcp.leases /tmp/hosts/odhcpd'] },
];

const CONNECTION_TEST_COMMAND: DiscoveryCommandSpec = {
  label: 'connection_test',
  command: ['ubus', 'call', 'system', 'board'],
};

const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;

export class OpenWrtDiscoveryCollector {
  private readonly timeoutMs: number;
  private readonly runCommand: (options: RunSshCommandOptions) => Promise<SshCommandResult>;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: OpenWrtDiscoveryCollectorOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.runCommand = options.runCommand ?? runSshCommand;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.env = options.env ?? process.env;
  }

  async testConnection(router: RouterConnection): Promise<RouterConnectionTestResult> {
    const command = await this.collectCommand(router, CONNECTION_TEST_COMMAND);
    return {
      routerId: router.id,
      reachable: isSuccessful(command),
      command,
    };
  }

  async collectSnapshot(router: RouterConnection): Promise<DiscoverySnapshot> {
    const capturedAt = this.now().toISOString();
    const rawCommands: DiscoveryCommandResult[] = [];

    for (const spec of OPENWRT_DISCOVERY_COMMANDS) {
      rawCommands.push(await this.collectCommand(router, spec));
    }

    return {
      id: `snapshot-${this.createId()}`,
      capturedAt,
      routers: [router],
      devices: [],
      topology: {
        nodes: [{ id: `router-${router.id}`, kind: 'router', label: router.label, routerId: router.id }],
        edges: [],
      },
      rawCommands,
    };
  }

  private async collectCommand(router: RouterConnection, spec: DiscoveryCommandSpec): Promise<DiscoveryCommandResult> {
    const startedAt = this.now().toISOString();
    const result = await this.runCommand({
      ...toSshTarget(router, this.env),
      command: spec.command,
      timeoutMs: this.timeoutMs,
    });
    const completedAt = this.now().toISOString();

    return {
      label: spec.label,
      command: spec.command,
      startedAt,
      completedAt,
      exitCode: result.exitCode,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
    };
  }
}

export function toSshTarget(router: RouterConnection, env: NodeJS.ProcessEnv = process.env): Pick<RunSshCommandOptions, 'host' | 'port' | 'username' | 'identityFile'> {
  const baseUrl = new URL(router.baseUrl);
  const identityFile = router.identityFileEnvVar ? env[router.identityFileEnvVar] : undefined;

  return {
    host: router.sshHost ?? baseUrl.hostname,
    port: router.sshPort ?? 22,
    username: router.username,
    identityFile,
  };
}

function isSuccessful(command: DiscoveryCommandResult): boolean {
  return command.exitCode === 0 && !command.timedOut;
}
