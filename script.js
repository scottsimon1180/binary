(() => {
  'use strict';

  // ---------- Defaults & state ----------
  const STORAGE_KEY = 'binary-translator-v1';
  const DEFAULTS = {
    theme: 'light',
    separator: 'space',
    customSeparator: '\u00b7',
    encoding: 'utf8',
    tapPreview: true,
  };

  const State = {
    mode: 'tToB',   // 'tToB' or 'bToT'
    bits: '',       // canonical binary string (only 0s and 1s, no separators)
    settings: loadSettings(),
  };

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return { ...DEFAULTS, ...s };
    } catch { return { ...DEFAULTS }; }
  }

  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(State.settings)); } catch {}
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
  const sepCustom  = $('sepCustom');
  const tapToggle  = $('tapPreviewToggle');
  const resetBtn   = $('resetSettings');
  const toast      = $('toast');
  const themeColor = $('themeColor');
  const root       = document.documentElement;
  let titleAnimationTimer;
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
      case 'dash':   return '-';
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
    let text = '';
    let bitIndex = 0;

    chunks.forEach((chunk, chunkIndex) => {
      if (chunkIndex > 0) {
        for (const char of sep) {
          text += char;
          bitIndexByOffset[text.length] = bitIndex;
        }
      }

      for (const bit of chunk) {
        text += bit;
        bitIndex += 1;
        bitIndexByOffset[text.length] = bitIndex;
        offsetByBitIndex[bitIndex] = text.length;
      }
    });

    return { text, offsetByBitIndex, bitIndexByOffset };
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

  function focusTextAtPoint(x, y) {
    textInput.focus({ preventScroll: true });

    let range = null;
    if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(x, y);
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
      }
    } else if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    }

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

    let range = null;
    if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(x, y);
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
      }
    } else if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    }

    if (!range || !binInput.contains(range.startContainer)) {
      setBinarySelectionByBitRange(State.bits.length);
      return;
    }

    const displayOffset = getTextOffsetWithin(binInput, range.startContainer, range.startOffset);
    setBinarySelectionByBitRange(bitIndexFromDisplayOffset(displayOffset));
  }

  // ---------- Mode handling ----------
  function setMode(next) {
    const previous = State.mode;
    State.mode = next;
    updateModeTitle(next, previous !== next);

    if (next === 'tToB') {
      panelText.classList.add('active');
      panelBin.classList.remove('active');
      textInput.setAttribute('contenteditable', 'true');
      binInput.setAttribute('contenteditable', 'false');
      binInput.setAttribute('aria-readonly', 'true');
      kbd.classList.add('hidden');
    } else {
      panelBin.classList.add('active');
      panelText.classList.remove('active');
      textInput.setAttribute('contenteditable', 'false');
      binInput.setAttribute('contenteditable', 'plaintext-only');
      binInput.setAttribute('aria-readonly', 'false');
      textInput.blur();
      kbd.classList.remove('hidden');
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
      }, 210);
    }, 120);
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
    if (State.mode === 'tToB') return;
    setMode('tToB');
    focusTextAtPoint(e.clientX, e.clientY);
  });

  textInput.addEventListener('focus', () => {
    if (State.mode !== 'tToB') setMode('tToB');
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
    if (State.mode === 'bToT') {
      return;
    }
    e.preventDefault();
    suppressNextBytePreview = true;
    setMode('bToT');
    focusBinaryAtPoint(e.clientX, e.clientY);
  });

  binInput.addEventListener('focus', () => {
    if (State.mode !== 'bToT') {
      setMode('bToT');
      requestAnimationFrame(() => setBinarySelectionByBitRange(State.bits.length));
    }
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
  binInput.addEventListener('click', (e) => {
    if (suppressNextBytePreview) {
      suppressNextBytePreview = false;
      return;
    }
    if (!State.settings.tapPreview) return;
    const span = e.target.closest('.byte');
    if (!span || span.classList.contains('partial')) return;
    const bits = span.textContent;
    if (bits.length !== 8) return;
    showBytePreview(bits);
  });

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

  // ---------- Settings sheet ----------
  function openSheet() {
    sheet.classList.add('open');
    sheetBack.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
  }
  function closeSheet() {
    sheet.classList.remove('open');
    sheetBack.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
  }
  settingsBtn.addEventListener('click', openSheet);
  sheetClose.addEventListener('click', closeSheet);
  sheetBack.addEventListener('click', closeSheet);

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
      if (key === 'theme') applyTheme(val);

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
    refresh();
  });

  // Apply theme to root
  function applyTheme(t) {
    root.setAttribute('data-theme', t);
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
