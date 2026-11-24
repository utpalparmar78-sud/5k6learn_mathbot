/* Local calculation history — no account, no server, just the browser. */
(function (global) {
  const MathBot = (global.MathBot = global.MathBot || {});
  const KEY = "mathbot.history.v2";
  const LIMIT = 80;

  function read() {
    try {
      const value = JSON.parse(global.localStorage.getItem(KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (err) {
      return [];
    }
  }

  function write(items) {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(items.slice(0, LIMIT)));
    } catch (err) {
      /* Storage may be full or disabled; history is a convenience only. */
    }
  }

  MathBot.history = {
    all: read,
    add(entry) {
      const items = read();
      entry.id = Date.now() + "-" + Math.random().toString(36).slice(2, 7);
      entry.ts = Date.now();
      items.unshift(entry);
      write(items);
    },
    remove(id) {
      write(read().filter((item) => item.id !== id));
    },
    clear() {
      write([]);
    },
  };
})(window);
