/* fileName: script.js */
const $ = id => document.getElementById(id);
const cpIframe = $('cpIframe'), fileInput = $('fileInput'), inputStr = $('inputStr'), outputStr = $('outputStr');
const previewArea = $('previewArea'), layersList = $('layersList'), layersWrap = $('layersWrap');
const detVbW = $('detVbW'), detVbH = $('detVbH'), detObjW = $('detObjW'), detObjH = $('detObjH');

let cpActiveCallback = null, cpInitialData = null;
let globalOptimizedSvg = null, globalOriginalSvg = null, colorMode = 'mono', zoomMode = 'fit';
let isLinkedMode = false, isEyedropperMode = false;
let cpRects = [], cpIsDragging = false, lastMouseX = 0, lastMouseY = 0;
let currentPngBg = 'transparent';
const ctxHelper = document.createElement('canvas').getContext('2d');

// Resize Panel State & History
let resizeBackupSvg = null;
let isAbLocked = true, isInkLocked = true, isLinked = true;
let resizeState = { 
    baseW: 0, baseH: 0, baseX: 0, baseY: 0, 
    abW: 0, abH: 0, inkW: 0, inkH: 0, inkX: 0, inkY: 0,
    origAbW: 0, origAbH: 0, origInkW: 0, origInkH: 0, origInkX: 0, origInkY: 0 
};
let resizeHistory = [];
let resizeHistoryIndex = -1;

const saveResizeState = () => {
    const currentState = JSON.stringify(resizeState);
    if (resizeHistoryIndex >= 0 && resizeHistory[resizeHistoryIndex] === currentState) return;
    resizeHistory = resizeHistory.slice(0, resizeHistoryIndex + 1);
    resizeHistory.push(currentState);
    resizeHistoryIndex++;
    updateUndoRedoUI();
};

const updateUndoRedoUI = () => {
    const btnUndo = $('btnResizeUndo');
    const btnRedo = $('btnResizeRedo');
    if (btnUndo) btnUndo.style.opacity = resizeHistoryIndex > 0 ? '1' : '0.3';
    if (btnUndo) btnUndo.style.pointerEvents = resizeHistoryIndex > 0 ? 'auto' : 'none';
    if (btnRedo) btnRedo.style.opacity = resizeHistoryIndex < resizeHistory.length - 1 ? '1' : '0.3';
    if (btnRedo) btnRedo.style.pointerEvents = resizeHistoryIndex < resizeHistory.length - 1 ? 'auto' : 'none';
};

window.resizeUndo = () => {
    if (resizeHistoryIndex > 0) {
        resizeHistoryIndex--;
        resizeState = JSON.parse(resizeHistory[resizeHistoryIndex]);
        updateResizeInputs(); 
        applyResizeMath(false);
        updateUndoRedoUI();
    }
};

window.resizeRedo = () => {
    if (resizeHistoryIndex < resizeHistory.length - 1) {
        resizeHistoryIndex++;
        resizeState = JSON.parse(resizeHistory[resizeHistoryIndex]);
        updateResizeInputs(); 
        applyResizeMath(false);
        updateUndoRedoUI();
    }
};

// ==========================================
// Centralized Popup Engine
// ==========================================
let opPopup = $('opPopupWrap');
let strokePopup = $('strokePopupWrap');

if (!opPopup) {
    opPopup = document.createElement('div');
    opPopup.className = 'slider-popup vertical';
    opPopup.id = 'opPopupWrap';
    opPopup.innerHTML = `<input type="range" min="0" max="100" step="1">`;
    document.body.appendChild(opPopup);

    strokePopup = document.createElement('div');
    strokePopup.className = 'slider-popup horizontal';
    strokePopup.id = 'strokePopupWrap';
    strokePopup.innerHTML = `<input type="range" min="-1" max="1" step="any" value="0">`;
    document.body.appendChild(strokePopup);

    document.addEventListener('pointerdown', e => {
        if (opPopup.style.display === 'flex' && !opPopup.contains(e.target) && !e.target.closest('.slider-trigger.op')) {
            opPopup.style.display = 'none';
        }
        if (strokePopup.style.display === 'flex' && !strokePopup.contains(e.target) && !e.target.closest('.slider-trigger.stroke')) {
            strokePopup.style.display = 'none';
        }
        if (!e.target.closest('.slider-trigger')) {
            document.querySelectorAll('.slider-trigger').forEach(el => el.classList.remove('is-active'));
        }
    });
}

// ==========================================
// Reusable Custom Scrollbar Engine
// ==========================================
const initCustomScroll = (contentEl, wrapEl) => {
    if (!contentEl || !wrapEl) return () => {};
    const track = wrapEl.querySelector('.custom-scroll-track');
    const thumb = wrapEl.querySelector('.custom-scroll-thumb');
    if (!track || !thumb) return () => {};

    let scrollTimeout, isDraggingScroll = false, scrollStartY = 0, scrollStartTop = 0;

    const updateScroll = () => {
        const sh = contentEl.scrollHeight, ch = contentEl.clientHeight;
        if (sh <= ch + 1 || ch === 0) {
            thumb.style.opacity = '0';
            track.style.pointerEvents = 'none';
            return;
        }
        thumb.style.opacity = '';
        track.style.pointerEvents = 'auto';
        const ratio = ch / sh;
        const thumbH = Math.max(30, ch * ratio);
        thumb.style.height = `${thumbH}px`;
        const maxScroll = sh - ch;
        const maxThumbY = ch - thumbH - 4; 
        const thumbY = (contentEl.scrollTop / maxScroll) * maxThumbY;
        thumb.style.transform = `translateY(${thumbY}px)`;
    };

    const showScroll = () => {
        const sh = contentEl.scrollHeight, ch = contentEl.clientHeight;
        if (sh <= ch + 1) return;
        track.classList.add('is-active');
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            if (!isDraggingScroll && !track.classList.contains('is-hovered')) {
                track.classList.remove('is-active');
            }
        }, 800);
    };

    contentEl.addEventListener('scroll', () => {
        updateScroll();
        showScroll();
        opPopup.style.display = 'none';
        strokePopup.style.display = 'none';
        document.querySelectorAll('.slider-trigger').forEach(el => el.classList.remove('is-active'));
    }, { passive: true });
    new ResizeObserver(updateScroll).observe(contentEl);

    // Smooth wheel scroll: forwards wheel events from anywhere inside the wrapper
    // (including sub-controls and the scroll track) and eases toward the target.
    let smoothTarget = null, smoothRAF = 0;
    const easeTick = () => {
        const current = contentEl.scrollTop;
        const diff = smoothTarget - current;
        if (Math.abs(diff) < 0.5) {
            contentEl.scrollTop = smoothTarget;
            smoothRAF = 0;
            smoothTarget = null;
            return;
        }
        contentEl.scrollTop = current + diff * 0.22;
        smoothRAF = requestAnimationFrame(easeTick);
    };
    const normalizeDelta = (e) => {
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        else if (e.deltaMode === 2) dy *= contentEl.clientHeight;
        return dy;
    };
    const onWheel = (e) => {
        // Fire only when the pointer is over this panel's wrap or track.
        const t = e.target;
        if (!(wrapEl.contains(t) || track.contains(t) || t === contentEl)) return;
        const sh = contentEl.scrollHeight, ch = contentEl.clientHeight;
        if (sh <= ch + 1) return;
        const dy = normalizeDelta(e);
        if (!dy) return;
        const maxScroll = sh - ch;
        const base = smoothTarget !== null ? smoothTarget : contentEl.scrollTop;
        const atTop = base <= 0;
        const atBottom = base >= maxScroll - 0.5;
        if ((dy < 0 && atTop) || (dy > 0 && atBottom)) return;
        e.preventDefault();
        e.stopPropagation();
        smoothTarget = Math.max(0, Math.min(maxScroll, base + dy));
        showScroll();
        if (!smoothRAF) smoothRAF = requestAnimationFrame(easeTick);
    };
    // Document-level capture: iPadOS + Bluetooth mouse routes wheel events to
    // the innermost scrollable element (often the textarea), bypassing wrap-level
    // listeners. Capturing at document ensures we intercept before Safari's
    // composited scroll pipeline consumes the event.
    document.addEventListener('wheel', onWheel, { passive: false, capture: true });

    track.addEventListener('pointerenter', () => {
        const sh = contentEl.scrollHeight, ch = contentEl.clientHeight;
        if (sh > ch + 1) track.classList.add('is-hovered');
    });
    
    track.addEventListener('pointerleave', () => {
        track.classList.remove('is-hovered');
        showScroll();
    });

    thumb.addEventListener('pointerdown', (e) => {
        isDraggingScroll = true; scrollStartY = e.clientY; scrollStartTop = contentEl.scrollTop;
        track.classList.add('is-active');
        thumb.setPointerCapture(e.pointerId);
        document.body.classList.add('is-dragging');
        e.preventDefault();
    });

    thumb.addEventListener('pointermove', (e) => {
        if (!isDraggingScroll) return;
        const sh = contentEl.scrollHeight, ch = contentEl.clientHeight;
        const maxScroll = sh - ch;
        const maxThumbY = ch - parseFloat(thumb.style.height) - 4;
        const deltaY = e.clientY - scrollStartY;
        const scrollDelta = (deltaY / maxThumbY) * maxScroll;
        contentEl.scrollTop = scrollStartTop + scrollDelta;
    });

    const stopScrollDrag = (e) => {
        if (!isDraggingScroll) return;
        isDraggingScroll = false;
        try { thumb.releasePointerCapture(e.pointerId); } catch(err) {}
        document.body.classList.remove('is-dragging');
        track.classList.remove('is-active');
        showScroll();
    };
    
    window.addEventListener('pointerup', stopScrollDrag);
    window.addEventListener('pointercancel', stopScrollDrag);

    return updateScroll;
};

const updateLayersScroll = initCustomScroll(layersList, layersWrap);
const updateImportScroll = initCustomScroll(inputStr, $('importWrap'));
const updateExportScroll = initCustomScroll(outputStr, $('exportWrap'));

window.updateAllScrollbars = () => {
    updateLayersScroll();
    updateImportScroll();
    updateExportScroll();
};

window.openCustomPicker = (initialData, isGradient, callback) => {
    cpActiveCallback = callback; cpInitialData = initialData;
    cpIframe.style.pointerEvents = 'auto';
    cpIframe.contentWindow.postMessage({ action: 'open', data: initialData, isGradient: isGradient }, '*');
};

// ==========================================
// Dynamic Click-Through Tracking Engine
// ==========================================
const checkIframePointer = (x, y) => {
    if (!cpActiveCallback && !isEyedropperMode && cpRects.length === 0) return;
    
    if (cpIsDragging) {
        cpIframe.style.pointerEvents = 'auto';
        return;
    }
    
    let isOverModal = false;
    for (let i = 0; i < cpRects.length; i++) {
        let r = cpRects[i];
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            isOverModal = true; break;
        }
    }
    
    cpIframe.style.pointerEvents = isOverModal ? 'auto' : 'none';
};

