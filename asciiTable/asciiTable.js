(() => {
  'use strict';

  const CATEGORIES = [
    { key: 'all', label: 'All', detail: 'Every standard ASCII code' },
    { key: 'letters', label: 'Letters', detail: 'Uppercase and lowercase' },
    { key: 'uppercase', label: 'Uppercase', detail: 'A through Z' },
    { key: 'lowercase', label: 'Lowercase', detail: 'a through z' },
    { key: 'numbers', label: 'Numbers', detail: '0 through 9' },
    { key: 'symbols', label: 'Symbols', detail: 'Punctuation and marks' },
    { key: 'whitespace', label: 'Whitespace', detail: 'Space, tab, newline' },
    { key: 'control', label: 'Control', detail: 'Non-printing control codes' },
  ];

  const CONTROL_NAMES = {
    0: ['NUL', 'Null'],
    1: ['SOH', 'Start of heading'],
    2: ['STX', 'Start of text'],
    3: ['ETX', 'End of text'],
    4: ['EOT', 'End of transmission'],
    5: ['ENQ', 'Enquiry'],
    6: ['ACK', 'Acknowledge'],
    7: ['BEL', 'Bell'],
    8: ['BS', 'Backspace'],
    9: ['HT', 'Horizontal tab'],
    10: ['LF', 'Line feed'],
    11: ['VT', 'Vertical tab'],
    12: ['FF', 'Form feed'],
    13: ['CR', 'Carriage return'],
    14: ['SO', 'Shift out'],
    15: ['SI', 'Shift in'],
    16: ['DLE', 'Data link escape'],
    17: ['DC1', 'Device control one'],
    18: ['DC2', 'Device control two'],
    19: ['DC3', 'Device control three'],
    20: ['DC4', 'Device control four'],
    21: ['NAK', 'Negative acknowledge'],
    22: ['SYN', 'Synchronous idle'],
    23: ['ETB', 'End transmission block'],
    24: ['CAN', 'Cancel'],
    25: ['EM', 'End of medium'],
    26: ['SUB', 'Substitute'],
    27: ['ESC', 'Escape'],
    28: ['FS', 'File separator'],
    29: ['GS', 'Group separator'],
    30: ['RS', 'Record separator'],
    31: ['US', 'Unit separator'],
    127: ['DEL', 'Delete'],
  };

  const WHITESPACE_NOTES = {
    9: 'tab',
    10: 'newline',
    11: 'vertical tab',
    12: 'form feed',
    13: 'return',
    32: 'space',
  };

  const SYMBOL_NAMES = {
    33: 'Exclamation mark',
    34: 'Double quote',
    35: 'Number sign',
    36: 'Dollar sign',
    37: 'Percent sign',
    38: 'Ampersand',
    39: 'Apostrophe',
    40: 'Left parenthesis',
    41: 'Right parenthesis',
    42: 'Asterisk',
    43: 'Plus sign',
    44: 'Comma',
    45: 'Hyphen-minus',
    46: 'Period',
    47: 'Slash',
    58: 'Colon',
    59: 'Semicolon',
    60: 'Less-than sign',
    61: 'Equals sign',
    62: 'Greater-than sign',
    63: 'Question mark',
    64: 'At sign',
    91: 'Left square bracket',
    92: 'Backslash',
    93: 'Right square bracket',
    94: 'Caret',
    95: 'Underscore',
    96: 'Grave accent',
    123: 'Left curly brace',
    124: 'Vertical bar',
    125: 'Right curly brace',
    126: 'Tilde',
  };

  const els = {};
  let activeCategory = 'all';
  let filterMenuOpen = false;
  let activeToastTimer;
  let activeCopiedRow;
  let lastFocused;

  const ASCII = Array.from({ length: 128 }, (_, code) => buildAsciiItem(code));

  function $(id) {
    return document.getElementById(id);
  }

  function binary(code) {
    return code.toString(2).padStart(8, '0');
  }

  function hex(code) {
    return code.toString(16).toUpperCase().padStart(2, '0');
  }

  function isControl(code) {
    return code <= 31 || code === 127;
  }

  function isUppercase(code) {
    return code >= 65 && code <= 90;
  }

  function isLowercase(code) {
    return code >= 97 && code <= 122;
  }

  function isNumber(code) {
    return code >= 48 && code <= 57;
  }

  function isWhitespace(code) {
    return Object.prototype.hasOwnProperty.call(WHITESPACE_NOTES, code);
  }

  function isSymbol(code) {
    return code >= 33 && code <= 126 && !isUppercase(code) && !isLowercase(code) && !isNumber(code);
  }

  function buildAsciiItem(code) {
    const char = code >= 32 && code <= 126 ? String.fromCharCode(code) : '';
    const control = CONTROL_NAMES[code];
    const whiteLabel = WHITESPACE_NOTES[code];
    let label = char;
    let note = '';
    let description = '';

    if (control) {
      label = control[0];
      description = control[1];
      note = whiteLabel || 'control';
    } else if (code === 32) {
      label = 'SP';
      note = 'space';
      description = 'Space character';
    } else if (isUppercase(code)) {
      description = `Uppercase letter ${char}`;
    } else if (isLowercase(code)) {
      description = `Lowercase letter ${char}`;
    } else if (isNumber(code)) {
      description = `Digit ${char}`;
    } else if (isSymbol(code)) {
      description = SYMBOL_NAMES[code] || 'Symbol';
    }

    const item = {
      code,
      char,
      label,
      note,
      description,
      binary: binary(code),
      decimal: String(code),
      hex: hex(code),
      categories: [],
    };

    if (isControl(code)) item.categories.push('control');
    if (isWhitespace(code)) item.categories.push('whitespace');
    if (isUppercase(code) || isLowercase(code)) item.categories.push('letters');
    if (isUppercase(code)) item.categories.push('uppercase');
    if (isLowercase(code)) item.categories.push('lowercase');
    if (isNumber(code)) item.categories.push('numbers');
    if (isSymbol(code)) item.categories.push('symbols');

    item.searchText = buildSearchText(item);
    return item;
  }

  function buildSearchText(item) {
    const aliases = [
      item.label,
      item.note,
      item.description,
      item.binary,
      item.binary.replace(/(.{4})/g, '$1 ').trim(),
      item.decimal,
      item.hex,
      `0x${item.hex}`,
      `x${item.hex}`,
      `ascii ${item.decimal}`,
      ...item.categories,
    ];

    if (item.char) aliases.push(item.char);
    if (item.code === 32) aliases.push('blank', 'spacebar');
    if (item.code === 9) aliases.push('tab', '\\t');
    if (item.code === 10) aliases.push('newline', 'line break', '\\n');
    if (item.code === 13) aliases.push('return', 'enter', '\\r');
    if (item.code === 27) aliases.push('escape', 'esc');

    return aliases.join(' ').toLowerCase();
  }

  function initAsciiTable() {
    els.phone = document.querySelector('.phone');
    els.app = document.querySelector('.app');
    els.openBtn = $('asciiOpenBtn');
    els.screen = $('asciiScreen');
    els.backBtn = $('asciiBackBtn');
    els.search = $('asciiSearch');
    els.filters = $('asciiFilters');
    els.list = $('asciiList');
    els.empty = $('asciiEmpty');
    els.count = $('asciiCount');
    els.toast = $('asciiToast');

    if (!els.phone || !els.openBtn || !els.screen) return;

    renderFilters();
    renderRows();

    els.openBtn.addEventListener('click', openAsciiTable);
    els.backBtn.addEventListener('click', closeAsciiTable);
    els.search.addEventListener('input', renderRows);
    document.addEventListener('click', handleDocumentClick);
    els.screen.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (filterMenuOpen) {
        closeFilterMenu({ restoreFocus: true });
        event.stopPropagation();
        return;
      }
      closeAsciiTable();
    });
  }

  function renderFilters() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ascii-filter-button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'asciiFilterMenu');
    button.innerHTML = `
      <span class="ascii-filter-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M5 7h14" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
          <path d="M8 12h8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
          <path d="M10.5 17h3" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
        </svg>
      </span>
      <span class="ascii-filter-copy">
        <span class="ascii-filter-kicker">Category</span>
        <span class="ascii-filter-label" data-filter-label></span>
      </span>
      <span class="ascii-filter-count" data-filter-count></span>
      <span class="ascii-filter-chevron" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none">
          <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    `;

    const menu = document.createElement('div');
    menu.className = 'ascii-filter-menu';
    menu.id = 'asciiFilterMenu';
    menu.hidden = true;
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', 'ASCII categories');

    CATEGORIES.forEach((category) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ascii-filter-option';
      button.dataset.category = category.key;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', category.key === activeCategory ? 'true' : 'false');
      button.innerHTML = `
        <span class="ascii-option-check" aria-hidden="true">
          <svg viewBox="0 0 18 18" fill="none">
            <path d="M4 9.4l3 3L14 5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <span class="ascii-option-copy">
          <span class="ascii-option-label">${escapeHtml(category.label)}</span>
          <span class="ascii-option-detail">${escapeHtml(category.detail)}</span>
        </span>
        <span class="ascii-option-count">${categoryCount(category.key)}</span>
      `;
      button.addEventListener('click', () => {
        setActiveCategory(category.key);
      });
      menu.appendChild(button);
    });

    els.filters.replaceChildren(button, menu);
    els.filterButton = button;
    els.filterLabel = button.querySelector('[data-filter-label]');
    els.filterCount = button.querySelector('[data-filter-count]');
    els.filterMenu = menu;
    els.filterOptions = Array.from(menu.querySelectorAll('.ascii-filter-option'));

    button.addEventListener('click', () => toggleFilterMenu());
    button.addEventListener('keydown', handleFilterButtonKeydown);
    menu.addEventListener('keydown', handleFilterMenuKeydown);
    updateFilterState();
  }

  function setActiveCategory(categoryKey) {
    activeCategory = categoryKey;
    updateFilterState();
    renderRows();
    closeFilterMenu({ restoreFocus: true });
  }

  function updateFilterState() {
    const category = activeCategoryData();
    els.filterLabel.textContent = category.label;
    els.filterCount.textContent = `${categoryCount(category.key)} codes`;

    els.filterOptions.forEach((option) => {
      const isActive = option.dataset.category === activeCategory;
      option.classList.toggle('active', isActive);
      option.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  function activeCategoryData() {
    return CATEGORIES.find((category) => category.key === activeCategory) || CATEGORIES[0];
  }

  function categoryCount(categoryKey) {
    return categoryKey === 'all'
      ? ASCII.length
      : ASCII.filter((item) => item.categories.includes(categoryKey)).length;
  }

  function toggleFilterMenu() {
    if (filterMenuOpen) {
      closeFilterMenu();
    } else {
      openFilterMenu();
    }
  }

  function openFilterMenu({ focusOption = false } = {}) {
    filterMenuOpen = true;
    els.filterMenu.hidden = false;
    els.filterButton.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => els.filterMenu.classList.add('open'));

    if (focusOption) {
      const selected = els.filterOptions.find((option) => option.dataset.category === activeCategory);
      (selected || els.filterOptions[0])?.focus({ preventScroll: true });
    }
  }

  function closeFilterMenu({ restoreFocus = false } = {}) {
    if (!filterMenuOpen && els.filterMenu.hidden) return;

    filterMenuOpen = false;
    els.filterButton.setAttribute('aria-expanded', 'false');
    els.filterMenu.classList.remove('open');
    window.setTimeout(() => {
      if (!filterMenuOpen) els.filterMenu.hidden = true;
    }, 160);

    if (restoreFocus) els.filterButton.focus({ preventScroll: true });
  }

  function handleFilterButtonKeydown(event) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openFilterMenu({ focusOption: true });
    }
  }

  function handleFilterMenuKeydown(event) {
    const currentIndex = els.filterOptions.indexOf(document.activeElement);

    if (event.key === 'Escape') {
      event.preventDefault();
      closeFilterMenu({ restoreFocus: true });
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (currentIndex + offset + els.filterOptions.length) % els.filterOptions.length;
      els.filterOptions[nextIndex].focus({ preventScroll: true });
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0 : els.filterOptions.length - 1;
      els.filterOptions[nextIndex].focus({ preventScroll: true });
    }
  }

  function handleDocumentClick(event) {
    if (!filterMenuOpen || els.filters.contains(event.target)) return;
    closeFilterMenu();
  }

  function renderRows() {
    const query = normalizeSearch(els.search.value);
    const rows = ASCII
      .map((item) => ({ item, score: searchScore(item, query) }))
      .filter(({ item, score }) => matchesCategory(item) && (!query || score > 0))
      .sort((a, b) => query ? b.score - a.score || a.item.code - b.item.code : a.item.code - b.item.code)
      .map(({ item }) => item);
    const fragment = document.createDocumentFragment();

    rows.forEach((item) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'ascii-row';
      row.dataset.code = item.code;
      row.setAttribute('aria-label', `Copy ${item.binary} for ${item.description || item.label}`);
      row.innerHTML = `
        <span class="ascii-char">
          <strong>${escapeHtml(item.label)}</strong>
          ${item.note ? `<small>${escapeHtml(item.note)}</small>` : ''}
        </span>
        <span class="ascii-binary">${item.binary}</span>
        <span class="ascii-dec">${item.decimal}</span>
        <span class="ascii-hex">0x${item.hex}</span>
        <span class="ascii-desc">${escapeHtml(item.description)}</span>
      `;
      row.addEventListener('click', () => copyAsciiBinary(item, row));
      fragment.appendChild(row);
    });

    els.list.replaceChildren(fragment);
    els.empty.hidden = rows.length !== 0;
    els.count.textContent = `${rows.length} code${rows.length === 1 ? '' : 's'}`;
  }

  function normalizeSearch(value) {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function matchesCategory(item) {
    return activeCategory === 'all' || item.categories.includes(activeCategory);
  }

  function searchScore(item, query) {
    if (!query) return 1;
    const compact = query.replace(/\s/g, '');
    const label = item.label.toLowerCase();
    const note = item.note.toLowerCase();
    const description = item.description.toLowerCase();
    const char = item.char.toLowerCase();
    const hexValue = item.hex.toLowerCase();
    const terms = [
      label,
      note,
      ...description.split(/\s+/),
      ...item.categories,
      `ascii ${item.decimal}`,
    ].filter(Boolean);

    if (query.length === 1 && !/\d/.test(query)) {
      if (char === query || label === query) return 100;
      return 0;
    }

    if (char === query) return 100;
    if (label === query) return 98;
    if (note === query) return 96;
    if (item.decimal === query) return 94;
    if (query === `0x${hexValue}` || query === `x${hexValue}` || query === hexValue) return 92;
    if (compact === item.binary) return 90;
    if (/^[01]+$/.test(compact) && item.binary.startsWith(compact)) return 82;
    if (/^[01]+$/.test(compact) && item.binary.includes(compact)) return 70;
    if (description === query) return 68;
    if (description.startsWith(query)) return 62;
    if (terms.some((term) => term === query)) return 58;
    if (terms.some((term) => term.startsWith(query))) return 48;
    if (query.includes(' ') && item.searchText.includes(query)) return 20;

    return 0;
  }

  async function copyAsciiBinary(item, row) {
    const copied = await writeClipboard(item.binary);
    if (!copied) return;

    if (activeCopiedRow) activeCopiedRow.classList.remove('is-copied');
    activeCopiedRow = row;
    row.classList.add('is-copied');
    setTimeout(() => row.classList.remove('is-copied'), 1000);

    const label = item.char && item.code !== 32 ? item.char : item.label;
    const message = item.char && item.code !== 32
      ? `Copied ${item.binary}`
      : `Copied ${label} · ${item.binary}`;

    showToast(message);
  }

  async function writeClipboard(value) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {}
    }

    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    area.style.top = '0';
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

  function showToast(message) {
    clearTimeout(activeToastTimer);
    els.toast.textContent = message;
    els.toast.classList.add('show');
    activeToastTimer = setTimeout(() => els.toast.classList.remove('show'), 1600);
  }

  function openAsciiTable() {
    lastFocused = document.activeElement;
    els.phone.classList.add('ascii-open');
    els.screen.setAttribute('aria-hidden', 'false');
    els.openBtn.setAttribute('aria-expanded', 'true');
    if ('inert' in HTMLElement.prototype) els.app.inert = true;
    setTimeout(() => els.backBtn.focus({ preventScroll: true }), 280);
  }

  function closeAsciiTable() {
    closeFilterMenu();
    els.phone.classList.remove('ascii-open');
    els.screen.setAttribute('aria-hidden', 'true');
    els.openBtn.setAttribute('aria-expanded', 'false');
    if ('inert' in HTMLElement.prototype) els.app.inert = false;
    els.toast.classList.remove('show');

    if (lastFocused && typeof lastFocused.focus === 'function') {
      setTimeout(() => lastFocused.focus({ preventScroll: true }), 220);
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAsciiTable);
  } else {
    initAsciiTable();
  }
})();
