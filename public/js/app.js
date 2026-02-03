/**
 * ПРИЛОЖЕНИЕ: ВИЗУАЛЬНАЯ СИМУЛЯЦИЯ
 * Этот файл отвечает ТОЛЬКО за внешний вид и поведение интерфейса.
 */

// --- АВТОРИЗАЦИЯ И КОНТЕКСТ ---
let currentUser = null;

function checkAuth() {
    const userStr = localStorage.getItem('currentUser');
    if (!userStr) {
        // ДЛЯ ДЕМО: Если мы на Render, просто создаем демо-пользователя, чтобы не мучать менеджеров входом
        if (window.location.hostname.includes('render') || window.location.hostname.includes('localhost')) {
            currentUser = { id: 7751419, name: 'Demo Manager', extension: '101', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Demo' };
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            console.log('Demo auto-login successful');
            // Если мы уже на /login.html, перекидываем на главную
            if (window.location.pathname.includes('login.html')) {
                window.location.href = '/';
            }
        } else {
            if (!window.location.pathname.includes('login.html')) {
                window.location.href = '/login.html';
            }
            return;
        }
    } else {
        currentUser = JSON.parse(userStr);
    }
    console.log('Logged in as:', currentUser.name);
    updateUserSettings();
}

function logout() {
    localStorage.removeItem('currentUser');
    window.location.href = '/login.html';
}

function updateUserSettings() {
    // Автозаполнение настроек
    const extInput = document.querySelector('#tab-settings input[type="text"]');
    if (extInput && currentUser) extInput.value = currentUser.extension;
}

// Запускаем проверку сразу
checkAuth();

// --- БАЗА ДАННЫХ ДЛЯ ПОИСКА (Демо-данные) ---
const leadPool = [
    {
        id: 1, contactName: 'Арман Сериков', phone: '+7 701 111 22 33', price: '450 000', created_at: 1706745600,
        status: 'pending', pipeline: 'Продажи', stage: 'Первичный контакт', responsible_user_id: 100,
        calls: [
            { date: '01.02.2024 14:20', status: 'success', duration: '02:15' },
            { date: '30.01.2024 10:05', status: 'no-answer', duration: '00:00' }
        ]
    },
    {
        id: 2, contactName: 'Donna Greene', phone: '+1 202 555 0123', price: '268', created_at: 1675814400,
        status: 'pending', pipeline: 'Продажи', stage: 'Переговоры', responsible_user_id: 200,
        calls: [
            { date: '08.02.2023 11:30', status: 'success', duration: '05:40' }
        ]
    },
    {
        id: 3, contactName: 'Берик Ахметов', phone: '+7 777 333 44 55', price: '120 000', created_at: Math.floor(Date.now() / 1000) - 86400,
        status: 'pending', pipeline: 'Холодный обзвон', stage: 'Первичный контакт', responsible_user_id: 100,
        calls: [
            { date: 'Вчера 16:45', status: 'busy', duration: '00:00' }
        ]
    }
];

// --- НАВИГАЦИЯ ---
window.switchTab = function (tabName) {
    const tabs = ['dialer', 'stats', 'history', 'settings'];
    tabs.forEach(t => {
        const el = document.getElementById(`tab-${t}`);
        if (el) el.classList.add('hidden');
        const nav = document.getElementById(`nav-${t}`);
        if (nav) nav.classList.remove('active');
    });
    const targetTab = document.getElementById(`tab-${tabName}`);
    if (targetTab) {
        targetTab.classList.remove('hidden');
        if (tabName === 'dialer') targetTab.classList.add('grid');
        else targetTab.classList.remove('grid');
    }
    const activeNav = document.getElementById(`nav-${tabName}`);
    if (activeNav) activeNav.classList.add('active');
}

let filteredResults = [];
let queue = [];
let completed = [];
let isSimulating = false;
let isPaused = false;
let callTimerInterval;
let shiftTimerInterval;
let callSeconds = 0;
let shiftSeconds = 0;
let currentSort = 'newest';
let currentDisplayedLead = null;
let amocrmPipelines = [];

// --- ИНИЦИАЛИЗАЦИЯ ---
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Сначала привязываем события к кнопкам (чтобы всё кликалось сразу)
    const startBtn = document.getElementById('startBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const stopBtn = document.getElementById('stopBtn');
    const filterBtn = document.getElementById('filterToggleBtn');
    const searchInput = document.getElementById('searchInput');
    const filterPanel = document.getElementById('filterPanel');
    const suggestions = document.getElementById('searchSuggestions');
    const addBtn = document.getElementById('addToQueueFromDetails');
    const sortBtn = document.getElementById('sortBtnAction');
    const sortMenu = document.getElementById('sortMenu');

    if (startBtn) startBtn.onclick = () => isPaused ? resumeSimulation() : startSimulation();
    if (pauseBtn) pauseBtn.onclick = () => pauseSimulation();
    if (stopBtn) stopBtn.onclick = () => stopSimulation();

    // КЛИК ПО ПОИСКУ ОТКРЫВАЕТ ФИЛЬТРЫ
    if (searchInput && filterPanel) {
        searchInput.onclick = (e) => {
            e.stopPropagation();
            filterPanel.classList.toggle('hidden');
            suggestions.classList.add('hidden');
        };
        searchInput.oninput = (e) => handleLiveSearch(e.target.value);
        searchInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                applyFilters();
                suggestions.classList.add('hidden');
            }
        };
    }

    if (filterBtn && filterPanel) {
        filterBtn.onclick = (e) => {
            e.stopPropagation();
            filterPanel.classList.toggle('hidden');
            suggestions.classList.add('hidden');
        };
        document.addEventListener('click', (e) => {
            if (!filterPanel.contains(e.target) && !filterBtn.contains(e.target) && !searchInput.contains(e.target)) {
                filterPanel.classList.add('hidden');
            }
            if (!suggestions.contains(e.target) && !searchInput.contains(e.target)) {
                suggestions.classList.add('hidden');
            }
        });
    }

    if (addBtn) {
        addBtn.onclick = () => {
            if (currentDisplayedLead) {
                if (!queue.find(q => q.id === currentDisplayedLead.id)) {
                    queue.unshift({ ...currentDisplayedLead, status: 'pending' });
                    renderQueue();
                    alert('Сделка добавлена в вашу очередь');
                } else {
                    alert('Эта сделка уже есть в очереди');
                }
            }
        };
    }

    if (sortBtn && sortMenu) {
        sortBtn.onclick = (e) => {
            e.stopPropagation();
            sortMenu.classList.toggle('hidden');
        };
        document.addEventListener('click', () => sortMenu.classList.add('hidden'));
    }

    // 2. Только теперь делаем запросы и рендерим данные
    if (!currentUser) return;

    loadAmoPipelines().then(() => console.log('Pipelines & Users loaded'));

    // ПРОВЕРКА: Если есть сохраненная очередь в localStorage, загружаем её
    const savedQueue = localStorage.getItem(`queue_${currentUser.id}`);
    if (savedQueue) {
        queue = JSON.parse(savedQueue);
    }

    applySorting();
    renderQueue();

    if (queue.length > 0) showLeadDetails(queue[0]);
});

