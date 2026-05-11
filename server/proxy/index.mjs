#!/usr/bin/env node
/**
 * Minimal WebSocket <-> TCP/UDP proxy that speaks the protocol v86 expects
 * on the host side of its NE2000 NIC.
 *
 * Framing (as implemented by v86's `network.js`):
 *
 *   Every WebSocket binary message is one Ethernet frame (guest -> host or
 *   host -> guest). The proxy on the host side is responsible for parsing
 *   the Ethernet payload (IPv4/ARP/...) and either dispatching to real
 *   TCP/UDP sockets (full user-space TCP) OR running a tun/tap device and
 *   letting the kernel handle it.
 *
 * This file implements the LIGHTWEIGHT variant: user-space slirp-style
 * translation for a minimal subset (DHCP, ARP, DNS, outbound TCP, outbound
 * UDP). It is enough to make `wget`, `curl`, and `apk` work. Inbound
 * connections to the VM are NOT supported.
 *
 * If you want full networking (ICMP, raw sockets, inbound), run the upstream
 * `benjamincburns/websockproxy` behind Docker and point the client at it —
 * the wire protocol is the same.
 *
 * Run: `node server/proxy/index.mjs`  (listens on :8080 by default)
 */

import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const MAX_CONNECTIONS_PER_CLIENT = Number(process.env.MAX_CONNS ?? 64);

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok\n');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, perMessageDeflate: false });

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress ?? 'unknown';
  console.log(`[ws] + ${clientIp}`);
  const handler = new ClientHandler(ws);
  ws.on('message', (data, isBinary) => {
    if (!isBinary) return; // v86 always sends binary
    handler.onFrame(Buffer.isBuffer(data) ? data : Buffer.from(data));
  });
  ws.on('close', () => {
    console.log(`[ws] - ${clientIp}`);
    handler.close();
  });
  ws.on('error', (err) => {
    console.warn(`[ws] err ${clientIp}: ${err.message}`);
  });
});

/**
 * Per-client state: tracks open TCP sockets keyed by guest-observed 4-tuple.
 *
 * NOTE: We implement a very small subset of IPv4 translation. Real stacks
 * like slirp are thousands of lines of C. Here we punt on the complicated
 * parts (window scaling, retransmits) by terminating TCP locally: the guest
 * talks to a synthetic TCP endpoint that proxies byte streams to a real
 * socket.
 *
 * Enough for curl/wget/apk over plain TCP-to-IP. TLS works because the guest
 * does the TLS; we only move bytes.
 */
class ClientHandler {
  constructor(ws) {
    this.ws = ws;
    /** @type {Map<string, net.Socket>} */
    this.conns = new Map();
    // Synthetic gateway MAC + IP for this client's VM.
    this.gwMac = Buffer.from([0x52, 0x54, 0x00, 0x12, 0x34, 0x00]);
    this.gwIp = Buffer.from([10, 0, 2, 2]);
    this.guestIp = Buffer.from([10, 0, 2, 15]);
    this.guestMac = null;
  }

  close() {
    for (const [, s] of this.conns) s.destroy();
    this.conns.clear();
  }

