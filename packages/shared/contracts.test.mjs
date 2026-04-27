import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  NAMING_FALLBACK_ORDER,
  WIFI_BANDS,
  resolveDeviceName,
  validateRuntimeConfig,
} from './dist/index.js';

describe('runtime config validation', () => {
  it('accepts valid YAML-shaped runtime config input', () => {
    const result = validateRuntimeConfig({
      routers: [
        {
          id: 'main-router',
          label: 'Main router',
          baseUrl: 'https://192.168.1.1',
          username: 'root',
          passwordEnvVar: 'OPENWRT_PASSWORD',
        },
      ],
      dataDirectory: './data',
      discoveryIntervalSeconds: 300,
      ui: {
        defaultView: 'setup',
        setupHelpText: 'Use env var names for SSH secrets.',
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.value.routers[0].id, 'main-router');
  });

  it('accepts config with only UI defaults', () => {
    const result = validateRuntimeConfig({
      ui: {
        defaultView: 'topology',
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.value.ui, { defaultView: 'topology' });
  });

  it('rejects invalid YAML-shaped runtime config input', () => {
    const result = validateRuntimeConfig({
      routers: [
        {
          id: 'main-router',
          label: '',
          baseUrl: 'not a url',
          username: 'root',
        },
      ],
      discoveryIntervalSeconds: 0,
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /routers\[0\]\.label/);
    assert.match(result.errors.join('\n'), /routers\[0\]\.baseUrl/);
    assert.match(result.errors.join('\n'), /routers\[0\]\.passwordEnvVar/);
    assert.match(result.errors.join('\n'), /discoveryIntervalSeconds/);
  });
});

describe('device naming fallback', () => {
  it('documents the fallback order', () => {
    assert.deepEqual(NAMING_FALLBACK_ORDER, ['discoveredHostname', 'dhcpHostname', 'ipAddress', 'macShort']);
  });

  it('uses discovered hostname before all other names', () => {
    assert.deepEqual(
      resolveDeviceName({
        discoveredHostname: 'phone.local',
        dhcpHostname: 'phone-dhcp',
        ipAddresses: ['192.168.1.30'],
        macAddress: 'AA:BB:CC:DD:EE:FF',
      }),
      { name: 'phone.local', source: 'discoveredHostname' },
    );
  });

  it('falls back through DHCP hostname, IP address, and MAC short form', () => {
    assert.deepEqual(
      resolveDeviceName({
        dhcpHostname: 'laptop',
        ipAddresses: ['192.168.1.20'],
        macAddress: 'AA:BB:CC:DD:EE:FF',
      }),
      { name: 'laptop', source: 'dhcpHostname' },
    );

    assert.deepEqual(
      resolveDeviceName({
        ipAddresses: ['192.168.1.21'],
        macAddress: 'AA:BB:CC:DD:EE:FF',
      }),
      { name: '192.168.1.21', source: 'ipAddress' },
    );

    assert.deepEqual(
      resolveDeviceName({
        ipAddresses: [],
        macAddress: 'AA:BB:CC:DD:EE:FF',
      }),
      { name: 'EEFF', source: 'macShort' },
    );
  });
});

describe('Wi-Fi band contract', () => {
  it('keeps Wi-Fi bands explicit', () => {
    assert.deepEqual(WIFI_BANDS, ['2.4G', '5G', 'Unknown']);
  });
});
