import assert from 'node:assert/strict';
import test from 'node:test';

import type { RouterConnection } from '@home-network-topology/shared';

import { OPENWRT_DISCOVERY_COMMANDS, OpenWrtDiscoveryCollector, toSshTarget } from './openWrtCollector.js';
import type { RunSshCommandOptions, SshCommandResult } from '../sshCommand.js';

const router: RouterConnection = {
  id: 'main-router',
  label: 'Main router',
  baseUrl: 'https://router.local',
  username: 'root',
  passwordEnvVar: 'ROUTER_PASSWORD',
  sshHost: '192.168.1.1',
  sshPort: 2222,
  identityFileEnvVar: 'ROUTER_IDENTITY_FILE',
};

test('connection test reports reachable routers', async () => {
  const calls: RunSshCommandOptions[] = [];
  const collector = new OpenWrtDiscoveryCollector({
    env: { ROUTER_IDENTITY_FILE: '/tmp/router_key' },
    runCommand: async (options) => {
      calls.push(options);
      return sshResult({ stdout: '{"hostname":"OpenWrt"}\n' });
    },
  });

  const result = await collector.testConnection(router);

  assert.equal(result.reachable, true);
  assert.equal(result.command.label, 'connection_test');
  assert.equal(result.command.exitCode, 0);
  assert.deepEqual(calls.map(({ host, port, username, identityFile, command }) => ({ host, port, username, identityFile, command })), [
    {
      host: '192.168.1.1',
      port: 2222,
      username: 'root',
      identityFile: '/tmp/router_key',
      command: ['ubus', 'call', 'system', 'board'],
    },
  ]);
});

test('connection test reports unreachable routers without throwing', async () => {
  const collector = new OpenWrtDiscoveryCollector({
    runCommand: async () => sshResult({ exitCode: 255, stderr: 'Permission denied\n' }),
  });

  const result = await collector.testConnection(router);

  assert.equal(result.reachable, false);
  assert.equal(result.command.exitCode, 255);
  assert.equal(result.command.stderr, 'Permission denied\n');
});

test('collector isolates command failures inside raw snapshot results', async () => {
  const collector = new OpenWrtDiscoveryCollector({
    now: createClock(),
    createId: () => 'fixed-id',
    runCommand: async (options) => {
      if (options.command[0] === 'iwinfo') {
        return sshResult({ exitCode: 127, stderr: 'iwinfo: not found\n' });
      }

      return sshResult({ stdout: `${options.command.join(' ')}\n` });
    },
  });

  const snapshot = await collector.collectSnapshot(router);

  assert.equal(snapshot.id, 'snapshot-fixed-id');
  assert.equal(snapshot.rawCommands?.length, OPENWRT_DISCOVERY_COMMANDS.length);
  assert.equal(snapshot.rawCommands?.find((command) => command.label === 'iwinfo_summary')?.exitCode, 127);
  assert.equal(snapshot.rawCommands?.find((command) => command.label === 'network_interfaces')?.exitCode, 0);
  assert.deepEqual(snapshot.devices, []);
  assert.deepEqual(snapshot.topology.nodes, [{ id: 'router-main-router', kind: 'router', label: 'Main router', routerId: 'main-router' }]);
});

test('SSH target falls back to the router base URL host', () => {
  assert.deepEqual(toSshTarget({ ...router, sshHost: undefined, sshPort: undefined, identityFileEnvVar: undefined }), {
    host: 'router.local',
    port: 22,
    username: 'root',
    identityFile: undefined,
  });
});

function sshResult(overrides: Partial<SshCommandResult> = {}): SshCommandResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    ...overrides,
  };
}

function createClock(): () => Date {
  let timestamp = Date.parse('2026-04-27T10:00:00.000Z');
  return () => {
    const value = new Date(timestamp);
    timestamp += 1_000;
    return value;
  };
}
