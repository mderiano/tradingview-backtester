const state = {
    indicatorId: '',
    symbols: [], // Array of symbol strings
    options: {}, // Stores current values
    ranges: {},  // Stores range configs: { key: { active: true, min, max, step } }
    results: [],
    inputMetadata: {}, // Stores input names: { in_0: 'Stop Loss %', in_1: 'Take Profit %', ... }
    currentJobId: null
};

// DOM Elements
const indicatorIdInput = document.getElementById('indicatorId');
const fetchOptionsBtn = document.getElementById('fetchOptionsBtn');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');
const optionsContainer = document.getElementById('optionsContainer');
const symbolsContainer = document.getElementById('symbolsContainer');
const newSymbolInput = document.getElementById('newSymbolInput');
const addSymbolBtn = document.getElementById('addSymbolBtn');
const runBacktestBtn = document.getElementById('runBacktestBtn');
const stopBacktestBtn = document.getElementById('stopBacktestBtn');
const resultsTableBody = document.querySelector('#resultsTable tbody');
const downloadExcelBtn = document.getElementById('downloadExcelBtn');
const statusMessage = document.getElementById('statusMessage');

// Event Listeners
fetchOptionsBtn.addEventListener('click', fetchOptions);
runBacktestBtn.addEventListener('click', runBacktest);
stopBacktestBtn.addEventListener('click', stopBacktest);
downloadExcelBtn.addEventListener('click', downloadExcel);
addSymbolBtn.addEventListener('click', handleAddSymbol);
newSymbolInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAddSymbol();
});


// Load config and settings on page load
document.addEventListener('DOMContentLoaded', async () => {
    loadSettings();
    await fetchConfig();
});

async function fetchConfig() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();

        // Update UI
        document.getElementById('appTitle').textContent = config.appTitle;
        document.getElementById('appSubtitle').textContent = config.appSubtitle;

        // Auto-load if indicator ID is set
        if (config.indicatorId) {
            const step1 = document.getElementById('step1');
            step1.classList.add('hidden'); // Hide Step 1

            indicatorIdInput.value = config.indicatorId;
            state.indicatorId = config.indicatorId;

            // Fetch options immediately
            await fetchOptions();
        }
    } catch (e) {
        console.error('Failed to load config:', e);
    }
}

// LocalStorage functions
function saveSettings() {
    const settings = {
        indicatorId: state.indicatorId,
        symbols: state.symbols,
        timeframes: Array.from(document.querySelectorAll('input[name="timeframe"]:checked')).map(cb => cb.value),
        options: state.options,
        ranges: state.ranges
    };
    localStorage.setItem('backtestSettings', JSON.stringify(settings));
}

function loadSettings() {
    const saved = localStorage.getItem('backtestSettings');

    // Default symbols if nothing saved
    const defaultSymbols = [
        'BINANCE:BTCUSDT.P', 'BINANCE:ETHUSDT.P', 'BINANCE:XRPUSDT.P',
        'BINANCE:BNBUSDT.P'
    ];

    if (!saved) {
        state.symbols = defaultSymbols;
        renderSymbols();
        return;
    }

    try {
        const settings = JSON.parse(saved);

        // Restore indicator ID
        if (settings.indicatorId) {
            indicatorIdInput.value = settings.indicatorId;
        }

        // Restore symbols
        state.symbols = (settings.symbols && Array.isArray(settings.symbols)) ? settings.symbols : defaultSymbols;
        renderSymbols();

        // Restore timeframes (will apply after checkboxes are rendered)
        if (settings.timeframes) {
            setTimeout(() => {
                document.querySelectorAll('input[name="timeframe"]').forEach(cb => {
                    cb.checked = settings.timeframes.includes(cb.value);
                });
            }, 100);
        }

        // Note: Options and ranges will be restored after fetching indicator
        window.savedOptionsAndRanges = {
            indicatorId: settings.indicatorId,
            options: settings.options,
            ranges: settings.ranges
        };
    } catch (e) {
        console.error('Failed to load settings:', e);
        state.symbols = defaultSymbols;
        renderSymbols();
    }
}

