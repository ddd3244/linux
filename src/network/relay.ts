/**
 * Network relay configuration.
 *
 * v86 ships a slirp-like NAT inside the VM and a generic WebSocket transport
 * on the host side. The host just needs a WS URL that speaks the v86 framing
 * protocol (literally: every message is an ethernet frame). See:
 *   https://github.com/benjamincburns/websockproxy
 *
 * We support three sources:
 *   - `user`   — the user pasted a wss:// URL in settings
 *   - `self`   — our own proxy (server/proxy/index.mjs), hosted next to the app
 *   - `public` — the v86 community proxy (slow, rate-limited, non-guaranteed)
 *   - `none`   — no networking; VM is fully offline
 */

export type RelaySource = 'user' | 'self' | 'public' | 'none';

export interface RelayConfig {
  source: RelaySource;
  url: string | null;
}

/** Public relay URL, last known. */
export const PUBLIC_V86_RELAY = 'wss://relay.widgetry.org/';

/**
 * Build the WS URL to co-host with the static app.
 * E.g. if app is at https://linux.example.com/, the proxy is at wss://linux.example.com/net/.
 */
export function selfRelayUrlFromLocation(loc: Location = location): string {
  const scheme = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${loc.host}/net/`;
}

export function resolveRelay(preferred: RelaySource, userUrl?: string | null): RelayConfig {
  switch (preferred) {
    case 'none':
      return { source: 'none', url: null };
    case 'user':
      return { source: 'user', url: userUrl?.trim() || null };
    case 'self':
      return { source: 'self', url: selfRelayUrlFromLocation() };
    case 'public':
      return { source: 'public', url: PUBLIC_V86_RELAY };
  }
}
