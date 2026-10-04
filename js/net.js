// WebSocket client for the optional multiplayer server.
export class Net {
  constructor(url, handlers) { this.url = url; this.h = handlers; this.ws = null; this.connected = false; this.id = null; }
  connect(hello) {
    return new Promise((resolve) => {
      let done = false; const finish = (v) => { if (!done) { done = true; resolve(v); } };
      try { this.ws = new WebSocket(this.url); } catch (e) { return finish(false); }
      const to = setTimeout(() => finish(false), 6000);
      this.ws.onopen = () => this.send({ t: 'hello', ...hello });
      this.ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'welcome') { this.connected = true; this.id = m.id; clearTimeout(to); finish(true); }
        this.h[m.t]?.(m);
      };
      this.ws.onclose = () => { const was = this.connected; this.connected = false; clearTimeout(to); finish(false); if (was) this.h.disconnect?.(); };
      this.ws.onerror = () => {};
    });
  }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
}