// --- SYMBOL MANAGEMENT ---
function renderSymbols() {
    // Clear existing chips (except the input wrapper)
    const chips = symbolsContainer.querySelectorAll('.symbol-chip');
    chips.forEach(chip => chip.remove());

    // Insert chips before the input wrapper
    const wrapper = symbolsContainer.querySelector('.add-symbol-wrapper');

    state.symbols.forEach(symbol => {
        const chip = document.createElement('div');
        chip.className = 'symbol-chip';
        chip.innerHTML = `
            ${symbol}
            <button class="remove-symbol" onclick="removeSymbol('${symbol}')">&times;</button>
        `;
        symbolsContainer.insertBefore(chip, wrapper);
    });
}

function handleAddSymbol() {
    const val = newSymbolInput.value.trim();
    if (val && !state.symbols.includes(val)) {
        state.symbols.push(val);
        renderSymbols();
        newSymbolInput.value = '';
    }
}

window.removeSymbol = (symbol) => {
    state.symbols = state.symbols.filter(s => s !== symbol);
    renderSymbols();
};

// --- OPTIONS FETCHING & RENDERING ---
async function fetchOptions() {
    const id = indicatorIdInput.value.trim();
    if (!id) return alert('Please enter an Indicator ID');

    fetchOptionsBtn.disabled = true;
    fetchOptionsBtn.textContent = 'Loading...';

    try {
        const response = await fetch(`/api/indicator?id=${encodeURIComponent(id)}`);
        const data = await response.json();

        if (data.error) throw new Error(data.error);

        state.indicatorId = id;
        renderOptions(data.inputs);
        step2.classList.remove('hidden');

    } catch (error) {
        alert('Error fetching options: ' + error.message);
    } finally {
        fetchOptionsBtn.disabled = false;
        fetchOptionsBtn.textContent = 'Fetch Options';
    }
}

function renderOptions(inputs) {
    optionsContainer.innerHTML = '';
    state.options = {};
    state.ranges = {};
    state.inputMetadata = {}; // Reset metadata

    const saved = window.savedOptionsAndRanges;
    const useSaved = saved && saved.indicatorId === state.indicatorId;

    Object.keys(inputs).forEach(key => {
        const inputObj = inputs[key];

        // Skip hidden inputs
        if (inputObj.isHidden) return;

        let value = inputObj.value;
        const label = inputObj.name || key;

        // Override with saved value if available
        if (useSaved && saved.options && saved.options.hasOwnProperty(key)) {
            value = saved.options[key];
        }

        state.options[key] = value; // Store value (default or saved)
        state.inputMetadata[key] = label; // Store readable name

        const row = document.createElement('div');
        row.className = 'option-row';

        const isNumber = typeof value === 'number';
        const isBool = typeof value === 'boolean';

        // --- INPUT CONTROL ---
        let inputHtml = '';
        if (isBool) {
            inputHtml = `
                <label class="toggle-switch">
                    <input type="checkbox" 
                           ${value ? 'checked' : ''} 
                           onchange="updateOption('${key}', this.checked, 'boolean')">
                    <span class="slider"></span>
                </label>
            `;
        } else if (inputObj.options && Array.isArray(inputObj.options)) {
            inputHtml = `
                <select onchange="updateOption('${key}', this.value, 'text')">
                    ${inputObj.options.map(opt => `<option value="${opt}" ${opt === value ? 'selected' : ''}>${opt}</option>`).join('')}
                </select>
            `;
        } else {
            inputHtml = `
                <input type="${isNumber ? 'number' : 'text'}" 
                       value="${value}" 
                       onchange="updateOption('${key}', this.value, '${typeof value}')">
            `;
        }

        // --- OPTIMIZATION CONTROLS ---
        let optimizeHtml = '';
        if (isNumber || isBool) {
            let isRangeActive = false;

            // Helper to fix floating point issues (e.g. 0.1 + 0.2 = 0.30000000000000004)
            const fix = (n) => parseFloat(n.toPrecision(10));

            let rangeMin = isNumber ? value : null;
            let rangeMax = isNumber ? fix(value + (value === 0 ? 10 : value * 2)) : null;
            let rangeStep = isNumber ? fix(value === 0 ? 1 : value / 10) : null;

            if (useSaved && saved.ranges && saved.ranges[key]) {
                const r = saved.ranges[key];
                isRangeActive = r.active;
                if (isNumber) {
                    rangeMin = r.min;
                    rangeMax = r.max;
                    rangeStep = r.step;
                }

                if (isRangeActive) {
                    state.ranges[key] = { active: true, min: rangeMin, max: rangeMax, step: rangeStep };
                }
            }

            const optimizeContent = isNumber ? `
                <div class="optimize-input-group">
                    <label>Min</label>
                    <input type="number" value="${rangeMin}" onchange="updateRange('${key}', 'min', this.value)">
                </div>
                <div class="optimize-input-group">
                    <label>Max</label>
                    <input type="number" value="${rangeMax}" onchange="updateRange('${key}', 'max', this.value)">
                </div>
                <div class="optimize-input-group">
                    <label>Step</label>
                    <input type="number" value="${rangeStep}" onchange="updateRange('${key}', 'step', this.value)">
                </div>
            ` : `
                <span class="test-both-badge">Test True/False</span>
            `;

            optimizeHtml = `
                <div class="optimize-wrapper">
                    <label class="optimize-check-wrapper">
                        <input type="checkbox" id="opt_${key}" 
                               onchange="toggleRange('${key}', this.checked)" 
                               ${isRangeActive ? 'checked' : ''}>
                        Optimize
                    </label>
                    <div id="opt_settings_${key}" class="optimize-settings ${isRangeActive ? '' : 'hidden'}">
                        ${optimizeContent}
                    </div>
                </div>
            `;
        }

        row.innerHTML = `
            <div class="option-label" title="${key}">${label}</div>
            <div class="option-controls">
                <div class="control-primary">
                    ${inputHtml}
                </div>
                ${optimizeHtml}
            </div>
        `;

        optionsContainer.appendChild(row);
    });
}