// --- API ЗАГРУЗКА ---
async function loadAmoPipelines() {
    try {
        // Загружаем воронки
        const resP = await fetch('/api/amocrm/pipelines');
        if (resP.ok) {
            amocrmPipelines = await resP.json();
            const pSelect = document.getElementById('filterPipeline');
            if (pSelect) {
                pSelect.innerHTML = '<option value="all">Все воронки</option>';
                amocrmPipelines.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.innerText = p.name;
                    pSelect.appendChild(opt);
                });
                pSelect.onchange = (e) => updateStageFilters(e.target.value);
            }
        }

        // Загружаем пользователей (для фильтра менеджера)
        const resU = await fetch('/api/users');
        if (resU.ok) {
            const users = await resU.json();
            const uSelect = document.getElementById('filterManager');
            if (uSelect) {
                uSelect.innerHTML = '<option value="all">Все пользователи</option>';
                users.forEach(u => {
                    const opt = document.createElement('option');
                    opt.value = u.id;
                    opt.innerText = u.name;
                    uSelect.appendChild(opt);
                });
                // По умолчанию выбираем текущего менеджера
                if (currentUser) {
                    uSelect.value = currentUser.id;
                }
            }
        }
    } catch (e) {
        console.error('Initial load error:', e);
    }
}

