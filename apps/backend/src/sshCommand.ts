import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

export type SshCommandResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type RunSshCommandOptions = {
  host: string;
  username: string;
  command: readonly string[];
  port?: number;
  identityFile?: string;
  timeoutMs?: number;
  spawn?: SpawnSshProcess;
  setTimeoutFn?: (callback: () => void, timeoutMs: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
};

export type SpawnSshProcess = (command: string, args: string[], options: SshSpawnOptions) => SshChildProcess;

export type SshSpawnOptions = {
  shell: false;
  stdio: ['ignore', 'pipe', 'pipe'];
};

export type SshChildProcess = {
  stdout: Readable | null;
  stderr: Readable | null;
  kill: (signal?: NodeJS.Signals) => boolean;
  on: {
    (event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): SshChildProcess;
    (event: 'error', listener: (error: Error) => void): SshChildProcess;
  };
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_DATA_DIR = '/data';
const KNOWN_HOSTS_FILENAME = 'ssh_known_hosts';

export function runSshCommand(options: RunSshCommandOptions): Promise<SshCommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  validateOptions(options, timeoutMs);

  const spawnProcess = options.spawn ?? spawn;
  const setTimeoutFn = options.setTimeoutFn ?? defaultSetTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? defaultClearTimeout;
  const child = spawnProcess('ssh', buildSshArgs(options, timeoutMs), {
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeout: unknown;

    const settle = (result: Pick<SshCommandResult, 'exitCode' | 'signal' | 'timedOut'>) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeoutFn(timeout);
      resolve({
        ...result,
        stdout,
        stderr,
      });
    };

    timeout = setTimeoutFn(() => {
      if (settled) {
        return;
      }

      child.kill('SIGTERM');
      settle({ exitCode: null, signal: 'SIGTERM', timedOut: true });
    }, timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string | Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string | Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      stderr += stderr ? `\n${error.message}` : error.message;
      settle({ exitCode: null, signal: null, timedOut: false });
    });

    child.on('close', (exitCode, signal) => {
      settle({ exitCode, signal, timedOut: false });
    });
  });
}

function buildSshArgs(options: RunSshCommandOptions, timeoutMs: number): string[] {
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    `UserKnownHostsFile=${getKnownHostsFile()}`,
    '-o',
    `ConnectTimeout=${Math.max(1, Math.ceil(timeoutMs / 1000))}`,
  ];

  if (options.port !== undefined) {
    args.push('-p', String(options.port));
  }

  if (options.identityFile !== undefined) {
    args.push('-i', options.identityFile);
  }

  args.push('--', `${options.username}@${options.host}`, ...options.command);
  return args;
}

function getKnownHostsFile(): string {
  const dataDir = (process.env.TOPOLOGY_DATA_DIR ?? DEFAULT_DATA_DIR).replace(/\/+$/u, '') || DEFAULT_DATA_DIR;
  return `${dataDir}/${KNOWN_HOSTS_FILENAME}`;
}

function validateOptions(options: RunSshCommandOptions, timeoutMs: number): void {
  requireSafeToken(options.host, 'host');
  requireSafeToken(options.username, 'username');

  if (options.command.length === 0) {
    throw new Error('command must include at least one argument');
  }

  options.command.forEach((part, index) => {
    if (part.length === 0) {
      throw new Error(`command[${index}] must not be empty`);
    }
  });

  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535)) {
    throw new Error('port must be an integer from 1 to 65535');
  }

  if (options.identityFile !== undefined) {
    requireSafeToken(options.identityFile, 'identityFile');
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('timeoutMs must be a positive integer');
  }
}

function requireSafeToken(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }

  if (value.startsWith('-') || /\s/u.test(value)) {
    throw new Error(`${label} must not start with '-' or contain whitespace`);
  }
}

function defaultSetTimeout(callback: () => void, timeoutMs: number): unknown {
  return setTimeout(callback, timeoutMs);
}

function defaultClearTimeout(handle: unknown): void {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}