window.updateOption = (key, value, type) => {
    if (type === 'number') {
        state.options[key] = parseFloat(value);
    } else {
        state.options[key] = value;
    }
};

window.toggleRange = (key, checked) => {
    const settingsDiv = document.getElementById(`opt_settings_${key}`);
    if (checked) {
        settingsDiv.classList.remove('hidden');

        // Initialize range state if missing
        if (!state.ranges[key]) {
            const currentVal = state.options[key];
            if (typeof currentVal === 'number') {
                state.ranges[key] = {
                    active: true,
                    min: currentVal,
                    max: currentVal + 10,
                    step: 1
                };
            } else {
                // Boolean optimization (just a flag)
                state.ranges[key] = { active: true };
            }
        } else {
            state.ranges[key].active = true;
        }
    } else {
        settingsDiv.classList.add('hidden');
        if (state.ranges[key]) {
            state.ranges[key].active = false;
        }
    }
};

window.updateRange = (key, field, value) => {
    if (!state.ranges[key]) state.ranges[key] = { active: true };
    state.ranges[key][field] = parseFloat(value);
};

async function runBacktest() {
    const timeframes = Array.from(document.querySelectorAll('input[name="timeframe"]:checked'))
        .map(cb => cb.value);

    if (state.symbols.length === 0 || timeframes.length === 0) {
        return alert('Please enter at least one symbol and select at least one timeframe');
    }

    runBacktestBtn.disabled = true;
    runBacktestBtn.textContent = 'Running Backtest...';
    stopBacktestBtn.classList.remove('hidden'); // Show stop button
    statusMessage.textContent = 'Starting backtest...';
    step3.classList.remove('hidden');
    resultsTableBody.innerHTML = '';
    state.results = [];

    // Save settings to localStorage
    saveSettings();

    try {
        const payload = {
            indicatorId: state.indicatorId,
            options: state.options,
            ranges: state.ranges,
            symbols: state.symbols,
            timeframes,
            inputMetadata: state.inputMetadata // Send readable names to backend
        };

        // Start job via HTTP
        const response = await fetch('/api/backtest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        const jobId = data.jobId;
        state.currentJobId = jobId; // Store for stop functionality
        console.log('Job started:', jobId);

        // Connect to WebSocket
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${wsProtocol}//${window.location.host}`);

        ws.onopen = () => {
            console.log('WebSocket connected');
            ws.send(JSON.stringify({ type: 'subscribe', jobId }));
        };

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);

            if (msg.type === 'progress') {
                statusMessage.textContent = `Progress: ${msg.current}/${msg.total} (${msg.percent}%)`;
                statusMessage.style.color = '';
            } else if (msg.type === 'result') {
                state.results.push(msg.data);
                addResultRow(msg.data);
            } else if (msg.type === 'complete') {
                statusMessage.textContent = '✅ Backtest complete!';
                statusMessage.style.color = '#4CAF50';
                resetButtons();
                ws.close();
            } else if (msg.type === 'error') {
                statusMessage.textContent = '❌ Error: ' + msg.message;
                statusMessage.style.color = '#ff4444';
                resetButtons();
                ws.close();
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            statusMessage.textContent = 'Connection error';
        };

    } catch (error) {
        statusMessage.textContent = '❌ Error: ' + error.message;
        statusMessage.style.color = '#ff4444';
        resetButtons();
    }
}