window.addEventListener('pointermove', e => {
    lastMouseX = e.clientX; lastMouseY = e.clientY;
    checkIframePointer(lastMouseX, lastMouseY);
});

// ==========================================
// Eyedropper Communication Engine
// ==========================================
window.addEventListener('message', e => {
    if (e.source !== cpIframe.contentWindow || !e.data?.action) return;
    const { action, hex, isGradient, gradientData, isScrubbing, state, rects, isDragging, x, y } = e.data;
    
    if (action === 'cpState') {
        cpRects = rects || [];
        cpIsDragging = !!isDragging;
        checkIframePointer(lastMouseX, lastMouseY);
    } else if (action === 'mouseMove') {
        lastMouseX = x; lastMouseY = y;
        checkIframePointer(lastMouseX, lastMouseY);
    } else if (action === 'update' && cpActiveCallback) {
        cpActiveCallback(isGradient ? gradientData : hex, isScrubbing, isGradient);
    } else if (action === 'confirm' || action === 'cancel') {
        if (action === 'confirm' && cpActiveCallback) {
            cpActiveCallback(isGradient ? gradientData : hex, false, isGradient);
        } else if (cpActiveCallback) {
            const wasGrad = cpInitialData && (typeof cpInitialData === 'object' || String(cpInitialData).includes('url'));
            cpActiveCallback(cpInitialData, false, wasGrad);
        }
        cpIframe.style.pointerEvents = 'none'; cpActiveCallback = cpInitialData = null;
        isEyedropperMode = false;
        document.body.classList.remove('is-eyedropper-active');
        cpRects = [];
    } else if (action === 'eyedropperToggle') {
        isEyedropperMode = state;
        if (state) {
            document.body.classList.add('is-eyedropper-active');
        } else {
            document.body.classList.remove('is-eyedropper-active');
        }
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isEyedropperMode) {
        isEyedropperMode = false;
        document.body.classList.remove('is-eyedropper-active');
        cpIframe.contentWindow.postMessage({ action: 'eyedropperToggle', state: false }, '*');
    }
});

previewArea.addEventListener('pointerdown', (e) => {
    // If neither eyedropper nor color picker is active, do nothing
    if (!isEyedropperMode && !cpActiveCallback) return;
    
    const target = e.target;
    const tagName = target.tagName.toLowerCase();
    const isValidShape = ['path', 'circle', 'rect', 'polygon', 'polyline', 'ellipse', 'line'].includes(tagName);

    if (isEyedropperMode) {
        e.preventDefault();
        e.stopPropagation();
        
        if (isValidShape) {
            let color = target.getAttribute('fill');
            if (!color || color === 'none') color = target.getAttribute('stroke');
            
            // Resolve currentColor fallback specifically for Mono Mode rendering
            if (color === 'currentColor') {
                const indexStr = target.getAttribute('data-pf-index');
                const index = indexStr !== null ? parseInt(indexStr) : -1;
                if (index !== -1 && globalOptimizedSvg) {
                    const origNodes = globalOptimizedSvg.querySelectorAll('path, circle, rect, polygon, polyline, ellipse, line');
                    if (origNodes[index]) {
                        color = origNodes[index].getAttribute('fill');
                        if (!color || color === 'none') color = origNodes[index].getAttribute('stroke');
                    }
                }
            }
            
            if (color && color !== 'none' && !color.includes('url')) {
                const hexColor = colorToHex(color);
                cpIframe.contentWindow.postMessage({ action: 'eyedropperPicked', hex: hexColor }, '*');
            } else {
                cpIframe.contentWindow.postMessage({ action: 'eyedropperToggle', state: false }, '*');
            }
        } else {
            // Abort dropper if clicked on empty canvas area
            cpIframe.contentWindow.postMessage({ action: 'eyedropperToggle', state: false }, '*');
        }
        
        isEyedropperMode = false;
        document.body.classList.remove('is-eyedropper-active');
        return;
    }

    // Direct color picker switching when open
    if (cpActiveCallback && isValidShape) {
        e.preventDefault();
        e.stopPropagation();
        
        const indexStr = target.getAttribute('data-pf-index');
        const index = indexStr !== null ? parseInt(indexStr) : -1;
        
        if (index !== -1) {
            const layerItems = layersList.querySelectorAll('.layer-item');
            const targetItem = isLinkedMode ? layerItems[0] : layerItems[index];
            
            if (targetItem) {
                let editStroke = false;
                let color = target.getAttribute('fill');
                
                // Check original SVG if currently in mono mode to determine true active attributes
                if (color === 'currentColor' && globalOptimizedSvg) {
                    const origNodes = globalOptimizedSvg.querySelectorAll('path, circle, rect, polygon, polyline, ellipse, line');
                    if (origNodes[index]) {
                        color = origNodes[index].getAttribute('fill');
                        if (!color || color === 'none') {
                            const origStroke = origNodes[index].getAttribute('stroke');
                            if (origStroke && origStroke !== 'none') editStroke = true;
                        }
                    }
                } else if (!color || color === 'none') {
                    color = target.getAttribute('stroke');
                    if (color && color !== 'none') editStroke = true;
                }
                
                const attrRows = targetItem.querySelectorAll('.layer-attr');
                // Fill is index 0, Stroke is index 1
                const targetRow = editStroke ? attrRows[1] : attrRows[0];
                
                if (targetRow) {
                    const pickerWrap = targetRow.querySelector('.picker-wrap');
                    if (pickerWrap) {
                        // Scroll the layers list to show the selected layer
                        targetItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        // Add a brief highlight effect to the layer item
                        targetItem.style.transition = 'background-color 0.2s';
                        targetItem.style.backgroundColor = 'var(--bg-hover)';
                        setTimeout(() => { targetItem.style.backgroundColor = ''; }, 300);
                        
                        // Trigger the picker open logic for that row
                        pickerWrap.click();
                    }
                }
            }
        }
    }
}, { capture: true });

const createEl = (tag, className = '', props = {}, children = []) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    Object.entries(props).forEach(([k, v]) => k === 'style' ? Object.assign(el.style, v) : el[k] = v);
    children.forEach(c => el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return el;
};

const colorToHex = col => {
    if (!col || col === 'none' || col.includes('url')) return '#000000';
    ctxHelper.fillStyle = '#000000'; ctxHelper.fillStyle = col; return ctxHelper.fillStyle;
};

const applyMonoToStops = (svgNode) => {
    svgNode.querySelectorAll('stop').forEach(stop => {
        let col = stop.getAttribute('stop-color');
        if (col && col !== 'none') {
            if (col.startsWith('rgba')) {
                let parts = col.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([^)]+)\)/);
                if (parts && parts[1]) {
                    let alpha = parseFloat(parts[1]);
                    let currentOp = stop.getAttribute('stop-opacity');
                    stop.setAttribute('stop-opacity', currentOp ? (parseFloat(currentOp) * alpha).toString() : alpha.toString());
                }
            } else if (col.length === 9 && col.startsWith('#')) {
                let alpha = parseInt(col.slice(7, 9), 16) / 255;
                let currentOp = stop.getAttribute('stop-opacity');
                stop.setAttribute('stop-opacity', currentOp ? (parseFloat(currentOp) * alpha).toString() : alpha.toFixed(2));
            }
            stop.setAttribute('stop-color', 'currentColor');
        }
    });
};

const applyZoomState = (isScrubbing = false) => {
    const svg = previewArea.querySelector('svg:not(.icon-svg)'), btn = $('btnZoomToggle');
    if (!svg) return;
    const nw = parseFloat(svg.dataset.nativeW) || 128, nh = parseFloat(svg.dataset.nativeH) || 128;
    
    Object.assign(svg.style, { 
        transition: isScrubbing ? 'none' : 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1), height 0.25s cubic-bezier(0.4, 0, 0.2, 1)', 
        maxWidth: 'none', 
        maxHeight: 'none' 
    });
    
    if (zoomMode === 'fit') {
        const cw = previewArea.clientWidth - 40, ch = previewArea.clientHeight - 40;
        if (cw <= 0 || ch <= 0) return;
        const scale = Math.min(cw / nw, ch / nh);
        svg.style.width = `${nw * scale}px`; svg.style.height = `${nh * scale}px`;
        if (btn) btn.innerHTML = '<svg class="icon-svg"><use href="#icon-zoom-size" xlink:href="#icon-zoom-size"></use></svg>';
    } else {
        svg.style.width = `${nw}px`; svg.style.height = `${nh}px`;
        if (btn) btn.innerHTML = '<svg class="icon-svg"><use href="#icon-zoom-fit" xlink:href="#icon-zoom-fit"></use></svg>';
    }
};

window.toggleZoom = () => { zoomMode = zoomMode === 'fit' ? 'size' : 'fit'; applyZoomState(); };
new ResizeObserver(() => { if (zoomMode === 'fit') applyZoomState(); }).observe(previewArea);

window.resetAllLayers = () => {
    if (!globalOriginalSvg) return;
    globalOptimizedSvg = globalOriginalSvg.cloneNode(true);
    isLinkedMode = false;
    buildLayersPanel(); 
    renderOutput();
    syncPngDimensions();
};

window.setColorMode = mode => {
    colorMode = mode;
    $('btnMono').classList.toggle('active', mode === 'mono');
    $('btnLocal').classList.toggle('active', mode === 'local');
    document.body.classList.toggle('mode-mono', mode === 'mono');
    if (globalOptimizedSvg) renderOutput();
};

const resetUI = () => {
    [detVbW, detVbH, detObjW, detObjH].forEach(el => el.textContent = '-');
    layersList.innerHTML = '<div style="font-size:11px;color:var(--text-secondary);text-align:center;margin-top:30px;">Import SVG to view layers</div>';
    previewArea.innerHTML = $('btnZoomToggle').outerHTML;
    outputStr.value = ''; globalOptimizedSvg = globalOriginalSvg = null;
    isLinkedMode = false;
    const btnLink = $('btnLinkLayers');
    if(btnLink) btnLink.style.display = 'none';
    if(opPopup) opPopup.style.display = 'none';
    if(strokePopup) strokePopup.style.display = 'none';
    if($('resizePanel')) $('resizePanel').style.display = 'none';
    window.updateAllScrollbars();
};

let processTimeout;
inputStr.addEventListener('input', () => { 
    clearTimeout(processTimeout);
    processTimeout = setTimeout(() => { window.processSVG(); }, 300);
});

fileInput.addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { inputStr.value = ev.target.result; window.processSVG(); };
    reader.readAsText(file); e.target.value = '';
});

window.focusAndSelectSVG = (btn) => {
    inputStr.focus();
    if (inputStr.value.trim().length > 0) inputStr.setSelectionRange(0, inputStr.value.length);
    btn.classList.add('btn-blue'); inputStr.classList.add('ring-blue');
    setTimeout(() => { btn.classList.remove('btn-blue'); inputStr.classList.remove('ring-blue'); }, 1000);
};

