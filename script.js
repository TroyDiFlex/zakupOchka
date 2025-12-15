// ==UserScript==
// @name         Steam Discount Finder - ЗакупОчка (updated_stable)
// @namespace    http://tampermonkey.net/
// @version      4.8
// @description  Скрипт-виджет Tampermonkey для поиска в Steam по проценту скидки и/или цене
// @author       TroyDiFlex
// @match        *://store.steampowered.com/search*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // Конфигурация
    const config = {
        panelId: 'discount-finder-panel',
        floatBtnId: 'discount-finder-float',
        highlightClass: 'discount-highlight',
        activeClass: 'discount-highlight-active',
        defaultMin: 85,
        defaultMax: 100
    };

    // Глобальное состояние
    let highlightedElements = [];
    let currentIndex = -1;
    let sortedValues = [];
    let styleElement = null;
    let observer = null;
    let lastContent = '';
    let sortDescending = true; // <--- глобальный флаг сортировки

    // Создаем плавающую кнопку сразу
    createFloatButton();

    // Не открываем панель автоматически
    // (initDiscountFinder вызывается только по клику на кнопку)

    // Функция корректировки положения панели
    const adjustPanelPosition = function() {
        const panel = document.getElementById(config.panelId);
        if (!panel) return;
        const rect = panel.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        let safeTop = Math.max(10, Math.min(rect.top, windowHeight - rect.height - 10));
        let safeLeft = Math.max(10, Math.min(rect.left, windowWidth - rect.width - 10));
        panel.style.top = `${safeTop}px`;
        panel.style.left = `${safeLeft}px`;
        panel.style.right = 'unset';
        panel.style.bottom = 'unset';
        // Не трогаем overflow и высоту results-glass
    };

    // Основная функция инициализации
    function initDiscountFinder() {
        // Удаляем старые элементы если есть
        document.getElementById(config.panelId)?.remove();
        document.querySelectorAll(`.${config.highlightClass}`).forEach(el => {
            const parent = el.parentNode;
            parent.replaceChild(document.createTextNode(el.textContent), el);
            parent.normalize();
        });

        // Создаем HTML панели
        createPanel();

        // Инициализируем функционал
        setupFunctionality();

        // Первоначальный поиск
        highlightNumbers(config.defaultMin, config.defaultMax);

        // Начинаем отслеживать изменения
        startContentObserver();
    }

    function createFloatButton() {
        const floatBtn = document.createElement('div');
        floatBtn.id = config.floatBtnId;
        floatBtn.innerHTML = `
            <button id="expand-glass-btn" aria-label="Открыть поиск скидок">
                🔍
            </button>
        `;
        document.body.appendChild(floatBtn);

        // Стили для стеклянной кнопки - ИСПРАВЛЕНО
        const style = document.createElement('style');
        style.textContent = `
            #${config.floatBtnId} {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 9999;
                transition: transform 0.3s ease, opacity 0.3s ease;
            }

            #expand-glass-btn {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.08);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: rgba(255, 255, 255, 0.9);
                font-size: 18px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.3s ease;
                box-shadow:
                    0 4px 20px rgba(0, 0, 0, 0.15),
                    0 0 0 1px rgba(0, 0, 0, 0.05);
            }

            #expand-glass-btn:hover {
                background: rgba(223, 67, 252, 0.15);
                transform: scale(1.1) rotate(15deg);
                box-shadow:
                    0 6px 25px rgba(0, 0, 0, 0.25),
                    0 0 20px rgba(223, 67, 252, 0.4);
                border-color: rgba(223, 67, 252, 0.3);
            }

            #expand-glass-btn:active {
                transform: scale(0.95) rotate(5deg);
            }
        `;
        document.head.appendChild(style);

        // Обработчик открытия панели
        document.getElementById('expand-glass-btn').addEventListener('click', () => {
            initDiscountFinder();
            document.getElementById(config.floatBtnId).style.opacity = '0.5';
        });
    }

    function createPanel() {
        const panelHTML = `
        <div id="${config.panelId}" class="glass-panel">
            <div class="glass-header">
                <span>🔍 ЗакупОчка</span>
                <div class="glass-controls">
                    <button id="minimize-glass-btn" title="Свернуть">−</button>
                    <button id="close-glass-btn" title="Закрыть">×</button>
                </div>
            </div>
            <div class="glass-body">
                <div class="input-group">
                    <label for="min-glass-range">Мин. значение:</label>
                    <input type="number" id="min-glass-range" value="${config.defaultMin}" min="-100">
                </div>
                <div class="input-group">
                    <label for="max-glass-range">Макс. значение:</label>
                    <input type="number" id="max-glass-range" value="${config.defaultMax}" min="-100">
                </div>
                <!-- Toggle switches вместо чекбоксов -->
                <div class="input-group">
                    <label class="toggle-switch">
                        <input type="checkbox" id="only-percent" checked>
                        <span class="slider"></span>
                    </label>
                    <label for="only-percent">Искать только процент скидки</label>
                </div>
                <div class="input-group">
                    <label class="toggle-switch">
                        <input type="checkbox" id="hide-non-matching" checked>
                        <span class="slider"></span>
                    </label>
                    <label for="hide-non-matching">Скрывать не попадающие в диапазон</label>
                </div>
                <button id="refresh-glass-btn" class="refresh-glass-btn">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" fill="currentColor"/>
                    </svg>
                    Обновить
                </button>
                <div class="results-glass-header">
                    <span>Найдено: <span id="results-glass-count">0</span></span>
                    <div class="nav-glass-buttons">
                        <button id="sort-glass-btn" title="Сортировать"><span id="sort-glass-icon"></span></button>
                        <button id="nav-glass-prev" title="Предыдущий">▲</button>
                        <button id="nav-glass-next" title="Следующий">▼</button>
                    </div>
                </div>
                <!-- Grid контейнер -->
                <div id="results-glass" class="results-glass-container"></div>
            </div>
            <div class="glass-resize-handle"></div>
            <div class="resize-handle resize-handle-top"></div>
            <div class="resize-handle resize-handle-right"></div>
            <div class="resize-handle resize-handle-bottom"></div>
            <div class="resize-handle resize-handle-left"></div>
            <div class="resize-handle resize-handle-top-right"></div>
            <div class="resize-handle resize-handle-bottom-right"></div>
            <div class="resize-handle resize-handle-bottom-left"></div>
            <div class="resize-handle resize-handle-top-left"></div>
        </div>
        `;
    let sortDescending = true;
        document.body.insertAdjacentHTML('beforeend', panelHTML);

        // Стили для стеклянной панели
        styleElement = document.createElement('style');
        styleElement.textContent = `
            .glass-panel {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 300px;
                z-index: 10000;
                background: rgba(15, 15, 19, 0.85);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                border-radius: 14px;
                border: 1px solid rgba(255, 255, 255, 0.08);
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(0, 0, 0, 0.05);
                overflow: auto;
                font-family: 'Segoe UI', system-ui, sans-serif;
                color: #f0f0f0;
                transition: transform 0.4s cubic-bezier(0.22, 0.61, 0.36, 1);
                min-width: 280px;
                min-height: 320px;
                max-height: 90vh;
                display: flex;
                flex-direction: column;
                resize: both; /* <--- добавлено */
            }

            .glass-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 14px 16px;
                background: rgba(21, 21, 26, 0.6);
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                font-weight: 600;
                cursor: move;
                font-size: 1.05em;
            }

            .glass-controls {
                display: flex;
                gap: 6px;
            }

            .glass-controls button {
                background: rgba(26, 26, 31, 0.6);
                border: 1px solid rgba(255, 255, 255, 0.08);
                color: rgba(176, 176, 176, 0.9);
                font-size: 0.9em;
                cursor: pointer;
                width: 26px;
                height: 26px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 6px;
                transition: all 0.2s ease;
            }

            .glass-controls button:hover {
                background: rgba(223, 67, 252, 0.5);
                color: white;
                transform: translateY(-1px);
                box-shadow: 0 0 15px rgba(223, 67, 252, 0.4);
            }

            .glass-body {
                padding: 16px;
                display: flex;
                flex-direction: column;
                gap: 14px;
                overflow: hidden;
                flex: 1 1 auto;
                min-height: 0;
            }

            .input-group {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            .input-group:has(input[type="checkbox"]) {
                flex-direction: row;
                align-items: center;
                gap: 8px;
            }

            .glass-body label {
                font-size: 0.9em;
                color: rgba(176, 176, 176, 0.9);
                font-weight: 500;
            }

            .glass-body input[type="number"] {
                padding: 12px;
                background: rgba(26, 26, 31, 0.6);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 8px;
                color: white;
                font-size: 1em;
                transition: all 0.2s ease;
            }

            .glass-body input:focus {
                outline: none;
                border-color: rgba(223, 67, 252, 0.5);
                box-shadow: 0 0 0 2px rgba(223, 67, 252, 0.25);
            }

            .glass-body input[type="checkbox"] {
                width: 16px;
                height: 16px;
                accent-color: #DF43FC;
            }

            .refresh-glass-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                padding: 18px 14px 18px 14px;
                background: linear-gradient(135deg, rgba(223, 67, 252, 0.97), rgba(192, 60, 255, 0.94));
                color: white;
                border: none;
                border-radius: 14px;
                font-weight: 400;
                cursor: pointer;
                transition: all 0.3s cubic-bezier(.4,1.4,.6,1);
                margin-top: 14px;
                margin-bottom: 4px;
                font-size: 1.13em;
                position: relative;
                overflow: hidden;
                box-shadow: 0 8px 32px rgba(223, 67, 252, 0.18), 0 4px 20px rgba(0, 0, 0, 0.32);
                border-bottom: 4px solid rgba(192, 60, 255, 0.55);
            }

            .refresh-glass-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5), 0 0 20px 4px rgba(223, 67, 252, 0.45);
            }

            .refresh-glass-btn:active {
                transform: translateY(0);
            }

            .refresh-glass-btn svg {
                transition: transform 0.5s ease;
            }

            .refresh-glass-btn:hover svg {
                transform: rotate(360deg);
            }

            .results-glass-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 0;
                margin-top: 8px;
                border-top: 1px solid rgba(255, 255, 255, 0.08);
                padding-top: 12px;
            }

            .nav-glass-buttons {
                display: flex;
                gap: 6px;
            }

            .nav-glass-buttons button {
                background: rgba(26, 26, 31, 0.6);
                border: 1px solid rgba(255, 255, 255, 0.08);
                color: rgba(176, 176, 176, 0.9);
                width: 28px;
                height: 28px;
                border-radius: 7px;
                cursor: pointer;
                transition: all 0.2s ease;
            }

            .nav-glass-buttons button:hover {
                background: rgba(223, 67, 252, 0.5);
                color: white;
                transform: translateY(-1px);
                box-shadow: 0 0 15px rgba(223, 67, 252, 0.4);
            }

            /* Grid контейнер */
            .results-glass-container {
                display: block;
                gap: 8px;
                margin-top: 5px;
                padding: 10px;
                background: rgba(26, 26, 31, 0.6);
                border-radius: 8px;
                font-size: 0.9em;
                overflow-y: auto;
                border: 1px solid rgba(255, 255, 255, 0.08);
                min-height: 0;
                max-height: 100%;
                align-content: start;
                height: auto;
            }

            .result-group {
                background: rgba(30, 30, 36, 0.6);
                border-radius: 6px;
                border: 1px solid rgba(255, 255, 255, 0.08);
                /* overflow: hidden; */
                /* Убрано, чтобы не обрезать содержимое group-items-grid */
                position: relative;
                z-index: 1;
                box-sizing: border-box;
                min-height: 40px;
            }

            .group-header {
                padding: 8px 12px;
                cursor: pointer;
                display: flex;
                justify-content: space-between;
                align-items: center;
                transition: background 0.2s ease;
                font-weight: 600;
                font-size: 0.95em;
                position: relative;
                z-index: 2;
                white-space: nowrap;
                height: 40px;
                box-sizing: border-box;
            }

            .group-header:hover {
                background: rgba(42, 26, 53, 0.6);
            }

            .group-items {
                display: none;
                padding: 10px;
                background: rgba(20, 20, 25, 0.7);
                border-top: 1px solid rgba(255, 255, 255, 0.05);
                /* position: relative; */
                /* Убрано, чтобы не мешать потоку документа */
                z-index: 3;
            }

            .group-items.expanded {
                display: block;
                position: static;
                /* max-height: 300px; */
                /* overflow-y: auto; */
                /* Убрано ограничение, чтобы показывать весь контент */
            }

            /* Внутренняя сетка для элементов списка */
            .group-items-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 6px;
            }

            .group-item {
                padding: 6px 8px;
                background: rgba(40, 40, 46, 0.6);
                border-radius: 4px;
                cursor: pointer;
                transition: all 0.2s ease;
                font-size: 0.85em;
                border: 1px solid rgba(255, 255, 255, 0.05);
                text-align: center;
                height: 28px;
                box-sizing: border-box;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .group-item:hover {
                background: rgba(52, 36, 63, 0.6);
            }

            .group-item.active {
                background: rgba(138, 43, 226, 0.4);
                box-shadow: 0 0 8px rgba(223, 67, 252, 0.4);
            }

            .no-results {
                text-align: center;
                padding: 8px;
                color: rgba(176, 176, 176, 0.9);
                font-style: italic;
                font-size: 0.9em;
                width: 100%;
                grid-column: 1 / -1;
            }

            /* Подсветка скидок */
            .${config.highlightClass} {
                background-color: rgba(235, 4, 24, 0.85);
                color: #fff;
                padding: 0 3px;
                border-radius: 4px;
                box-shadow: 0 0 8px rgba(235, 4, 24, 0.7);
                transition: all 0.3s ease;
                font-weight: bold;
            }

            .${config.activeClass} {
                background-color: rgba(255, 0, 21, 0.9);
                animation: pulseBorder 1.5s infinite, glowText 2s infinite alternate;
                position: relative;
                z-index: 1000;
                color: #fff !important;
            }

            @keyframes pulseBorder {
                0% { box-shadow: 0 0 0 0 rgba(0, 255, 234, 0.8); }
                100% { box-shadow: 0 0 0 6px rgba(0, 255, 234, 0); }
            }

            @keyframes glowText {
                0% { text-shadow: 0 0 2px #fff; }
                100% { text-shadow: 0 0 10px #fff, 0 0 20px #00ffea; }
            }

            /* Handle для изменения размера */
            .glass-resize-handle {
                display: none !important; /* <--- скрываем старый хэндл */
            }

            .glass-panel.minimized {
                min-height: 40px !important;
                height: auto !important;
            }
            .glass-panel.minimized .glass-body {
                display: none !important;
            }

            /* Скрыть стрелки у input[type=number] */
            input[type=number]::-webkit-inner-spin-button,
            input[type=number]::-webkit-outer-spin-button {
                -webkit-appearance: none;
                margin: 0;
            }
            input[type=number] {
                -moz-appearance: textfield;
            }
            /* Toggle switch */
            .toggle-switch {
                position: relative;
                display: inline-block;
                width: 36px;
                height: 20px;
            }
            .toggle-switch input {
                opacity: 0;
                width: 0;
                height: 0;
            }
            .toggle-switch .slider {
                position: absolute;
                cursor: pointer;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: rgba(176, 176, 176, 0.5);
                transition: .4s;
                border-radius: 20px;
                box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);
            }
            .toggle-switch .slider:before {
                position: absolute;
                content: "";
                height: 16px;
                width: 16px;
                left: 2px;
                bottom: 2px;
                background-color: rgba(255, 255, 255, 0.9);
                transition: .4s;
                border-radius: 50%;
            }
            .toggle-switch input:checked + .slider {
                background-color: rgba(223, 67, 252, 0.8);
            }
            .toggle-switch input:checked + .slider:before {
                transform: translateX(16px);
                background-color: white;
                box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            }
            .toggle-switch input:focus + .slider {
                box-shadow: 0 0 0 2px rgba(223, 67, 252, 0.3);
            }
            .input-group:has(.toggle-switch) {
                flex-direction: row;
                align-items: center;
                gap: 8px;
            }
            /* Resize handles for all sides and corners */
            .resize-handle {
                position: absolute;
                background: transparent;
                z-index: 10;
            }

            .resize-handle-right {
                cursor: ew-resize;
                width: 6px;
                height: calc(100% - 20px);
                top: 10px;
                right: 0;
            }
            .resize-handle-bottom {
                cursor: ns-resize;
                height: 6px;
                width: calc(100% - 20px);
                bottom: 0;
                left: 10px;
            }

            .resize-handle-top-right {
                cursor: nesw-resize;
                width: 12px;
                height: 12px;
                top: 0;
                right: 0;
            }
            .resize-handle-bottom-right {
                cursor: nwse-resize;
                width: 12px;
                height: 12px;
                bottom: 0;
                right: 0;
            }
            .resize-handle-bottom-left {
                cursor: nesw-resize;
                width: 12px;
                height: 12px;
                bottom: 0;
                left: 0;
            }
            .resize-handle-top-left {
                cursor: nwse-resize;
                width: 12px;
                height: 12px;
                top: 0;
                left: 0;
            }
        `;
        document.head.appendChild(styleElement);

        // Добавляем корректировку положения
        setTimeout(adjustPanelPosition, 10);
    }

    function setupFunctionality() {
        let isMinimized = false; // Добавлено объявление переменной

        const panel = document.getElementById(config.panelId);
        const minimizeBtn = document.getElementById('minimize-glass-btn');
        const closeBtn = document.getElementById('close-glass-btn');
        const refreshBtn = document.getElementById('refresh-glass-btn');
        const minInput = document.getElementById('min-glass-range');
        const maxInput = document.getElementById('max-glass-range');
        const excludeDatesCheckbox = document.getElementById('exclude-dates');
        const onlyPercentCheckbox = document.getElementById('only-percent');
        const hideNonMatchingCheckbox = document.getElementById('hide-non-matching');
        const resultsCount = document.getElementById('results-glass-count');
        const navPrev = document.getElementById('nav-glass-prev');
        const navNext = document.getElementById('nav-glass-next');
        const sortBtn = document.getElementById('sort-glass-btn');
        const sortIcon = document.getElementById('sort-glass-icon');

        if (sortBtn && sortIcon) {
        function updateSortIcon() {
            // Используем только символ ⇅
            sortIcon.textContent = '⇅';
            sortBtn.title = sortDescending ? 'Сортировать по убыванию' : 'Сортировать по возрастанию';
        }
        updateSortIcon();
        sortBtn.addEventListener('click', () => {
            sortDescending = !sortDescending;
            updateSortIcon();
            const min = parseInt(minInput.value) || config.defaultMin;
            const max = parseInt(maxInput.value) || config.defaultMax;
            highlightNumbers(min, max);
            updateRowsVisibility();
        });
        }

        // Скрываем плавающую кнопку при открытой панели
        document.getElementById(config.floatBtnId).style.opacity = '0.5';

        // Обработчики кнопок
        minimizeBtn.addEventListener('click', () => {
            isMinimized = !isMinimized;
            const glassBody = panel.querySelector('.glass-body');
            if (isMinimized) {
                panel.classList.add('minimized');
                minimizeBtn.textContent = '+';
            } else {
                panel.classList.remove('minimized');
                minimizeBtn.textContent = '−';
            }
            adjustPanelPosition();
        });

        closeBtn.addEventListener('click', () => {
            panel.remove();
            styleElement.remove();
            document.getElementById(config.floatBtnId).style.opacity = '1';
            stopContentObserver();
            window.removeEventListener('resize', adjustPanelPosition);

            // Удаляем все подсветки
            document.querySelectorAll(`.${config.highlightClass}`).forEach(el => {
                const parent = el.parentNode;
                parent.replaceChild(document.createTextNode(el.textContent), el);
                parent.normalize();
            });
        });

        refreshBtn.addEventListener('click', () => {
            const min = parseInt(minInput.value) || config.defaultMin;
            const max = parseInt(maxInput.value) || config.defaultMax;
            highlightNumbers(min, max);
            updateRowsVisibility();
        });

        navPrev.addEventListener('click', () => navigateToIndex('prev'));
        navNext.addEventListener('click', () => navigateToIndex('next'));

        // Перетаскивание панели
        let isDragging = false;
        let offsetX, offsetY;

        panel.querySelector('.glass-header').addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDragging = true;
            offsetX = e.clientX - panel.getBoundingClientRect().left;
            offsetY = e.clientY - panel.getBoundingClientRect().top;
            panel.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            panel.style.left = `${e.clientX - offsetX}px`;
            panel.style.top = `${e.clientY - offsetY}px`;
            panel.style.right = 'unset';
            panel.style.bottom = 'unset';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            panel.style.cursor = '';
            adjustPanelPosition();
        });

        const resizeHandle = panel.querySelector('.glass-resize-handle');

        // Изменение размера панели
        let isResizing = false;
        let startX, startY, startWidth, startHeight;

        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = parseInt(document.defaultView.getComputedStyle(panel).width, 10);
            startHeight = parseInt(document.defaultView.getComputedStyle(panel).height, 10);
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newWidth = Math.max(280, startWidth + (e.clientX - startX));
            const newHeight = Math.max(320, startHeight + (e.clientY - startY));
            panel.style.width = `${newWidth}px`;
            panel.style.height = `${newHeight}px`;
            // Не трогаем overflow и высоту results-glass
            adjustPanelPosition();
        });

        document.addEventListener('mouseup', () => {
            isResizing = false;
            adjustPanelPosition();
        });

        // Обработчик изменения размера окна
        window.addEventListener('resize', adjustPanelPosition);

        // --- Добавляем обработчики ресайза по всем краям ---
        function setupResizeHandles() {
            const panel = document.getElementById(config.panelId);
            let isResizing = false;
            let startX, startY, startWidth, startHeight, handleClass;

            function initResize(e) {
                isResizing = true;
                startX = e.clientX;
                startY = e.clientY;
                startWidth = parseInt(document.defaultView.getComputedStyle(panel).width, 10);
                startHeight = parseInt(document.defaultView.getComputedStyle(panel).height, 10);
                handleClass = Array.from(e.target.classList).find(cls => cls.startsWith('resize-handle-'));
                document.body.style.userSelect = 'none';
                e.preventDefault();
            }

            function doResize(e) {
                if (!isResizing) return;
                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;
                let newWidth = startWidth;
                let newHeight = startHeight;
                let newLeft = startLeft;
                let newTop = startTop;

                // Горизонтальные хендлы (левый/правый/углы)
                if (handleClass.includes('left')) {
                    newWidth = startWidth - deltaX;
                    newLeft = startLeft + (startWidth - newWidth);
                }
                if (handleClass.includes('right')) {
                    newWidth = startWidth + deltaX;
                }
                // Вертикальные хендлы (верх/низ/углы)
                if (handleClass.includes('top')) {
                    newHeight = startHeight - deltaY;
                    newTop = startTop + (startHeight - newHeight);
                }
                if (handleClass.includes('bottom')) {
                    newHeight = startHeight + deltaY;
                }

                // Ограничения по минимальным размерам
                newWidth = Math.max(280, newWidth);
                newHeight = Math.max(320, newHeight);

                panel.style.width = `${newWidth}px`;
                panel.style.height = `${newHeight}px`;
                panel.style.left = `${newLeft}px`;
                panel.style.top = `${newTop}px`;

                adjustPanelPosition();
            }

            function stopResize() {
                isResizing = false;
                document.body.style.userSelect = '';
            }

            const handles = panel.querySelectorAll('.resize-handle');
            handles.forEach(handle => {
                handle.addEventListener('mousedown', initResize);
            });
            document.addEventListener('mousemove', doResize);
            document.addEventListener('mouseup', stopResize);
        }
        setupResizeHandles();
    }

    function startContentObserver() {
        // Останавливаем предыдущий наблюдатель, если был
        stopContentObserver();

        const gamesContainer = document.querySelector('#search_resultsRows');
        if (!gamesContainer) return;

        observer = new MutationObserver((mutationsList) => {
            let contentChanged = false;
            for (const mutation of mutationsList) {
                // Проверяем только на добавление новых элементов
                if (mutation.type === 'childList' && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
                    contentChanged = true;
                    break;
                }
            }
            if (contentChanged) {
                // Проверяем, изменился ли HTML (можно убрать, если не нужно)
                if (gamesContainer.innerHTML !== lastContent) {
                    lastContent = gamesContainer.innerHTML;
                    // Фиксируем текущее состояние фильтров
                    const minInput = document.getElementById('min-glass-range');
                    const maxInput = document.getElementById('max-glass-range');
                    const min = parseInt(minInput.value) || config.defaultMin;
                    const max = parseInt(maxInput.value) || config.defaultMax;
                    // Обновляем поиск без задержки
                    highlightNumbers(min, max);
                }
            }
        });

        observer.observe(gamesContainer, {
            childList: true,
            subtree: true
        });
    }

    function stopContentObserver() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
    }

    // Функция для обновления подсветки
    function highlightNumbers(min, max) {
        // Удаляем предыдущие подсветки
        document.querySelectorAll(`.${config.highlightClass}`).forEach(el => {
            const parent = el.parentNode;
            parent.replaceChild(document.createTextNode(el.textContent), el);
            parent.normalize();
        });

        const resultsContainer = document.getElementById('results-glass');
        const resultsCount = document.getElementById('results-glass-count');

        if (resultsContainer) resultsContainer.innerHTML = '';
        if (resultsCount) resultsCount.textContent = '0';

        const allValues = [];
        const numberElements = [];
        highlightedElements = [];
        sortedValues = [];

        // Флаги настроек
        const excludeDates = document.getElementById('exclude-dates')?.checked !== false;
        const onlyPercent = document.getElementById('only-percent')?.checked === true;

        // Регулярные выражения для поиска
        const percentRegex = /[-−]?\d{1,3}%/g;
        const numberRegex = /\b\d{1,3}(?:[ ,]\d{3})+\b|\b\d{4,5}\b|\b\d{1,3}\b/g;

        // Корректный диапазон для процентов: пользователь вводит 10 и 95, а ищем от -95 до -10
        let percentMin = min, percentMax = max;
        if (onlyPercent) {
            const absMin = Math.abs(min);
            const absMax = Math.abs(max);
            percentMin = -Math.max(absMin, absMax);
            percentMax = -Math.min(absMin, absMax);
        }

        // 1. Сначала подсвечиваем скидки в discount_block (Steam-style)
        const rows = document.querySelectorAll('.search_result_row');
        rows.forEach(row => {
            const discountBlocks = row.querySelectorAll('.discount_block');
            discountBlocks.forEach(block => {
                if (onlyPercent) {
                    // Обработка только процентов
                    const pct = block.querySelector('.discount_pct');
                    if (pct) {
                        // Удаляем старую подсветку, если есть
                        const oldHighlight = pct.querySelector('.' + config.highlightClass);
                        if (oldHighlight) {
                            pct.textContent = oldHighlight.textContent;
                        }
                        // Проверяем, есть ли процент
                        const match = pct.textContent.match(/[-−]?\d{1,3}%/);
                        if (match) {
                            let numText = match[0].replace(/%/g, '').replace(/−/g, '-');
                            let num = parseInt(numText, 10);
                            let minVal = percentMin;
                            let maxVal = percentMax;
                            if (!isNaN(num) && num >= minVal && num <= maxVal && num >= -100 && num <= 100) {
                                pct.innerHTML = `<span class="${config.highlightClass}" data-value="${num}">${match[0]}</span>`;
                                allValues.push(num);
                                highlightedElements.push(pct.querySelector('.' + config.highlightClass));
                            }
                        }
                    }
                } else {
                    // Обработка только цен
                    const priceSelectors = ['.discount_original_price', '.discount_final_price'];
                    priceSelectors.forEach(sel => {
                        const priceEl = block.querySelector(sel);
                        if (priceEl) {
                            // Удаляем старую подсветку, если есть
                            const oldHighlight = priceEl.querySelector('.' + config.highlightClass);
                            if (oldHighlight) {
                                priceEl.textContent = oldHighlight.textContent;
                            }
                            // Ищем все числа с пробелами/запятыми
                            const priceText = priceEl.textContent;
                            // Регулярка для поиска чисел с пробелами и запятыми
                            const priceMatches = [...priceText.matchAll(/\d{1,3}(?:[ \u00A0]\d{3})*(?:[.,]\d{2})?|\d+/g)];
                            let offset = 0;
                            let fragments = [];
                            let found = false;
                            for (const match of priceMatches) {
                                let numStr = match[0].replace(/[ \u00A0]/g, '').replace(',', '.');
                                let num = parseFloat(numStr);
                                if (isNaN(num) || num < min || num > max) continue;
                                found = true;
                                // Добавляем текст до числа
                                if (match.index > offset) {
                                    fragments.push(document.createTextNode(priceText.slice(offset, match.index)));
                                }
                                // Подсветка
                                const span = document.createElement('span');
                                span.className = config.highlightClass;
                                span.textContent = match[0];
                                span.dataset.value = num;
                                fragments.push(span);
                                allValues.push(num);
                                highlightedElements.push(span);
                                offset = match.index + match[0].length;
                            }
                            if (found) {
                                // Добавляем оставшийся текст
                                if (offset < priceText.length) {
                                    fragments.push(document.createTextNode(priceText.slice(offset)));
                                }
                                // Заменяем содержимое priceEl на новые фрагменты
                                priceEl.innerHTML = '';
                                fragments.forEach(frag => priceEl.appendChild(frag));
                            }
                        }
                    });
                }
            });
        });

        // 2. Старый механизм: ищем числа по всему контейнеру, но пропускаем .discount_block (чтобы не было дублей)
        function scanNodes(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                // Пропускаем блоки с датами и названиями игр
                if (
                    node.classList?.contains('search_released') ||
                    node.classList?.contains('search_name') ||
                    node.classList?.contains('title')
                ) return;
                // Пропускаем .discount_block и все его потомки
                if (node.classList && node.classList.contains('discount_block')) return;
                for (const child of node.childNodes) {
                    scanNodes(child);
                }
            } else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                const text = node.textContent;
                let match;

                if (onlyPercent) {
                    while ((match = percentRegex.exec(text)) !== null) {
                        let numText = match[0].replace(/%/g, '').replace(/−/g, '-');
                        let num = parseInt(numText, 10);
                        if (isNaN(num)) continue;
                        if (num < percentMin || num > percentMax) continue;
                        if (num < -100 || num > 100) continue;
                        if (excludeDates) {
                            const context = node.parentNode.textContent.toLowerCase();
                            if (context.includes('date') || context.includes('дата') || context.match(/\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/)) {
                                continue;
                            }
                        }
                        allValues.push(num);
                        numberElements.push({
                            node: node,
                            start: match.index,
                            end: match.index + match[0].length,
                            original: match[0],
                            value: num,
                            isPercent: true
                        });
                    }
                } else {
                    while ((match = numberRegex.exec(text)) !== null) {
                        const afterChar = text[match.index + match[0].length] || '';
                        if (afterChar === '%') continue;
                        if (/[-−]?\d{1,3}%/.test(match[0])) continue;
                        let rawValue = match[0];
                        let numText = rawValue.replace(/[ ,]/g, '');
                        let num = parseInt(numText, 10);
                        if (isNaN(num)) continue;
                        if (num < min || num > max) continue;
                        if (excludeDates) {
                            const context = node.parentNode.textContent.toLowerCase();
                            if (context.includes('date') || context.includes('дата') || context.match(/\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/)) {
                                continue;
                            }
                        }
                        allValues.push(num);
                        numberElements.push({
                            node: node,
                            start: match.index,
                            end: match.index + match[0].length,
                            original: match[0],
                            value: num,
                            isPercent: false
                        });
                    }
                }
            }
        }

        const gamesContainer = document.querySelector('#search_resultsRows');
        if (gamesContainer) {
            // Сканируем только ценовые элементы вне discount_block (для надёжности)
            const priceElements = gamesContainer.querySelectorAll(
                '.discount_original_price, .discount_final_price, .discount_pct'
            );
            priceElements.forEach(el => {
                // Пропускаем, если уже подсвечено
                if (el.querySelector('.' + config.highlightClass)) return;
                // Для процентов скидки
                if (el.classList.contains('discount_pct')) {
                    const match = el.textContent.match(/[-−]?\d{1,3}%/);
                    if (match) {
                        let numText = match[0].replace(/%/g, '').replace(/−/g, '-');
                        let num = parseInt(numText, 10);
                        let minVal = onlyPercent ? percentMin : min;
                        let maxVal = onlyPercent ? percentMax : max;
                        if (!isNaN(num) && num >= minVal && num <= maxVal && num >= -100 && num <= 100) {
                            el.innerHTML = `<span class="${config.highlightClass}" data-value="${num}">${match[0]}</span>`;
                            allValues.push(num);
                            highlightedElements.push(el.querySelector('.' + config.highlightClass));
                        }
                    }
                } else {
                    // Для цен
                    const priceText = el.textContent;
                    const priceMatches = [...priceText.matchAll(/\d{1,3}(?:[ \u00A0]\d{3})*(?:[.,]\d{2})?|\d+/g)];
                    let offset = 0;
                    let fragments = [];
                    let found = false;
                    for (const match of priceMatches) {
                        let numStr = match[0].replace(/[ \u00A0]/g, '').replace(',', '.');
                        let num = parseFloat(numStr);
                        if (isNaN(num) || num < min || num > max) continue;
                        found = true;
                        if (match.index > offset) {
                            fragments.push(document.createTextNode(priceText.slice(offset, match.index)));
                        }
                        const span = document.createElement('span');
                        span.className = config.highlightClass;
                        span.textContent = match[0];
                        span.dataset.value = num;
                        fragments.push(span);
                        allValues.push(num);
                        highlightedElements.push(span);
                        offset = match.index + match[0].length;
                    }
                    if (found) {
                        if (offset < priceText.length) {
                            fragments.push(document.createTextNode(priceText.slice(offset)));
                        }
                        el.innerHTML = '';
                        fragments.forEach(frag => el.appendChild(frag));
                    }
                }
            });
        } else {
            scanNodes(document.body);
        }

        numberElements.reverse().forEach(item => {
            const { node, start, end, original, value } = item;
            if (!node.parentNode) return;
            const beforeText = node.textContent.substring(0, start);
            const afterText = node.textContent.substring(end);
            const beforeNode = document.createTextNode(beforeText);
            const highlightNode = document.createElement('span');
            highlightNode.className = config.highlightClass;
            highlightNode.textContent = original;
            highlightNode.dataset.value = value;
            const afterNode = document.createTextNode(afterText);
            const parent = node.parentNode;
            const fragment = document.createDocumentFragment();
            if (beforeText) fragment.appendChild(beforeNode);
            fragment.appendChild(highlightNode);
            if (afterText) fragment.appendChild(afterNode);
            parent.replaceChild(fragment, node);
            highlightedElements.push(highlightNode);
        });

        // Сортируем элементы по их порядку в DOM (чтобы навигация и индексы были корректны)
        highlightedElements = Array.from(document.querySelectorAll('.' + config.highlightClass));
        sortedValues = highlightedElements.map(el => parseInt(el.dataset.value));
        if (resultsCount) resultsCount.textContent = allValues.length;
        if (resultsContainer && allValues.length > 0) {
            // Группируем значения
            const valueGroups = {};
            let valueToIndexes = {};
            highlightedElements.forEach((el, idx) => {
                const value = parseInt(el.dataset.value);
                if (!valueGroups[value]) {
                    valueGroups[value] = [];
                    valueToIndexes[value] = [];
                }
                valueGroups[value].push(value);
                valueToIndexes[value].push(idx);
            });

            // Сортируем группы по значению
            let sortedGroups = Object.keys(valueGroups)
                .map(Number)
                .sort((a, b) => sortDescending ? b - a : a - b);

            // Создаем элементы групп
            sortedGroups.forEach(value => {
                const group = document.createElement('div');
                group.className = 'result-group';

                const count = valueGroups[value].length;
                const groupHeader = document.createElement('div');
                groupHeader.className = 'group-header';
                groupHeader.innerHTML = `
                    <span>${value}${onlyPercent ? '%' : ''}</span>
                    <span>(${count})</span>
                `;

                const groupItems = document.createElement('div');
                groupItems.className = 'group-items expanded'; // Всегда открыты по умолчанию

                // Контейнер для двухколоночной сетки элементов
                const groupItemsGrid = document.createElement('div');
                groupItemsGrid.className = 'group-items-grid';

            // Получаем все индексы элементов с этим value (по порядку в highlightedElements),
            // и для каждого уникального DOM-элемента создаём отдельный пункт
            const groupEls = highlightedElements.filter(el => parseInt(el.dataset.value) === value);
            groupEls.forEach((el, itemIndex) => {
                const item = document.createElement('div');
                item.className = 'group-item';
                item.textContent = `${itemIndex + 1}. ${value}${onlyPercent ? '%' : ''}`;
                item.dataset.value = value;
                // Привязываем к реальному индексу в highlightedElements
                item.dataset.absindex = highlightedElements.indexOf(el);

                item.addEventListener('click', (e) => {
                    // Снимаем выделение со всех group-item
                    const resultsContainer = document.getElementById('results-glass');
                    if (resultsContainer) {
                        resultsContainer.querySelectorAll('.group-item').forEach(i => i.classList.remove('active'));
                    }
                    // Выделяем только текущий
                    item.classList.add('active');
                    // Навигация и подсветка
                    const absIdx = parseInt(item.dataset.absindex);
                    if (!isNaN(absIdx)) {
                        currentIndex = absIdx;
                        highlightActiveElement();
                    }
                    e.stopPropagation(); // Не даём всплывать клику на groupHeader
                });

                groupItemsGrid.appendChild(item);
            });

                groupItems.appendChild(groupItemsGrid);
                group.appendChild(groupHeader);
                group.appendChild(groupItems);
                resultsContainer.appendChild(group);

                groupHeader.addEventListener('click', (e) => {
                    // Переход к первому элементу группы
                    const idxInAll = allIndexes[0];
                    if (typeof idxInAll === 'number') {
                        currentIndex = idxInAll;
                        highlightActiveElement();
                    }
                });
            });
        } else if (resultsContainer && allValues.length === 0) {
            resultsContainer.innerHTML = "<div class='no-results'>Числа в диапазоне не найдены</div>";
        }

        // Сбрасываем индекс навигации
        currentIndex = -1;
    }

    // Функция подсветки активного элемента
    function highlightActiveElement() {
        if (currentIndex < 0 || currentIndex >= highlightedElements.length) return;

        const element = highlightedElements[currentIndex];
        // Удаляем активный класс у всех элементов
        document.querySelectorAll(`.${config.highlightClass}`).forEach(el => {
            el.classList.remove(config.activeClass);
        });
        // Добавляем активный класс к целевому элементу
        element.classList.add(config.activeClass);
        // Прокручиваем страницу к элементу
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Подсвечиваем активный элемент в списке
        const resultsContainer = document.getElementById('results-glass');
        if (resultsContainer) {
            // Сбрасываем активность у всех элементов
            resultsContainer.querySelectorAll('.group-item').forEach(item => {
                item.classList.remove('active');
            });
            // Находим и активируем соответствующий элемент по абсолютному индексу
            const allItems = resultsContainer.querySelectorAll('.group-item');
            for (const item of allItems) {
                if (parseInt(item.dataset.absindex) === currentIndex) {
                    item.classList.add('active');
                    break;
                }
            }
        }
    }

    // Функция навигации по индексу
    function navigateToIndex(direction) {
        if (highlightedElements.length === 0) return;

        if (direction === 'prev') {
            currentIndex = currentIndex <= 0 ? highlightedElements.length - 1 : currentIndex - 1;
        } else {
            currentIndex = currentIndex >= highlightedElements.length - 1 ? 0 : currentIndex + 1;
        }

        highlightActiveElement();
    }

    function updateRowsVisibility() {
        const hide = document.getElementById('hide-non-matching')?.checked;
        const rows = document.querySelectorAll('.search_result_row');
        rows.forEach(row => {
            if (!hide) {
                row.style.display = '';
                return;
            }
            // Скрываем, если внутри .search_result_row НЕТ хотя бы одного .discount-highlight
            let hasHighlight = false;
            // Проверяем только прямых потомков discount_block (Steam структура)
            const discountBlocks = row.querySelectorAll('.discount_block');
            discountBlocks.forEach(block => {
                if (block.querySelector('span.' + config.highlightClass)) {
                    hasHighlight = true;
                }
            });
            if (hasHighlight) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }

    // Вызовем updateRowsVisibility после highlightNumbers
    const origHighlightNumbers = highlightNumbers;
    highlightNumbers = function(min, max) {
        origHighlightNumbers(min, max);
        updateRowsVisibility();
    };

    // Панель не открывается автоматически, только по клику на кнопку
})();