function resetButtons() {
    runBacktestBtn.disabled = false;
    runBacktestBtn.textContent = 'Run Backtest';
    stopBacktestBtn.classList.add('hidden');
    state.currentJobId = null;
}

async function stopBacktest() {
    if (!state.currentJobId) return;

    try {
        const response = await fetch(`/api/backtest/${state.currentJobId}/cancel`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            statusMessage.textContent = '⚠️ Backtest stopped by user';
            statusMessage.style.color = '#ff9800';
        }

        resetButtons();
    } catch (error) {
        console.error('Failed to stop backtest:', error);
    }
}

function formatOptions(options, metadata = state.inputMetadata) {
    // Only show options that are part of a range (non-default varied values)
    // If state.ranges exists and has active ranges, show only those
    if (state.ranges) {
        const rangedOptions = {};
        Object.keys(state.ranges).forEach(key => {
            if (state.ranges[key].active && options[key] !== undefined) {
                rangedOptions[key] = options[key];
            }
        });

        if (Object.keys(rangedOptions).length > 0) {
            return Object.entries(rangedOptions)
                .map(([k, v]) => {
                    const name = metadata[k] || k; // Use readable name or fallback to key
                    return `${name}: ${v}`;
                })
                .join(', ');
        }
    }

    // Show "No ranges" if no ranged options
    return 'Default settings';
}

function addResultRow(r) {
    const row = document.createElement('tr');
    row.dataset.resultIndex = state.results.length - 1; // Store index for modal
    row.addEventListener('click', () => openAnalyticsModal(r));

    if (r.error || !r.report) {
        row.innerHTML = `
            <td>${r.symbol}</td>
            <td>${r.timeframe}</td>
            <td><small>${formatOptions(r.options)}</small></td>
            <td colspan="6" class="negative">${r.error || 'Unknown error (No report data)'}</td>
        `;
    } else {
        const netProfit = r.report.netProfit !== 'N/A' ? r.report.netProfit : null;
        const netProfitClass = netProfit !== null && netProfit >= 0 ? 'positive' : 'negative';

        row.innerHTML = `
            <td>${r.symbol}</td>
            <td>${r.timeframe}</td>
            <td><small>${formatOptions(r.options)}</small></td>
            <td class="${netProfitClass}">${formatNumber(r.report.netProfit)}</td>
            <td>${r.report.totalClosedTrades !== 'N/A' ? r.report.totalClosedTrades : 'N/A'}</td>
            <td>${formatNumber(r.report.percentProfitable)}${r.report.percentProfitable !== 'N/A' ? '%' : ''}</td>
            <td>${formatNumber(r.report.profitFactor)}</td>
            <td class="negative">${formatNumber(r.report.maxDrawdown)}%</td>
            <td>${formatNumber(r.report.avgTrade)}</td>
        `;
    }
    resultsTableBody.appendChild(row);
}

function formatNumber(num) {
    if (num === 'N/A' || num === null || num === undefined) return 'N/A';
    if (typeof num === 'number') {
        return num.toFixed(2);
    }
    return num;
}

async function downloadExcel() {
    if (state.results.length === 0) return alert('No results to download');

    try {
        const response = await fetch('/api/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ results: state.results })
        });

        if (!response.ok) throw new Error('Export failed');

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'backtest_results.xlsx';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();

    } catch (error) {
        alert('Download failed: ' + error.message);
    }
}