window.clearSVG = (btn) => {
    inputStr.value = ''; window.processSVG();
    btn.classList.add('btn-yellow'); inputStr.classList.add('ring-yellow');
    setTimeout(() => { btn.classList.remove('btn-yellow'); inputStr.classList.remove('ring-yellow'); }, 1000);
};

const ensureInkWrapper = (svgNode) => {
    let wrapper = svgNode.querySelector(':scope > g#ink-wrapper');
    if (!wrapper) {
        wrapper = document.createElementNS("http://www.w3.org/2000/svg", "g");
        wrapper.id = 'ink-wrapper';
        const children = Array.from(svgNode.childNodes);
        children.forEach(child => {
            if (child.nodeType === 1) {
                const tag = child.tagName.toLowerCase();
                if (!['defs', 'style', 'title', 'desc'].includes(tag)) wrapper.appendChild(child);
            } else if (child.nodeType === 3 && child.textContent.trim() !== '') {
                wrapper.appendChild(child);
            }
        });
        svgNode.appendChild(wrapper);
    }
    return wrapper;
};

window.processSVG = () => {
    const rawCode = inputStr.value.trim();
    if (!rawCode) return resetUI();
    const oldSvg = new DOMParser().parseFromString(rawCode, "image/svg+xml").querySelector('svg');
    if (!oldSvg) { resetUI(); return; }

    const classStyles = {};
    oldSvg.querySelectorAll('style').forEach(tag => {
        let match; const regex = /([^\{]+)\{([^}]+)\}/g;
        while ((match = regex.exec(tag.textContent)) !== null) {
            const selectors = match[1].split(',');
            const rules = match[2].trim();
            selectors.forEach(sel => {
                const cleanSel = sel.trim().replace('.', '');
                if (cleanSel) classStyles[cleanSel] = rules;
            });
        }
    });

    const optimizeNode = node => {
        if (node.nodeType !== 1) return null;
        const originalTagName = node.tagName;
        const tagName = originalTagName.toLowerCase();
        
        if (!['svg', 'path', 'circle', 'rect', 'polygon', 'polyline', 'ellipse', 'line', 'defs', 'lineargradient', 'radialgradient', 'stop', 'g', 'clippath', 'mask', 'use'].includes(tagName)) return null;

        const newNode = document.createElementNS("http://www.w3.org/2000/svg", originalTagName);
        if (tagName === 'svg') newNode.setAttribute("xmlns", "http://www.w3.org/2000/svg");

        const structAttrs = ['viewbox', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'fx', 'fy', 'fr', 'width', 'height', 'points', 'transform', 'id', 'offset', 'gradientunits', 'gradienttransform', 'href', 'xlink:href', 'xmlns:xlink', 'spreadmethod', 'data-pf-sx', 'data-pf-sy', 'data-pf-tx', 'data-pf-ty'];
        const presAttrs = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'clip-rule', 'opacity', 'stop-color', 'stop-opacity', 'fill-opacity', 'stroke-opacity'];

        let styles = node.hasAttribute('style') ? node.getAttribute('style') + ";" : "";
        if (node.hasAttribute('class')) node.getAttribute('class').split(/\s+/).forEach(cls => { if (classStyles[cls]) styles += classStyles[cls] + ";"; });

        styles.split(';').forEach(decl => {
            if (!decl.includes(':')) return;
            const [k, v] = decl.split(':').map(s => s.trim());
            if (presAttrs.includes(k.toLowerCase()) && !newNode.hasAttribute(k.toLowerCase())) newNode.setAttribute(k.toLowerCase(), v);
        });

        Array.from(node.attributes).forEach(attr => {
            const name = attr.name.toLowerCase(); let val = attr.value.trim();
            if (name === 'class' || name === 'style') return;
            if (structAttrs.includes(name)) {
                if (name === 'd') val = val.replace(/\s+/g, ' ').replace(/-?\d*\.\d+(?:[eE][-+]?\d+)?/g, m => Number.isInteger(+m) ? (+m).toString() : (+m).toFixed(2).replace(/\.?0+$/, '')).replace(/\s*([a-zA-Z])\s*/g, '$1');
                if (!(tagName === 'svg' && (name === 'width' || name === 'height'))) newNode.setAttribute(attr.name, val);
            } else if (presAttrs.includes(name) && !newNode.hasAttribute(attr.name)) newNode.setAttribute(attr.name, val);
        });

        if (['path', 'circle', 'rect', 'polygon', 'polyline', 'ellipse', 'line'].includes(tagName) && !newNode.hasAttribute('fill') && !newNode.hasAttribute('stroke')) newNode.setAttribute('fill', '#000000');
        Array.from(node.childNodes).forEach(child => { const opt = optimizeNode(child); if (opt) newNode.appendChild(opt); });
        return newNode;
    };

    globalOptimizedSvg = optimizeNode(oldSvg);
    
    let vb = globalOptimizedSvg.getAttribute("viewBox");
    if (!vb && oldSvg.getAttribute("width")) {
        vb = `0 0 ${parseFloat(oldSvg.getAttribute("width"))} ${parseFloat(oldSvg.getAttribute("height"))}`;
        globalOptimizedSvg.setAttribute("viewBox", vb);
    }
    if (vb) {
        const p = vb.trim().split(/[\s,]+/);
        globalOptimizedSvg.setAttribute("width", Number(parseFloat(p.length === 4 ? p[2] : p[0]).toFixed(2)));
        globalOptimizedSvg.setAttribute("height", Number(parseFloat(p.length === 4 ? p[3] : p[1]).toFixed(2)));
    }
    
    ensureInkWrapper(globalOptimizedSvg);
    
    globalOptimizedSvg.querySelectorAll('path, circle, rect, polygon, polyline, ellipse, line').forEach((s, idx) => {
        s.setAttribute('data-pf-index', idx);
    });
    
    globalOriginalSvg = globalOptimizedSvg.cloneNode(true);
    buildLayersPanel(); 
    renderOutput();
    syncPngDimensions();
};

window.toggleLinkLayers = () => {
    if (!globalOptimizedSvg) return;
    const btnLink = $('btnLinkLayers');
    btnLink.style.pointerEvents = 'none'; 
    if(opPopup) opPopup.style.display = 'none';
    if(strokePopup) strokePopup.style.display = 'none';
    
    const shapes = Array.from(globalOptimizedSvg.querySelectorAll('path, circle, rect, polygon, polyline, ellipse, line'));

    if (!isLinkedMode) {
        if (shapes.length > 1) {
            const topShape = shapes[0];
            const fill = topShape.getAttribute('fill');
            const stroke = topShape.getAttribute('stroke');
            const strokeWidth = topShape.getAttribute('stroke-width');
            const hiddenFill = topShape.getAttribute('data-hidden-fill');
            const hiddenStroke = topShape.getAttribute('data-hidden-stroke');
            const fillOp = topShape.getAttribute('fill-opacity');
            const strokeOp = topShape.getAttribute('stroke-opacity');

            for (let i = 1; i < shapes.length; i++) {
                const s = shapes[i];
                if (fill !== null) s.setAttribute('fill', fill); else s.removeAttribute('fill');
                if (stroke !== null) s.setAttribute('stroke', stroke); else s.removeAttribute('stroke');
                if (strokeWidth !== null) s.setAttribute('stroke-width', strokeWidth); else s.removeAttribute('stroke-width');
                if (hiddenFill) s.setAttribute('data-hidden-fill', 'true'); else s.removeAttribute('data-hidden-fill'); 
                if (hiddenStroke) s.setAttribute('data-hidden-stroke', 'true'); else s.removeAttribute('data-hidden-stroke');
                if (fillOp !== null) s.setAttribute('fill-opacity', fillOp); else s.removeAttribute('fill-opacity');
                if (strokeOp !== null) s.setAttribute('stroke-opacity', strokeOp); else s.removeAttribute('stroke-opacity');
            }
            renderOutput();
        }

        btnLink.innerHTML = '<svg class="icon-svg"><use href="#icon-linked-layers" xlink:href="#icon-linked-layers"></use></svg>';

        const items = Array.from(layersList.querySelectorAll('.layer-item'));
        if (items.length > 0) {
            const firstTop = items[0].offsetTop;
            items.forEach((item, i) => {
                if (i > 0) {
                    const dist = firstTop - item.offsetTop;
                    item.style.transition = 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease';
                    item.style.transform = `translateY(${dist}px) scale(0.95)`;
                    item.style.opacity = '0';
                    item.style.pointerEvents = 'none';
                } else {
                    item.style.transition = 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
                    item.style.transform = 'scale(1.02)';
                    item.style.zIndex = '10';
                    item.style.position = 'relative';
                }
            });
        }
        setTimeout(() => {
            isLinkedMode = true;
            buildLayersPanel();
            btnLink.style.pointerEvents = 'auto';
        }, 400);
    } else {
        layersList.style.opacity = '0';
        btnLink.innerHTML = '<svg class="icon-svg"><use href="#icon-unlinked-layers" xlink:href="#icon-unlinked-layers"></use></svg>';
        isLinkedMode = false;
        buildLayersPanel();
        
        const newItems = Array.from(layersList.querySelectorAll('.layer-item'));
        if (newItems.length > 0) {
            const firstTop = newItems[0].offsetTop;
            newItems.forEach((item, i) => {
                if (i > 0) {
                    item.style.transition = 'none';
                    const dist = firstTop - item.offsetTop;
                    item.style.transform = `translateY(${dist}px) scale(0.95)`;
                    item.style.opacity = '0';
                } else {
                    item.style.transition = 'none';
                    item.style.transform = 'scale(1.02)';
                    item.style.zIndex = '10';
                    item.style.position = 'relative';
                }
            });
        }
        
        layersList.style.opacity = '1';
        
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                newItems.forEach((item, i) => {
                    item.style.transition = 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease';
                    item.style.transform = 'translateY(0) scale(1)';
                    item.style.opacity = '1';
                });
                setTimeout(() => {
                    newItems.forEach(item => {
                        item.style.transition = '';
                        item.style.transform = '';
                        item.style.zIndex = '';
                        item.style.position = '';
                    });
                    btnLink.style.pointerEvents = 'auto';
                }, 500);
            });
        });
    }
};