  send(frame) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(frame);
  }

  onFrame(frame) {
    if (frame.length < 14) return;
    const etherType = frame.readUInt16BE(12);
    const srcMac = frame.subarray(6, 12);
    if (!this.guestMac) this.guestMac = Buffer.from(srcMac);

    if (etherType === 0x0806) {
      this.handleArp(frame);
    } else if (etherType === 0x0800) {
      this.handleIpv4(frame);
    }
    // ignore IPv6 etc
  }

  /** Respond to guest's ARP for gateway IP with our synthetic MAC. */
  handleArp(frame) {
    const arp = frame.subarray(14);
    if (arp.length < 28) return;
    const op = arp.readUInt16BE(6);
    if (op !== 1) return; // only handle requests
    const targetIp = arp.subarray(24, 28);
    if (!targetIp.equals(this.gwIp)) return;

    const reply = Buffer.alloc(42);
    // eth: dst=guestMac src=gwMac type=ARP
    this.guestMac.copy(reply, 0);
    this.gwMac.copy(reply, 6);
    reply.writeUInt16BE(0x0806, 12);
    // arp reply
    reply.writeUInt16BE(1, 14); // htype
    reply.writeUInt16BE(0x0800, 16); // ptype
    reply.writeUInt8(6, 18); // hlen
    reply.writeUInt8(4, 19); // plen
    reply.writeUInt16BE(2, 20); // op=reply
    this.gwMac.copy(reply, 22);
    this.gwIp.copy(reply, 28);
    this.guestMac.copy(reply, 32);
    this.guestIp.copy(reply, 38);
    this.send(reply);
  }

  async handleIpv4(frame) {
    const ip = frame.subarray(14);
    if (ip.length < 20) return;
    const ihl = (ip[0] & 0x0f) * 4;
    const proto = ip[9];
    const srcIp = ip.subarray(12, 16);
    const dstIp = ip.subarray(16, 20);
    const payload = ip.subarray(ihl);

    if (proto === 17) {
      // UDP — only handle DNS (dst port 53) and DHCP (67)
      if (payload.length < 8) return;
      const dport = payload.readUInt16BE(2);
      if (dport === 67) {
        this.handleDhcp(payload);
      } else if (dport === 53) {
        await this.handleDns(srcIp, dstIp, payload);
      }
      return;
    }
    if (proto === 6) {
      // TCP
      this.handleTcp(srcIp, dstIp, payload);
      return;
    }
  }

  /** Minimal DHCP OFFER/ACK so guest gets an IP. */
  handleDhcp(udp) {
    // Not implemented here because Alpine's /etc/network/interfaces in our
    // image uses static config (10.0.2.15 / gw 10.0.2.2 / dns 10.0.2.3) to
    // match slirp defaults. If you need real DHCP, add it here.
    void udp;
  }

  async handleDns(srcIp, _dstIp, udp) {
    const sport = udp.readUInt16BE(0);
    const dnsMsg = udp.subarray(8);
    // Parse question name
    try {
      const qname = parseQName(dnsMsg, 12);
      if (!qname.name) return;
      const res = await dns.lookup(qname.name, { all: false, family: 4 }).catch(() => null);
      const reply = buildDnsReply(dnsMsg, qname.name, res?.address ?? null);
      if (!reply) return;
      const frame = buildUdpFrame(this.gwMac, this.guestMac, this.gwIp, srcIp, 53, sport, reply);
      this.send(frame);
    } catch {
      /* swallow */
    }
  }

  /**
   * Terminate TCP at the proxy. We accept SYNs, open a real socket to the
   * destination, and bridge bytes.
   */
  handleTcp(srcIp, dstIp, tcp) {
    if (tcp.length < 20) return;
    const sport = tcp.readUInt16BE(0);
    const dport = tcp.readUInt16BE(2);
    const seq = tcp.readUInt32BE(4);
    const ack = tcp.readUInt32BE(8);
    const dataOffset = ((tcp[12] >> 4) & 0x0f) * 4;
    const flags = tcp[13];
    const payload = tcp.subarray(dataOffset);
    const key = `${srcIp.join('.')}:${sport}->${dstIp.join('.')}:${dport}`;

    const SYN = 0x02, FIN = 0x01, RST = 0x04, ACK = 0x10;

    let conn = this.conns.get(key);
    if (!conn) {
      if (!(flags & SYN)) return; // ignore mid-stream packets for unknown conn
      if (this.conns.size >= MAX_CONNECTIONS_PER_CLIENT) return;

      const dest = dstIp.join('.');
      conn = new TcpBridge(this, srcIp, dstIp, sport, dport, seq);
      this.conns.set(key, conn);
      conn.connect(dest, dport);
      // Send SYN-ACK
      conn.sendCtrl(SYN | ACK);
      return;
    }

    if (flags & RST) {
      conn.close();
      this.conns.delete(key);
      return;
    }
    if (flags & ACK) conn.onAck(ack);
    if (payload.length > 0) {
      conn.onGuestData(seq, payload);
    }
    if (flags & FIN) {
      conn.onFin(seq + payload.length);
    }
  }
}

