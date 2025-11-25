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
const discoveredContainer = document.getElementById('discoveredContainer');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');
const optionsContainer = document.getElementById('optionsContainer');
const symbolsContainer = document.getElementById('symbolsContainer');
const newSymbolInput = document.getElementById('newSymbolInput');
const addSymbolBtn = document.getElementById('addSymbolBtn');
const runBacktestBtn = document.getElementById('runBacktestBtn');
const stopBacktestBtn = document.getElementById('stopBacktestBtn');
const dateFromInput = document.getElementById('dateFrom');
const dateToInput = document.getElementById('dateTo');
const resultsTableBody = document.querySelector('#resultsTable tbody');

const statusMessage = document.getElementById('statusMessage');
const clearSettingsBtn = document.getElementById('clearSettingsBtn');

// History Elements
const historyBtn = document.getElementById('historyBtn');
const historyModal = document.getElementById('historyModal');
const closeHistoryBtn = document.getElementById('closeHistoryBtn');
const historyTableBody = document.getElementById('historyTableBody');

// Event Listeners
historyBtn.addEventListener('click', openHistoryModal);
closeHistoryBtn.addEventListener('click', () => historyModal.classList.add('hidden'));
runBacktestBtn.addEventListener('click', runBacktest);
stopBacktestBtn.addEventListener('click', stopBacktest);
clearSettingsBtn.addEventListener('click', clearSettings);

addSymbolBtn.addEventListener('click', handleAddSymbol);
newSymbolInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAddSymbol();
});


// Load config and settings on page load
// Initialize date inputs with default 1-year range
function initializeDateInputs() {
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);

    // Format as YYYY-MM-DD
    const formatDate = (date) => date.toISOString().split('T')[0];

    // Only set defaults if not already set (from localStorage)
    if (!dateFromInput.value) {
        dateFromInput.value = formatDate(oneYearAgo);
    }
    if (!dateToInput.value) {
        dateToInput.value = formatDate(today);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    initializeDateInputs();
    loadSettings();
    await restoreCredentials(); // Restore TradingView credentials from localStorage
    await fetchConfig();

    // Attach timeframe listeners after DOM is ready
    attachTimeframeListeners();

    // Always ensure step1 is visible on page load
    const step1 = document.getElementById('step1');
    if (step1) step1.classList.remove('hidden');

    // Check for active job to restore
    checkActiveJob();
    
    // Listen for sync data loaded from extension
    window.addEventListener('tvBacktestSyncLoaded', (event) => {
        console.log('🔄 Sync data loaded event received:', event.detail);
        autoLoadFromSync(event.detail);
    });
});

// Auto-load data from sync
function autoLoadFromSync(syncData) {
    if (!syncData) return;
    
    console.log('🚀 Auto-loading from sync data...');
    
    // Ensure step1 is visible when syncing from extension
    const step1 = document.getElementById('step1');
    if (step1) step1.classList.remove('hidden');
    
    // Update server state with session/signature
    if (syncData.session) {
        process.env = process.env || {};
        console.log('✅ Session available from sync');
    }
    
    // If we have indicators, auto-load the first one
    if (syncData.indicators && syncData.indicators.length > 0) {
        const firstIndicator = syncData.indicators[0];
        console.log('📊 Auto-loading indicator:', firstIndicator.name);
        
        // Store globally for access
        window.chartContext = {
            symbol: syncData.symbol || '',
            timeframe: syncData.timeframe || ''
        };
        
        // Show notification
        if (statusMessage) {
            statusMessage.textContent = `🔄 Auto-loaded from extension: ${firstIndicator.name}`;
            statusMessage.className = 'status-message success';
            setTimeout(() => statusMessage.textContent = '', 5000);
        }
        
        // Auto-load with TradingView values
        setTimeout(() => {
            loadIndicatorWithTVValues(firstIndicator);
        }, 500);
    }
}