// ======= TABLE SORTING =======
let sortState = { column: null, direction: 'asc' };

function initTableSorting() {
    const headers = document.querySelectorAll('#resultsTable th');
    const sortableColumns = [3, 4, 5, 6, 7, 8]; // Net Profit, Trades, % Win, PF, DD, Avg Trade

    headers.forEach((header, index) => {
        if (sortableColumns.includes(index)) {
            header.classList.add('sortable');
            header.addEventListener('click', () => sortTable(index));
        }
    });
}

function sortTable(columnIndex) {
    const table = document.querySelector('#resultsTable tbody');
    const rows = Array.from(table.querySelectorAll('tr'));

    // Toggle direction if same column, otherwise default to ascending
    if (sortState.column === columnIndex) {
        sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
        sortState.column = columnIndex;
        sortState.direction = 'asc';
    }

    // Update header classes
    document.querySelectorAll('#resultsTable th').forEach((th, i) => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (i === columnIndex) {
            th.classList.add(sortState.direction === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    });

    // Sort rows
    rows.sort((a, b) => {
        const aCell = a.cells[columnIndex]?.textContent.replace(/[^0-9.-]/g, '') || '0';
        const bCell = b.cells[columnIndex]?.textContent.replace(/[^0-9.-]/g, '') || '0';

        const aVal = parseFloat(aCell) || 0;
        const bVal = parseFloat(bCell) || 0;

        return sortState.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });

    // Re-append sorted rows
    rows.forEach(row => table.appendChild(row));
}

// Initialize sorting when results are shown
document.addEventListener('DOMContentLoaded', () => {
    initTableSorting();
});

// ======= ANALYTICS MODAL =======
let currentChart = null;

function openAnalyticsModal(result) {
    if (!result.fullReport) {
        alert('No detailed data available for this result');
        return;
    }

    const modal = document.getElementById('analyticsModal');
    const report = result.fullReport;

    // Update title
    document.getElementById('modalTitle').textContent =
        `${result.symbol} - ${result.timeframe} Analytics`;

    // Update metrics
    document.getElementById('modal-netProfit').textContent =
        formatNumber(report.performance?.all?.netProfit) || 'N/A';
    document.getElementById('modal-totalTrades').textContent =
        report.performance?.all?.totalTrades || 'N/A';
    document.getElementById('modal-percentProfitable').textContent =
        report.performance?.all?.percentProfitable ?
            (report.performance.all.percentProfitable * 100).toFixed(2) + '%' : 'N/A';
    document.getElementById('modal-profitFactor').textContent =
        formatNumber(report.performance?.all?.profitFactor) || 'N/A';
    document.getElementById('modal-maxDrawdown').textContent =
        report.performance?.maxStrategyDrawDownPercent ?
            (report.performance.maxStrategyDrawDownPercent * 100).toFixed(2) + '%' : 'N/A';
    document.getElementById('modal-sharpeRatio').textContent =
        formatNumber(report.performance?.sharpeRatio) || 'N/A';

    // Render tabs
    renderPerformanceTab(report);
    renderTradesTab(report);

    // Show modal
    modal.classList.remove('hidden');

    // Render chart after modal is visible
    setTimeout(() => renderEquityChart(report), 100);
}

window.closeAnalyticsModal = function () {
    const modal = document.getElementById('analyticsModal');
    modal.classList.add('hidden');

    // Destroy chart
    if (currentChart) {
        currentChart.destroy();
        currentChart = null;
    }
};

// Initialize modal close handlers
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('analyticsModal');
    const closeBtn = document.getElementById('closeModalBtn');

    // Close button click
    if (closeBtn) {
        closeBtn.addEventListener('click', closeAnalyticsModal);
    }

    // Click outside modal to close
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeAnalyticsModal();
            }
        });
    }

    // ESC key to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            closeAnalyticsModal();
        }
    });
});

// Tab switching
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;

            // Update active button
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update active pane
            document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
            document.getElementById(`${tabName}-tab`).classList.add('active');
        });
    });
});