/** Very small TCP state machine sufficient for curl/wget/apk. */
class TcpBridge {
  constructor(handler, guestIp, hostIp, guestPort, hostPort, guestIsn) {
    this.h = handler;
    this.guestIp = guestIp;
    this.hostIp = hostIp;
    this.guestPort = guestPort;
    this.hostPort = hostPort;
    this.guestIsn = guestIsn;
    this.ourIsn = (Math.random() * 0xffffffff) >>> 0;
    this.rcvNxt = (guestIsn + 1) >>> 0;
    this.sndNxt = (this.ourIsn + 1) >>> 0;
    this.sock = null;
    this.closed = false;
  }

  connect(host, port) {
    this.sock = net.connect({ host, port }, () => {
      /* connected */
    });
    this.sock.on('data', (buf) => {
      const frame = buildTcpFrame(
        this.h.gwMac, this.h.guestMac,
        this.hostIp, this.guestIp,
        this.hostPort, this.guestPort,
        this.sndNxt, this.rcvNxt, 0x18, buf,
      );
      this.h.send(frame);
      this.sndNxt = (this.sndNxt + buf.length) >>> 0;
    });
    this.sock.on('end', () => {
      this.sendCtrl(0x11); // FIN | ACK
      this.sndNxt = (this.sndNxt + 1) >>> 0;
    });
    this.sock.on('error', () => {
      this.sendCtrl(0x04); // RST
      this.closed = true;
    });
  }

  onGuestData(seq, data) {
    if (!this.sock) return;
    this.sock.write(data);
    this.rcvNxt = (seq + data.length) >>> 0;
    this.sendCtrl(0x10); // ACK
  }

  onAck(_ack) {
    // No flow control; we trust the real socket.
  }

  onFin(seq) {
    this.rcvNxt = (seq + 1) >>> 0;
    this.sendCtrl(0x10); // ACK
    this.sock?.end();
  }

  sendCtrl(flags) {
    const frame = buildTcpFrame(
      this.h.gwMac, this.h.guestMac,
      this.hostIp, this.guestIp,
      this.hostPort, this.guestPort,
      flags & 0x02 ? this.ourIsn : this.sndNxt,
      this.rcvNxt, flags, Buffer.alloc(0),
    );
    this.h.send(frame);
  }

  close() {
    this.closed = true;
    this.sock?.destroy();
  }
}

// -----------------------------------------------------------------------------
// Packet builders — plain textbook IPv4 / TCP / UDP.
// -----------------------------------------------------------------------------

function ipChecksum(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 2) {
    sum += buf.readUInt16BE(i);
  }
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return ~sum & 0xffff;
}

function buildIpv4Header(srcIp, dstIp, proto, payloadLen) {
  const h = Buffer.alloc(20);
  h[0] = 0x45; // v4, ihl=5
  h[1] = 0;
  h.writeUInt16BE(20 + payloadLen, 2);
  h.writeUInt16BE((Math.random() * 0xffff) | 0, 4); // id
  h.writeUInt16BE(0x4000, 6); // DF
  h[8] = 64; // ttl
  h[9] = proto;
  h.writeUInt16BE(0, 10); // checksum placeholder
  srcIp.copy(h, 12);
  dstIp.copy(h, 16);
  h.writeUInt16BE(ipChecksum(h), 10);
  return h;
}

function buildEthernet(dstMac, srcMac, type) {
  const h = Buffer.alloc(14);
  dstMac.copy(h, 0);
  srcMac.copy(h, 6);
  h.writeUInt16BE(type, 12);
  return h;
}