const buildLayersPanel = () => {
    layersList.innerHTML = ''; 
    if (!globalOptimizedSvg) { window.updateAllScrollbars(); return; }
    
    // --- Orphaned Gradient Cleanup ---
    const usedIds = new Set();
    globalOptimizedSvg.querySelectorAll('*').forEach(el => {
        const f = el.getAttribute('fill'), s = el.getAttribute('stroke');
        if (f && f.includes('url(#')) { const m = f.match(/url\(['"]?#([^)'"]+)['"]?\)/); if (m) usedIds.add(m[1]); }
        if (s && s.includes('url(#')) { const m = s.match(/url\(['"]?#([^)'"]+)['"]?\)/); if (m) usedIds.add(m[1]); }
    });
    const defs = globalOptimizedSvg.querySelector('defs');
    if (defs) {
        Array.from(defs.children).forEach(c => {
            if (c.id && c.id.startsWith('pf-grad-') && !usedIds.has(c.id)) c.remove();
        });
        if (!defs.children.length) defs.remove();
    }
    // ---------------------------------
    
    const getGradIconType = (hexStr) => {
        const match = hexStr.match(/url\(['"]?#([^)'"]+)['"]?\)/);
        if (match && match[1]) {
            const gradEl = globalOptimizedSvg.querySelector(`#${match[1]}`) || globalOriginalSvg.querySelector(`#${match[1]}`);
            if (gradEl && gradEl.tagName.toLowerCase() === 'radialgradient') {
                return 'radial-gradient';
            }
        }
        return 'linear-gradient';
    };
    
    const shapes = Array.from(globalOptimizedSvg.querySelectorAll('path, circle, rect, polygon, polyline, ellipse, line'));
    const btnLink = $('btnLinkLayers');
    
    if (shapes.length > 1) {
        btnLink.style.display = 'flex';
        btnLink.innerHTML = `<svg class="icon-svg"><use href="#icon-${isLinkedMode ? 'linked' : 'unlinked'}-layers" xlink:href="#icon-${isLinkedMode ? 'linked' : 'unlinked'}-layers"></use></svg>`;
    } else {
        if (btnLink) btnLink.style.display = 'none';
        isLinkedMode = false;
    }

    if (!shapes.length) {
        layersList.innerHTML = '<div style="font-size:11px;color:var(--text-secondary);text-align:center;margin-top:30px;">No editable paths found.</div>';
        window.updateAllScrollbars();
        return;
    }

    const createAttrRow = (attrName, nodes) => {
        const isStroke = attrName === 'Stroke';
        const attrKey = attrName.toLowerCase();
        const origVal = nodes[0].getAttribute(attrKey);
        const isHidden = nodes[0].getAttribute(`data-hidden-${attrKey}`) || (!origVal || origVal === 'none');
        
        let dedicatedGradId = null; 
        
        if (isHidden) nodes.forEach(n => n.setAttribute(`data-hidden-${attrKey}`, 'true'));
        
        let activeHex = origVal && origVal.includes('url') ? origVal : colorToHex(origVal).toUpperCase();
        let updateRaf = null;

        const row = createEl('div', `layer-attr ${isHidden ? 'hidden-row' : ''}`);

        const updateColor = (val, scrub, isGradFlag = false) => {
            let isGradient = isGradFlag || (typeof val === 'string' && val.includes('url'));
            
            if (isGradient && typeof val === 'object' && val !== null) {
                let defs = globalOptimizedSvg.querySelector('defs');
                if (!defs) {
                    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
                    globalOptimizedSvg.insertBefore(defs, globalOptimizedSvg.firstChild);
                }
                
                if (!dedicatedGradId) {
                    dedicatedGradId = `pf-grad-${Math.random().toString(36).substr(2, 9)}`;
                }
                
                let gradEl = defs.querySelector(`#${dedicatedGradId}`);
                const targetTag = val.type === 'linear' ? "linearGradient" : "radialGradient";
                
                if (gradEl && gradEl.tagName.toLowerCase() !== targetTag.toLowerCase()) {
                    gradEl.remove();
                    gradEl = null;
                }

                if (!gradEl) {
                    gradEl = document.createElementNS("http://www.w3.org/2000/svg", targetTag);
                    gradEl.setAttribute('id', dedicatedGradId);
                    defs.appendChild(gradEl);
                }
                
                if (val.type === 'linear') {
                    gradEl.setAttribute('x1', '0.5'); gradEl.setAttribute('y1', '1');
                    gradEl.setAttribute('x2', '0.5'); gradEl.setAttribute('y2', '0');
                    if (val.angle !== 0) gradEl.setAttribute('gradientTransform', `rotate(${val.angle}, 0.5, 0.5)`);
                    else gradEl.removeAttribute('gradientTransform');
                } else {
                    gradEl.setAttribute('cx', '0.5'); gradEl.setAttribute('cy', '0.5'); gradEl.setAttribute('r', '0.5');
                    gradEl.removeAttribute('gradientTransform');
                }
                
                let stopsHtml = '';
                const n = val.stops.length;
                val.stops.forEach((stopCol, i) => {
                    let offset = n === 1 ? 0 : (i / (n - 1)) * 100;
                    stopsHtml += `<stop offset="${offset}%" stop-color="${stopCol}" />`;
                });
                gradEl.innerHTML = stopsHtml;
                
                activeHex = `url(#${dedicatedGradId})`;
            } else if (typeof val === 'string') {
                activeHex = val.includes('url') ? val : val.toUpperCase();
            }

            const wrap = row.querySelector('.picker-wrap');
            if (wrap) {
                if (!activeHex.includes('url')) {
                    if (!wrap.querySelector('.picker-ios')) {
                        wrap.innerHTML = `<div class="picker-ios"><div class="picker-center" style="background-color: ${activeHex};"></div></div>`;
                    } else {
                        wrap.querySelector('.picker-center').style.backgroundColor = activeHex;
                    }
                } else {
                    let iconType = 'linear-gradient';
                    if (isGradient && typeof val === 'object' && val !== null) {
                        iconType = val.type === 'linear' ? 'linear-gradient' : 'radial-gradient';
                    } else {
                        iconType = getGradIconType(activeHex);
                    }
                    wrap.innerHTML = `<svg class="icon-svg" style="width:26px; height:26px;"><use href="#icon-${iconType}" xlink:href="#icon-${iconType}"></use></svg>`;
                }
            }

            nodes.forEach(n => n.setAttribute(attrKey, activeHex));
            
            const solidCtrl = row.querySelector('.solid-controls');
            const gradCtrl = row.querySelector('.grad-controls');
            if (activeHex.includes('url')) {
                if (solidCtrl) solidCtrl.style.display = 'none';
                if (gradCtrl) gradCtrl.style.display = 'flex';
            } else {
                if (solidCtrl) solidCtrl.style.display = 'flex';
                if (gradCtrl) gradCtrl.style.display = 'none';
            }
            
            if (!isStroke) {
                const hexInp = row.querySelector('.cp-hex-input');
                if (hexInp && !activeHex.includes('url')) hexInp.value = activeHex.replace('#', '');
            } else {
                nodes.forEach(n => {
                    if (!n.hasAttribute('stroke-width') || parseFloat(n.getAttribute('stroke-width')) === 0) {
                        n.setAttribute('stroke-width', '1'); 
                    }
                });
                const sizeInp = row.querySelector('.cp-size-input');
                if (sizeInp && parseFloat(sizeInp.value) === 0) sizeInp.value = '1';
            }
            
            nodes.forEach(n => n.removeAttribute(`data-hidden-${attrKey}`)); 
            tglBtn.classList.remove('hidden-state'); 
            row.classList.remove('hidden-row');
            tglBtn.innerHTML = '<svg class="icon-svg"><use href="#icon-eye" xlink:href="#icon-eye"></use></svg>';
            
            if (scrub) { 
                if (updateRaf) cancelAnimationFrame(updateRaf); 
                updateRaf = requestAnimationFrame(() => renderOutput(true)); 
            } else {
                renderOutput(false);
            }
        };

        const label = createEl('span', 'layer-attr-label', { textContent: attrName });
        
        let isGradientInit = activeHex.includes('url');
        let pickerWrapChildren;
        if (isGradientInit) {
            let initIconType = getGradIconType(activeHex);
            pickerWrapChildren = [
                createEl('svg', 'icon-svg', { style: { width: '26px', height: '26px' }, innerHTML: `<use href="#icon-${initIconType}" xlink:href="#icon-${initIconType}"></use>` })
            ];
        } else {
            const pCenter = createEl('div', 'picker-center', { style: { backgroundColor: activeHex } });
            pickerWrapChildren = [createEl('div', 'picker-ios', {}, [pCenter])];
        }

        const pickerWrap = createEl('div', 'picker-wrap', { onclick: () => {
            const isGrad = activeHex.includes('url');
            let passData = activeHex;
            if (isGrad) {
                const gradIdMatch = activeHex.match(/url\(['"]?#([^)'"]+)['"]?\)/);
                if (gradIdMatch && gradIdMatch[1]) {
                    const gradEl = globalOptimizedSvg.querySelector(`#${gradIdMatch[1]}`) || globalOriginalSvg.querySelector(`#${gradIdMatch[1]}`);
                    if (gradEl) {
                        const type = gradEl.tagName.toLowerCase() === 'radialgradient' ? 'angular' : 'linear';
                        let angle = 0;
                        if (type === 'linear') {
                            const transform = gradEl.getAttribute('gradientTransform');
                            if (transform && transform.includes('rotate')) {
                                const match = transform.match(/rotate\(([-0-9.]+)/);
                                if (match) angle = parseFloat(match[1]);
                            }
                        }
                        let stops = [];
                        gradEl.querySelectorAll('stop').forEach(s => {
                            let c = s.getAttribute('stop-color');
                            if (c && c !== 'none' && c !== 'currentColor') {
                                stops.push(colorToHex(c));
                            }
                        });
                        if (stops.length >= 2) {
                            passData = { type, angle, stops };
                        }
                    }
                }
            } else {
                passData = activeHex.includes('url') ? '#000000' : activeHex;
            }
            window.openCustomPicker(passData, isGrad, (newCol, scrub, isGradFlag) => updateColor(newCol, scrub, isGradFlag));
        }}, pickerWrapChildren);

        let opValue = nodes[0].getAttribute(`${attrKey}-opacity`);
        let opParsed = opValue !== null ? parseFloat(opValue) * 100 : 100;
        if (isNaN(opParsed)) opParsed = 100;

        const opInp = createEl('input', 'cp-op-input', { 
            type: 'number', value: Math.round(opParsed), min: 0, max: 100, 
            oninput: e => {
                if (e.target.value === '') return;
                let parsed = parseInt(e.target.value);
                if (isNaN(parsed)) return;
                let v = Math.min(100, Math.max(0, parsed));
                let finalVal = (v / 100).toFixed(2).replace(/\.?0+$/, '');
                if (finalVal === "") finalVal = "0";
                nodes.forEach(n => {
                    if (v === 100) n.removeAttribute(`${attrKey}-opacity`);
                    else n.setAttribute(`${attrKey}-opacity`, finalVal);
                });
                if (updateRaf) cancelAnimationFrame(updateRaf); 
                updateRaf = requestAnimationFrame(() => renderOutput(true));
            }, 
            onblur: e => {
                let parsed = parseInt(e.target.value);
                let v = isNaN(parsed) ? 100 : Math.min(100, Math.max(0, parsed));
                e.target.value = v; 
                let finalVal = (v / 100).toFixed(2).replace(/\.?0+$/, '');
                if (finalVal === "") finalVal = "0";
                nodes.forEach(n => {
                    if (v === 100) n.removeAttribute(`${attrKey}-opacity`);
                    else n.setAttribute(`${attrKey}-opacity`, finalVal);
                });
                renderOutput(false);
            }
        });
        
        const opInpGroup = createEl('div', 'cp-input-group', { title: 'Opacity %' }, [ opInp, createEl('span', 'cp-unit', { textContent: '%' }) ]);

        const opTrigger = createEl('div', 'slider-trigger op', {
            title: 'Adjust Opacity',
            innerHTML: `<svg class="icon-svg" style="width:16px;height:16px;"><use href="#icon-slider-vertical" xlink:href="#icon-slider-vertical"></use></svg>`,
            onclick: e => {
                e.stopPropagation();
                document.querySelectorAll('.slider-trigger').forEach(el => el.classList.remove('is-active'));
                opTrigger.classList.add('is-active');

                const rect = opTrigger.getBoundingClientRect();
                opPopup.style.display = 'flex';
                let leftPos = rect.left + (rect.width / 2) - 17;
                if (leftPos + 34 > window.innerWidth) leftPos = window.innerWidth - 44;
                
                opPopup.style.left = `${leftPos}px`;
                opPopup.style.top = `${rect.top - 148}px`; 

                const range = opPopup.querySelector('input');
                range.value = Math.round(parseFloat(opInp.value) || 0);
                
                range.oninput = ev => {
                    opInp.value = ev.target.value;
                    opInp.dispatchEvent(new Event('input'));
                };
                range.onchange = () => {
                    opInp.dispatchEvent(new Event('blur')); 
                };
            }
        });

        const tglBtn = createEl('div', `layer-toggle ${isHidden ? 'hidden-state' : ''}`, { innerHTML: `<svg class="icon-svg"><use href="#icon-eye${isHidden ? '' : '-hidden'}" xlink:href="#icon-eye${isHidden ? '-hidden' : ''}"></use></svg>` });
        tglBtn.onclick = () => {
            if (nodes[0].getAttribute(`data-hidden-${attrKey}`)) {
                nodes.forEach(n => {
                    n.removeAttribute(`data-hidden-${attrKey}`); 
                    n.setAttribute(attrKey, activeHex);
                    if (isStroke && (!n.hasAttribute('stroke-width') || parseFloat(n.getAttribute('stroke-width')) === 0)) { n.setAttribute('stroke-width', '1'); }
                });
                if (isStroke && !activeHex.includes('url')) {
                    const sizeInp = row.querySelector('.cp-size-input');
                    if (sizeInp && parseFloat(sizeInp.value) === 0) sizeInp.value = '1';
                }
                tglBtn.classList.remove('hidden-state'); row.classList.remove('hidden-row'); 
                tglBtn.innerHTML = '<svg class="icon-svg"><use href="#icon-eye" xlink:href="#icon-eye"></use></svg>';
            } else {
                nodes.forEach(n => n.setAttribute(`data-hidden-${attrKey}`, 'true')); 
                tglBtn.classList.add('hidden-state'); row.classList.add('hidden-row'); 
                tglBtn.innerHTML = '<svg class="icon-svg"><use href="#icon-eye-hidden" xlink:href="#icon-eye-hidden"></use></svg>';
            }
            renderOutput(false);
        };

        const leftBlock = createEl('div', 'attr-left');
        leftBlock.appendChild(label);
        leftBlock.appendChild(pickerWrap);
        row.appendChild(leftBlock);

        const middleBlock = createEl('div', 'attr-middle');

        if (isStroke) {
            const sizeInp = createEl('input', 'cp-size-input', { type: 'number', value: nodes[0].getAttribute('stroke-width') || 1, min: 0, step: 0.5, oninput: e => {
                if (e.target.value === '') return; 
                let parsed = parseFloat(e.target.value);
                if (isNaN(parsed)) return;
                let v = Math.max(0, parsed); 
                nodes.forEach(n => n.setAttribute('stroke-width', v));
                if (v > 0 && nodes[0].getAttribute('data-hidden-stroke')) {
                    updateColor(activeHex, false, activeHex.includes('url'));
                } 
                if (updateRaf) cancelAnimationFrame(updateRaf); 
                updateRaf = requestAnimationFrame(() => renderOutput(true));
            }, onblur: e => {
                if (e.target.value === '' || isNaN(parseFloat(e.target.value))) {
                    e.target.value = 1; nodes.forEach(n => n.setAttribute('stroke-width', 1));
                }
                renderOutput(false);
            }});
            const sizeInpGroup = createEl('div', 'cp-input-group', {}, [sizeInp, createEl('span', 'cp-unit', { textContent: 'px' })]);
            
            const strokeTrigger = createEl('div', 'slider-trigger stroke', {
                title: 'Adjust Stroke Width',
                innerHTML: `<svg class="icon-svg" style="width:16px;height:16px;"><use href="#icon-slider-horizontal" xlink:href="#icon-slider-horizontal"></use></svg>`,
                onclick: e => {
                    e.stopPropagation();
                    document.querySelectorAll('.slider-trigger').forEach(el => el.classList.remove('is-active'));
                    strokeTrigger.classList.add('is-active');

                    const rect = strokeTrigger.getBoundingClientRect();
                    strokePopup.style.display = 'flex';
                    
                    let leftPos = rect.left + (rect.width / 2) - 70;
                    if (leftPos + 140 > window.innerWidth) leftPos = window.innerWidth - 150;
                    if (leftPos < 10) leftPos = 10;
                    
                    strokePopup.style.left = `${leftPos}px`;
                    strokePopup.style.top = `${rect.top - 44}px`; 

                    const range = strokePopup.querySelector('input');
                    range.value = 0; 
                    let dragBase = 0, dragging = false;

                    range.onpointerdown = () => {
                        dragging = true; dragBase = parseFloat(sizeInp.value) || 0;
                        const handleStop = () => {
                            if (dragging) { 
                                dragging = false; range.value = 0; 
                                if (updateRaf) cancelAnimationFrame(updateRaf); 
                                updateRaf = requestAnimationFrame(() => renderOutput(false)); 
                                sizeInp.dispatchEvent(new Event('blur')); // Finalize state
                            }
                            window.removeEventListener('pointerup', handleStop); window.removeEventListener('pointercancel', handleStop);
                        };
                        window.addEventListener('pointerup', handleStop); window.addEventListener('pointercancel', handleStop);
                    };

                    range.oninput = ev => {
                        if (!dragging) return;
                        let v = Number(Math.max(0, dragBase + (parseFloat(ev.target.value) * 10)).toFixed(2));
                        sizeInp.value = v; sizeInp.dispatchEvent(new Event('input'));
                    };
                }
            });

            middleBlock.appendChild(sizeInpGroup);
            middleBlock.appendChild(strokeTrigger);
            middleBlock.appendChild(createEl('div', 'row-divider'));
            middleBlock.appendChild(opInpGroup);
            middleBlock.appendChild(opTrigger);
        } else {
            const solidControls = createEl('div', 'solid-controls', { style: { display: isGradientInit ? 'none' : 'flex', gap: '8px', alignItems: 'center' } });
            const gradControls = createEl('div', 'grad-controls', { style: { display: isGradientInit ? 'flex' : 'none', gap: '8px', alignItems: 'center', opacity: '0.5', pointerEvents: 'none' } });
            
            const hexInp = createEl('input', 'cp-hex-input', { type: 'text', value: activeHex.replace('#', ''), maxLength: 6, spellcheck: false, onchange: e => {
                let v = e.target.value.trim().replace(/[^0-9A-Fa-f]/g, ''); if (v.length === 3) v = v.split('').map(c => c+c).join('');
                if (v.length === 6) { updateColor('#' + v); e.target.value = v.toUpperCase(); } else e.target.value = activeHex.replace('#', '');
            }, onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); hexInp.blur(); } } });
            
            const hexInpGroup = createEl('div', 'cp-input-group hex-target', {}, [createEl('span', 'cp-unit', { textContent: '#' }), hexInp]);
            
            const presetColors = ['#FF3B30', '#34C759', '#007AFF', '#FFCC00', '#00C7BE', '#804B98'];
            const presetGroup = createEl('div', 'preset-group', {}, presetColors.map(c => 
                createEl('div', 'preset-swatch', { style: { backgroundColor: c }, onclick: () => updateColor(c) })
            ));
            
            solidControls.appendChild(hexInpGroup);
            solidControls.appendChild(presetGroup);

            const gradLbl = createEl('div', 'cp-input-group hex-target', { style: { justifyContent: 'center', width: '100px' } }, [
                createEl('span', 'cp-unit', { textContent: 'GRADIENT' })
            ]);
            gradControls.appendChild(gradLbl);

            middleBlock.appendChild(solidControls);
            middleBlock.appendChild(gradControls);
            middleBlock.appendChild(createEl('div', 'row-divider'));
            middleBlock.appendChild(opInpGroup);
            middleBlock.appendChild(opTrigger);
        }

        row.appendChild(middleBlock);
        row.appendChild(tglBtn);

        return row;
    };

    if (isLinkedMode) {
        layersList.appendChild(createEl('div', 'layer-item', {}, [
            createEl('div', 'layer-title-row', {}, [
                createEl('div', 'layer-title', { textContent: `Linked Layers (${shapes.length})` }),
                createEl('div', 'layer-toggle', { title: 'Reset Layer', style: { opacity: '0', pointerEvents: 'none' }, innerHTML: '<svg class="icon-svg"><use href="#icon-reset" xlink:href="#icon-reset"></use></svg>' })
            ]), 
            createAttrRow('Fill', shapes), 
            createAttrRow('Stroke', shapes)
        ]));
    } else {
        shapes.forEach((shape, i) => {
            layersList.appendChild(createEl('div', 'layer-item', {}, [
                createEl('div', 'layer-title-row', {}, [
                    createEl('div', 'layer-title', { textContent: `${shape.tagName.charAt(0).toUpperCase() + shape.tagName.slice(1)} ${i + 1}` }),
                    createEl('div', 'layer-toggle', { title: 'Reset Layer', innerHTML: '<svg class="icon-svg"><use href="#icon-reset" xlink:href="#icon-reset"></use></svg>', onclick: () => {
                        const orig = globalOriginalSvg.querySelectorAll('path, circle, rect, polygon, polyline, ellipse, line')[i];
                        if (orig) { shape.replaceWith(orig.cloneNode(true)); buildLayersPanel(); renderOutput(false); }
                    }})
                ]), 
                createAttrRow('Fill', [shape]), 
                createAttrRow('Stroke', [shape])
            ]));
        });
    }

    requestAnimationFrame(window.updateAllScrollbars); 
};

