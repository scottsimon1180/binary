(() => {
  'use strict';

  // ---------- Defaults & state ----------
  const STORAGE_KEY = 'binary-translator-v1';
  const DEFAULTS = {
    theme: 'dark',
    accent: 'blue',
    separator: 'space',
    customSeparator: '\u00b7',
    encoding: 'utf8',
    tapPreview: true,
  };
  const VALID_SETTING_VALUES = {
    theme: new Set(['dark', 'electric']),
    accent: new Set(['blue', 'green']),
    separator: new Set(['space', 'comma', 'none', 'custom']),
    encoding: new Set(['utf8', 'ascii']),
  };

  const State = {
    mode: 'tToB',   // 'tToB' or 'bToT'
    bits: '',       // canonical binary string (only 0s and 1s, no separators)
    settings: loadSettings(),
  };

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return normalizeSettings({ ...DEFAULTS, ...s });
    } catch { return { ...DEFAULTS }; }
  }

  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(State.settings)); } catch {}
  }

  function normalizeSettings(settings) {
    const normalized = { ...DEFAULTS, ...settings };
    if (normalized.separator === 'dash') normalized.separator = 'none';

    if (!VALID_SETTING_VALUES.theme.has(normalized.theme)) {
      normalized.theme = DEFAULTS.theme;
    }
    if (!VALID_SETTING_VALUES.accent.has(normalized.accent)) {
      normalized.accent = DEFAULTS.accent;
    }
    if (!VALID_SETTING_VALUES.separator.has(normalized.separator)) {
      normalized.separator = DEFAULTS.separator;
    }
    if (!VALID_SETTING_VALUES.encoding.has(normalized.encoding)) {
      normalized.encoding = DEFAULTS.encoding;
    }
    if (typeof normalized.customSeparator !== 'string') {
      normalized.customSeparator = DEFAULTS.customSeparator;
    } else {
      normalized.customSeparator = normalized.customSeparator.slice(0, 3);
    }
    if (typeof normalized.tapPreview !== 'boolean') {
      normalized.tapPreview = DEFAULTS.tapPreview;
    }

    return normalized;
  }

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const textInput  = $('textInput');
  const binInput   = $('binInput');
  const panelText  = $('panelText');
  const panelBin   = $('panelBin');
  const modeTitle  = $('modeTitle');
  const titleFrom  = $('titleFrom');
  const titleTo    = $('titleTo');
  const textNum    = $('textNum');
  const textNumWord= $('textNumWord');
  const binNum     = $('binNum');
  const binNumWord = $('binNumWord');
  const binBits    = $('binBits');
  const textEnc    = $('textEnc');
  const swapBtn    = $('swap');
  const kbd        = $('kbd');
  const settingsBtn= $('settingsBtn');
  const sheet      = $('settingsSheet');
  const sheetBack  = $('sheetBackdrop');
  const sheetClose = $('sheetClose');
  const sheetCancel= $('sheetCancel');
  const sheetOk    = $('sheetOk');
  const sepCustom  = $('sepCustom');
  const tapToggle  = $('tapPreviewToggle');
  const resetBtn   = $('resetSettings');
  const toast      = $('toast');
  const themeColor = $('themeColor');
  const root       = document.documentElement;
  const app        = document.querySelector('.app');
  let titleAnimationTimer;
  let panelSwapTimer;
  let activeKeyButton;
  let keyReleaseTimer;
  let repeatDelayTimer;
  let repeatTimer;
  let lastPointerKeyTime = 0;
  let lastKeyboardKeyTime = 0;
  let suppressGeneratedPointerClick = false;
  let suppressNextBytePreview = false;

  // ---------- Helpers ----------
  const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  function getSeparator() {
    switch (State.settings.separator) {
      case 'comma':  return ',';
      case 'none':   return '';
      case 'custom': return State.settings.customSeparator || '';
      default:       return ' ';
    }
  }

  // Update the meta-color (status bar tint in standalone PWA)
  function updateThemeColor() {
    const computedBg = getComputedStyle(root).getPropertyValue('--bg').trim();
    if (themeColor && computedBg) themeColor.setAttribute('content', computedBg);
  }

  // ---------- Conversion ----------
  function textToBytes(text) {
    if (State.settings.encoding === 'utf8') {
      return Array.from(new TextEncoder().encode(text));
    }
    const out = [];
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      out.push(c > 127 ? 63 : c); // '?' for non-ASCII
    }
    return out;
  }

  function bytesToText(bytes) {
    if (!bytes.length) return '';
    if (State.settings.encoding === 'utf8') {
      try {
        return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
      } catch { return ''; }
    }
    return bytes.map(b => String.fromCharCode(b & 0x7F)).join('');
  }

  function textToBits(text) {
    return textToBytes(text).map(b => b.toString(2).padStart(8, '0')).join('');
  }

  function bitsToText(bits) {
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    return bytesToText(bytes);
  }

  // ---------- Rendering ----------
  function getBinaryDisplayData(bits = State.bits) {
    const sep = getSeparator();
    const chunks = bits.match(/.{1,8}/g) || [];
    const offsetByBitIndex = [0];
    const bitIndexByOffset = [0];
    const bitIndexByCharOffset = [];
    let text = '';
    let bitIndex = 0;

    chunks.forEach((chunk, chunkIndex) => {
      if (chunkIndex > 0) {
        if (chunkIndex % 4 === 0) {
          text += '\n';
          bitIndexByOffset[text.length] = bitIndex;
        } else {
          for (const char of sep) {
            text += char;
            bitIndexByOffset[text.length] = bitIndex;
          }
        }
      }

      for (const bit of chunk) {
        bitIndexByCharOffset[text.length] = bitIndex;
        text += bit;
        bitIndex += 1;
        bitIndexByOffset[text.length] = bitIndex;
        offsetByBitIndex[bitIndex] = text.length;
      }
    });

    return { text, offsetByBitIndex, bitIndexByOffset, bitIndexByCharOffset };
  }

  function renderBinary(options = {}) {
    const preserveSelection = options.preserveSelection && State.mode === 'bToT';
    const preservedSelection = preserveSelection ? getBinarySelectionRange() : null;
    const data = getBinaryDisplayData();

    if (binInput.textContent !== data.text) {
      binInput.textContent = data.text;
    }

    if (typeof options.caretBitIndex === 'number') {
      setBinarySelectionByBitRange(options.caretBitIndex, options.caretBitIndex, data);
    } else if (options.selection) {
      setBinarySelectionByBitRange(options.selection.start, options.selection.end, data);
    } else if (preservedSelection) {
      setBinarySelectionByBitRange(preservedSelection.start, preservedSelection.end, data);
    }
  }

  function updateMeta() {
    const t = textInput.textContent || '';
    const charCount = [...t].length;
    textNum.textContent = charCount;
    textNumWord.textContent = charCount === 1 ? 'character' : 'characters';
    textEnc.textContent = State.settings.encoding === 'utf8' ? 'UTF-8' : 'ASCII';

    const bitLen = State.bits.length;
    const byteCount = Math.floor(bitLen / 8);
    binNum.textContent = byteCount;
    binNumWord.textContent = byteCount === 1 ? 'byte' : 'bytes';
    binBits.textContent = `${bitLen} bit${bitLen === 1 ? '' : 's'}`;
  }

  function refresh(options = {}) {
    renderBinary(options);
    updateMeta();
  }

  function placeCaretAtEnd(el) {
    el.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function getCaretRangeFromPoint(x, y) {
    if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(x, y);
      if (position) {
        const range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        return range;
      }
    }

    if (document.caretRangeFromPoint) {
      return document.caretRangeFromPoint(x, y);
    }

    return null;
  }

  function focusTextAtPoint(x, y) {
    textInput.focus({ preventScroll: true });

    const range = getCaretRangeFromPoint(x, y);

    if (!range || !textInput.contains(range.startContainer)) {
      placeCaretAtEnd(textInput);
      return;
    }

    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function focusBinaryInput() {
    binInput.focus({ preventScroll: true });
  }

  function getTextOffsetWithin(el, node, offset) {
    const range = document.createRange();
    range.selectNodeContents(el);
    try {
      range.setEnd(node, offset);
    } catch {
      return el.textContent.length;
    }
    return range.toString().length;
  }

  function getDisplayOffsetAtPoint(x, y) {
    const range = getCaretRangeFromPoint(x, y);
    if (!range || !binInput.contains(range.startContainer)) return null;
    return getTextOffsetWithin(binInput, range.startContainer, range.startOffset);
  }

  function clampBitIndex(index) {
    return Math.max(0, Math.min(State.bits.length, index));
  }

  function bitIndexFromDisplayOffset(offset, data = getBinaryDisplayData()) {
    const clampedOffset = Math.max(0, Math.min(data.text.length, offset));
    return data.bitIndexByOffset[clampedOffset] ?? State.bits.length;
  }

  function getBinarySelectionRange() {
    const selection = window.getSelection();
    if (!selection.rangeCount || !binInput.contains(selection.anchorNode) || !binInput.contains(selection.focusNode)) {
      return { start: State.bits.length, end: State.bits.length };
    }

    const data = getBinaryDisplayData();
    const anchorOffset = getTextOffsetWithin(binInput, selection.anchorNode, selection.anchorOffset);
    const focusOffset = getTextOffsetWithin(binInput, selection.focusNode, selection.focusOffset);
    const start = bitIndexFromDisplayOffset(Math.min(anchorOffset, focusOffset), data);
    const end = bitIndexFromDisplayOffset(Math.max(anchorOffset, focusOffset), data);
    return { start, end };
  }

  function getBitCountBeforeTextOffset(text, offset) {
    return (text.slice(0, Math.max(0, offset)).match(/[01]/g) || []).length;
  }

  function getBinaryRawSelectionRange() {
    const selection = window.getSelection();
    const rawText = binInput.textContent || '';
    if (!selection.rangeCount || !binInput.contains(selection.anchorNode) || !binInput.contains(selection.focusNode)) {
      const end = (rawText.match(/[01]/g) || []).length;
      return { start: end, end };
    }

    const anchorOffset = getTextOffsetWithin(binInput, selection.anchorNode, selection.anchorOffset);
    const focusOffset = getTextOffsetWithin(binInput, selection.focusNode, selection.focusOffset);
    return {
      start: getBitCountBeforeTextOffset(rawText, Math.min(anchorOffset, focusOffset)),
      end: getBitCountBeforeTextOffset(rawText, Math.max(anchorOffset, focusOffset)),
    };
  }

  function setBinarySelectionByBitRange(start, end = start, data = getBinaryDisplayData()) {
    focusBinaryInput();

    const startBit = Math.max(0, Math.min(State.bits.length, start));
    const endBit = Math.max(0, Math.min(State.bits.length, end));
    const startOffset = data.offsetByBitIndex[startBit] ?? data.text.length;
    const endOffset = data.offsetByBitIndex[endBit] ?? data.text.length;
    const node = binInput.firstChild || binInput;
    const range = document.createRange();

    if (node === binInput) {
      range.setStart(binInput, 0);
      range.setEnd(binInput, 0);
    } else {
      range.setStart(node, startOffset);
      range.setEnd(node, endOffset);
    }

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    if (endBit >= State.bits.length) {
      binInput.scrollTop = binInput.scrollHeight;
    }
  }

  function focusBinaryAtPoint(x, y) {
    focusBinaryInput();

    const displayOffset = getDisplayOffsetAtPoint(x, y);
    if (displayOffset === null) {
      setBinarySelectionByBitRange(State.bits.length);
      return;
    }

    setBinarySelectionByBitRange(bitIndexFromDisplayOffset(displayOffset));
  }

  function getByteBitsAtDisplayOffset(displayOffset) {
    const data = getBinaryDisplayData();
    const offset = Math.max(0, Math.min(data.text.length, displayOffset));
    let bitIndex = data.bitIndexByCharOffset[offset];

    if (typeof bitIndex !== 'number') {
      bitIndex = data.bitIndexByCharOffset[offset - 1];
    }
    if (typeof bitIndex !== 'number') return '';

    const byteStart = Math.floor(clampBitIndex(bitIndex) / 8) * 8;
    const byte = State.bits.slice(byteStart, byteStart + 8);
    return byte.length === 8 ? byte : '';
  }

  // ---------- Keyboard show/hide (iOS-style) ----------
  function showKeyboard() {
    kbd.classList.remove('hidden');
  }

  function hideKeyboard() {
    kbd.classList.add('hidden');
  }

  // ---------- Mode handling ----------
  function setMode(next) {
    const previous = State.mode;
    State.mode = next;
    updateModeTitle(next, previous !== next);
    applyPanelOrder(next, previous !== next);

    if (next === 'tToB') {
      panelText.classList.add('active');
      panelBin.classList.remove('active');
      textInput.setAttribute('contenteditable', 'true');
      binInput.setAttribute('contenteditable', 'false');
      binInput.setAttribute('aria-readonly', 'true');
      binInput.blur();
      textInput.blur();
      hideKeyboard();
    } else {
      panelBin.classList.add('active');
      panelText.classList.remove('active');
      textInput.setAttribute('contenteditable', 'false');
      binInput.setAttribute('contenteditable', 'plaintext-only');
      binInput.setAttribute('aria-readonly', 'false');
      textInput.blur();
      binInput.blur();
      hideKeyboard();
    }
  }

  function updateModeTitle(next, animate) {
    const from = next === 'tToB' ? 'Text' : 'Binary';
    const to = next === 'tToB' ? 'Binary' : 'Text';
    clearTimeout(titleAnimationTimer);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (!modeTitle || !animate || reduceMotion) {
      if (modeTitle) {
        modeTitle.classList.remove('title-exit', 'title-enter');
        modeTitle.style.width = '';
      }
      titleFrom.textContent = from;
      titleTo.textContent = to;
      return;
    }

    modeTitle.style.width = `${Math.ceil(modeTitle.getBoundingClientRect().width)}px`;
    modeTitle.classList.remove('title-exit', 'title-enter');
    void modeTitle.offsetWidth;
    modeTitle.classList.add('title-exit');

    titleAnimationTimer = setTimeout(() => {
      titleFrom.textContent = from;
      titleTo.textContent = to;
      modeTitle.classList.remove('title-exit');
      void modeTitle.offsetWidth;
      modeTitle.classList.add('title-enter');

      titleAnimationTimer = setTimeout(() => {
        modeTitle.classList.remove('title-enter');
        modeTitle.style.width = '';
      }, 360);
    }, 150);
  }

  // Active panel slides to the top; the other slides down (FLIP animation).
  function applyPanelOrder(mode, animate) {
    const shouldSwap = mode === 'bToT';
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (!animate || reduceMotion) {
      app.classList.toggle('swapped', shouldSwap);
      return;
    }

    const firstText = panelText.getBoundingClientRect().top;
    const firstBin = panelBin.getBoundingClientRect().top;

    app.classList.toggle('swapped', shouldSwap);

    const dyText = firstText - panelText.getBoundingClientRect().top;
    const dyBin = firstBin - panelBin.getBoundingClientRect().top;

    clearTimeout(panelSwapTimer);
    for (const [el, dy] of [[panelText, dyText], [panelBin, dyBin]]) {
      el.style.willChange = 'transform';
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
    }

    void panelText.offsetHeight; // lock in the inverted start position

    for (const el of [panelText, panelBin]) {
      el.style.transition = 'transform 0.48s cubic-bezier(0.65, 0, 0.35, 1)';
      el.style.transform = '';
    }

    panelSwapTimer = setTimeout(() => {
      for (const el of [panelText, panelBin]) {
        el.style.transition = '';
        el.style.willChange = '';
      }
    }, 520);
  }

  // ---------- Event: text input ----------
  function cleanupTextInput() {
    // Browsers leave a stray <br> after deleting all content,
    // which prevents :empty::before from showing the placeholder.
    const html = textInput.innerHTML;
    if (!textInput.textContent && (html === '<br>' || html === '<div><br></div>')) {
      textInput.innerHTML = '';
    }
  }

  textInput.addEventListener('input', () => {
    cleanupTextInput();
    if (State.mode !== 'tToB') return;
    State.bits = textToBits(textInput.textContent || '');
    refresh();
  });

  textInput.addEventListener('pointerdown', (e) => {
    if (State.mode !== 'tToB') e.preventDefault();
  });

  // Prevent rich paste/formatting in text panel
  textInput.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text');
    document.execCommand('insertText', false, text);
  });

  // ---------- Event: custom keyboard ----------
  function syncBinaryTextFromBits(selection) {
    textInput.textContent = bitsToText(State.bits);
    refresh(selection ? { selection } : { preserveSelection: true });
  }

  function applyBinaryEdit(value, options = {}) {
    if (State.mode !== 'bToT') setMode('bToT');

    const range = getBinarySelectionRange();
    let start = range.start;
    let end = range.end;

    if (options.deleteDirection === 'backward' && start === end) {
      start = Math.max(0, start - 1);
    } else if (options.deleteDirection === 'forward' && start === end) {
      end = Math.min(State.bits.length, end + 1);
    }

    const insert = (value || '').replace(/[^01]/g, '');
    State.bits = State.bits.slice(0, start) + insert + State.bits.slice(end);
    const caret = start + insert.length;
    syncBinaryTextFromBits({ start: caret, end: caret });
  }

  function normalizeBinaryField() {
    const selection = getBinaryRawSelectionRange();
    State.bits = (binInput.textContent || '').replace(/[^01]/g, '');
    textInput.textContent = bitsToText(State.bits);
    refresh({
      selection: {
        start: Math.min(selection.start, State.bits.length),
        end: Math.min(selection.end, State.bits.length),
      },
    });
  }

  function commitBinaryKey(k) {
    if (k === 'back') {
      applyBinaryEdit('', { deleteDirection: 'backward' });
    } else if (k === '0' || k === '1') {
      applyBinaryEdit(k);
    } else {
      return;
    }
  }

  function setPressedKey(btn) {
    clearTimeout(keyReleaseTimer);
    if (activeKeyButton && activeKeyButton !== btn) {
      activeKeyButton.classList.remove('is-pressing');
    }
    activeKeyButton = btn;
    btn.classList.add('is-pressing');
  }

  function clearPressedKey() {
    clearTimeout(keyReleaseTimer);
    keyReleaseTimer = setTimeout(() => {
      if (activeKeyButton) activeKeyButton.classList.remove('is-pressing');
      activeKeyButton = null;
    }, 40);
  }

  function stopKeyRepeat() {
    clearTimeout(repeatDelayTimer);
    clearInterval(repeatTimer);
    repeatDelayTimer = null;
    repeatTimer = null;
  }

  function startBackspaceRepeat() {
    stopKeyRepeat();
    repeatDelayTimer = setTimeout(() => {
      repeatTimer = setInterval(() => {
        if (!State.bits.length) {
          stopKeyRepeat();
          return;
        }
        commitBinaryKey('back');
      }, 72);
    }, 430);
  }

  kbd.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.key');
    if (!btn || (e.pointerType === 'mouse' && e.button !== 0)) return;

    e.preventDefault();
    lastPointerKeyTime = performance.now();
    suppressGeneratedPointerClick = true;
    try { btn.setPointerCapture(e.pointerId); } catch {}

    setPressedKey(btn);
    commitBinaryKey(btn.dataset.k);
    if (btn.dataset.k === 'back') startBackspaceRepeat();
  });

  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => {
    kbd.addEventListener(type, () => {
      if (type !== 'pointerup') suppressGeneratedPointerClick = false;
      stopKeyRepeat();
      clearPressedKey();
    });
  });

  kbd.addEventListener('click', (e) => {
    const btn = e.target.closest('.key');
    if (!btn) return;
    e.preventDefault();

    if (e.detail > 0 && suppressGeneratedPointerClick) {
      suppressGeneratedPointerClick = false;
      return;
    }

    const recentPointerCommit = e.detail > 0 && performance.now() - lastPointerKeyTime < 350;
    const recentKeyboardCommit = e.detail === 0 && performance.now() - lastKeyboardKeyTime < 350;
    if (recentPointerCommit || recentKeyboardCommit) return;

    setPressedKey(btn);
    commitBinaryKey(btn.dataset.k);
    clearPressedKey();
  });

  kbd.addEventListener('keydown', (e) => {
    const btn = e.target.closest('.key');
    if (!btn || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    lastKeyboardKeyTime = performance.now();
    setPressedKey(btn);
    commitBinaryKey(btn.dataset.k);
    clearPressedKey();
  });

  binInput.addEventListener('pointerdown', (e) => {
    if (State.mode !== 'bToT') e.preventDefault();
  });

  // Keyboard rides the binary field's focus, like the iOS software keyboard.
  binInput.addEventListener('focus', () => {
    if (State.mode === 'bToT') showKeyboard();
  });

  binInput.addEventListener('blur', () => {
    // Defer: re-rendering the field re-asserts focus, so only dismiss on a real blur.
    setTimeout(() => {
      if (document.activeElement !== binInput) hideKeyboard();
    }, 0);
  });

  // Tapping anywhere outside the field or its keyboard dismisses the keyboard.
  document.addEventListener('pointerdown', (e) => {
    if (kbd.classList.contains('hidden')) return;
    if (kbd.contains(e.target) || binInput.contains(e.target)) return;
    binInput.blur();
    hideKeyboard();
  });

  binInput.addEventListener('beforeinput', (e) => {
    if (State.mode !== 'bToT') setMode('bToT');

    if (
      e.inputType === 'insertText' ||
      e.inputType === 'insertCompositionText' ||
      e.inputType === 'insertReplacementText'
    ) {
      e.preventDefault();
      applyBinaryEdit(e.data || '');
    } else if (e.inputType === 'insertFromPaste') {
      const text = e.dataTransfer?.getData('text') || '';
      if (text) {
        e.preventDefault();
        applyBinaryEdit(text);
      }
    } else if (e.inputType === 'deleteContentBackward') {
      e.preventDefault();
      applyBinaryEdit('', { deleteDirection: 'backward' });
    } else if (e.inputType === 'deleteContentForward') {
      e.preventDefault();
      applyBinaryEdit('', { deleteDirection: 'forward' });
    } else if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
      e.preventDefault();
    }
  });

  binInput.addEventListener('input', normalizeBinaryField);

  binInput.addEventListener('paste', (e) => {
    if (State.mode !== 'bToT') setMode('bToT');
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text');
    applyBinaryEdit(text);
  });

  binInput.addEventListener('keydown', (e) => {
    if (State.mode !== 'bToT') setMode('bToT');
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === '0' || e.key === '1') {
      e.preventDefault();
      applyBinaryEdit(e.key);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      applyBinaryEdit('', { deleteDirection: 'backward' });
    } else if (e.key === 'Delete') {
      e.preventDefault();
      applyBinaryEdit('', { deleteDirection: 'forward' });
    } else if (
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight' ||
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'Home' ||
      e.key === 'End' ||
      e.key === 'Tab' ||
      e.key === 'Escape' ||
      e.key === 'Shift'
    ) {
      return;
    } else if (e.key.length === 1 || e.key === 'Enter') {
      e.preventDefault();
    }
  });

  // ---------- Event: swap ----------
  swapBtn.addEventListener('click', () => {
    setMode(State.mode === 'tToB' ? 'bToT' : 'tToB');
    refresh();
  });

  // ---------- Event: panel tools ----------
  document.querySelectorAll('.tool').forEach(t => {
    t.addEventListener('click', async () => {
      const act = t.dataset.act;
      const tgt = t.dataset.tgt;
      const field = getToolField(tgt);

      if (act === 'copy') {
        const value = getToolValue(tgt);
        if (!value || t.classList.contains('btn-success')) return;
        if (await writeClipboard(value)) triggerCopyFeedback(t, field);
      }

      else if (act === 'paste') {
        try {
          const text = await navigator.clipboard.readText();
          if (tgt === 'text') {
            textInput.textContent = text;
            if (State.mode === 'tToB') {
              State.bits = textToBits(text);
            } else {
              setMode('tToB');
              State.bits = textToBits(text);
            }
          } else {
            State.bits = (text || '').replace(/[^01]/g, '');
            if (State.mode === 'bToT') {
              textInput.textContent = bitsToText(State.bits);
            } else {
              setMode('bToT');
              textInput.textContent = bitsToText(State.bits);
            }
          }
          refresh();
        } catch {}
      }

      else if (act === 'clear') {
        if (tgt === 'text') {
          textInput.textContent = '';
          State.bits = '';
        } else {
          State.bits = '';
          textInput.textContent = '';
        }
        refresh();
        triggerClearFeedback(t, field);
      }
    });
  });

  function getToolField(tgt) {
    return tgt === 'text' ? textInput : binInput;
  }

  function getToolValue(tgt) {
    return getToolField(tgt).textContent || '';
  }

  async function writeClipboard(value) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {}
    }
    return fallbackCopy(value);
  }

  function fallbackCopy(value) {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '-9999px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();

    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {}

    area.remove();
    return copied;
  }

  function triggerCopyFeedback(btn, field) {
    btn.classList.add('btn-success');
    field.classList.add('ring-green');

    setTimeout(() => {
      btn.classList.remove('btn-success');
      field.classList.remove('ring-green');
    }, 2000);
  }

  function triggerClearFeedback(btn, field) {
    btn.classList.add('btn-yellow');
    field.classList.add('ring-yellow');

    setTimeout(() => {
      btn.classList.remove('btn-yellow');
      field.classList.remove('ring-yellow');
    }, 1000);
  }

  // ---------- Event: byte tap (preview) ----------
  let toastTimer;
  let flashTimer;
  binInput.addEventListener('click', (e) => {
    if (suppressNextBytePreview) {
      suppressNextBytePreview = false;
      return;
    }
    if (!State.settings.tapPreview) return;
    const displayOffset = getDisplayOffsetAtPoint(e.clientX, e.clientY);
    if (displayOffset === null) return;
    const byteStartBit = getByteStartBitAtDisplayOffset(displayOffset);
    if (byteStartBit === null) return;
    flashByte(byteStartBit);
  });

  function getByteStartBitAtDisplayOffset(displayOffset) {
    const data = getBinaryDisplayData();
    const offset = Math.max(0, Math.min(data.text.length, displayOffset));
    let bitIndex = data.bitIndexByCharOffset[offset];
    if (typeof bitIndex !== 'number') bitIndex = data.bitIndexByCharOffset[offset - 1];
    if (typeof bitIndex !== 'number') return null;
    const byteStart = Math.floor(clampBitIndex(bitIndex) / 8) * 8;
    return State.bits.slice(byteStart, byteStart + 8).length === 8 ? byteStart : null;
  }

  // Byte span [start, end) of the character that owns byteIndex (multi-byte aware for UTF-8).
  function byteSpanForChar(bytes, byteIndex) {
    if (State.settings.encoding !== 'utf8') return [byteIndex, byteIndex + 1];
    let start = byteIndex;
    while (start > 0 && (bytes[start] & 0xC0) === 0x80) start--; // walk back over continuation bytes
    const lead = bytes[start];
    let len = 1;
    if (lead >= 0xF0) len = 4;
    else if (lead >= 0xE0) len = 3;
    else if (lead >= 0xC0) len = 2;
    let end = start + 1;
    while (end < bytes.length && end < start + len && (bytes[end] & 0xC0) === 0x80) end++;
    return [start, end];
  }

  let flashOverlays = [];

  function clearByteFlash() {
    flashOverlays.forEach(ov => ov.remove());
    flashOverlays = [];
  }

  // A transparent mirror of contentEl with only [start, end) colored, so the
  // flash can fade its opacity in/out without disturbing the editable field.
  function buildFlashOverlay(contentEl, kind, text, start, end) {
    const panel = contentEl.parentNode;
    if (!panel) return;
    const cs = getComputedStyle(contentEl);
    const ov = document.createElement('div');
    ov.className = `byte-flash-overlay ${kind}`;
    ov.style.left = `${contentEl.offsetLeft}px`;
    ov.style.top = `${contentEl.offsetTop}px`;
    ov.style.width = `${contentEl.offsetWidth}px`;
    ov.style.height = `${contentEl.offsetHeight}px`;
    [
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'textAlign', 'whiteSpace', 'wordBreak', 'overflowWrap',
    ].forEach(p => { ov.style[p] = cs[p]; });
    ov.innerHTML = `${escapeHtml(text.slice(0, start))}<span class="fx">${escapeHtml(text.slice(start, end))}</span>${escapeHtml(text.slice(end))}`;
    panel.appendChild(ov);
    ov.scrollTop = contentEl.scrollTop;
    flashOverlays.push(ov);
  }

  // Briefly fade the tapped byte (plus its sibling bytes for multi-byte chars)
  // in the binary panel and the matching character in the text panel to color,
  // then fade back.
  function flashByte(byteStartBit) {
    clearTimeout(flashTimer);
    clearByteFlash();

    const bytes = (State.bits.match(/.{8}/g) || []).map(b => parseInt(b, 2));
    const byteIndex = byteStartBit / 8;
    if (byteIndex >= bytes.length) return;
    const [startByte, endByte] = byteSpanForChar(bytes, byteIndex);

    const data = getBinaryDisplayData();
    const binStart = data.offsetByBitIndex[startByte * 8];
    const binEnd = data.offsetByBitIndex[endByte * 8];
    if (typeof binStart === 'number' && typeof binEnd === 'number') {
      buildFlashOverlay(binInput, 'bin', data.text, binStart, binEnd);
    }

    const fullText = bytesToText(bytes);
    if (textInput.textContent === fullText) {
      const txtStart = bytesToText(bytes.slice(0, startByte)).length;
      const txtEnd = bytesToText(bytes.slice(0, endByte)).length;
      buildFlashOverlay(textInput, 'text', fullText, txtStart, txtEnd);
    }

    const overlays = flashOverlays;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      overlays.forEach(ov => ov.classList.add('show'));
    }));
    flashTimer = setTimeout(() => {
      overlays.forEach(ov => ov.classList.remove('show'));
      setTimeout(() => overlays.forEach(ov => ov.remove()), 260);
    }, 1400);
  }

  function showBytePreview(bits) {
    const code = parseInt(bits, 2);
    let label;
    if (code === 32) label = '<em style="color:var(--ink-3); font-style:normal;">space</em>';
    else if (code === 10) label = '<em style="color:var(--ink-3); font-style:normal;">newline</em>';
    else if (code === 13) label = '<em style="color:var(--ink-3); font-style:normal;">return</em>';
    else if (code === 9) label = '<em style="color:var(--ink-3); font-style:normal;">tab</em>';
    else if (code === 0) label = '<em style="color:var(--ink-3); font-style:normal;">null</em>';
    else if (code === 127) label = '<em style="color:var(--ink-3); font-style:normal;">del</em>';
    else if (code < 32) label = `<em style="color:var(--ink-3); font-style:normal;">ctrl-${code}</em>`;
    else if (code > 127 && State.settings.encoding === 'utf8') {
      label = `<em style="color:var(--ink-3); font-style:normal; font-size:14px;">part of multi-byte</em>`;
    }
    else label = escapeHtml(String.fromCharCode(code));

    toast.innerHTML = `<span class="byte-bits">${bits} &middot; ${code}</span>${label}`;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1700);
  }

  // ---------- Settings modal ----------
  // Settings apply live; snapshot on open so Cancel/X can revert.
  let settingsSnapshot = null;

  function openSheet() {
    settingsSnapshot = { ...State.settings };
    sheet.classList.add('open');
    sheetBack.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
  }
  function hideSheet() {
    sheet.classList.remove('open');
    sheetBack.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
  }
  // OK: keep current (already-applied) settings.
  function confirmSheet() {
    settingsSnapshot = null;
    hideSheet();
  }
  // Cancel / X / backdrop: revert to the snapshot taken on open.
  function cancelSheet() {
    if (settingsSnapshot) {
      State.settings = settingsSnapshot;
      settingsSnapshot = null;
      saveSettings();
      applySettingsToUI();
      applyTheme(State.settings.theme);
      applyAccent(State.settings.accent);
      refresh();
    }
    hideSheet();
  }
  settingsBtn.addEventListener('click', openSheet);
  sheetClose.addEventListener('click', cancelSheet);
  sheetCancel.addEventListener('click', cancelSheet);
  sheetBack.addEventListener('click', cancelSheet);
  sheetOk.addEventListener('click', confirmSheet);

  // Segmented controls
  document.querySelectorAll('.seg').forEach(seg => {
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      const key = seg.dataset.setting;
      const val = btn.dataset.val;
      seg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
      State.settings[key] = val;

      if (key === 'separator') {
        sepCustom.hidden = val !== 'custom';
        if (val === 'custom') {
          sepCustom.value = State.settings.customSeparator;
          setTimeout(() => sepCustom.focus(), 50);
        }
      }
      if (key === 'theme') { applyTheme(val); applyAccent(State.settings.accent); }
      if (key === 'accent') applyAccent(val);

      saveSettings();
      if (key === 'encoding') {
        // recompute from source
        if (State.mode === 'tToB') {
          State.bits = textToBits(textInput.textContent || '');
        } else {
          textInput.textContent = bitsToText(State.bits);
        }
      }
      refresh();
    });
  });

  // Custom separator input
  sepCustom.addEventListener('input', () => {
    State.settings.customSeparator = sepCustom.value;
    saveSettings();
    refresh();
  });

  // Tap-preview toggle
  tapToggle.addEventListener('click', () => {
    const next = tapToggle.getAttribute('aria-checked') !== 'true';
    tapToggle.setAttribute('aria-checked', next);
    State.settings.tapPreview = next;
    saveSettings();
  });

  // Reset
  resetBtn.addEventListener('click', () => {
    State.settings = { ...DEFAULTS };
    saveSettings();
    applySettingsToUI();
    applyTheme(State.settings.theme);
    applyAccent(State.settings.accent);
    refresh();
  });

  // Apply theme to root
  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    requestAnimationFrame(updateThemeColor);
  }

  // Apply accent color to root
  function applyAccent(a) {
    // Electric theme drives both accents itself, so ignore the stored accent.
    root.setAttribute('data-accent', State.settings.theme === 'electric' ? 'blue' : a);
    requestAnimationFrame(updateThemeColor);
  }

  // Update settings UI to reflect State.settings
  function applySettingsToUI() {
    document.querySelectorAll('.seg').forEach(seg => {
      const key = seg.dataset.setting;
      const val = State.settings[key];
      seg.querySelectorAll('.seg-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.val === val);
      });
    });
    sepCustom.value = State.settings.customSeparator || '';
    sepCustom.hidden = State.settings.separator !== 'custom';
    tapToggle.setAttribute('aria-checked', State.settings.tapPreview ? 'true' : 'false');
  }

  // ---------- Prevent unintended behaviors ----------
  // Double-tap zoom prevention (extra safety on iOS)
  let lastTouch = 0;
  document.addEventListener('touchend', (e) => {
    if (e.target.closest('button, input, textarea, .content, [contenteditable="true"]')) {
      lastTouch = Date.now();
      return;
    }
    const now = Date.now();
    if (now - lastTouch <= 350) e.preventDefault();
    lastTouch = now;
  }, { passive: false });

  // Stop pinch zoom
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // Listen for OS color scheme changes (for 'auto' theme)
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (State.settings.theme === 'auto') {
        requestAnimationFrame(updateThemeColor);
      }
    });
  }

  // ---------- Init ----------
  function init() {
    applyTheme(State.settings.theme);
    applyAccent(State.settings.accent);
    applySettingsToUI();
    setMode('tToB');
    State.bits = '';
    refresh();
    setTimeout(updateThemeColor, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