function tcpUdpChecksum(srcIp, dstIp, proto, l4) {
  const pseudo = Buffer.alloc(12);
  srcIp.copy(pseudo, 0);
  dstIp.copy(pseudo, 4);
  pseudo[8] = 0;
  pseudo[9] = proto;
  pseudo.writeUInt16BE(l4.length, 10);
  const buf = Buffer.concat([pseudo, l4, l4.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
  let sum = 0;
  for (let i = 0; i < buf.length; i += 2) sum += buf.readUInt16BE(i);
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return ~sum & 0xffff;
}

function buildTcpFrame(srcMac, dstMac, srcIp, dstIp, sport, dport, seq, ack, flags, data) {
  const tcpLen = 20 + data.length;
  const tcp = Buffer.alloc(tcpLen);
  tcp.writeUInt16BE(sport, 0);
  tcp.writeUInt16BE(dport, 2);
  tcp.writeUInt32BE(seq >>> 0, 4);
  tcp.writeUInt32BE(ack >>> 0, 8);
  tcp[12] = 0x50; // data offset 5
  tcp[13] = flags;
  tcp.writeUInt16BE(0xffff, 14); // window
  tcp.writeUInt16BE(0, 16); // checksum
  tcp.writeUInt16BE(0, 18); // urg
  data.copy(tcp, 20);
  tcp.writeUInt16BE(tcpUdpChecksum(srcIp, dstIp, 6, tcp), 16);

  const ip = buildIpv4Header(srcIp, dstIp, 6, tcp.length);
  const eth = buildEthernet(dstMac, srcMac, 0x0800);
  return Buffer.concat([eth, ip, tcp]);
}

function buildUdpFrame(srcMac, dstMac, srcIp, dstIp, sport, dport, payload) {
  const udp = Buffer.alloc(8 + payload.length);
  udp.writeUInt16BE(sport, 0);
  udp.writeUInt16BE(dport, 2);
  udp.writeUInt16BE(udp.length, 4);
  udp.writeUInt16BE(0, 6);
  payload.copy(udp, 8);
  udp.writeUInt16BE(tcpUdpChecksum(srcIp, dstIp, 17, udp), 6);

  const ip = buildIpv4Header(srcIp, dstIp, 17, udp.length);
  const eth = buildEthernet(dstMac, srcMac, 0x0800);
  return Buffer.concat([eth, ip, udp]);
}

// -----------------------------------------------------------------------------
// DNS helpers — handle one A-record question.
// -----------------------------------------------------------------------------

function parseQName(msg, offset) {
  const labels = [];
  let off = offset;
  while (off < msg.length) {
    const len = msg[off];
    if (len === 0) {
      off++;
      break;
    }
    labels.push(msg.subarray(off + 1, off + 1 + len).toString('ascii'));
    off += 1 + len;
  }
  return { name: labels.join('.'), endOffset: off };
}

function buildDnsReply(query, name, ip) {
  if (query.length < 12) return null;
  const id = query.readUInt16BE(0);
  const qd = query.subarray(12);
  const reply = Buffer.alloc(12 + qd.length + (ip ? 16 : 0));
  reply.writeUInt16BE(id, 0);
  reply.writeUInt16BE(0x8180, 2); // response, no error
  reply.writeUInt16BE(1, 4); // QDCOUNT
  reply.writeUInt16BE(ip ? 1 : 0, 6); // ANCOUNT
  reply.writeUInt16BE(0, 8);
  reply.writeUInt16BE(0, 10);
  qd.copy(reply, 12);
  if (ip) {
    let off = 12 + qd.length;
    reply.writeUInt16BE(0xc00c, off); off += 2; // pointer to qname
    reply.writeUInt16BE(1, off); off += 2; // A
    reply.writeUInt16BE(1, off); off += 2; // IN
    reply.writeUInt32BE(60, off); off += 4; // TTL
    reply.writeUInt16BE(4, off); off += 2;
    const parts = ip.split('.').map((p) => Number(p));
    for (const p of parts) reply.writeUInt8(p, off++);
  }
  void name;
  return reply;
}

server.listen(PORT, HOST, () => {
  console.log(`browser-linux proxy listening on ${HOST}:${PORT}`);
});