// ==========================================
// High Performance DOM Replacement Engine
// ==========================================
const renderOutput = (isScrubbing = false) => {
    if (!globalOptimizedSvg) return;
    const clone = globalOptimizedSvg.cloneNode(true);
    
    if (colorMode === 'mono') {
        applyMonoToStops(clone);
    }
    
    clone.querySelectorAll('path, circle, rect, polygon, polyline, ellipse, line').forEach(s => {
        if (s.getAttribute('data-hidden-fill')) s.setAttribute('fill', 'none');
        if (s.getAttribute('data-hidden-stroke')) s.setAttribute('stroke', 'none');
        s.removeAttribute('data-hidden-fill'); s.removeAttribute('data-hidden-stroke');
        const f = s.getAttribute('fill'), st = s.getAttribute('stroke');
        if ((!f || f === 'none') && (!st || st === 'none')) return s.remove();
        if (colorMode === 'mono') {
            if (f && f !== 'none' && !f.startsWith('url')) s.setAttribute('fill', 'currentColor');
            if (st && st !== 'none' && !st.startsWith('url')) s.setAttribute('stroke', 'currentColor');
        }
    });

    const emps = clone.querySelectorAll('g, defs');
    for (let i = emps.length - 1; i >= 0; i--) if (!emps[i].children.length) emps[i].remove();

    const wrapper = clone.querySelector('g#ink-wrapper');
    if (wrapper) {
        wrapper.removeAttribute('data-pf-sx');
        wrapper.removeAttribute('data-pf-sy');
        wrapper.removeAttribute('data-pf-tx');
        wrapper.removeAttribute('data-pf-ty');
    }

    const vb = clone.getAttribute("viewBox") || clone.getAttribute("viewbox");
    let nw = 128, nh = 128;
    if (vb) {
        const p = vb.trim().split(/[\s,]+/); nw = parseFloat(p.length === 4 ? p[2] : p[0]); nh = parseFloat(p.length === 4 ? p[3] : p[1]);
        detVbW.textContent = `${nw.toFixed(2)}px`; detVbH.textContent = `${nh.toFixed(2)}px`;
    } else {
        detVbW.textContent = `-`; detVbH.textContent = `-`;
    }

    clone.dataset.nativeW = nw; clone.dataset.nativeH = nh;

    const oldSvg = previewArea.querySelector('svg:not(.icon-svg)');
    if (oldSvg) {
        clone.style.width = oldSvg.style.width || `${nw}px`;
        clone.style.height = oldSvg.style.height || `${nh}px`;
        clone.style.transition = 'none'; 
        oldSvg.replaceWith(clone);
        void clone.offsetWidth; 
    } else {
        clone.style.transition = 'none';
        previewArea.appendChild(clone);
        void clone.offsetWidth;
    }

    if (!isScrubbing) {
        const exportClone = clone.cloneNode(true);
        exportClone.removeAttribute('data-native-w');
        exportClone.removeAttribute('data-native-h');
        exportClone.querySelectorAll('[data-pf-index]').forEach(el => el.removeAttribute('data-pf-index'));
        outputStr.value = new XMLSerializer().serializeToString(exportClone);
    }

    try { 
        const b = clone.getBBox();
        detObjW.textContent = `${b.width.toFixed(2)}px`; 
        detObjH.textContent = `${b.height.toFixed(2)}px`; 
    } catch { detObjW.textContent = detObjH.textContent = 'Error'; }
    
    applyZoomState(isScrubbing);

    if (!isScrubbing && document.querySelector('input[name="exportFormat"]:checked').value === 'png') {
        updatePngPreview();
    }
};

