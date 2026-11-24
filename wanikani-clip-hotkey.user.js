// ==UserScript==
// @name         WaniKani Clip Hotkey
// @namespace    wk-clip-hotkey
// @version      1.1.0
// @description  Press a hotkey during reviews/lessons to play a real anime/drama/game clip (screenshot + audio from Immersion Kit) using the current word or kanji.
// @author       Snackwrap
// @homepageURL  https://github.com/Snackwrap/wanikani-clip-hotkey
// @supportURL   https://github.com/Snackwrap/wanikani-clip-hotkey/issues
// @downloadURL  https://raw.githubusercontent.com/Snackwrap/wanikani-clip-hotkey/main/wanikani-clip-hotkey.user.js
// @updateURL    https://raw.githubusercontent.com/Snackwrap/wanikani-clip-hotkey/main/wanikani-clip-hotkey.user.js
// @match        https://www.wanikani.com/*
// @match        https://preview.wanikani.com/*
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

/*
 * HOTKEYS (Option on Mac = Alt)
 *   Alt+V          open the clip panel / play the next clip
 *   Alt+Shift+V    previous clip
 *   Alt+R          replay the current clip
 *   Alt+Y          open a YouGlish video search for the word in a new tab
 *   Alt+A          turn autoplay-after-correct-answer on/off (remembered)
 *   Esc            close the panel
 *   Click the screenshot to replay; click the blurred translation to reveal it.
 *
 * Media comes from https://www.immersionkit.com (screenshot + audio per line).
 */