function updateStageFilters(pipelineId) {
    const sSelect = document.getElementById('filterStage');
    if (!sSelect) return;
    sSelect.innerHTML = '<option value="all">Все этапы</option>';
    if (pipelineId === 'all') return;
    const pipeline = amocrmPipelines.find(p => p.id == pipelineId);
    if (pipeline && pipeline._embedded && pipeline._embedded.statuses) {
        pipeline._embedded.statuses.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.innerText = s.name;
            sSelect.appendChild(opt);
        });
    }
}

const formatDate = (timestamp) => {
    if (!timestamp || timestamp === 0) return '—';
    // AmoCRM использует секунды (10 знаков), JS использует миллисекунды (13 знаков)
    const ts = timestamp > 10000000000 ? timestamp : timestamp * 1000;
    const date = new Date(ts);

    if (isNaN(date.getTime()) || date.getFullYear() <= 1970) return '—';

    return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
};

async function showLeadDetails(lead) {
    if (!lead) return;

    // Если это реальная сделка и у нас нет полных данных (полей/тегов) — подтягиваем их
    if (lead.id && lead.id > 10 && (!lead.custom_fields_values || lead.custom_fields_values.length === 0)) {
        try {
            const res = await fetch(`/api/amocrm/leads/${lead.id}`);
            if (res.ok) {
                const fullLead = await res.json();
                // Обогащаем текущий объект данными
                Object.assign(lead, fullLead);
            }
        } catch (e) {
            console.error('Failed to enrich lead data:', e);
        }
    }

    currentDisplayedLead = lead;
    document.getElementById('mainName').innerText = lead.contactName || lead.name || 'Без имени';
    document.getElementById('mainAvatar').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(lead.contactName || 'Lead')}`;

    // Пытаемся взять сырой timestamp и форматируем его
    const rawTs = lead.created_at || lead.createdAt || lead.timestamp;
    const displayDate = formatDate(rawTs);
    document.getElementById('mainDate').innerText = displayDate;

    document.getElementById('mainPipeline').innerText = lead.pipeline || '—';
    document.getElementById('mainPrice').innerText = `₸ ${lead.price || 0}`;
    document.getElementById('mainPhone').innerText = lead.phone || 'Нет телефона';
    document.getElementById('mainStage').innerText = lead.stage || '—';

    // Ссылка на AmoCRM
    const amoLinkContainer = document.getElementById('amoLinkContainer');
    if (amoLinkContainer) {
        if (lead.id && lead.id > 10) {
            amoLinkContainer.innerHTML = `
                <a href="${lead.link || '#'}" target="_blank" class="flex items-center gap-2 px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black uppercase hover:bg-teal-50/20 hover:text-teal-600 transition-all">
                    <i class="fa-solid fa-external-link text-[10px]"></i>
                    Открыть в AMO
                </a>
            `;
        } else {
            amoLinkContainer.innerHTML = '';
        }
    }

    renderCallHistory(lead);
}

function renderCallHistory(lead) {
    const container = document.getElementById('callHistoryContainer');
    if (!container) return;
    container.innerHTML = '';
    if (!lead.calls || lead.calls.length === 0) {
        container.innerHTML = `<div class="p-8 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">Звонков еще не было</div>`;
        return;
    }
    lead.calls.forEach(call => {
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-2xl group hover:border-teal-500/30 transition-all";
        let statusIcon = '<i class="fa-solid fa-phone-slash text-red-400"></i>';
        let statusText = 'Не отвечен';
        let statusClass = 'text-red-500';
        if (call.status === 'success') {
            statusIcon = '<i class="fa-solid fa-phone-flip text-teal-400"></i>';
            statusText = 'Успешно';
            statusClass = 'text-teal-600';
        } else if (call.status === 'busy') {
            statusIcon = '<i class="fa-solid fa-phone-xmark text-amber-400"></i>';
            statusText = 'Занято';
            statusClass = 'text-amber-600';
        }
        div.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="w-10 h-10 rounded-xl bg-white border border-slate-100 flex items-center justify-center">${statusIcon}</div>
                <div>
                    <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">${call.date}</p>
                    <p class="text-sm font-bold ${statusClass}">${statusText}</p>
                </div>
            </div>
            <div class="text-right">
                <p class="text-[10px] font-bold text-slate-300 uppercase leading-none mb-1">Длительность</p>
                <p class="text-sm font-black text-slate-700">${call.duration}</p>
            </div>
        `;
        container.appendChild(div);
    });
}