// Restore TradingView credentials from localStorage
async function restoreCredentials() {
    // Check if we have sync data in localStorage
    const syncDataStr = localStorage.getItem('tvBacktestSyncData');
    if (!syncDataStr) {
        console.log('⚠️ No credentials found in localStorage');
        return;
    }
    
    try {
        const syncData = JSON.parse(syncDataStr);
        if (syncData.session) {
            console.log('🔄 Restoring credentials to server...');
            // Send credentials to server
            const response = await fetch('/api/restore-credentials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session: syncData.session,
                    signature: syncData.signature
                })
            });
            
            if (response.ok) {
                console.log('✅ Credentials restored from localStorage');
            } else {
                console.warn('⚠️ Failed to restore credentials');
            }
        }
    } catch (e) {
        console.error('Error restoring credentials:', e);
    }
}

async function checkActiveJob() {
    const savedJobId = localStorage.getItem('currentJobId');
    if (!savedJobId) return;

    try {
        console.log('Checking for active job:', savedJobId);
        const res = await fetch(`/api/jobs/${savedJobId}`);
        if (!res.ok) {
            if (res.status === 404) localStorage.removeItem('currentJobId');
            return;
        }

        const job = await res.json();

        // If job is running, reconnect
        if (job.status === 'running' || job.status === 'pending') {
            console.log('Restoring running job...');
            restoreJob(job);
        } else if (job.status === 'completed') {
            // Optional: Auto-load completed job if it's very recent?
            // For now, let's just let the user load it from history if they want,
            // or maybe show a notification.
            // Actually, let's load it if it's the first load to be helpful.
            console.log('Restoring completed job...');
            restoreJob(job);
        }
    } catch (e) {
        console.error('Error checking active job:', e);
    }
}

async function openHistoryModal() {
    historyModal.classList.remove('hidden');
    await fetchHistory();
}

async function fetchHistory() {
    historyTableBody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';
    try {
        const res = await fetch('/api/jobs');
        const jobs = await res.json();
        renderHistory(jobs);
    } catch (e) {
        historyTableBody.innerHTML = `<tr><td colspan="5" class="negative">Error: ${e.message}</td></tr>`;
    }
}

function renderHistory(jobs) {
    historyTableBody.innerHTML = '';
    if (jobs.length === 0) {
        historyTableBody.innerHTML = '<tr><td colspan="5">No history found</td></tr>';
        return;
    }

    jobs.forEach(job => {
        const row = document.createElement('tr');
        const date = new Date(job.date).toLocaleString();
        const statusClass = `status-${job.status}`;

        row.innerHTML = `
            <td>${date}</td>
            <td><span class="status-badge ${statusClass}">${job.status}</span></td>
            <td>${job.symbolCount || '?'} symbols</td>
            <td>${job.isArchived ? 'Archived' : 'Available'}</td>
            <td>
                <button class="btn small primary" onclick="loadJob('${job.id}')">Load</button>
            </td>
        `;
        historyTableBody.appendChild(row);
    });
}

window.loadJob = async (jobId) => {
    try {
        historyModal.classList.add('hidden');
        statusMessage.textContent = 'Loading job...';

        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) throw new Error('Failed to load job');

        const job = await res.json();
        restoreJob(job);

    } catch (e) {
        alert('Error loading job: ' + e.message);
    }
};

