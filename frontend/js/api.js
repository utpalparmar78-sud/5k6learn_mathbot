/* The site is fully standalone: calculations run in this browser tab.
 * No server, no run.bat, no network connection required.
 */
(function (global) {
  const MathBot = (global.MathBot = global.MathBot || {});
  MathBot.api = {
    local: true,
    async health() {
      return { status: "ok", engine: "Browser", tools: (MathBot.MODES || []).length, online: global.navigator.onLine };
    },
    async solve(payload) {
      return MathBot.engine.solve(payload);
    },
  };
})(window);