function handleLiveSearch(query) {
    const suggestions = document.getElementById('searchSuggestions');
    const content = document.getElementById('suggestionsContent');
    if (!query || query.length < 1) {
        suggestions.classList.add('hidden');
        return;
    }
    suggestions.classList.remove('hidden');
    content.innerHTML = '';
    const cleanQuery = query.toLowerCase().replace(/\+/g, '').replace(/\s/g, '');
    const dealMatches = leadPool.filter(l => (l.contactName || '').toLowerCase().includes(query.toLowerCase()));
    const phoneMatches = leadPool.filter(l => (l.phone || '').replace(/\+/g, '').replace(/\s/g, '').includes(cleanQuery));

    if (dealMatches.length > 0) renderSection(content, 'СДЕЛКИ', dealMatches);
    if (phoneMatches.length > 0) {
        const uniquePhoneMatches = phoneMatches.filter(pm => !dealMatches.find(dm => dm.id === pm.id));
        if (uniquePhoneMatches.length > 0) renderSection(content, 'КОНТАКТЫ', uniquePhoneMatches, true);
    }
    if (dealMatches.length === 0 && phoneMatches.length === 0) {
        content.innerHTML = `<div class="p-8 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">Ничего не найдено</div>`;
    }
}

function renderSection(content, title, items, isPhone = false) {
    const header = document.createElement('div');
    header.className = "bg-slate-50/50 px-4 py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100";
    header.innerText = title;
    content.appendChild(header);
    items.forEach(item => {
        const row = document.createElement('div');
        row.className = "group px-4 py-3 hover:bg-teal-50/50 cursor-pointer border-b border-slate-50 last:border-0 transition-colors";
        row.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(item.contactName)}" class="w-8 h-8 rounded-lg bg-slate-100">
                    <div>
                        <p class="text-sm font-bold text-slate-800 group-hover:text-teal-600 transition-colors">${item.contactName}</p>
                        <p class="text-[11px] text-slate-400 font-medium">${isPhone ? item.phone : item.pipeline}</p>
                    </div>
                </div>
                <div class="text-right">
                    <p class="text-[10px] font-bold text-slate-400 uppercase">${item.stage}</p>
                    <p class="text-xs font-black text-slate-700 mt-0.5">₸ ${item.price}</p>
                </div>
            </div>
        `;
        row.onclick = () => selectLeadFromSearch(item);
        content.appendChild(row);
    });
}

function selectLeadFromSearch(lead) {
    document.getElementById('searchSuggestions').classList.add('hidden');
    document.getElementById('searchInput').value = lead.contactName;
    showLeadDetails(lead);
    document.getElementById('searchResultsView').classList.add('hidden');
    document.getElementById('customerDetailsView').classList.remove('hidden');
    document.getElementById('callHistoryView').classList.remove('hidden');
}

window.removeFromQueue = function (id) {
    queue = queue.filter(q => q.id !== id);
    renderQueue();
}

window.clearQueue = function () {
    if (queue.length === 0) return;
    if (confirm('Очистить всю очередь?')) {
        queue = [];
        renderQueue();
    }
}

function parsePrice(priceStr) {
    if (!priceStr) return 0;
    return parseInt(priceStr.toString().replace(/\s/g, '')) || 0;
}

function formatPrice(num) {
    return '₸ ' + num.toLocaleString('ru-RU');
}

function updateSearchSummary() {
    const totalCountEl = document.getElementById('totalFoundCount');
    const totalBudgetEl = document.getElementById('totalFoundBudget');
    const selectedCountEl = document.getElementById('selectedCount');
    const selectedBudgetEl = document.getElementById('selectedBudget');
    if (!totalCountEl) return;
    const totalFound = filteredResults.length;
    const totalBudget = filteredResults.reduce((sum, lead) => sum + parsePrice(lead.price), 0);
    totalCountEl.innerText = totalFound;
    totalBudgetEl.innerText = formatPrice(totalBudget);
    const checkboxes = document.querySelectorAll('.lead-checkbox:checked');
    const selectedCount = checkboxes.length;
    let selectedBudget = 0;
    checkboxes.forEach(cb => {
        const lead = filteredResults.find(l => l.id == cb.value);
        if (lead) selectedBudget += parsePrice(lead.price);
    });
    selectedCountEl.innerText = selectedCount;
    selectedBudgetEl.innerText = formatPrice(selectedBudget);
}

window.changeSort = function (type) {
    currentSort = type;
    applySorting();
    renderQueue();
}

function applySorting() {
    queue.sort((a, b) => currentSort === 'newest' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp);
}

window.resetFilters = function () {
    document.getElementById('filterPanel').classList.add('hidden');
    document.getElementById('searchSuggestions').classList.add('hidden');
    document.getElementById('filterPipeline').value = 'all';
    document.getElementById('filterStage').value = 'all';
    document.getElementById('filterManager').value = currentUser ? currentUser.id : 'all';

    const input = document.getElementById('searchInput');
    input.placeholder = "Поиск сделок...";
    input.value = "";
    input.classList.remove('text-teal-600', 'font-bold');

    document.getElementById('searchResultsView').classList.add('hidden');
    document.getElementById('customerDetailsView').classList.remove('hidden');
    document.getElementById('callHistoryView').classList.remove('hidden');
}

window.applyFilters = async function () {
    const pipelineId = document.getElementById('filterPipeline').value;
    const stageId = document.getElementById('filterStage').value;
    const managerId = document.getElementById('filterManager').value;
    const term = document.getElementById('searchInput').value.toLowerCase();
    const tbody = document.getElementById('searchResultsTableBody');

    // Показываем лоадер в кнопке или таблице
    tbody.innerHTML = '<tr><td colspan="4" class="p-10 text-center text-teal-600 font-bold"><i class="fa-solid fa-spinner fa-spin mr-2"></i>ЗАГРУЗКА ДАННЫХ...</td></tr>';

    try {
        let url = `/api/amocrm/leads?limit=250`;
        if (pipelineId !== 'all') url += `&pipeline_id=${pipelineId}`;
        if (stageId !== 'all') url += `&status_id=${stageId}`;
        if (managerId !== 'all') url += `&user_id=${managerId}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error('API Error');
        const realLeads = await res.json();

        filteredResults = realLeads.map(lead => {
            let stageName = 'Неизвестно';
            let pipelineName = '—';
            amocrmPipelines.forEach(p => {
                const status = p._embedded?.statuses?.find(s => s.id == lead.status_id);
                if (status) {
                    stageName = status.name;
                    pipelineName = p.name;
                }
            });

            // Используем timestamp AmoCRM
            const createdTimestamp = (lead.created_at || lead.createdAt || 0);

            return {
                ...lead,
                contactName: lead.contactName || lead.name || 'Без названия',
                phone: lead.phone || 'Нет телефона',
                stage: stageName,
                pipeline: pipelineName,
                price: lead.price || 0,
                timestamp: createdTimestamp,
                date: formatDate(createdTimestamp)
            };
        });

        // Обновляем текст в поиске (breadcrumbs)
        const input = document.getElementById('searchInput');
        let filterLabels = [];

        if (pipelineId !== 'all') {
            const p = amocrmPipelines.find(p => p.id == pipelineId);
            if (p) filterLabels.push(p.name);
        }
        if (stageId !== 'all') {
            const p = amocrmPipelines.find(p => p.id == pipelineId);
            const s = p?._embedded?.statuses?.find(s => s.id == stageId);
            if (s) filterLabels.push(s.name);
        }

        if (filterLabels.length > 0) {
            input.value = filterLabels.join(' > ');
            input.classList.add('text-teal-600', 'font-bold');
        }

        document.getElementById('filterPanel').classList.add('hidden');
        document.getElementById('searchSuggestions').classList.add('hidden');
        document.getElementById('customerDetailsView').classList.add('hidden');
        document.getElementById('callHistoryView').classList.add('hidden');
        document.getElementById('searchResultsView').classList.remove('hidden');

        renderSearchResults();
        updateSearchSummary();
    } catch (e) {
        console.error('Apply filters error:', e);
        tbody.innerHTML = '<tr><td colspan="4" class="p-10 text-center text-red-500 font-bold">Ошибка: Проверьте соединение</td></tr>';
    }
}

