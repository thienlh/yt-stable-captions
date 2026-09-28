(() => {
  'use strict';

  /**
   * Captures the caption payload YouTube's own player downloads.
   * Our own timedtext fetch is often gated (empty body without a `pot`
   * token); the player's request is signed, so we reuse its response.
   * Runs at document_start in the MAIN world, before the player boots.
   * Single responsibility: observe timedtext responses, publish them.
   */
  // Only useful in the page's own JS world; page-loader.js re-injects us there
  // if the browser ran this file as an isolated content script (Safari).
  if ((globalThis.browser ?? globalThis.chrome)?.runtime?.id) return;
  if (window.__ytscTapInstalled) return;
  window.__ytscTapInstalled = true;
  document.documentElement.dataset.ytscTap = '1';

  const isTimedtext = (url) => /\/api\/timedtext/.test(String(url || ''));

  const publish = (url, body) => {
    if (typeof body !== 'string' || !body.trim()) return;
    let videoId = null;
    let lang = null;
    try {
      const u = new URL(url, location.href);
      videoId = u.searchParams.get('v');
      lang = u.searchParams.get('tlang') || u.searchParams.get('lang');
    } catch { /* keep nulls */ }
    const entry = { url: String(url), body, videoId, lang, at: Date.now() };
    window.__ytscTimedtext = entry;
    window.dispatchEvent(new CustomEvent('ytsc:timedtext', { detail: entry }));
  };

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const promise = origFetch.apply(this, arguments);
    const url = input instanceof Request ? input.url : String(input);
    if (isTimedtext(url) && !init?.ytscOwn) {
      promise
        .then((res) => res.clone().text())
        .then((body) => publish(url, body))
        .catch(() => {});
    }
    return promise;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ytscUrl = url;
    return origOpen.apply(this, arguments);
  };

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (isTimedtext(this.__ytscUrl)) {
      this.addEventListener('load', () => {
        try {
          const t = this.responseType;
          const body =
            t === '' || t === 'text'
              ? this.responseText
              : t === 'json' && this.response
                ? JSON.stringify(this.response)
                : null;
          publish(this.responseURL || this.__ytscUrl, body);
        } catch { /* ignore */ }
      });
    }
    return origSend.apply(this, arguments);
  };
})();