function restoreJob(job) {
    // Restore state
    state.currentJobId = job.id;
    state.results = job.results || [];

    // Restore config if available
    if (job.config) {
        const cfg = job.config;

        // Restore Indicator ID
        if (cfg.indicatorId) {
            state.indicatorId = cfg.indicatorId;
            // Keep step1 visible so user can change indicator if needed
            step2.classList.remove('hidden');
        }

        // Restore Symbols
        if (cfg.symbols && Array.isArray(cfg.symbols)) {
            state.symbols = cfg.symbols;
            renderSymbols();
        }

        // Restore Timeframes
        if (cfg.timeframes) {
            document.querySelectorAll('input[name="timeframe"]').forEach(cb => {
                cb.checked = cfg.timeframes.includes(cb.value);
            });
        }

        // Restore Dates
        if (cfg.dateFrom) dateFromInput.value = cfg.dateFrom;
        if (cfg.dateTo) dateToInput.value = cfg.dateTo;

        // Restore Options & Ranges
        // We need to fetch options first to render the UI, then apply values
        if (cfg.indicatorId) {
            // We can't await here easily without making restoreJob async, 
            // but fetchOptions is async.
            // Let's try to fetch options and then apply values.
            fetch(`/api/indicator?id=${encodeURIComponent(cfg.indicatorId)}`)
                .then(res => res.json())
                .then(data => {
                    if (data.inputs) {
                        // Render options with default values
                        // But we want to override with saved values

                        // Temporarily set savedOptionsAndRanges so renderOptions uses them
                        window.savedOptionsAndRanges = {
                            indicatorId: cfg.indicatorId,
                            options: cfg.options,
                            ranges: cfg.ranges
                        };

                        renderOptions(data.inputs);

                        // Update state explicitly just in case
                        state.options = cfg.options || {};
                        state.ranges = cfg.ranges || {};

                        updateBacktestSummary();
                    }
                })
                .catch(e => console.error('Failed to restore options:', e));
        }
    }

    // Update UI
    step3.classList.remove('hidden');
    resultsTableBody.innerHTML = '';

    // Render results
    if (job.results) {
        job.results.forEach(r => addResultRow(r));
    }

    // Update status
    if (job.status === 'running' || job.status === 'pending') {
        statusMessage.textContent = 'Resuming backtest...';
        runBacktestBtn.disabled = true;
        runBacktestBtn.textContent = 'Running Backtest...';
        stopBacktestBtn.classList.remove('hidden');

        // Reconnect WebSocket
        connectWebSocket(job.id);
    } else {
        statusMessage.textContent = `Loaded job from ${new Date(job.startTime).toLocaleString()}`;
        if (job.status === 'completed') {
            statusMessage.style.color = '#4CAF50';
        } else if (job.status === 'failed') {
            statusMessage.style.color = '#ff4444';
        }
        resetButtons();
    }

    // Save ID to local storage so it persists on reload
    localStorage.setItem('currentJobId', job.id);
}