(() => {
    'use strict';

    // ---------- Settings ----------
    const KEYS = {
        next: 'KeyV',     // with Alt
        replay: 'KeyR',   // with Alt
        youglish: 'KeyY', // with Alt
        autoplay: 'KeyA', // with Alt: toggles autoplay
    };
    // Autoplay a clip after a correct answer. Alt+A toggles it; your choice is remembered.
    // This is only the starting value before you've ever pressed Alt+A.
    const AUTOPLAY_DEFAULT = false;
    // Which correct answers trigger autoplay: 'any' (meaning or reading) or 'reading' only.
    const AUTOPLAY_ON = 'any';
    const BLUR_TRANSLATION = true;   // hide the English until clicked (it can spoil the meaning)
    const MAX_CLIPS = 40;            // how many clips to keep per item
    const VOLUME = 0.9;

    const API = 'https://apiv2.immersionkit.com';
    const MEDIA = 'https://immersionkit.s3.bhs.io.cloud.ovh.net/';
    const INDEX_CACHE_KEY = 'wk-clip-hotkey.index';
    const INDEX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

    // ---------- State ----------
    let currentSubject = null;   // {characters, type}
    let clips = [];
    let clipIndex = -1;
    let clipsFor = null;         // keyword the clips were loaded for
    let audio = null;
    let panel = null;
    let loading = null;          // in-flight Promise
    const searchCache = new Map();
    let titleIndexPromise = null;
    const AUTOPLAY_STORE_KEY = 'wk-clip-hotkey.autoplay';
    let autoplayEnabled = (() => {
        const saved = localStorage.getItem(AUTOPLAY_STORE_KEY);
        return saved === null ? AUTOPLAY_DEFAULT : saved === 'true';
    })();
    let questionType = null;     // 'meaning' | 'reading' (from WaniKani's event, if provided)
    let autoplayedThisQuestion = false;

    // ---------- Current item ----------
    window.addEventListener('willShowNextQuestion', (e) => {
        const subject = e.detail?.subject ?? e.detail;
        if (subject?.characters !== undefined) {
            currentSubject = {characters: subject.characters, type: subject.type};
        }
        questionType = e.detail?.questionType ?? null;
        autoplayedThisQuestion = false;
        closePanel();
    });

    // ---------- Autoplay after a correct answer ----------
    // Two independent signals, because WaniKani's internal event has changed before:
    //  1. the didAnswerQuestion event reporting results.action === 'pass'
    //  2. the answer box container getting correct="true"
    window.addEventListener('didAnswerQuestion', (e) => {
        const result = e.detail?.results;
        if (result?.action === 'pass' || result?.passed === true) onCorrectAnswer(e.detail?.questionType);
    });

    new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.target instanceof Element
                && m.target.matches('.quiz-input__input-container')
                && m.target.getAttribute('correct') === 'true') {
                onCorrectAnswer();
                return;
            }
        }
    }).observe(document.documentElement, {subtree: true, attributes: true, attributeFilter: ['correct']});

    function currentQuestionType(fromEvent) {
        if (fromEvent) return fromEvent;
        if (questionType) return questionType;
        const lang = document.querySelector('#user-response')?.getAttribute('lang');
        return lang === 'ja' ? 'reading' : lang ? 'meaning' : null;
    }

    function onCorrectAnswer(typeFromEvent) {
        if (!autoplayEnabled || autoplayedThisQuestion) return;
        if (AUTOPLAY_ON === 'reading' && currentQuestionType(typeFromEvent) !== 'reading') return;
        autoplayedThisQuestion = true;
        const item = getCurrentItem();
        if (!item || item.isRadical) return;
        if (panel && clipsFor === keywordFor(item.characters) && clips[clipIndex]) return; // already showing one
        step(1, {auto: true});
    }

    function toggleAutoplay() {
        autoplayEnabled = !autoplayEnabled;
        try { localStorage.setItem(AUTOPLAY_STORE_KEY, String(autoplayEnabled)); } catch { /* ignore */ }
        const scope = AUTOPLAY_ON === 'reading' ? 'correct readings' : 'correct answers';
        toast(autoplayEnabled ? `Autoplay ON: a clip plays after ${scope}` : 'Autoplay OFF');
    }

    function getCurrentItem() {
        // Prefer the page header so this keeps working if the event shape changes.
        const header = document.querySelector('.character-header__characters');
        const domText = header?.textContent?.trim();
        const isRadical = !!document.querySelector('.character-header--radical')
            || /radical/i.test(currentSubject?.type ?? '');
        const characters = domText || currentSubject?.characters;
        if (!characters) return null;
        return {characters, isRadical};
    }

    function keywordFor(characters) {
        return characters.replace(/[〜~]/g, '').trim();
    }

    // ---------- Immersion Kit ----------
    function loadTitleIndex() {
        if (titleIndexPromise) return titleIndexPromise;
        titleIndexPromise = (async () => {
            try {
                const cached = JSON.parse(localStorage.getItem(INDEX_CACHE_KEY) || 'null');
                if (cached && Date.now() - cached.savedAt < INDEX_TTL_MS) return cached.data;
            } catch { /* ignore */ }
            const res = await fetch(`${API}/index_meta`);
            if (!res.ok) throw new Error(`index_meta HTTP ${res.status}`);
            const {data} = await res.json();
            try { localStorage.setItem(INDEX_CACHE_KEY, JSON.stringify({savedAt: Date.now(), data})); } catch { /* quota */ }
            return data;
        })();
        titleIndexPromise.catch(() => { titleIndexPromise = null; });
        return titleIndexPromise;
    }

    function mediaUrl(example, fileName, index) {
        if (!fileName) return '';
        // id looks like "anime_my_neighbor_totoro_000000151"
        const parts = example.id.split('_');
        const category = parts[0];
        const key = parts.slice(1, -1).join('_');
        const title = index[key]?.title;
        if (!title) return '';
        return encodeURI(`${MEDIA}media/${category}/${title}/media/${fileName}`);
    }

    async function searchClips(keyword) {
        if (searchCache.has(keyword)) return searchCache.get(keyword);
        const [index, data] = await Promise.all([
            loadTitleIndex(),
            fetch(`${API}/search?q=${encodeURIComponent(keyword)}&sort=sentence_length:asc`)
                .then((r) => { if (!r.ok) throw new Error(`search HTTP ${r.status}`); return r.json(); }),
        ]);
        const all = (data.examples || [])
            .map((ex) => ({
                sentence: (ex.sentence || '').replace(/[‪-‮⁦-⁩]/g, ''),
                translation: ex.translation || '',
                source: index[ex.id.split('_').slice(1, -1).join('_')]?.title || ex.title || '',
                image: mediaUrl(ex, ex.image, index),
                sound: mediaUrl(ex, ex.sound, index),
                exact: (ex.sentence || '').includes(keyword),
            }))
            .filter((c) => c.sound);
        // Lines that contain the exact word first, then looser (conjugated / lemma) matches.
        const result = [...all.filter((c) => c.exact), ...all.filter((c) => !c.exact)].slice(0, MAX_CLIPS);
        searchCache.set(keyword, result);
        return result;
    }

    // ---------- Playback ----------
    function stopAudio() {
        if (audio) { audio.pause(); audio = null; }
    }

    function playCurrent() {
        stopAudio();
        const clip = clips[clipIndex];
        if (!clip) return;
        audio = new Audio(clip.sound);
        audio.volume = VOLUME;
        audio.addEventListener('playing', () => panel?.classList.add('wkch-playing'));
        audio.addEventListener('ended', () => panel?.classList.remove('wkch-playing'));
        audio.addEventListener('pause', () => panel?.classList.remove('wkch-playing'));
        audio.play().catch((err) => showMessage(`Couldn't play audio (${err.name}).`));
        render();
    }

    async function step(delta, {auto = false} = {}) {
        const item = getCurrentItem();
        if (!item) return;
        if (item.isRadical) { openPanel(); showMessage('Radicals have no clips. Try it on a kanji or vocab item.'); return; }
        const keyword = keywordFor(item.characters);
        openPanel();
        if (clipsFor !== keyword) {
            stopAudio();
            showMessage(`Looking up clips for ${keyword}…`);
            const thisLoad = loading = searchClips(keyword);
            try {
                const found = await thisLoad;
                if (loading !== thisLoad) return; // a newer lookup replaced this one
                clips = found;
                clipsFor = keyword;
                clipIndex = -1;
            } catch (err) {
                console.error('[WK Clip Hotkey]', err);
                showMessage('Immersion Kit lookup failed. See the console for details.');
                return;
            } finally {
                if (loading === thisLoad) loading = null;
            }
            if (!clips.length) {
                if (auto) closePanel(); else showMessage(`No clips found for ${keyword}.`);
                return;
            }
        }
        if (!clips.length) return;
        clipIndex = (clipIndex + delta + clips.length) % clips.length;
        playCurrent();
    }

    function openYouGlish() {
        const item = getCurrentItem();
        if (!item || item.isRadical) return;
        const keyword = keywordFor(item.characters);
        window.open(`https://youglish.com/pronounce/${encodeURIComponent(keyword)}/japanese`, '_blank', 'noopener');
    }

    // ---------- UI ----------
    const CSS = `
    #wkch-panel{position:fixed;right:16px;bottom:16px;width:min(420px,calc(100vw - 32px));z-index:99999;
      background:#1f2024;color:#f2f2f2;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.45);
      font:14px/1.45 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;overflow:hidden}
    #wkch-panel .wkch-img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#000;cursor:pointer}
    #wkch-panel .wkch-body{padding:10px 14px 12px}
    #wkch-panel .wkch-ja{font-size:18px;margin:2px 0 6px}
    #wkch-panel .wkch-ja mark{background:#ffd54a;color:#111;border-radius:3px;padding:0 2px}
    #wkch-panel .wkch-en{color:#c9c9c9;cursor:pointer;transition:filter .15s}
    #wkch-panel .wkch-en.wkch-blur{filter:blur(5px)}
    #wkch-panel .wkch-meta{display:flex;justify-content:space-between;gap:8px;margin-top:8px;font-size:12px;color:#9a9a9a}
    #wkch-panel .wkch-hint{font-size:11px;color:#7d7d7d;margin-top:4px}
    #wkch-panel .wkch-close{position:absolute;top:6px;right:8px;background:rgba(0,0,0,.55);color:#fff;border:0;
      border-radius:50%;width:26px;height:26px;cursor:pointer;font-size:15px;line-height:26px}
    #wkch-panel.wkch-playing .wkch-img{outline:3px solid #ffd54a;outline-offset:-3px}
    #wkch-panel .wkch-msg{padding:14px}
    #wkch-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:100000;
      background:#1f2024;color:#f2f2f2;padding:8px 14px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.4);
      font:14px/1.4 system-ui,-apple-system,sans-serif;pointer-events:none}`;

    function ensureStyle() {
        if (document.getElementById('wkch-style')) return;
        const style = document.createElement('style');
        style.id = 'wkch-style';
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    let toastTimer = null;
    function toast(text) {
        ensureStyle();
        document.getElementById('wkch-toast')?.remove();
        const node = el('div', {id: 'wkch-toast', textContent: text});
        document.body.appendChild(node);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => node.remove(), 1800);
        render(); // refresh the hint line if the panel is open
    }

    function openPanel() {
        if (panel) return;
        ensureStyle();
        panel = document.createElement('div');
        panel.id = 'wkch-panel';
        document.body.appendChild(panel);
    }

    function closePanel() {
        stopAudio();
        panel?.remove();
        panel = null;
    }

    function el(tag, props = {}, children = []) {
        const node = Object.assign(document.createElement(tag), props);
        for (const child of [].concat(children)) node.append(child);
        return node;
    }

    function closeButton() {
        return el('button', {className: 'wkch-close', title: 'Close (Esc)', textContent: '×', onclick: closePanel});
    }

    function showMessage(text) {
        if (!panel) return;
        panel.replaceChildren(closeButton(), el('div', {className: 'wkch-msg', textContent: text}));
    }

    function highlighted(sentence, keyword) {
        const frag = document.createDocumentFragment();
        const i = keyword ? sentence.indexOf(keyword) : -1;
        if (i < 0) { frag.append(sentence); return frag; }
        frag.append(sentence.slice(0, i), el('mark', {textContent: keyword}), sentence.slice(i + keyword.length));
        return frag;
    }

    function render() {
        const clip = clips[clipIndex];
        if (!panel || !clip) return;
        const nodes = [closeButton()];
        if (clip.image) {
            nodes.push(el('img', {className: 'wkch-img', src: clip.image, alt: '', title: 'Replay (Alt+R)', onclick: playCurrent}));
        }
        const en = el('div', {
            className: 'wkch-en' + (BLUR_TRANSLATION ? ' wkch-blur' : ''),
            textContent: clip.translation,
            title: BLUR_TRANSLATION ? 'Click to reveal' : '',
            onclick: (e) => e.currentTarget.classList.remove('wkch-blur'),
        });
        nodes.push(el('div', {className: 'wkch-body'}, [
            el('div', {className: 'wkch-ja'}, highlighted(clip.sentence, clipsFor)),
            en,
            el('div', {className: 'wkch-meta'}, [
                el('span', {textContent: clip.source}),
                el('span', {textContent: `${clipIndex + 1} / ${clips.length}`}),
            ]),
            el('div', {className: 'wkch-hint', textContent: `Alt+V next · Alt+Shift+V prev · Alt+R replay · Alt+Y YouGlish · Alt+A autoplay ${autoplayEnabled ? 'on' : 'off'} · Esc close`}),
        ]));
        panel.replaceChildren(...nodes);
    }

    // ---------- Hotkeys ----------
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panel) {
            e.preventDefault();
            e.stopPropagation();
            closePanel();
            return;
        }
        if (!e.altKey || e.ctrlKey || e.metaKey) return;
        // Only act where there is a quiz/item header on the page.
        if (!document.querySelector('.character-header__characters') && !currentSubject) return;

        let handled = true;
        if (e.code === KEYS.next) step(e.shiftKey ? -1 : 1);
        else if (e.code === KEYS.replay && !e.shiftKey) { if (clips[clipIndex] && panel) playCurrent(); else step(1); }
        else if (e.code === KEYS.youglish && !e.shiftKey) openYouGlish();
        else if (e.code === KEYS.autoplay && !e.shiftKey) toggleAutoplay();
        else handled = false;

        if (handled) {
            // Stop Option+V etc. from typing "√" into the answer box, and keep WaniKani from seeing it.
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);
})();
