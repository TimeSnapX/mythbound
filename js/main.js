import { Game } from './game.js';
import { DEFAULT_SERVER } from './config.js';
const params = new URLSearchParams(location.search);
try {
  const game = new Game();
  // ?server=ws://host:port connects to a multiplayer server; ?server=auto uses the page's own host (when the Node
  // server is also serving the client); ?server=off forces solo mode. Otherwise config.js DEFAULT_SERVER is used.
  let url = params.has('server') ? params.get('server') : DEFAULT_SERVER;
  if (url === 'auto') url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  if (!url || url === 'off') url = '';
  game.serverUrl = url || null;
  game.run();
} catch (e) {
  console.error(e);
  document.getElementById('loading').textContent = 'Mythbound needs WebGL to run. (' + e.message + ')';
}