window.copyOutput = btn => {
    if (!outputStr.value || btn.classList.contains('btn-success')) return;
    const span = btn.querySelector('span'), trigger = () => {
        btn.classList.add('btn-success'); 
        outputStr.classList.add('ring-green'); 
        
        if (span) span.textContent = 'Copied! ✓';
        setTimeout(() => { 
            btn.classList.remove('btn-success'); 
            outputStr.classList.remove('ring-green'); 
            if (span) span.textContent = 'Copy to Clipboard'; 
        }, 2000);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(outputStr.value).then(trigger).catch(fallback); else fallback();
    function fallback() {
        outputStr.focus(); outputStr.select(); outputStr.setSelectionRange(0, 999999);
        try { if (document.execCommand('copy')) trigger(); } catch (e) { console.error(e); }
        window.getSelection().removeAllRanges(); outputStr.blur();
    }
};

// ==========================================
// Export Formats & Logic
// ==========================================

let pngAspectRatio = 1;

window.setPngBg = (bgData) => {
    currentPngBg = bgData;
    const isCustom = (bgData !== 'transparent' && bgData !== '#000000' && bgData !== '#ffffff');
    
    document.querySelectorAll('.bg-preset-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.bg === bgData || (btn.id === 'btnCustomPngBg' && isCustom));
    });
    
    const center = $('customPngBgCenter');
    if (isCustom) {
        if (typeof bgData === 'string') {
            center.style.background = bgData;
        } else {
            if (bgData.type === 'linear') {
                let stops = bgData.stops.map((c, i) => `${c} ${(i / (bgData.stops.length - 1)) * 100}%`).join(', ');
                center.style.background = `linear-gradient(${bgData.angle}deg, ${stops})`;
            } else {
                let stops = bgData.stops.map((c, i) => `${c} ${(i / (bgData.stops.length - 1)) * 100}%`).join(', ');
                center.style.background = `radial-gradient(circle at center, ${stops})`;
            }
        }
        center.classList.add('has-color');
    } else {
        center.classList.remove('has-color');
    }
    
    updatePngPreview();
};

window.openPngBgPicker = () => {
    let startData = (currentPngBg !== 'transparent') ? currentPngBg : '#007aff';
    let isGrad = typeof startData === 'object' && startData !== null;
    window.openCustomPicker(startData, true, (newCol, scrub, isGradFlag) => {
        setPngBg(newCol);
    });
};

window.syncPngDimensions = () => {
    if (!globalOptimizedSvg) return;
    
    const holdRes = $('pngHoldRes').checked;
    const isClipped = $('pngClipBounds').checked;
    
    let targetW, targetH;
    if (isClipped) {
        targetW = resizeState.inkW; targetH = resizeState.inkH;
        if (targetW === 0 || targetH === 0) {
            try { 
                const liveSvg = document.getElementById('previewArea').querySelector('svg:not(.icon-svg)');
                if (liveSvg) {
                    const bbox = liveSvg.querySelector('g#ink-wrapper').getBBox();
                    targetW = bbox.width; targetH = bbox.height;
                }
            } catch(err) {}
        }
    } else {
        targetW = resizeState.abW; targetH = resizeState.abH;
        if (targetW === 0 || targetH === 0) {
            let vb = globalOptimizedSvg.getAttribute('viewBox');
            if (vb) {
                let p = vb.trim().split(/[\s,]+/);
                targetW = parseFloat(p.length === 4 ? p[2] : p[0]); 
                targetH = parseFloat(p.length === 4 ? p[3] : p[1]);
            } else {
                targetW = parseFloat(globalOptimizedSvg.getAttribute('width'));
                targetH = parseFloat(globalOptimizedSvg.getAttribute('height'));
            }
        }
    }
    
    targetW = targetW || 512; targetH = targetH || 512;
    pngAspectRatio = targetW / targetH;
    
    // Do not auto-update fields if "Hold Resolution" is enabled
    if (holdRes) {
        let savedW = localStorage.getItem('pf_pngHoldW');
        let savedH = localStorage.getItem('pf_pngHoldH');
        if (savedW && savedH) {
            $('pngW').value = savedW;
            $('pngH').value = savedH;
        }
        updatePngPreview();
        return; 
    }
    
    $('pngW').value = Math.round(targetW);
    $('pngH').value = Math.round(targetH);
    updatePngPreview();
};

window.toggleExportFormat = () => {
    const format = document.querySelector('input[name="exportFormat"]:checked').value;
    const btnCopy = $('btnCopyExport');
    const btnSave = $('btnSaveExport');
    const saveSpan = btnSave.querySelector('span');
    const outStrWrap = $('exportWrap');
    const pngWrap = $('pngExportWrap');

    if (format === 'png') {
        btnCopy.style.display = 'none';
        outStrWrap.style.display = 'none';
        pngWrap.style.display = 'flex';
        saveSpan.textContent = 'Save PNG';
        syncPngDimensions();
        updatePngPreview();
    } else {
        btnCopy.style.display = 'flex';
        outStrWrap.style.display = 'flex';
        pngWrap.style.display = 'none';
        saveSpan.textContent = 'Save .svg';
    }
};

window.handlePngDimChange = (axis) => {
    const wInp = $('pngW');
    const hInp = $('pngH');
    let w = parseFloat(wInp.value);
    let h = parseFloat(hInp.value);
    
    if (axis === 'w' && !isNaN(w) && w > 0) {
        hInp.value = Math.round(w / pngAspectRatio);
    } else if (axis === 'h' && !isNaN(h) && h > 0) {
        wInp.value = Math.round(h * pngAspectRatio);
    }
    
    if ($('pngHoldRes').checked) {
        localStorage.setItem('pf_pngHoldW', $('pngW').value);
        localStorage.setItem('pf_pngHoldH', $('pngH').value);
    }
    
    updatePngPreview();
};

window.handlePngHoldToggle = (isChecked) => {
    localStorage.setItem('pf_pngHoldRes', isChecked ? 'true' : 'false');
    if (isChecked) {
        localStorage.setItem('pf_pngHoldW', $('pngW').value);
        localStorage.setItem('pf_pngHoldH', $('pngH').value);
    } else {
        syncPngDimensions();
    }
};

window.handlePngClipToggle = (isClipped) => {
    syncPngDimensions();
};

window.executeExport = () => {
    const format = document.querySelector('input[name="exportFormat"]:checked').value;
    if (format === 'svg') window.downloadSVG();
    else window.downloadPNG();
};

window.downloadSVG = async () => {
    if (!outputStr.value) return;
    const blob = new Blob([outputStr.value], { type: 'image/svg+xml;charset=utf-8' });
    if (window.isSecureContext && navigator.share && navigator.canShare) {
        const file = new File([blob], 'icon_optimized.svg', { type: 'image/svg+xml' });
        if (navigator.canShare({ files: [file] })) try { return await navigator.share({ files: [file] }); } catch (e) { if (e.name !== 'AbortError') throw e; }
    }
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = 'icon_optimized.svg'; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
};