function renderSearchResults() {
    const tbody = document.getElementById('searchResultsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (filteredResults.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-10 text-center text-slate-400 font-medium">Сделок не найдено</td></tr>`;
        return;
    }
    filteredResults.forEach(lead => {
        const tr = document.createElement('tr');
        tr.className = "group border-b border-slate-50 hover:bg-slate-50/50 transition-colors cursor-pointer";
        tr.innerHTML = `
            <td class="p-4 pl-6">
                <div class="flex items-center gap-3">
                    <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(lead.contactName)}" class="w-8 h-8 rounded-lg bg-slate-100">
                    <div>
                        <p class="text-sm font-bold text-slate-800">${lead.contactName}</p>
                        <div class="flex items-center gap-2">
                            <p class="text-[10px] text-slate-400 font-medium">${lead.phone}</p>
                            <span class="text-[8px] text-slate-300">•</span>
                            <p class="text-[10px] text-slate-400 font-medium">${lead.date || '—'}</p>
                        </div>
                    </div>
                </div>
            </td>
            <td class="p-4">
                <span class="text-[10px] font-bold px-2 py-0.5 bg-teal-50 text-teal-600 rounded-lg border border-teal-100 uppercase">${lead.stage}</span>
            </td>
            <td class="p-4 text-sm font-bold text-slate-700">₸ ${lead.price}</td>
            <td class="p-4 text-center">
                <input type="checkbox" value="${lead.id}" class="lead-checkbox w-5 h-5 rounded-lg text-teal-500 focus:ring-teal-500 border-slate-200 cursor-pointer">
            </td>
        `;
        tr.onclick = (e) => {
            if (e.target.type !== 'checkbox') {
                const cb = tr.querySelector('input');
                cb.checked = !cb.checked;
            }
            updateSearchSummary();
        };
        tbody.appendChild(tr);
    });
}

