// SSE (Server-Sent Events) broadcaster
//
// 用途：server 端把 record-level 變更即時推給所有 client。
//
// 連線生命週期：
//   client GET /events → server 回 text/event-stream → 持久連線（HTTP long-lived）
//   server broadcast() → 寫到每個連線 res → client 端 EventSource onmessage
//
// 訊息格式（每筆事件包成 SSE frame）：
//   id: <unique-id>
//   event: <eventName>      e.g. patient.updated
//   data: <json>            e.g. {"id":"abc","version":2,...}
//   \n\n
//
// 設計重點：
//   - 每連線塞 clientId（從 X-Client-Id header），broadcast 時可選擇 exclude 自己
//     (廣播者不需要收到自己剛剛改的東西)
//   - 保留最近 100 筆事件 in-memory：client 短暫斷線重連 + Last-Event-ID header → 補推漏掉的
//     超過 100 筆的話、client 直接 GET /api/<entity>?since= 補增量
//   - 30s heartbeat 防中間 proxy / NAS 砍 idle 連線

import crypto from 'node:crypto';

class SseBroadcaster {
  constructor() {
    this.clients = new Map(); // connId → { res, clientId }
    this.recent = []; // { id, event, data, ts }[]
    this._heartbeatTimer = null;
  }

  // 訂閱：當 GET /events 進來時叫
  subscribe(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // 防 nginx / reverse proxy buffer
    res.flushHeaders?.();
    // 先送一個 comment 線、確認連線通
    res.write(`: connected ${new Date().toISOString()}\n\n`);

    const connId = crypto.randomUUID();
    const clientId = req.headers['x-client-id'] || null;
    this.clients.set(connId, { res, clientId });
    console.log(
      `[sse] + conn ${connId.slice(0, 8)} (client=${clientId || '-'}) total=${this.clients.size}`,
    );

    // Replay missed events（client 帶 Last-Event-ID 進來、找到該 id 之後的全推）
    const lastId = req.headers['last-event-id'];
    if (lastId) {
      const startIdx = this.recent.findIndex((e) => e.id === lastId);
      if (startIdx >= 0) {
        const toReplay = this.recent.slice(startIdx + 1);
        if (toReplay.length > 0) {
          console.log(`[sse] replay ${toReplay.length} events for conn ${connId.slice(0, 8)}`);
          for (const e of toReplay) this._send(res, e);
        }
      } else {
        // lastId 不在 recent buffer → client 太久沒連、需要 fresh snapshot
        res.write(`event: reconnect-stale\ndata: {"hint":"please GET /api/snapshot to resync"}\n\n`);
      }
    }

    req.on('close', () => {
      this.clients.delete(connId);
      console.log(`[sse] - conn ${connId.slice(0, 8)} total=${this.clients.size}`);
    });
  }

  // 廣播事件給所有連線（可選排除某 clientId — 廣播者自己）
  broadcast(eventName, data, excludeClientId = null) {
    const event = {
      id: `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      event: eventName,
      data,
      ts: new Date().toISOString(),
    };
    this.recent.push(event);
    if (this.recent.length > 100) this.recent.shift();

    let sentCount = 0;
    for (const [, { res, clientId }] of this.clients) {
      if (excludeClientId && clientId === excludeClientId) continue;
      try {
        this._send(res, event);
        sentCount++;
      } catch (e) {
        console.error('[sse] send failed:', e.message);
      }
    }
    console.log(
      `[sse] broadcast ${eventName} → ${sentCount} conn (exclude=${excludeClientId || '-'})`,
    );
  }

  _send(res, e) {
    res.write(`id: ${e.id}\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
  }

  startHeartbeat(intervalMs = 30_000) {
    if (this._heartbeatTimer) return;
    this._heartbeatTimer = setInterval(() => {
      const beat = { ts: new Date().toISOString(), connCount: this.clients.size };
      for (const [, { res }] of this.clients) {
        try {
          res.write(`event: heartbeat\ndata: ${JSON.stringify(beat)}\n\n`);
        } catch {
          // ignore — 下次廣播會清掉死連線
        }
      }
    }, intervalMs);
    this._heartbeatTimer.unref?.(); // 不擋 process exit
  }

  stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }
}

// Singleton
export const sse = new SseBroadcaster();
