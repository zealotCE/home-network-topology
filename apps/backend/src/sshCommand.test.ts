import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { runSshCommand, type SshChildProcess, type SshSpawnOptions } from './sshCommand.js';

test('runSshCommand captures stdout for a successful command', async () => {
  const child = createFakeChild();
  const calls: SpawnCall[] = [];
  const resultPromise = runSshCommand({
    host: '192.168.1.1',
    port: 2222,
    username: 'root',
    identityFile: '/tmp/router_key',
    command: ['ubus', 'call', 'system', 'board'],
    timeoutMs: 5_000,
    spawn: createSpawn(calls, child),
  });

  child.stdout.write('{"hostname":"openwrt"}\n');
  child.emit('close', 0, null);

  const result = await resultPromise;

  assert.deepEqual(result, {
    exitCode: 0,
    signal: null,
    stdout: '{"hostname":"openwrt"}\n',
    stderr: '',
    timedOut: false,
  });
  assert.deepEqual(calls, [
    {
      command: 'ssh',
      args: [
        '-o',
        'BatchMode=yes',
        '-o',
        'StrictHostKeyChecking=accept-new',
        '-o',
        'UserKnownHostsFile=/data/ssh_known_hosts',
        '-o',
        'ConnectTimeout=5',
        '-p',
        '2222',
        '-i',
        '/tmp/router_key',
        '--',
        'root@192.168.1.1',
        'ubus',
        'call',
        'system',
        'board',
      ],
      options: { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
    },
  ]);
});

test('runSshCommand stores host-key trust in the configured data directory', async () => {
  const originalDataDir = process.env.TOPOLOGY_DATA_DIR;
  process.env.TOPOLOGY_DATA_DIR = '/var/lib/topology/';

  try {
    const child = createFakeChild();
    const calls: SpawnCall[] = [];
    const resultPromise = runSshCommand({
      host: 'router.lan',
      username: 'root',
      command: ['true'],
      timeoutMs: 1_000,
      spawn: createSpawn(calls, child),
    });

    child.emit('close', 0, null);

    assert.equal((await resultPromise).exitCode, 0);
    assert.deepEqual(calls[0]?.args.slice(0, 8), [
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'UserKnownHostsFile=/var/lib/topology/ssh_known_hosts',
      '-o',
      'ConnectTimeout=1',
    ]);
  } finally {
    if (originalDataDir === undefined) {
      delete process.env.TOPOLOGY_DATA_DIR;
    } else {
      process.env.TOPOLOGY_DATA_DIR = originalDataDir;
    }
  }
});

test('runSshCommand captures stderr and non-zero exit code', async () => {
  const child = createFakeChild();
  const resultPromise = runSshCommand({
    host: 'router.lan',
    username: 'root',
    command: ['iwinfo', 'wlan0', 'assoclist'],
    timeoutMs: 1_000,
    spawn: createSpawn([], child),
  });

  child.stderr.write('No such wireless device\n');
  child.emit('close', 1, null);

  assert.deepEqual(await resultPromise, {
    exitCode: 1,
    signal: null,
    stdout: '',
    stderr: 'No such wireless device\n',
    timedOut: false,
  });
});

test('runSshCommand returns a timed out result without waiting for close', async () => {
  const child = createFakeChild();
  let timeoutCallback: (() => void) | undefined;
  const clearedHandles: unknown[] = [];
  const resultPromise = runSshCommand({
    host: 'router.lan',
    username: 'root',
    command: ['cat', '/tmp/dhcp.leases'],
    timeoutMs: 10,
    spawn: createSpawn([], child),
    setTimeoutFn: (callback, timeoutMs) => {
      assert.equal(timeoutMs, 10);
      timeoutCallback = callback;
      return 'timeout-handle';
    },
    clearTimeoutFn: (handle) => {
      clearedHandles.push(handle);
    },
  });

  child.stdout.write('partial output');
  timeoutCallback?.();

  assert.deepEqual(await resultPromise, {
    exitCode: null,
    signal: 'SIGTERM',
    stdout: 'partial output',
    stderr: '',
    timedOut: true,
  });
  assert.deepEqual(child.killCalls, ['SIGTERM']);
  assert.deepEqual(clearedHandles, ['timeout-handle']);

  child.emit('close', 0, null);
});

type SpawnCall = {
  command: string;
  args: string[];
  options: SshSpawnOptions;
};

function createSpawn(calls: SpawnCall[], child: FakeChild): (command: string, args: string[], options: SshSpawnOptions) => SshChildProcess {
  return (command, args, options) => {
    calls.push({ command, args, options });
    return child;
  };
}

type FakeChild = SshChildProcess & EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  killCalls: NodeJS.Signals[];
  emit(event: 'close', code: number | null, signal: NodeJS.Signals | null): boolean;
};

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killCalls = [];
  child.kill = (signal = 'SIGTERM') => {
    child.killCalls.push(signal);
    return true;
  };

  return child;
}