function buildExportSvgElement(w, h, clip) {
    if (!globalOptimizedSvg) return null;
    const clone = globalOptimizedSvg.cloneNode(true);
    
    if (colorMode === 'mono') {
        applyMonoToStops(clone);
    }
    
    clone.querySelectorAll('path, circle, rect, polygon, polyline, ellipse, line').forEach((s, idx) => {
        s.removeAttribute('data-pf-index');
        if (s.getAttribute('data-hidden-fill')) s.setAttribute('fill', 'none');
        if (s.getAttribute('data-hidden-stroke')) s.setAttribute('stroke', 'none');
        s.removeAttribute('data-hidden-fill'); s.removeAttribute('data-hidden-stroke');
        const f = s.getAttribute('fill'), st = s.getAttribute('stroke');
        if ((!f || f === 'none') && (!st || st === 'none')) return s.remove();
        
        if (colorMode === 'mono') {
            const activeF = s.getAttribute('fill');
            if (activeF === 'currentColor') {
                let orig = globalOriginalSvg.querySelectorAll('path, circle, rect, polygon, polyline, ellipse, line')[idx];
                if (orig) {
                    let fillCol = orig.getAttribute('fill');
                    s.setAttribute('fill', (!fillCol || fillCol === 'none') ? '#000000' : fillCol);
                }
            }
            const activeS = s.getAttribute('stroke');
            if (activeS === 'currentColor') {
                let orig = globalOriginalSvg.querySelectorAll('path, circle, rect, polygon, polyline, ellipse, line')[idx];
                if (orig) {
                    let strokeCol = orig.getAttribute('stroke');
                    s.setAttribute('stroke', strokeCol || 'none');
                }
            }
        }
    });

    const usedIdsExport = new Set();
    clone.querySelectorAll('*').forEach(el => {
        const f = el.getAttribute('fill'), s = el.getAttribute('stroke');
        if (f && f.includes('url(#')) { const m = f.match(/url\(['"]?#([^)'"]+)['"]?\)/); if (m) usedIdsExport.add(m[1]); }
        if (s && s.includes('url(#')) { const m = s.match(/url\(['"]?#([^)'"]+)['"]?\)/); if (m) usedIdsExport.add(m[1]); }
    });
    const cloneDefs = clone.querySelector('defs');
    if (cloneDefs) {
        Array.from(cloneDefs.children).forEach(c => {
            if (c.id && c.id.startsWith('pf-grad-') && !usedIdsExport.has(c.id)) c.remove();
        });
    }

    const emps = clone.querySelectorAll('g, defs');
    for (let i = emps.length - 1; i >= 0; i--) if (!emps[i].children.length) emps[i].remove();
    
    let abW = resizeState.abW, abH = resizeState.abH;
    let inkX = resizeState.inkX, inkY = resizeState.inkY, inkW = resizeState.inkW, inkH = resizeState.inkH;
    let abX = 0, abY = 0;
    
    if (abW === 0 || abH === 0) {
        let vb = globalOptimizedSvg.getAttribute('viewBox');
        if (vb) {
            let p = vb.trim().split(/[\s,]+/);
            if (p.length === 4) {
                abX = parseFloat(p[0]) || 0;
                abY = parseFloat(p[1]) || 0;
                abW = parseFloat(p[2]) || 128; 
                abH = parseFloat(p[3]) || 128;
            } else {
                abW = parseFloat(p[0]) || 128; 
                abH = parseFloat(p[1]) || 128;
            }
        } else {
            abW = parseFloat(globalOptimizedSvg.getAttribute('width')) || 128;
            abH = parseFloat(globalOptimizedSvg.getAttribute('height')) || 128;
        }
        
        let bbox = {x:0, y:0, width:abW, height:abH};
        try { 
            const liveSvg = document.getElementById('previewArea').querySelector('svg:not(.icon-svg)');
            if (liveSvg) bbox = liveSvg.querySelector('g#ink-wrapper').getBBox();
        } catch(e) {}
        
        inkX = bbox.x; inkY = bbox.y; inkW = bbox.width; inkH = bbox.height;
    }

    if (clip) {
        clone.setAttribute('viewBox', `${inkX} ${inkY} ${inkW} ${inkH}`);
    } else {
        clone.setAttribute('viewBox', `${abX} ${abY} ${abW} ${abH}`);
    }
    
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);
    
    // Inject Native PNG Background rendering layer
    if (currentPngBg !== 'transparent') {
        let defs = clone.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
            clone.insertBefore(defs, clone.firstChild);
        }
        
        let bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        
        let vbStr = clone.getAttribute('viewBox');
        if (vbStr) {
            let p = vbStr.trim().split(/[\s,]+/);
            bgRect.setAttribute('x', p[0] || '0');
            bgRect.setAttribute('y', p[1] || '0');
            bgRect.setAttribute('width', p[2] || '100%');
            bgRect.setAttribute('height', p[3] || '100%');
        } else {
            bgRect.setAttribute('x', '0');
            bgRect.setAttribute('y', '0');
            bgRect.setAttribute('width', '100%');
            bgRect.setAttribute('height', '100%');
        }

        if (typeof currentPngBg === 'string') {
            bgRect.setAttribute('fill', currentPngBg);
        } else {
            let gradId = 'pf-png-bg-grad';
            let gradEl = document.createElementNS("http://www.w3.org/2000/svg", currentPngBg.type === 'linear' ? "linearGradient" : "radialGradient");
            gradEl.setAttribute('id', gradId);
            
            if (currentPngBg.type === 'linear') {
                gradEl.setAttribute('x1', '0.5'); gradEl.setAttribute('y1', '1');
                gradEl.setAttribute('x2', '0.5'); gradEl.setAttribute('y2', '0');
                if (currentPngBg.angle !== 0) gradEl.setAttribute('gradientTransform', `rotate(${currentPngBg.angle}, 0.5, 0.5)`);
            } else {
                gradEl.setAttribute('cx', '0.5'); gradEl.setAttribute('cy', '0.5'); gradEl.setAttribute('r', '0.5');
            }
            
            let stopsHtml = '';
            const n = currentPngBg.stops.length;
            currentPngBg.stops.forEach((stopCol, i) => {
                let offset = n === 1 ? 0 : (i / (n - 1)) * 100;
                stopsHtml += `<stop offset="${offset}%" stop-color="${stopCol}" />`;
            });
            gradEl.innerHTML = stopsHtml;
            defs.appendChild(gradEl);
            bgRect.setAttribute('fill', `url(#${gradId})`);
        }
        
        clone.insertBefore(bgRect, defs.nextSibling);
    }
    
    return clone;
}

window.updatePngPreview = () => {
    if (!globalOptimizedSvg || document.querySelector('input[name="exportFormat"]:checked').value !== 'png') return;
    
    const clip = $('pngClipBounds').checked;
    
    // Fixed massive size to ensure preview scales purely via CSS max-width/max-height
    let previewW = 1000;
    let previewH = 1000 / pngAspectRatio;
    if (pngAspectRatio < 1) {
        previewH = 1000;
        previewW = 1000 * pngAspectRatio;
    }
    
    const clone = buildExportSvgElement(previewW, previewH, clip);
    if (!clone) return;
    
    const svgString = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const URL = window.URL || window.webkitURL || window;
    const blobURL = URL.createObjectURL(blob);
    
    const img = $('pngPreviewImg');
    img.onload = () => URL.revokeObjectURL(blobURL);
    img.src = blobURL;
    
    if (currentPngBg === 'transparent') {
        img.classList.add('checkerboard-bg');
    } else {
        img.classList.remove('checkerboard-bg');
    }
};

window.downloadPNG = () => {
    const w = parseFloat($('pngW').value) || 1024;
    const h = parseFloat($('pngH').value) || 1024;
    const clip = $('pngClipBounds').checked;
    
    const clone = buildExportSvgElement(w, h, clip);
    if (!clone) return;
    
    const svgString = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const URL = window.URL || window.webkitURL || window;
    const blobURL = URL.createObjectURL(blob);
    
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(blobURL);
        
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png', 1.0);
        a.download = 'icon_optimized.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
    };
    img.src = blobURL;
};

// ==========================================
// Dimension Resizing & Bounding Engine
// ==========================================
const updateResizeInputs = () => {
    const setVal = (el, val) => { if (document.activeElement !== el) el.value = Number(val.toFixed(2)); };
    setVal($('inpAbW'), resizeState.abW);
    setVal($('inpAbH'), resizeState.abH);
    setVal($('inpInkW'), resizeState.inkW);
    setVal($('inpInkH'), resizeState.inkH);

    $('btnLockAb').innerHTML = `<svg class="icon-svg"><use href="#icon-${isAbLocked ? 'lock' : 'unlock'}" xlink:href="#icon-${isAbLocked ? 'lock' : 'unlock'}"></use></svg>`;
    $('btnLockAb').className = `fp-lock ${isAbLocked ? '' : 'is-unlocked'}`;
    $('btnLockInk').innerHTML = `<svg class="icon-svg"><use href="#icon-${isInkLocked ? 'lock' : 'unlock'}" xlink:href="#icon-${isInkLocked ? 'lock' : 'unlock'}"></use></svg>`;
    $('btnLockInk').className = `fp-lock ${isInkLocked ? '' : 'is-unlocked'}`;
    $('btnLinkAbInk').innerHTML = `<svg class="icon-svg"><use href="#icon-${isLinked ? 'linked-layers' : 'unlinked-layers'}" xlink:href="#icon-${isLinked ? 'linked-layers' : 'unlinked-layers'}"></use></svg>`;
    $('btnLinkAbInk').className = `fp-link-btn-standalone ${isLinked ? '' : 'is-unlinked'}`;
};

const applyResizeMath = (isScrubbing = true) => {
    let sx = Number((resizeState.baseW === 0 ? 1 : resizeState.inkW / resizeState.baseW).toFixed(4));
    let sy = Number((resizeState.baseH === 0 ? 1 : resizeState.inkH / resizeState.baseH).toFixed(4));
    let tx = Number((resizeState.inkX - (resizeState.baseX * sx)).toFixed(4));
    let ty = Number((resizeState.inkY - (resizeState.baseY * sy)).toFixed(4));
    
    let wrapper = globalOptimizedSvg.querySelector('g#ink-wrapper');
    if (wrapper) {
        wrapper.setAttribute('data-pf-sx', sx); wrapper.setAttribute('data-pf-sy', sy);
        wrapper.setAttribute('data-pf-tx', tx); wrapper.setAttribute('data-pf-ty', ty);
        wrapper.setAttribute('transform', `translate(${tx}, ${ty}) scale(${sx}, ${sy})`);
    }
    
    let abW = Number(resizeState.abW.toFixed(2));
    let abH = Number(resizeState.abH.toFixed(2));
    
    globalOptimizedSvg.setAttribute('viewBox', `0 0 ${abW} ${abH}`);
    globalOptimizedSvg.setAttribute('width', `${abW}`);
    globalOptimizedSvg.setAttribute('height', `${abH}`);
    
    renderOutput(isScrubbing);
    
    if (!isScrubbing) {
        syncPngDimensions();
    }
};

window.toggleLock = (type) => {
    if (type === 'ab') isAbLocked = !isAbLocked;
    else if (type === 'ink') isInkLocked = !isInkLocked;
    else if (type === 'link') isLinked = !isLinked;
    updateResizeInputs();
};