function connectWebSocket(jobId) {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}`);

    ws.onopen = () => {
        console.log('WebSocket connected (reconnect)');
        ws.send(JSON.stringify({ type: 'subscribe', jobId }));
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'progress') {
            statusMessage.textContent = `Progress: ${msg.current}/${msg.total} (${msg.percent}%)`;
            statusMessage.style.color = '';
        } else if (msg.type === 'result') {
            // Avoid duplicates if we already loaded results
            // But since we just loaded the full list from API, we might get duplicates if we are not careful.
            // The server sends 'result' for each new result.
            // If we loaded the job, we have the past results.
            // We should check if result is already in state.results
            // Ideally, the server only sends *new* results or we handle dedup.
            // For simplicity, let's just append for now, or check index.

            // Actually, if we subscribe, the server might replay results?
            // In server.js: "Replay results if needed, or just let client know it's running"
            // The current server implementation DOES NOT replay results on subscribe.
            // It only sends status.
            // So we are safe. New results will come in as they happen.

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
}


async function fetchConfig() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();

        // Update UI
        document.getElementById('appTitle').textContent = config.appTitle;
        document.getElementById('appSubtitle').textContent = config.appSubtitle;

        // Auto-load if indicator ID is set
        if (config.indicatorId) {
            state.indicatorId = config.indicatorId;
            // Note: fetchOptions will be called when user clicks load button
        }

        // Render Discovered Indicators
        if (config.discoveredIndicators && config.discoveredIndicators.length > 0) {
            // Store chart context globally
            window.chartContext = config.chartContext || {};
            renderDiscoveredIndicators(config.discoveredIndicators);
        }
    } catch (e) {
        console.error('Failed to load config:', e);
    }
}

function renderDiscoveredIndicators(indicators) {
    if (!discoveredContainer) return;

    discoveredContainer.innerHTML = '<h3>Active Strategies (from Extension)</h3>';
    
    const list = document.createElement('div');
    list.className = 'discovered-list';

    indicators.forEach(ind => {
        const item = document.createElement('div');
        item.className = 'discovered-item';
        
        // Create indicator info section
        const infoDiv = document.createElement('div');
        infoDiv.className = 'indicator-info';
        infoDiv.innerHTML = `
            <div class="name">${ind.name}</div>
        `;
        
        // Create buttons section
        const buttonsDiv = document.createElement('div');
        buttonsDiv.className = 'indicator-buttons';
        
        // Load with TradingView values button
        const tvBtn = document.createElement('button');
        tvBtn.className = 'load-btn tv-load';
        tvBtn.textContent = '📊 Load from TradingView';
        tvBtn.title = 'Load with current values from TradingView (symbol, timeframe, inputs)';
        tvBtn.onclick = (e) => {
            e.stopPropagation();
            loadIndicatorWithTVValues(ind);
        };
        
        buttonsDiv.appendChild(tvBtn);
        
        // Check if saved settings exist for this indicator
        const saved = localStorage.getItem('backtestSettings');
        if (saved) {
            try {
                const settings = JSON.parse(saved);
                if (settings.indicatorId === ind.id && settings.options) {
                    // Load with localStorage values button (only show if data exists)
                    const localBtn = document.createElement('button');
                    localBtn.className = 'load-btn local-load';
                    localBtn.textContent = '💾 Load Saved Settings';
                    localBtn.title = 'Load with previously saved values from this browser';
                    localBtn.onclick = (e) => {
                        e.stopPropagation();
                        loadIndicatorWithLocalValues(ind);
                    };
                    buttonsDiv.appendChild(localBtn);
                }
            } catch (e) {
                console.warn('Error checking saved settings:', e);
            }
        }
        
        item.appendChild(infoDiv);
        item.appendChild(buttonsDiv);
        list.appendChild(item);
    });

    discoveredContainer.appendChild(list);
    discoveredContainer.classList.remove('hidden');
}

// Load indicator with TradingView values
function loadIndicatorWithTVValues(indicator) {
    console.log('Loading with TradingView values:', indicator);
    
    state.indicatorId = indicator.id;
    
    // Convert TradingView inputs to options format
    const tvOptions = {};
    if (indicator.inputs && Array.isArray(indicator.inputs)) {
        indicator.inputs.forEach(input => {
            // Only include actual indicator inputs (in_0, in_1, etc.)
            if (input.id && input.id.startsWith('in_')) {
                tvOptions[input.id] = input.value;
            }
        });
    }
    
    // Store TradingView values in global variable so renderOptions can use them
    window.savedOptionsAndRanges = {
        indicatorId: indicator.id,
        options: tvOptions,
        ranges: {} // No ranges from TradingView
    };
    
    console.log('Prepared TradingView options:', tvOptions);
    
    // Load symbol from chartContext if available
    if (window.chartContext && window.chartContext.symbol) {
        const symbol = window.chartContext.symbol;
        // Clear existing symbols and add TradingView symbol
        state.symbols = [symbol];
        renderSymbols();
        console.log('Loaded symbol from TradingView:', symbol);
    }
    
    // Load timeframe from chartContext if available
    if (window.chartContext && window.chartContext.timeframe) {
        const timeframe = window.chartContext.timeframe;
        // Wait for DOM to be ready and check the corresponding timeframe
        setTimeout(() => {
            const timeframeCheckbox = document.querySelector(`input[name="timeframe"][value="${timeframe}"]`);
            if (timeframeCheckbox) {
                // Uncheck all timeframes first
                document.querySelectorAll('input[name="timeframe"]').forEach(cb => cb.checked = false);
                // Check the TradingView timeframe
                timeframeCheckbox.checked = true;
                updateBacktestSummary();
                console.log('Loaded timeframe from TradingView:', timeframe);
            } else {
                console.warn('Timeframe not found in checkboxes:', timeframe);
            }
        }, 100);
    }
    
    // Show status message
    if (statusMessage) {
        statusMessage.textContent = `📊 Loading ${indicator.name} with TradingView values...`;
        statusMessage.className = 'status-message success';
        setTimeout(() => statusMessage.textContent = '', 3000);
    }
    
    // Fetch options - will use window.savedOptionsAndRanges
    fetchOptions();
}

// Load indicator with localStorage values
function loadIndicatorWithLocalValues(indicator) {
    console.log('Loading with localStorage values for:', indicator.id);
    
    state.indicatorId = indicator.id;
    
    // Restore from localStorage
    const saved = localStorage.getItem('backtestSettings');
    if (saved) {
        try {
            const settings = JSON.parse(saved);
            if (settings.indicatorId === indicator.id) {
                window.savedOptionsAndRanges = {
                    indicatorId: indicator.id,
                    options: settings.options || {},
                    ranges: settings.ranges || {}
                };
                console.log('Loaded localStorage values:', settings.options);
            } else {
                // Different indicator, clear saved values
                window.savedOptionsAndRanges = null;
            }
        } catch (e) {
            console.error('Error parsing localStorage:', e);
            window.savedOptionsAndRanges = null;
        }
    } else {
        window.savedOptionsAndRanges = null;
    }
    
    // Show status message
    if (statusMessage) {
        statusMessage.textContent = `💾 Loading ${indicator.name} with saved values...`;
        statusMessage.className = 'status-message success';
        setTimeout(() => statusMessage.textContent = '', 3000);
    }
    
    // Fetch options and then apply localStorage values
    fetchOptions();
}

// LocalStorage functions
function saveSettings() {
    const settings = {
        indicatorId: state.indicatorId,
        symbols: state.symbols,
        timeframes: Array.from(document.querySelectorAll('input[name="timeframe"]:checked')).map(cb => cb.value),
        options: state.options,
        ranges: state.ranges,
        dateFrom: dateFromInput.value,
        dateTo: dateToInput.value
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
            state.indicatorId = settings.indicatorId;
            state.indicatorName = settings.indicatorName || 'Saved Strategy';
            state.activeSource = 'saved';
            
            // Render saved indicator in step1
            renderSavedIndicator(settings);
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
                updateBacktestSummary();
            }, 100);
        } else {
            setTimeout(() => {
                updateBacktestSummary();
            }, 100);
        }

        // Restore date range
        if (settings.dateFrom) {
            dateFromInput.value = settings.dateFrom;
        }
        if (settings.dateTo) {
            dateToInput.value = settings.dateTo;
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

function clearSettings() {
    if (!confirm('Clear all saved settings? This will reset symbols, timeframes, options, and ranges.')) {
        return;
    }

    localStorage.removeItem('backtestSettings');
    alert('Settings cleared! Reloading page...');
    location.reload();
}

function attachTimeframeListeners() {
    const checkboxes = document.querySelectorAll('input[name="timeframe"]');
    console.log(`🔌 Attaching timeframe listeners to ${checkboxes.length} checkboxes`);
    checkboxes.forEach(checkbox => {
        // Remove existing listener if any (to prevent duplicates)
        checkbox.removeEventListener('change', handleTimeframeChange);
        // Add new listener
        checkbox.addEventListener('change', handleTimeframeChange);
    });
}

function handleTimeframeChange() {
    console.log('⏱️ Timeframe changed, updating summary...');
    updateBacktestSummary();
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

    // Update backtest summary when symbols change
    updateBacktestSummary();
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
    const id = state.indicatorId;
    if (!id) {
        console.error('No indicator ID in state');
        return;
    }

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

    // Update backtest summary after rendering options
    setTimeout(() => updateBacktestSummary(), 100);
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
                // Helper to fix floating point issues
                const fix = (n) => parseFloat(n.toPrecision(10));

                // Match the defaults shown in renderOptions
                state.ranges[key] = {
                    active: true,
                    min: currentVal,
                    max: fix(currentVal + (currentVal === 0 ? 10 : currentVal * 2)),
                    step: fix(currentVal === 0 ? 1 : currentVal / 10)
                };
            } else {
                // Boolean optimization (just a flag)
                state.ranges[key] = { active: true };
            }
        } else {
            state.ranges[key].active = true;
        }

        // Show value count
        updateRangeValueCount(key);
    } else {
        settingsDiv.classList.add('hidden');
        if (state.ranges[key]) {
            state.ranges[key].active = false;
        }
        // Update summary when optimization is disabled
        updateBacktestSummary();
    }
};

window.updateRange = (key, field, value) => {
    if (!state.ranges[key]) state.ranges[key] = { active: true };
    state.ranges[key][field] = parseFloat(value);

    // Update the value count display
    updateRangeValueCount(key);
    updateBacktestSummary(); // Update summary when range values change
};

function updateRangeValueCount(key) {
    const range = state.ranges[key];
    if (!range || !range.active) return;

    const { min, max, step } = range;
    if (isNaN(min) || isNaN(max) || isNaN(step) || step <= 0) return;

    const steps = Math.round((max - min) / step);
    const count = steps + 1;

    // Find or create the count display element
    const settingsDiv = document.getElementById(`opt_settings_${key}`);
    if (!settingsDiv) return;

    let countDisplay = settingsDiv.querySelector('.range-count');
    if (!countDisplay) {
        countDisplay = document.createElement('div');
        countDisplay.className = 'range-count';
        settingsDiv.appendChild(countDisplay);
    }

    // Update the display with appropriate styling
    const isLarge = count > 50;
    const isVeryLarge = count > 100;

    countDisplay.textContent = `${count} value${count !== 1 ? 's' : ''} will be tested for this parameter`;
    countDisplay.style.color = isVeryLarge ? '#ff9800' : isLarge ? '#ffc107' : '#4CAF50';
    countDisplay.style.fontWeight = isVeryLarge ? '600' : '400';

    // Update the overall backtest summary
    updateBacktestSummary();
}

function updateBacktestSummary() {
    // Calculate total backtests
    const symbolCount = state.symbols.length;
    const timeframeCount = Array.from(document.querySelectorAll('input[name="timeframe"]:checked')).length;

    // Calculate total option combinations
    let totalCombinations = 1;
    const rangeInfo = [];

    Object.keys(state.ranges).forEach(key => {
        if (state.ranges[key].active) {
            const r = state.ranges[key];
            if (typeof state.options[key] === 'boolean') {
                totalCombinations *= 2;
                rangeInfo.push({ name: state.inputMetadata[key] || key, count: 2 });
            } else {
                const steps = Math.round((r.max - r.min) / r.step);
                const count = steps + 1;
                totalCombinations *= count;
                rangeInfo.push({ name: state.inputMetadata[key] || key, count: count });
            }
        }
    });

    const totalBacktests = symbolCount * timeframeCount * totalCombinations;

    // Update the UI
    const totalElement = document.getElementById('totalBacktests');
    const detailsElement = document.getElementById('breakdownDetails');

    if (totalElement && detailsElement) {
        totalElement.textContent = totalBacktests.toLocaleString();

        // Build breakdown string
        let breakdown = `${symbolCount} symbol${symbolCount !== 1 ? 's' : ''} × ${timeframeCount} timeframe${timeframeCount !== 1 ? 's' : ''}`;

        if (rangeInfo.length > 0) {
            breakdown += ` × ${totalCombinations.toLocaleString()} combinations`;
            const rangeDesc = rangeInfo.map(r => `${r.name}: ${r.count}`).join(', ');
            breakdown += ` (${rangeDesc})`;
        }

        detailsElement.textContent = breakdown;

        // Color-code the total based on size
        if (totalBacktests > 500) {
            totalElement.style.background = 'linear-gradient(45deg, #ff9800, #f44336)';
            totalElement.style.webkitBackgroundClip = 'text';
            totalElement.style.backgroundClip = 'text';
        } else if (totalBacktests > 100) {
            totalElement.style.background = 'linear-gradient(45deg, #ffc107, #ff9800)';
            totalElement.style.webkitBackgroundClip = 'text';
            totalElement.style.backgroundClip = 'text';
        } else {
            totalElement.style.background = 'linear-gradient(45deg, #2962ff, #00bfa5)';
            totalElement.style.webkitBackgroundClip = 'text';
            totalElement.style.backgroundClip = 'text';
        }
    }
}

async function runBacktest() {
    const timeframes = Array.from(document.querySelectorAll('input[name="timeframe"]:checked'))
        .map(cb => cb.value);

    if (state.symbols.length === 0 || timeframes.length === 0) {
        return alert('Please enter at least one symbol and select at least one timeframe');
    }

    // Calculate total number of option combinations
    let totalCombinations = 1;
    const rangeDetails = [];

    Object.keys(state.ranges).forEach(key => {
        if (state.ranges[key].active) {
            const r = state.ranges[key];
            if (typeof state.options[key] === 'boolean') {
                totalCombinations *= 2;
                rangeDetails.push(`${state.inputMetadata[key] || key}: 2 values (true/false)`);
            } else {
                const steps = Math.round((r.max - r.min) / r.step);
                const count = steps + 1;
                totalCombinations *= count;
                rangeDetails.push(`${state.inputMetadata[key] || key}: ${count} values (${r.min} to ${r.max} by ${r.step})`);
            }
        }
    });

    const totalBacktests = state.symbols.length * timeframes.length * totalCombinations;

    // Show confirmation if running many backtests
    if (totalBacktests > 50) {
        const details = rangeDetails.length > 0 ? '\n\nRange details:\n' + rangeDetails.join('\n') : '';
        const message = `You are about to run ${totalBacktests} backtests:\n• ${state.symbols.length} symbols\n• ${timeframes.length} timeframes\n• ${totalCombinations} option combinations${details}\n\nThis may take several minutes. Continue?`;

        if (!confirm(message)) {
            return;
        }
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
            inputMetadata: state.inputMetadata, // Send readable names to backend
            dateFrom: dateFromInput.value,
            dateTo: dateToInput.value
        };

        // Debug: Log the ranges being sent
        console.log('📤 Sending ranges to backend:');
        Object.keys(state.ranges).forEach(key => {
            if (state.ranges[key].active) {
                const r = state.ranges[key];
                console.log(`  ${key}: min=${r.min}, max=${r.max}, step=${r.step}`);
            }
        });


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
        localStorage.setItem('currentJobId', jobId); // Persist for auto-resume
        console.log('Job started:', jobId);

        // Connect to WebSocket
        connectWebSocket(jobId);



    } catch (error) {
        const errorMsg = error.message || 'Unknown error';
        statusMessage.textContent = '❌ Error: ' + errorMsg;
        statusMessage.style.color = '#ff4444';
        statusMessage.className = 'status-message error';
        
        // Show alert for credential errors
        if (errorMsg.includes('credentials') || errorMsg.includes('Chrome Extension')) {
            alert('⚠️ ' + errorMsg + '\n\nPlease sync again using the Chrome Extension.');
        }
        
        resetButtons();
    }
}

function resetButtons() {
    runBacktestBtn.disabled = false;
    runBacktestBtn.textContent = 'Run Backtest';
    stopBacktestBtn.classList.add('hidden');
    state.currentJobId = null;
    localStorage.removeItem('currentJobId'); // Clear active job
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
            <td colspan="8" class="negative">${r.error || 'Unknown error (No report data)'}</td>
        `;
    } else {
        const netProfit = r.report.netProfit !== 'N/A' ? r.report.netProfit : null;
        const netProfitClass = netProfit !== null && netProfit >= 0 ? 'positive' : 'negative';

        // Calculate number of days and profit per day
        let nbDays = 'N/A';
        let profitPerDay = 'N/A';

        if (r.fullReport && r.fullReport.trades && r.fullReport.trades.length > 0) {
            const trades = r.fullReport.trades;
            const firstTradeTime = trades[0].entry?.time;
            const lastTradeTime = trades[trades.length - 1].exit?.time;

            if (firstTradeTime && lastTradeTime) {
                const firstDate = new Date(firstTradeTime);
                const lastDate = new Date(lastTradeTime);
                const diffInMs = firstDate - lastDate;
                const diffInDays = diffInMs / (1000 * 60 * 60 * 24);
                nbDays = diffInDays.toFixed(2);

                // Calculate profit per day
                if (netProfit !== null && diffInDays > 0) {
                    profitPerDay = (netProfit / diffInDays).toFixed(2);
                }
            }
        }

        const profitPerDayClass = profitPerDay !== 'N/A' && parseFloat(profitPerDay) >= 0 ? 'positive' : 'negative';

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



// ======= TABLE SORTING =======
let sortState = { column: null, direction: 'asc' };

function initTableSorting() {
    const headers = document.querySelectorAll('#resultsTable th');
    const sortableColumns = [3, 4, 5, 6, 7, 8, 9, 10]; // Net Profit, Trades, % Win, PF, DD, Avg Trade, Nb Days, Profit per days

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
    const drawdownPercent = report.history.drawDownPercent || [];

    // Create labels from trade dates if available
    let labels = [];
    if (report.trades && report.trades.length > 0) {
        // Use trade exit times as labels
        labels = report.trades.map(trade => {
            const date = new Date(trade.exit?.time);
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
        });

        // Reverse labels to match equity order (Oldest -> Newest)
        labels.reverse();

        // If equity array is longer than trades (includes initial capital), 
        // prepend empty labels to align
        if (equity.length > labels.length) {
            const extraPoints = equity.length - labels.length;
            for (let i = 0; i < extraPoints; i++) {
                labels.unshift(''); // Prepend to start
            }
        }
    } else {
        // Fallback to indices if no trade data
        labels = equity.map((_, i) => i);
    }

    currentChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Equity',
                    data: equity,
                    borderColor: '#00bfa5',
                    backgroundColor: 'rgba(0, 191, 165, 0.1)',
                    fill: true,
                    tension: 0.1,
                    borderWidth: 2,
                    yAxisID: 'y'
                },
                {
                    label: 'Drawdown %',
                    data: drawdownPercent,
                    borderColor: '#f23645',
                    backgroundColor: 'rgba(242, 54, 69, 0.1)',
                    fill: true,
                    tension: 0.1,
                    borderWidth: 1,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    labels: {
                        color: '#e0e3eb'
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                if (context.dataset.yAxisID === 'y1') {
                                    // drawDownPercent is already in percentage format, no need to multiply by 100
                                    label += context.parsed.y.toFixed(2) + '%';
                                } else {
                                    label += context.parsed.y.toFixed(2);
                                }
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: '#2a2e39'
                    },
                    ticks: {
                        color: '#787b86',
                        maxRotation: 45,
                        minRotation: 45
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grid: {
                        color: '#2a2e39'
                    },
                    ticks: {
                        color: '#787b86'
                    },
                    title: {
                        display: true,
                        text: 'Equity',
                        color: '#00bfa5'
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: {
                        drawOnChartArea: false // Don't draw grid lines for this axis
                    },
                    ticks: {
                        color: '#787b86',
                        callback: function (value) {
                            return value.toFixed(1) + '%';
                        }
                    },
                    title: {
                        display: true,
                        text: 'Drawdown %',
                        color: '#f23645'
                    },
                    // Reverse the scale so drawdown goes down from 0
                    reverse: true,
                    min: 0
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
        tbody.innerHTML = '<tr><td colspan="11">No trades available</td></tr>';
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
                <td>${trades.length - index}</td>
                <td>${type.toUpperCase()}</td>
                <td><small>${formatDateTime(trade.entry?.time)}</small></td>
                <td>${trade.entry?.value?.toFixed(5) || 'N/A'}</td>
                <td><small>${formatDateTime(trade.exit?.time)}</small></td>
                <td>${trade.exit?.value?.toFixed(5) || 'N/A'}</td>
                <td class="${profitClass}">${trade.profit?.v?.toFixed(2) || 'N/A'}</td>
                <td class="${profitClass}">${trade.profit?.p ? (trade.profit.p * 100).toFixed(2) + '%' : 'N/A'}</td>
                <td>${trade.cumulative?.v?.toFixed(2) || 'N/A'}</td>
                <td class="negative">${trade.drawdown?.v?.toFixed(2) || 'N/A'}</td>
                <td class="negative">${trade.drawdown?.p ? (trade.drawdown.p * 100).toFixed(2) + '%' : 'N/A'}</td>
            </tr>
        `;
    }).join('');
}