function renderEquityChart(report) {
    if (!report.history || !report.history.equity) return;

    const ctx = document.getElementById('equityChart');
    if (!ctx) return;

    // Destroy existing chart
    if (currentChart) {
        currentChart.destroy();
    }

    const equity = report.history.equity;
    const drawdown = report.history.drawDown || [];

    currentChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: equity.map((_, i) => i),
            datasets: [
                {
                    label: 'Equity',
                    data: equity,
                    borderColor: '#00bfa5',
                    backgroundColor: 'rgba(0, 191, 165, 0.1)',
                    fill: true,
                    tension: 0.1,
                    borderWidth: 2
                },
                {
                    label: 'Drawdown',
                    data: drawdown.map(dd => -dd),
                    borderColor: '#f23645',
                    backgroundColor: 'rgba(242, 54, 69, 0.1)',
                    fill: true,
                    tension: 0.1,
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#e0e3eb'
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            },
            scales: {
                x: {
                    grid: {
                        color: '#2a2e39'
                    },
                    ticks: {
                        color: '#787b86'
                    }
                },
                y: {
                    grid: {
                        color: '#2a2e39'
                    },
                    ticks: {
                        color: '#787b86'
                    }
                }
            }
        }
    });
}

function renderPerformanceTab(report) {
    const container = document.getElementById('performanceDetails');
    const perf = report.performance;

    if (!perf) {
        container.innerHTML = '<p>No performance data available</p>';
        return;
    }

    const metrics = [
        ['Net Profit', formatNumber(perf.all?.netProfit)],
        ['Gross Profit', formatNumber(perf.all?.grossProfit)],
        ['Gross Loss', formatNumber(perf.all?.grossLoss)],
        ['Total Trades', perf.all?.totalTrades],
        ['Winning Trades', perf.all?.numberOfWiningTrades],
        ['Losing Trades', perf.all?.numberOfLosingTrades],
        ['% Profitable', perf.all?.percentProfitable ? (perf.all.percentProfitable * 100).toFixed(2) + '%' : 'N/A'],
        ['Profit Factor', formatNumber(perf.all?.profitFactor)],
        ['Avg Trade', formatNumber(perf.all?.avgTrade)],
        ['Avg Win', formatNumber(perf.all?.avgWinTrade)],
        ['Avg Loss', formatNumber(perf.all?.avgLosTrade)],
        ['Max Drawdown', perf.maxStrategyDrawDown ? formatNumber(perf.maxStrategyDrawDown) : 'N/A'],
        ['Max Drawdown %', perf.maxStrategyDrawDownPercent ? (perf.maxStrategyDrawDownPercent * 100).toFixed(2) + '%' : 'N/A'],
        ['Sharpe Ratio', formatNumber(perf.sharpeRatio)],
        ['Buy & Hold Return', formatNumber(perf.buyHoldReturn)],
    ];

    container.innerHTML = metrics.map(([label, value]) => `
        <div class="metric-row">
            <span style="color: var(--text-secondary)">${label}</span>
            <span>${value || 'N/A'}</span>
        </div>
    `).join('');
}

function renderTradesTab(report) {
    const tbody = document.getElementById('tradesTableBody');

    if (!report.trades || report.trades.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9">No trades available</td></tr>';
        return;
    }

    const trades = report.trades;

    // Helper to format date/time
    const formatDateTime = (timestamp) => {
        if (!timestamp) return 'N/A';
        const date = new Date(timestamp);
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    tbody.innerHTML = trades.map((trade, index) => {
        const profitClass = trade.profit?.v >= 0 ? 'positive' : 'negative';
        const type = trade.entry?.type || 'N/A';

        return `
            <tr>
                <td>${index + 1}</td>
                <td>${type.toUpperCase()}</td>
                <td><small>${formatDateTime(trade.entry?.time)}</small></td>
                <td>${trade.entry?.value?.toFixed(5) || 'N/A'}</td>
                <td><small>${formatDateTime(trade.exit?.time)}</small></td>
                <td>${trade.exit?.value?.toFixed(5) || 'N/A'}</td>
                <td class="${profitClass}">${trade.profit?.v?.toFixed(2) || 'N/A'}</td>
                <td class="${profitClass}">${trade.profit?.p ? (trade.profit.p * 100).toFixed(2) + '%' : 'N/A'}</td>
                <td>${trade.cumulative?.v?.toFixed(2) || 'N/A'}</td>
            </tr>
        `;
    }).join('');
}