window.resetDimensions = (type) => {
    if (type === 'ab') {
        resizeState.abW = resizeState.origAbW;
        resizeState.abH = resizeState.origAbH;
    } else if (type === 'ink') {
        resizeState.inkW = resizeState.origInkW;
        resizeState.inkH = resizeState.origInkH;
        resizeState.inkX = resizeState.origInkX;
        resizeState.inkY = resizeState.origInkY;
    }
    updateResizeInputs();
    applyResizeMath(false);
    saveResizeState();
};

window.alignCenter = (axis) => {
    if (axis === 'h') resizeState.inkX = (resizeState.abW - resizeState.inkW) / 2;
    else resizeState.inkY = (resizeState.abH - resizeState.inkH) / 2;
    applyResizeMath(false);
    saveResizeState();
};

window.fitToBounds = () => {
    resizeState.abW = resizeState.inkW; resizeState.abH = resizeState.inkH;
    resizeState.inkX = 0; resizeState.inkY = 0;
    updateResizeInputs(); applyResizeMath(false);
    saveResizeState();
};

window.openResizePanel = () => {
    if (!globalOptimizedSvg) return;
    resizeBackupSvg = globalOptimizedSvg.cloneNode(true);
    let liveSvg = previewArea.querySelector('svg:not(.icon-svg)');
    if (!liveSvg) return;
    let liveWrapper = ensureInkWrapper(liveSvg);
    let globalWrapper = ensureInkWrapper(globalOptimizedSvg);

    let oldTransform = liveWrapper.getAttribute('transform');
    liveWrapper.removeAttribute('transform');
    let bbox; try { bbox = liveWrapper.getBBox(); } catch(e) { bbox = {x:0, y:0, width:128, height:128}; }
    if (oldTransform) liveWrapper.setAttribute('transform', oldTransform);

    resizeState.baseW = bbox.width || 0.1; resizeState.baseH = bbox.height || 0.1;
    resizeState.baseX = bbox.x || 0; resizeState.baseY = bbox.y || 0;

    let vb = globalOptimizedSvg.getAttribute('viewBox');
    let abX = 0, abY = 0;
    if (vb) {
        let p = vb.trim().split(/[\s,]+/);
        if (p.length === 4) {
            abX = parseFloat(p[0]) || 0;
            abY = parseFloat(p[1]) || 0;
            resizeState.abW = parseFloat(p[2]) || 128; 
            resizeState.abH = parseFloat(p[3]) || 128;
        } else {
            resizeState.abW = parseFloat(p[0]) || 128; 
            resizeState.abH = parseFloat(p[1]) || 128;
        }
    } else {
        resizeState.abW = parseFloat(globalOptimizedSvg.getAttribute('width')) || 128;
        resizeState.abH = parseFloat(globalOptimizedSvg.getAttribute('height')) || 128;
    }

    let sx = parseFloat(globalWrapper.getAttribute('data-pf-sx'));
    let sy = parseFloat(globalWrapper.getAttribute('data-pf-sy'));
    let tx = parseFloat(globalWrapper.getAttribute('data-pf-tx'));
    let ty = parseFloat(globalWrapper.getAttribute('data-pf-ty'));

    if (isNaN(sx) || isNaN(sy) || isNaN(tx) || isNaN(ty)) {
        let tr = globalWrapper.getAttribute('transform');
        sx = 1; sy = 1; tx = 0; ty = 0;
        if (tr) {
            let scaleMatch = tr.match(/scale\(([^)]+)\)/);
            if (scaleMatch) {
                let parts = scaleMatch[1].trim().split(/[\s,]+/);
                sx = parseFloat(parts[0]);
                sy = parts.length > 1 ? parseFloat(parts[1]) : sx;
            }
            let transMatch = tr.match(/translate\(([^)]+)\)/);
            if (transMatch) {
                let parts = transMatch[1].trim().split(/[\s,]+/);
                tx = parseFloat(parts[0]);
                ty = parts.length > 1 ? parseFloat(parts[1]) : 0;
            }
        }
        globalWrapper.setAttribute('data-pf-sx', sx);
        globalWrapper.setAttribute('data-pf-sy', sy);
        globalWrapper.setAttribute('data-pf-tx', tx);
        globalWrapper.setAttribute('data-pf-ty', ty);
    }

    resizeState.inkW = resizeState.baseW * sx; resizeState.inkH = resizeState.baseH * sy;
    resizeState.inkX = (resizeState.baseX * sx) + tx - abX; 
    resizeState.inkY = (resizeState.baseY * sy) + ty - abY;

    resizeState.origAbW = resizeState.abW;
    resizeState.origAbH = resizeState.abH;
    resizeState.origInkW = resizeState.inkW;
    resizeState.origInkH = resizeState.inkH;
    resizeState.origInkX = resizeState.inkX;
    resizeState.origInkY = resizeState.inkY;

    // Reset History Stack
    resizeHistory = [];
    resizeHistoryIndex = -1;

    updateResizeInputs();
    $('resizePanel').style.display = 'flex';
    saveResizeState(); // Push initial state to history
};

window.cancelResize = () => {
    globalOptimizedSvg = resizeBackupSvg.cloneNode(true);
    $('resizePanel').style.display = 'none'; renderOutput(false);
};

window.confirmResize = () => { $('resizePanel').style.display = 'none'; renderOutput(false); };

const initPanelInputs = () => {
    
    // Globally applied App-Like Text Input UI
    const setupAppLikeInput = (inp) => {
        let isFirstType = false;
        inp.addEventListener('focus', function() { this.classList.add('app-input-grey'); isFirstType = true; setTimeout(() => this.select(), 0); });
        inp.addEventListener('keydown', function(e) { if (isFirstType && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { this.value = ''; this.classList.remove('app-input-grey'); isFirstType = false; }});
        inp.addEventListener('input', function() { this.classList.remove('app-input-grey'); isFirstType = false; });
        inp.addEventListener('blur', function() { this.classList.remove('app-input-grey'); isFirstType = false; window.getSelection().removeAllRanges(); });
    };

    const sync = (id, field, isAb, isW) => {
        let inputEl = $(id);
        setupAppLikeInput(inputEl);
        
        inputEl.addEventListener('input', e => {
            if (e.target.value === '') return; 
            let val = parseFloat(e.target.value); 
            if (isNaN(val) || val <= 0.01) return;
            
            let oldVal = resizeState[field];
            let ratio = val / oldVal;
            
            if (isLinked) {
                resizeState.abW *= ratio;
                resizeState.abH *= ratio;
                resizeState.inkW *= ratio;
                resizeState.inkH *= ratio;
                resizeState.inkX *= ratio;
                resizeState.inkY *= ratio;
            } else {
                if (isAb) {
                    resizeState[field] = val;
                    if (isAbLocked) {
                        if (isW) resizeState.abH *= ratio;
                        else resizeState.abW *= ratio;
                    }
                } else {
                    let oldInkW = resizeState.inkW;
                    let oldInkH = resizeState.inkH;
                    
                    resizeState[field] = val;
                    if (isInkLocked) {
                        if (isW) resizeState.inkH *= ratio;
                        else resizeState.inkW *= ratio;
                    }
                    
                    resizeState.inkX -= (resizeState.inkW - oldInkW) / 2;
                    resizeState.inkY -= (resizeState.inkH - oldInkH) / 2;
                }
            }
            updateResizeInputs(); applyResizeMath(true);
        });

        inputEl.addEventListener('change', e => { applyResizeMath(false); saveResizeState(); });

        inputEl.addEventListener('blur', e => {
            if (e.target.value === '' || isNaN(parseFloat(e.target.value))) {
                e.target.value = resizeState[field].toFixed(2);
            }
        });
    };

    sync('inpAbW', 'abW', true, true); sync('inpAbH', 'abH', true, false);
    sync('inpInkW', 'inkW', false, true); sync('inpInkH', 'inkH', false, false);

    const makeScrub = (scrubId, inpId) => {
        let el = $(scrubId), inp = $(inpId), isDragging = false, startX, startVal, scrubRaf;
        el.addEventListener('pointerdown', e => {
            isDragging = true; startX = e.clientX; startVal = parseFloat(inp.value) || 0;
            document.body.classList.add('is-dragging-ew'); el.setPointerCapture(e.pointerId);
        });
        el.addEventListener('pointermove', e => {
            if (!isDragging) return;
            let delta = (e.clientX - startX) * 0.5;
            inp.value = Math.max(0.1, startVal + delta).toFixed(2);
            if (scrubRaf) cancelAnimationFrame(scrubRaf);
            scrubRaf = requestAnimationFrame(() => inp.dispatchEvent(new Event('input')));
        });
        const stop = e => { 
            if(isDragging) { 
                isDragging = false; 
                document.body.classList.remove('is-dragging-ew'); 
                el.releasePointerCapture(e.pointerId); 
                applyResizeMath(false); 
                saveResizeState();
            } 
        };
        el.addEventListener('pointerup', stop); el.addEventListener('pointercancel', stop);
    };
    makeScrub('scrubAbW', 'inpAbW'); makeScrub('scrubAbH', 'inpAbH');
    makeScrub('scrubInkW', 'inpInkW'); makeScrub('scrubInkH', 'inpInkH');

    const header = $('resizePanelHeader'), panel = $('resizePanel');
    let isDraggingWin = false, sX, sY, sL, sT;
    
    header.addEventListener('pointerdown', e => {
        // Prevent the window from dragging if the user is explicitly trying to click Undo/Redo
        if (e.target.closest('.fp-reset-btn')) return;
        
        isDraggingWin = true; sX = e.clientX; sY = e.clientY;
        const r = panel.getBoundingClientRect();
        panel.style.transform = 'none'; panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px';
        sL = r.left; sT = r.top; header.setPointerCapture(e.pointerId);
    });
    
    header.addEventListener('pointermove', e => {
        if (!isDraggingWin) return;
        let newL = sL + e.clientX - sX;
        let newT = sT + e.clientY - sY;
        let maxL = window.innerWidth - panel.offsetWidth;
        let maxT = window.innerHeight - panel.offsetHeight;
        
        newL = Math.max(0, Math.min(newL, maxL));
        newT = Math.max(0, Math.min(newT, maxT));

        panel.style.left = newL + 'px'; 
        panel.style.top = newT + 'px';
    });
    
    const stopWin = e => { if (isDraggingWin) { isDraggingWin = false; header.releasePointerCapture(e.pointerId); } };
    header.addEventListener('pointerup', stopWin); header.addEventListener('pointercancel', stopWin);
};

document.addEventListener('DOMContentLoaded', () => {
    initPanelInputs();
    
    if (localStorage.getItem('pf_pngHoldRes') === 'true') {
        const holdCb = $('pngHoldRes');
        if (holdCb) holdCb.checked = true;
    }
});