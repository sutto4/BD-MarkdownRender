import {marked} from 'marked';
import DOMPurify from 'dompurify';
const LIMIT = 1024 * 1024;

class MarkdownRender {
    start() {
        this.stop();
        this.running = true;
        this.entries = new Map();
        this.cache = new Map();
        this.queue = [];
        this.active = 0;
        this.generation = (this.generation || 0) + 1;
        this.installStyle();
        this.observer = new MutationObserver(records => {
            if (records.every(r => (r.target.nodeType === 1 ? r.target : r.target.parentElement)?.closest('.mda-panel'))) return;
            if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.scan(); }, 150);
        });
        this.observer.observe(document.body, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href']});
        this.scan();
    }

    stop() {
        this.running = false;
        this.observer?.disconnect();
        clearTimeout(this.timer); this.timer = null;
        for (const entry of this.entries?.values() || []) this.remove(entry);
        this.entries?.clear(); this.cache?.clear(); this.queue = [];
        BdApi.DOM.removeStyle('MarkdownRender');
        BdApi.DOM.removeStyle('MarkdownRenderExtras');
    }

    remove(entry) {
        entry.dead = true; entry.controller?.abort();
        entry.source?.classList.remove('mda-hidden'); entry.panel.remove();
    }

    attachmentURL(value) {
        try {
            const url = new URL(value);
            if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
            if (!['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)) return null;
            if (!/^\/attachments\/\d+\/\d+\//.test(url.pathname)) return null;
            if (!/\.(md|markdown|txt)$/i.test(decodeURIComponent(url.pathname))) return null;
            return url;
        } catch { return null; }
    }

    findLink(card) {
        return [...card.querySelectorAll('a[href]')].find(a => this.attachmentURL(a.href));
    }

    scan() {
        if (!this.running) return;
        for (const [key, entry] of this.entries) {
            if (!key.isConnected || !entry.panel.isConnected) { this.remove(entry); this.entries.delete(key); }
        }
        for (const source of document.querySelectorAll('[class*="textContainer"]')) {
            if (source.closest('.mda-panel') || source.querySelector('[class*="textContainer"]')) continue;
            const code = source.querySelector('code,pre');
            if (!code) continue;
            let card = source.parentElement, link, filename;
            for (let depth = 0; card && depth < 3; depth++, card = card.parentElement) {
                link = this.findLink(card);
                filename = link ? decodeURIComponent(this.attachmentURL(link.href).pathname.split('/').pop()) :
                    [...card.querySelectorAll('[class*="filename"],[class*="fileName"],a')]
                        .map(n => n.textContent.trim()).find(t => /^[^\n]{1,255}\.(txt|md|markdown)$/i.test(t));
                if (filename) break;
            }
            if (!filename) continue;
            for (const [oldKey, old] of this.entries) {
                if (!old.source && old.card.contains(source)) { this.remove(old); this.entries.delete(oldKey); }
            }
            this.upsert(source, source, card, link, filename, code.textContent.slice(0, LIMIT));
        }
        // Also support files Discord displays only as a download card.
        for (const link of document.querySelectorAll('a[href]')) {
            if (link.closest('.mda-panel')) continue;
            const url = this.attachmentURL(link.href);
            if (!url) continue;
            const card = link.closest('[class*="fileWrapper"],[class*="attachment"],[class*="file__"],[class*="file_"]');
            if (!card || card.querySelector('[class*="textContainer"]')) continue;
            if ([...this.entries.values()].some(e => e.source && e.card?.contains(card))) continue;
            this.upsert(card, null, card, link, decodeURIComponent(url.pathname.split('/').pop()), '');
        }
    }

    upsert(key, source, card, link, filename, preview) {
        const url = link && this.attachmentURL(link.href);
        const identity = url ? url.origin + url.pathname : filename;
        let entry = this.entries.get(key);
        if (entry && entry.identity !== identity) { this.remove(entry); this.entries.delete(key); entry = null; }
        if (entry) {
            entry.link = link; // Retry uses the latest signed URL.
            if (!entry.complete && entry.preview !== preview) {
                entry.preview = preview; entry.text = preview; this.paint(entry);
            }
            return;
        }
        const panel = document.createElement('section'); panel.className = 'mda-panel';
        const toolbar = document.createElement('div'); toolbar.className = 'mda-toolbar';
        const label = document.createElement('span'); label.setAttribute('role', 'status');
        const actions = document.createElement('div'); actions.className = 'mda-actions';
        const toggle = document.createElement('button'); toggle.type = 'button';
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry'; retry.hidden = true;
        const body = document.createElement('div'); body.className = 'mda-body';
        entry = {key, source, card, link, filename, identity, preview, text: preview, panel, body, label, toggle, retry, raw: false};
        toggle.onclick = () => { entry.raw = !entry.raw; this.paint(entry); };
        retry.onclick = () => this.enqueue(entry);
        actions.append(toggle, retry); toolbar.append(label, actions); panel.append(toolbar, body);
        (source || card).before(panel); source?.classList.add('mda-hidden');
        this.entries.set(key, entry);
        this.paint(entry);
        if (preview.trim()) {
            label.textContent = `${filename} \u00b7 Discord preview`;
            if (url) { retry.textContent = 'Load full file'; retry.hidden = false; }
        } else if (url) this.enqueue(entry);
        else label.textContent = 'Loaded preview only - download link unavailable';
    }

    paint(entry) {
        entry.toggle.textContent = entry.raw ? 'Show Markdown' : 'Show raw text';
        entry.toggle.setAttribute('aria-pressed', String(!entry.raw));
        try {
            if (entry.raw) {
                const pre = document.createElement('pre'); pre.textContent = entry.text; entry.body.replaceChildren(pre);
            } else entry.body.replaceChildren(this.render(entry.text));
        } catch {
            const pre = document.createElement('pre'); pre.textContent = entry.text; entry.body.replaceChildren(pre);
            entry.label.textContent = 'Markdown could not be rendered Â· showing raw text';
        }
    }

    enqueue(entry) {
        if (entry.dead || entry.pending || !this.running) return;
        const url = this.attachmentURL(entry.link?.href);
        if (!url) { entry.label.textContent = 'Attachment link unavailable'; return; }
        const cached = this.cache.get(entry.identity);
        if (cached !== undefined) { this.complete(entry, cached); return; }
        entry.pending = true; entry.retry.hidden = true; entry.label.textContent = 'Loading full attachmentâ€¦';
        this.queue.push({entry, url: url.href}); this.pump();
    }

    pump() {
        while (this.running && this.active < 3 && this.queue.length) {
            const {entry, url} = this.queue.shift();
            if (entry.dead) continue;
            this.active++;
            const generation = this.generation;
            entry.controller = new AbortController();
            entry.label.textContent = entry.preview ? 'Preview ready · fetching full file…' : 'Loading full attachment…';
            let watchdog;
            const controller = entry.controller;
            const deadline = new Promise((_, reject) => {
                watchdog = setTimeout(() => {
                    reject(new Error('Full-file download timed out'));
                    controller.abort();
                }, 22000);
            });
            // Bound the UI state even if the transport fails to settle or throws synchronously.
            Promise.race([new Promise(resolve => resolve(this.download(url, controller.signal))), deadline]).then(text => {
                if (!this.running || entry.dead || generation !== this.generation) return;
                this.cache.set(entry.identity, text);
                while (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value);
                this.complete(entry, text);
            }).catch(error => {
                if (!this.running || entry.dead || generation !== this.generation) return;
                entry.label.textContent = `${error.message}${entry.preview ? ' Â· showing loaded preview' : ''}`;
                entry.retry.textContent = 'Retry full download'; entry.retry.hidden = false;
            }).finally(() => {
                clearTimeout(watchdog);
                if (generation !== this.generation) return;
                this.active--; entry.pending = false; entry.controller = null; this.pump();
            });
        }
    }

    complete(entry, text) {
        entry.text = text; entry.complete = true; entry.retry.hidden = true;
        entry.label.textContent = `${entry.filename} Â· full file`; this.paint(entry);
    }

    async download(value, signal) {
        const url = this.attachmentURL(value);
        if (!url) throw new Error('Unsupported attachment URL');
        const controller = new AbortController();
        const abort = () => controller.abort();
        if (signal.aborted) throw new Error('Cancelled');
        signal.addEventListener('abort', abort, {once: true});
        const timer = setTimeout(abort, 20000);
        let reader;
        try {
            // Use Chromium's network stack, which Discord itself uses for previews.
            const response = await fetch(url.href, {
                signal: controller.signal, credentials: 'omit', redirect: 'error',
                referrerPolicy: 'no-referrer'
            });
            if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
            if (Number(response.headers.get('content-length')) > LIMIT) throw new Error('Attachment exceeds 1 MiB limit');
            if (!response.body) throw new Error('Attachment response has no body');
            reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8', {fatal: true});
            let size = 0, text = '';
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > LIMIT) throw new Error('Attachment exceeds 1 MiB limit');
                text += decoder.decode(value, {stream: true});
            }
            text += decoder.decode();
            if (text.includes('\0')) throw new Error('File is not UTF-8 text');
            return text.replace(/^\uFEFF/, '');
        } catch (error) {
            if (controller.signal.aborted) throw new Error(signal.aborted ? 'Cancelled' : 'Download timed out');
            throw error;
        } finally {
            clearTimeout(timer); signal.removeEventListener('abort', abort);
            if (reader) { try { await reader.cancel(); } catch {} }
            controller.abort();
        }
    }

    render(text) {
        const escape = value => value.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
        const renderer = new marked.Renderer();
        renderer.html = token => escape(token.text);
        renderer.image = token => escape(`[Image: ${token.text || 'image'}]`);
        const html = marked.parse(text, {
            gfm: true, breaks: false, async: false,
            renderer
        });
        const fragment = DOMPurify.sanitize(html, {
            RETURN_DOM_FRAGMENT: true,
            ALLOWED_TAGS: ['p','br','hr','h1','h2','h3','h4','h5','h6','strong','em','del','s','blockquote','ul','ol','li','pre','code','a','table','thead','tbody','tr','th','td','input'],
            ALLOWED_ATTR: ['href','title','start','align','type','checked','disabled'],
            ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false
        });
        for (const anchor of fragment.querySelectorAll('a')) {
            try {
                const url = new URL(anchor.getAttribute('href'));
                if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
                anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
            } catch { anchor.removeAttribute('href'); }
        }
        for (const input of fragment.querySelectorAll('input')) { input.type = 'checkbox'; input.disabled = true; }
        return fragment;
    }

    installStyle() {
        BdApi.DOM.addStyle('MarkdownRender', `
            .mda-hidden { display: none !important; }
            .mda-panel {
                color-scheme: dark;
                color: #e3e5e8 !important;
                background: #202127 !important;
                border: 1px solid #363840;
                border-radius: 8px;
                overflow: hidden;
                font-family: var(--font-primary, "Segoe UI", sans-serif);
                font-size: 15px;
                text-align: left;
                white-space: normal;
                min-width: 0;
                box-sizing: border-box;
            }
            .mda-panel .mda-toolbar {
                display: flex; align-items: center; justify-content: space-between;
                gap: 12px; padding: 9px 16px;
                background: #292b32; border-bottom: 1px solid #3a3c45;
            }
            .mda-panel .mda-toolbar span { font-size: 12px; font-weight: 500; color: #b5bac5 !important; }
            .mda-panel .mda-toolbar button {
                cursor: pointer; color: #f2f3f5 !important; background: #383b45 !important;
                border: 1px solid #505462; border-radius: 5px; padding: 5px 10px;
                font: inherit; font-size: 12px; line-height: 1.4;
            }
            .mda-panel .mda-toolbar button:hover { background: #454956 !important; }
            .mda-panel .mda-toolbar button:focus-visible { outline: 2px solid #9bbcff; outline-offset: 2px; }
            .mda-panel .mda-body {
                padding: 16px 20px; max-height: 520px; overflow: auto;
                line-height: 1.65; overflow-wrap: anywhere; user-select: text;
                color: #e3e5e8 !important; background: #202127 !important;
                scrollbar-width: thin; scrollbar-color: #626776 #202127;
            }
            .mda-panel .mda-body [hidden], .mda-panel .mda-body[hidden] { display: none !important; }
            .mda-panel .mda-body :is(p,li,ul,ol,blockquote,em,s) { color: inherit !important; }
            .mda-panel .mda-body :is(h1,h2,h3,h4,h5,h6) {
                color: #f2f3f5 !important; font-weight: 700; line-height: 1.3; margin: 22px 0 10px;
            }
            .mda-panel .mda-body h1 { font-size: 1.65em; }
            .mda-panel .mda-body h2 { font-size: 1.35em; }
            .mda-panel .mda-body h3 { font-size: 1.15em; }
            .mda-panel .mda-body :is(h4,h5,h6) { font-size: 1em; }
            .mda-panel .mda-body > :first-child { margin-top: 0; }
            .mda-panel .mda-body > :last-child { margin-bottom: 0; }
            .mda-panel .mda-body p { margin: 10px 0; white-space: normal; }
            .mda-panel .mda-body :is(ul,ol) { padding-left: 26px; margin: 10px 0; }
            .mda-panel .mda-body ul { list-style: disc outside; }
            .mda-panel .mda-body ol { list-style: decimal outside; }
            .mda-panel .mda-body li { display: list-item; margin: 5px 0; }
            .mda-panel .mda-body strong { color: #f2f3f5 !important; font-weight: 700; }
            .mda-panel .mda-body em { font-style: italic; }
            .mda-panel .mda-body code {
                font-family: var(--font-code, Consolas, monospace); font-size: .9em;
                color: #dce5ff !important; background: #30333d !important;
                border-radius: 4px; padding: 2px 5px;
            }
            .mda-panel .mda-body pre {
                background: #17181d !important; padding: 12px; overflow: auto;
                white-space: pre; border: 1px solid #363840; border-radius: 6px; margin: 12px 0;
                scrollbar-width: thin; scrollbar-color: #626776 #17181d;
            }
            .mda-panel .mda-body pre code { padding: 0; background: transparent !important; }
            .mda-panel .mda-body a { color: #8ebaff !important; text-decoration: underline; }
            .mda-panel .mda-body blockquote {
                border-left: 3px solid #7b88ab; padding: 4px 12px;
                background: #272a33; margin: 10px 0;
            }
            .mda-panel .mda-body hr { border: 0; border-top: 1px solid #41444f; margin: 18px 0; }
            .mda-panel ::selection { background: #465987; color: #fff; }
            .mda-panel ::-webkit-scrollbar { width: 8px; height: 8px; }
            .mda-panel ::-webkit-scrollbar-track { background: #202127; }
            .mda-panel ::-webkit-scrollbar-thumb { background: #626776; border: 2px solid #202127; border-radius: 8px; }
        `);

        BdApi.DOM.addStyle('MarkdownRenderExtras', `
            .mda-actions { display: flex; gap: 8px; flex-shrink: 0; }
            .mda-panel [hidden] { display: none !important; }
            .mda-panel .mda-toolbar { flex-wrap: wrap; }
            .mda-panel .mda-toolbar > span { overflow-wrap: anywhere; min-width: 0; flex: 1; }
            .mda-panel .mda-body table { border-collapse: collapse; display: block; overflow-x: auto; margin: 12px 0; }
            .mda-panel .mda-body :is(th,td) { border: 1px solid #454956; padding: 8px 12px; color: #e3e5e8 !important; }
            .mda-panel .mda-body th { background: #30333d; font-weight: 700; }
            .mda-panel .mda-body input[type=checkbox] { appearance: auto; margin-right: 6px; accent-color: #8ebaff; }
        `);
    }
}
module.exports = MarkdownRender;