window.selectAllLeads = function () {
    const checkboxes = document.querySelectorAll('.lead-checkbox');
    const anyUnchecked = Array.from(checkboxes).some(cb => !cb.checked);
    checkboxes.forEach(cb => cb.checked = anyUnchecked);
    updateSearchSummary();
}

window.addSelectedToQueue = function () {
    const selectedIds = Array.from(document.querySelectorAll('.lead-checkbox:checked')).map(cb => parseInt(cb.value));
    if (selectedIds.length === 0) {
        alert('Выберите хотя бы одну сделку!');
        return;
    }
    const selectedLeads = filteredResults.filter(l => selectedIds.includes(l.id));
    selectedLeads.forEach(sl => {
        if (!queue.find(q => q.id === sl.id)) {
            queue.unshift({ ...sl, status: 'pending' });
        }
    });

    // Сохраняем в локалсторадж
    if (currentUser) {
        localStorage.setItem(`queue_${currentUser.id}`, JSON.stringify(queue));
    }

    applySorting();
    renderQueue();
    resetFilters();
}

window.removeFromQueue = function (id) {
    queue = queue.filter(q => q.id !== id);
    if (currentUser) {
        localStorage.setItem(`queue_${currentUser.id}`, JSON.stringify(queue));
    }
    renderQueue();
}

window.clearQueue = function () {
    if (queue.length === 0) return;
    if (confirm('Очистить всю очередь?')) {
        queue = [];
        if (currentUser) {
            localStorage.removeItem(`queue_${currentUser.id}`);
        }
        renderQueue();
    }
}

function updateShiftTimer() {
    shiftSeconds++;
    const h = Math.floor(shiftSeconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((shiftSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (shiftSeconds % 60).toString().padStart(2, '0');
    const timerEl = document.getElementById('topTimer');
    if (timerEl) timerEl.innerText = `${h}:${m}:${s}`;
}

function renderQueue() {
    const container = document.getElementById('queueContainer');
    const counter = document.getElementById('queueCounter');
    const queueBudgetEl = document.getElementById('queueTotalBudget');
    if (!container) return;
    container.innerHTML = '';

    const sortedList = [...queue].sort((a, b) => {
        const priority = { 'dialing': 0, 'pending': 1, 'talked': 2, 'no-answer': 2 };
        if (priority[a.status] !== priority[b.status]) return priority[a.status] - priority[b.status];
        return b.timestamp - a.timestamp;
    });

    const pendingCount = queue.filter(l => l.status === 'pending' || l.status === 'dialing').length;
    counter.innerText = pendingCount;
    const totalBudget = queue.filter(l => l.status === 'pending' || l.status === 'dialing').reduce((sum, lead) => sum + parsePrice(lead.price), 0);
    if (queueBudgetEl) queueBudgetEl.innerText = formatPrice(totalBudget);

    sortedList.forEach(lead => {
        const div = document.createElement('div');
        let classes = "card group cursor-pointer transition-all duration-300 w-full relative ";
        if (lead.status === 'dialing') classes += "border-amber-400 bg-amber-50 shadow-lg z-10 ";
        else if (lead.status === 'talked') classes += "opacity-75 bg-slate-50 border-slate-100 ";
        else if (lead.status === 'no-answer') classes += "opacity-75 bg-red-50/30 border-red-100 ";
        else classes += "hover:border-teal-50/30 hover:shadow-xl ";
        div.className = classes;

        let statusMark = '';
        if (lead.status === 'dialing') statusMark = '<span class="text-[10px] font-black text-amber-600 animate-pulse uppercase">Звоним...</span>';
        else if (lead.status === 'talked') statusMark = '<span class="text-[10px] font-black text-teal-600 uppercase"><i class="fa-solid fa-check-double mr-1"></i>Поговорили</span>';
        else if (lead.status === 'no-answer') statusMark = '<span class="text-[10px] font-black text-red-500 uppercase"><i class="fa-solid fa-phone-slash mr-1"></i>Нет ответа</span>';
        else statusMark = `<span class="text-[9px] font-bold text-slate-400 uppercase truncate max-w-[100px]">${lead.stage || 'В очереди'}</span>`;

        const displayDate = formatDate(lead.created_at || lead.timestamp);

        div.innerHTML = `
            <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                <button onclick="event.stopPropagation(); removeFromQueue(${lead.id})" class="w-6 h-6 flex items-center justify-center bg-red-50 text-red-500 rounded-lg hover:bg-red-500 hover:text-white transition-all">
                    <i class="fa-solid fa-trash-can text-[10px]"></i>
                </button>
            </div>
            <div class="flex justify-between items-start gap-2 mb-2">
                <div class="flex items-center gap-3 min-w-0">
                    <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(lead.contactName)}" class="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200">
                    <div class="min-w-0">
                        <h4 class="font-bold text-sm truncate ${lead.status === 'dialing' ? 'text-amber-900' : ''}">${lead.contactName}</h4>
                        <p class="text-[11px] text-slate-400 truncate">${lead.phone}</p>
                    </div>
                </div>
                <span class="text-[9px] font-bold text-slate-400 uppercase shrink-0">${displayDate}</span>
            </div>
            <div class="flex justify-between items-center mt-3">
                <span class="text-[10px] font-bold bg-white text-slate-600 px-2 py-0.5 rounded border border-slate-100 shadow-sm">₸ ${lead.price}</span>
                <div class="flex items-center gap-2">
                    ${statusMark}
                </div>
            </div>
        `;
        div.onclick = () => showLeadDetails(lead);
        container.appendChild(div);
    });
}

function startSimulation() {
    isSimulating = true;
    isPaused = false;
    document.getElementById('startBtn').classList.add('hidden');
    document.getElementById('pauseBtn').classList.remove('hidden');
    document.getElementById('stopBtn').classList.remove('hidden');
    if (!shiftTimerInterval) {
        shiftSeconds = 0;
        shiftTimerInterval = setInterval(updateShiftTimer, 1000);
    }
    cycle();
}

function pauseSimulation() {
    isPaused = true;
    document.getElementById('startBtn').innerText = 'Продолжить';
    document.getElementById('startBtn').classList.remove('hidden');
    document.getElementById('pauseBtn').classList.add('hidden');
}

function resumeSimulation() {
    isPaused = false;
    document.getElementById('startBtn').classList.add('hidden');
    document.getElementById('pauseBtn').classList.remove('hidden');
    cycle();
}

function stopSimulation() {
    isSimulating = false;
    isPaused = false;
    document.getElementById('startBtn').innerText = 'Запустить';
    document.getElementById('startBtn').classList.remove('hidden');
    document.getElementById('pauseBtn').classList.add('hidden');
    document.getElementById('stopBtn').classList.add('hidden');
    document.getElementById('floatingDialerBar').classList.add('hidden');
    clearInterval(callTimerInterval);
    clearInterval(shiftTimerInterval);
    shiftTimerInterval = null;
    document.getElementById('callTimer').innerText = "00:00";
    alert('Обзвон завершен.');
}

async function cycle() {
    if (!isSimulating || isPaused) return;
    const targets = queue.filter(l => l.status === 'pending').slice(0, 2);
    if (targets.length === 0) {
        if (!queue.find(l => l.status === 'dialing')) stopSimulation();
        return;
    }
    const bar = document.getElementById('floatingDialerBar');
    if (bar) bar.classList.remove('hidden');
    targets.forEach(l => l.status = 'dialing');
    renderQueue();
    await new Promise(r => setTimeout(r, 4000));
    if (!isSimulating || isPaused) {
        targets.forEach(l => { if (l.status === 'dialing') l.status = 'pending'; });
        renderQueue();
        return;
    }
    const winner = targets[0];
    const isSuccess = Math.random() > 0.2;
    winner.status = isSuccess ? 'talked' : 'no-answer';
    if (targets[1]) targets[1].status = 'pending';
    startCallTimer();
    showLeadDetails(winner);
    await new Promise(r => setTimeout(r, 5000));
    if (bar) bar.classList.add('hidden');
    if (!isSimulating) return;
    clearInterval(callTimerInterval);
    renderQueue();
    if (!isPaused) setTimeout(cycle, 1500);
}

function startCallTimer() {
    callSeconds = 0;
    clearInterval(callTimerInterval);
    callTimerInterval = setInterval(() => {
        callSeconds++;
        const m = Math.floor(callSeconds / 60).toString().padStart(2, '0');
        const s = (callSeconds % 60).toString().padStart(2, '0');
        const el = document.getElementById('callTimer');
        if (el) el.innerText = `${m}:${s}`;
    }, 1000);
}
