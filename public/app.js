const state = {
    indicatorId: '',
    symbols: [], // Array of symbol strings
    options: {}, // Stores current values
    ranges: {},  // Stores range configs: { key: { active: true, min, max, step } }
    results: [],
    inputMetadata: {}, // Stores input names: { in_0: 'Stop Loss %', in_1: 'Take Profit %', ... }
    currentJobId: null,
    session: null, // Store session for history filtering
    currentIndicator: {  // Current indicator structure with tabs and groups
        tabs: [],
        groups: [],
        inputs: {}
    },
    activeTab: 'Inputs'  // Track current active tab
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
const reloadPreviousSettingsBtn = document.getElementById('reloadPreviousSettingsBtn');

// History Elements
const historyBtn = document.getElementById('historyBtn');
const historyModal = document.getElementById('historyModal');
const closeHistoryBtn = document.getElementById('closeHistoryBtn');
const historyTableBody = document.getElementById('historyTableBody');

// Parallel connections input
const parallelInput = document.getElementById('parallelInput');
const badgeHint = document.getElementById('badgeHint');

// LocalStorage helper functions
function getSyncData() {
    try {
        const data = localStorage.getItem('tvBacktestSyncData');
        return data ? JSON.parse(data) : null;
    } catch (e) {
        console.error('Error parsing sync data:', e);
        return null;
    }
}

// Default plan connections mapping
// Conservative limits to avoid TradingView 429 rate limiting
const DEFAULT_PLAN_CONNECTIONS = {
    'Free': 1,
    'Essential': 2,
    'Plus': 4,
    'Premium': 8,
    'Ultimate': 15
};

// Get saved parallel value or default for account type
function getSavedParallelValue() {
    const saved = localStorage.getItem('parallelConnections');
    return saved ? parseInt(saved, 10) : null;
}

// Save parallel value
function saveParallelValue(value) {
    localStorage.setItem('parallelConnections', value.toString());
}

// Get max connections for current account (uses saved value or default)
function getMaxConnections(accountType) {
    const saved = getSavedParallelValue();
    if (saved && saved >= 1) {
        return saved;
    }
    return DEFAULT_PLAN_CONNECTIONS[accountType] || DEFAULT_PLAN_CONNECTIONS['Free'] || 1;
}

// Get recommended value for account type
function getRecommendedConnections(accountType) {
    return DEFAULT_PLAN_CONNECTIONS[accountType] || 1;
}

// Update account badge display
function updateAccountBadge(accountType) {
    const badge = document.getElementById('accountBadge');
    if (!badge) return;
    
    const planSpan = badge.querySelector('.badge-plan');
    
    // Always show badge (even for Free accounts, so user can adjust parallel value)
    const recommended = getRecommendedConnections(accountType || 'Free');
    const currentValue = getSavedParallelValue() || recommended;
    
    if (planSpan) planSpan.textContent = accountType || 'Free';
    if (parallelInput) {
        parallelInput.value = currentValue;
        parallelInput.max = Math.max(50, recommended * 3); // Allow up to 3x recommended or 50
    }
    if (badgeHint) {
        badgeHint.textContent = i18n.t('tooltips.recommended', { recommended });
    }
    
    badge.classList.remove('hidden');
}

function getSettings() {
    try {
        const data = localStorage.getItem('backtestSettings');
        return data ? JSON.parse(data) : null;
    } catch (e) {
        console.error('Error parsing settings:', e);
        return null;
    }
}

function getCurrentJobId() {
    return localStorage.getItem('currentJobId');
}

// Status message helper
function updateStatus(message, type = 'info') {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
}

// Show 429 rate limit warning
function showRateLimitWarning() {
    const syncData = getSyncData();
    const accountType = syncData?.accountType || 'Free';
    const recommended = getRecommendedConnections(accountType);
    
    // Flash the badge and hint to draw attention
    const badge = document.getElementById('accountBadge');
    if (badge) {
        badge.classList.add('rate-limit-error');
        setTimeout(() => badge.classList.remove('rate-limit-error'), 3000);
    }
    
    // Update status with helpful message
    updateStatus(
        i18n.t('errors.rateLimitWarning', { recommended, accountType }),
        'error'
    );
}

// Event Listeners
historyBtn.addEventListener('click', openHistoryModal);
closeHistoryBtn.addEventListener('click', () => historyModal.classList.add('hidden'));
runBacktestBtn.addEventListener('click', runBacktest);
stopBacktestBtn.addEventListener('click', stopBacktest);
clearSettingsBtn.addEventListener('click', clearSettings);
reloadPreviousSettingsBtn.addEventListener('click', () => {
    if (state.indicatorId && window.currentIndicatorObj) {
        loadIndicatorWithLocalValues(window.currentIndicatorObj);
    }
});

// Parallel input listener - save on change
if (parallelInput) {
    parallelInput.addEventListener('change', () => {
        const value = parseInt(parallelInput.value, 10);
        if (!isNaN(value) && value >= 1) {
            saveParallelValue(value);
            console.log('💾 Saved parallel connections:', value);
        }
    });
}

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
    // Initialize i18n FIRST
    await i18n.init();
    i18n.updateDOM();

    // Initialize language selector
    const langToggle = document.getElementById('langToggle');
    const currentLangText = document.getElementById('currentLangText');
    if (langToggle && currentLangText) {
        currentLangText.textContent = i18n.getCurrentLanguage().toUpperCase();
        langToggle.addEventListener('click', () => {
            const newLang = i18n.getCurrentLanguage() === 'en' ? 'fr' : 'en';
            i18n.setLanguage(newLang);
            currentLangText.textContent = newLang.toUpperCase();
        });
    }

    initializeDateInputs();
    loadSettings();

    // Initialize from localStorage if available
    const syncData = getSyncData();
    if (syncData) {
        autoLoadFromSync(syncData);
    }

    // Attach timeframe listeners after DOM is ready
    attachTimeframeListeners();

    // Always ensure step1 is visible on page load
    const step1 = document.getElementById('step1');
    if (step1) step1.classList.remove('hidden');

    // Check for active job to restore
    checkActiveJob();

    // Listen for sync data from content script (postMessage)
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'TV_BACKTEST_SYNC_DATA') {
            console.log('🔄 Received sync data from content script:', event.data.data);
            autoLoadFromSync(event.data.data);
        }
    });

    // Settings import/export event listeners
    const exportSettingsBtn = document.getElementById('exportSettingsBtn');
    const importSettingsBtn = document.getElementById('importSettingsBtn');
    const importSettingsFile = document.getElementById('importSettingsFile');

    if (exportSettingsBtn) {
        exportSettingsBtn.addEventListener('click', exportSettings);
    }
    if (importSettingsBtn) {
        importSettingsBtn.addEventListener('click', () => importSettingsFile.click());
    }
    if (importSettingsFile) {
        importSettingsFile.addEventListener('change', handleImportSettings);
    }

    // Results import/export event listeners
    const exportResultsJSONBtn = document.getElementById('exportResultsJSONBtn');
    const importResultsBtn = document.getElementById('importResultsBtn');
    const importResultsFile = document.getElementById('importResultsFile');

    if (exportResultsJSONBtn) {
        exportResultsJSONBtn.addEventListener('click', exportResultsJSON);
    }
    if (importResultsBtn) {
        importResultsBtn.addEventListener('click', () => importResultsFile.click());
    }
    if (importResultsFile) {
        importResultsFile.addEventListener('change', handleImportResults);
    }
});

// Auto-load data from sync
function autoLoadFromSync(syncData) {
    if (!syncData) return;

    // Ensure data is saved to localStorage for other functions (like fetchHistory)
    localStorage.setItem('tvBacktestSyncData', JSON.stringify(syncData));

    console.log('🚀 Auto-loading from sync data:', JSON.stringify(syncData, null, 2));

    // Update account badge if account type is available
    if (syncData.accountType) {
        updateAccountBadge(syncData.accountType);
        console.log(`👤 Account type: ${syncData.accountType}`);
    } else {
        console.warn('⚠️ No accountType in syncData');
    }

    // Ensure step1 is visible when syncing from extension
    const step1 = document.getElementById('step1');
    if (step1) step1.classList.remove('hidden');

    // If we have indicators, render them
    if (syncData.indicators && syncData.indicators.length > 0) {
        console.log(`📊 Found ${syncData.indicators.length} indicators`);
        renderDiscoveredIndicators(syncData.indicators);

        // Store globally for access
        window.chartContext = {
            symbol: syncData.symbol || '',
            timeframe: syncData.timeframe || ''
        };

        // Auto-load previous indicator if saved settings exist and indicator is available
        const savedSettings = getSettings();
        if (savedSettings && savedSettings.indicatorId) {
            const savedIndicator = syncData.indicators.find(ind => ind.id === savedSettings.indicatorId);
            if (savedIndicator) {
                console.log('🔄 Auto-loading previous indicator with saved settings:', savedIndicator.name);
                // Use loadIndicatorWithLocalValues to restore all saved settings
                loadIndicatorWithLocalValues(savedIndicator);
                updateStatus(i18n.t('messages.restoredSettings', { indicator: savedIndicator.name }), 'success');
                setTimeout(() => statusMessage.textContent = '', 3000);
                return; // Don't show the sync notification since we're restoring
            }
        }

        // Show notification only if we didn't auto-load
        if (statusMessage) {
            updateStatus(i18n.t('messages.syncedIndicators', { count: syncData.indicators.length }), 'success');
            setTimeout(() => statusMessage.textContent = '', 5000);
        }
    }
}

async function checkActiveJob() {
    const savedJobId = getCurrentJobId();
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
    historyTableBody.innerHTML = `<tr><td colspan="5">${i18n.t('messages.loadingHistory')}</td></tr>`;
    try {
        // Get session from localStorage to filter history
        const headers = {};
        const syncData = getSyncData();
        if (syncData && syncData.session) {
            headers['x-session-id'] = syncData.session;
            console.log('✅ fetchHistory: Using session from localStorage');
        }

        if (!headers['x-session-id']) {
            console.warn('⚠️ fetchHistory: No session found in localStorage');
        }

        const res = await fetch('/api/jobs', { headers });
        const jobs = await res.json();
        renderHistory(jobs);
    } catch (e) {
        historyTableBody.innerHTML = `<tr><td colspan="5" class="negative">${i18n.t('messages.historyError', { message: e.message })}</td></tr>`;
    }
}

function renderHistory(jobs) {
    historyTableBody.innerHTML = '';
    if (jobs.length === 0) {
        historyTableBody.innerHTML = `<tr><td colspan="5">${i18n.t('messages.noHistory')}</td></tr>`;
        return;
    }

    jobs.forEach(job => {
        const row = document.createElement('tr');
        const date = new Date(job.date).toLocaleString();
        const statusClass = `status-${job.status}`;
        
        // Show symbols preview (first 3 + count)
        let symbolsDisplay = '-';
        if (job.symbols && job.symbols.length > 0) {
            const preview = job.symbols.slice(0, 3).join(', ');
            const remaining = job.symbols.length > 3 ? ` +${job.symbols.length - 3}` : '';
            symbolsDisplay = `${preview}${remaining}`;
        }

        const translatedStatus = i18n.t(`status.${job.status}`) || job.status;

        row.innerHTML = `
            <td>${date}</td>
            <td><span class="status-badge ${statusClass}">${translatedStatus}</span></td>
            <td title="${job.symbols?.join(', ') || ''}">${symbolsDisplay}</td>
            <td>${job.symbolCount || 0}</td>
            <td class="actions-cell">
                <button class="btn small primary load-job-btn" data-job-id="${job.id}">${i18n.t('buttons.load')}</button>
                <button class="btn small secondary export-json-btn" data-job-id="${job.id}">📥 Export</button>
                <button class="btn small secondary share-job-btn" data-job-id="${job.id}">🔗 Share</button>
            </td>
        `;

        // Add click handlers to the buttons
        const loadBtn = row.querySelector('.load-job-btn');
        const exportJSONBtn = row.querySelector('.export-json-btn');
        const shareBtn = row.querySelector('.share-job-btn');

        loadBtn.addEventListener('click', () => handleLoadJob(job.id, loadBtn));
        exportJSONBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            exportHistoryJobJSON(job.id);
        });
        shareBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            shareJob(job.id);
        });
        
        historyTableBody.appendChild(row);
    });
}

// Handle load job with streaming for progressive loading
async function handleLoadJob(jobId, button) {
    try {
        // Add loading state to button
        button.classList.add('loading');
        button.disabled = true;
        
        // Show loading message
        statusMessage.textContent = i18n.t('messages.loadingJob');
        statusMessage.className = 'status-message info';
        
        // Close modal immediately to show results as they stream in
        historyModal.classList.add('hidden');
        
        // Use streaming endpoint
        await loadJobWithStreaming(jobId);
        
        // Remove loading state
        button.classList.remove('loading');
        button.disabled = false;

    } catch (e) {
        // Remove loading state
        button.classList.remove('loading');
        button.disabled = false;
        
        alert(i18n.t('errors.loadingJob', { message: e.message }));
    }
}

// Load job with Server-Sent Events for progressive rendering
async function loadJobWithStreaming(jobId) {
    return new Promise((resolve, reject) => {
        // EventSource doesn't support custom headers, so pass session as query param
        const syncData = getSyncData();
        const sessionParam = syncData?.session ? `?session=${encodeURIComponent(syncData.session)}` : '';
        const eventSource = new EventSource(`/api/jobs/${jobId}/stream${sessionParam}`);
        let jobMetadata = null;
        let allResults = [];
        
        // Set currentJobId immediately so export works even during loading
        state.currentJobId = jobId;
        
        eventSource.addEventListener('metadata', (event) => {
            try {
                jobMetadata = JSON.parse(event.data);
                
                // Initialize UI with metadata
                state.currentJobId = jobMetadata.id || jobId; // Use jobId as fallback
                state.results = [];
                
                // Restore config if available
                if (jobMetadata.config) {
                    restoreJobConfig(jobMetadata.config);
                }
                
                // Show step 3 and clear results table
                step3.classList.remove('hidden');
                historyBtn.classList.remove('hidden');
                resultsTableBody.innerHTML = '';
                
                // Show progress
                if (jobMetadata.totalResults > 0) {
                    statusMessage.textContent = i18n.t('messages.loadingResults', { progress: 0, total: jobMetadata.totalResults });
                } else {
                    statusMessage.textContent = i18n.t('messages.jobLoadedNoResults');
                }
            } catch (e) {
                console.error('Error parsing metadata:', e);
            }
        });
        
        eventSource.addEventListener('results', (event) => {
            try {
                const data = JSON.parse(event.data);
                
                // Add results progressively
                data.batch.forEach(result => {
                    state.results.push(result);
                    allResults.push(result);
                    addResultRow(result);
                });
                
                // Update progress
                statusMessage.textContent = i18n.t('messages.loadingResults', { progress: data.progress, total: data.total });
            } catch (e) {
                console.error('Error parsing results:', e);
            }
        });
        
        eventSource.addEventListener('complete', (event) => {
            eventSource.close();
            
            // Final status update
            if (jobMetadata) {
                const dateStr = jobMetadata.startTime 
                    ? new Date(jobMetadata.startTime).toLocaleString() 
                    : 'unknown date';
                statusMessage.textContent = i18n.t('messages.jobLoaded', { date: dateStr, count: allResults.length });
                
                if (jobMetadata.status === 'completed') {
                    statusMessage.style.color = '#4CAF50';
                } else if (jobMetadata.status === 'failed') {
                    statusMessage.style.color = '#ff4444';
                }
            }
            
            // Save ID to local storage and state
            localStorage.setItem('currentJobId', jobId);
            state.currentJobId = jobId; // Keep the jobId for export
            resetButtonsKeepJob(); // Don't clear currentJobId
            
            resolve();
        });
        
        eventSource.addEventListener('error', (event) => {
            eventSource.close();
            
            try {
                const data = JSON.parse(event.data);
                reject(new Error(data.message || 'Failed to load job'));
            } catch (e) {
                reject(new Error('Failed to load job'));
            }
        });
        
        // Handle connection errors
        eventSource.onerror = () => {
            eventSource.close();
            reject(new Error('Connection lost while loading job'));
        };
    });
}

// Helper function to restore job config (extracted from restoreJob)
function restoreJobConfig(cfg) {
    // Restore Indicator ID
    if (cfg.indicatorId) {
        state.indicatorId = cfg.indicatorId;
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
    if (cfg.indicatorId) {
        const syncData = getSyncData();
        if (syncData && syncData.indicators) {
            const indicator = syncData.indicators.find(ind => ind.id === cfg.indicatorId);

            if (indicator && indicator.inputs) {
                window.currentIndicatorObj = indicator;
                state.indicatorId = indicator.id;

                window.savedOptionsAndRanges = {
                    indicatorId: cfg.indicatorId,
                    options: cfg.options,
                    ranges: cfg.ranges
                };

                renderOptions(indicator);

                state.options = cfg.options || {};
                state.ranges = cfg.ranges || {};

                updateBacktestSummary();
            }
        }
    }
    
    // Check if we have saved settings to show the button
    const savedSettings = getSettings();
    if (savedSettings && savedSettings.indicatorId === state.indicatorId) {
        reloadPreviousSettingsBtn.classList.remove('hidden');
    }
}

window.loadJob = async (jobId) => {
    // Legacy function for backwards compatibility
    const button = document.querySelector(`[data-job-id="${jobId}"]`);
    if (button) {
        handleLoadJob(jobId, button);
    } else {
        // Fallback if button not found - use streaming anyway
        try {
            historyModal.classList.add('hidden');
            statusMessage.textContent = i18n.t('messages.loadingJob');
            await loadJobWithStreaming(jobId);
        } catch (e) {
            alert(i18n.t('errors.loadingJob', { message: e.message }));
        }
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
        if (cfg.indicatorId) {
            // Try to find indicator in local sync data to get inputs
            const syncData = getSyncData();
            if (syncData && syncData.indicators) {
                const indicator = syncData.indicators.find(ind => ind.id === cfg.indicatorId);

                if (indicator && indicator.inputs) {
                    // Store the indicator object for "Load Saved Settings" button
                    window.currentIndicatorObj = indicator;
                    state.indicatorId = indicator.id;

                    // Temporarily set savedOptionsAndRanges so renderOptions uses them
                    window.savedOptionsAndRanges = {
                        indicatorId: cfg.indicatorId,
                        options: cfg.options,
                        ranges: cfg.ranges
                    };

                    // renderOptions expects the full indicator object, not just inputs
                    renderOptions(indicator);

                    // Update state explicitly just in case
                    state.options = cfg.options || {};
                    state.ranges = cfg.ranges || {};

                    updateBacktestSummary();
                }
            }
        }
    }

    // Update UI
    step3.classList.remove('hidden');

    // Show header buttons
    historyBtn.classList.remove('hidden');
    // Check if we have saved settings to show the button
    const savedSettings = getSettings();
    if (savedSettings && savedSettings.indicatorId === state.indicatorId) {
        reloadPreviousSettingsBtn.classList.remove('hidden');
    }

    resultsTableBody.innerHTML = '';

    // Render results
    if (job.results) {
        job.results.forEach(r => addResultRow(r));
    }

    // Update status
    if (job.status === 'running' || job.status === 'pending') {
        statusMessage.textContent = i18n.t('messages.resumingBacktest');
        runBacktestBtn.disabled = true;
        runBacktestBtn.textContent = i18n.t('messages.runningBacktest');
        stopBacktestBtn.classList.remove('hidden');

        // Reconnect WebSocket
        connectWebSocket(job.id);
    } else {
        statusMessage.textContent = i18n.t('messages.jobLoaded', { date: new Date(job.startTime).toLocaleString(), count: state.results.length });
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

        if (msg.type === 'pending') {
            // Add a pending row to show what's queued
            addPendingRow(msg.data);
        } else if (msg.type === 'running') {
            // Update row to show it's currently running
            updateRowStatus(msg.data, 'running');
        } else if (msg.type === 'progress') {
            // Update progress bar (no text status message)
            updateProgressBar(msg.percent, msg.current, msg.total);
        } else if (msg.type === 'saved') {
            // Update saved progress indicator
            updateSavedProgress(msg.index, msg.total);
        } else if (msg.type === 'result') {
            state.results.push(msg.data);
            updateRowWithResult(msg.data);
            
            // Check if result contains a 429 error - show special warning
            if (msg.data.error && msg.data.error.includes('429')) {
                showRateLimitWarning();
            }
        } else if (msg.type === 'retrying') {
            // Update the specific row to show retry status (orange)
            updateRowWithRetrying(msg.data);
        } else if (msg.type === 'retry_complete') {
            // A retry completed successfully - update handled by 'result' message
            console.log('✓ Retry completed:', msg.data.symbol, msg.data.timeframe);
        } else if (msg.type === 'complete') {
            statusMessage.textContent = '✅ ' + i18n.t('messages.backtestComplete');
            statusMessage.style.color = '#4CAF50';
            // Hide saved progress after completion
            setTimeout(() => {
                const savedContainer = document.getElementById('savedProgressContainer');
                if (savedContainer) savedContainer.style.display = 'none';
            }, 3000);
            resetButtons();
            ws.close();
        } else if (msg.type === 'error') {
            // Check if error is rate limit (429)
            if (msg.message && msg.message.includes('429')) {
                showRateLimitWarning();
            }
            statusMessage.textContent = '❌ ' + i18n.t('errors.generic', { message: msg.message });
            statusMessage.style.color = '#ff4444';
            resetButtons();
            ws.close();
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        statusMessage.textContent = i18n.t('errors.connectionError');
    };
}

// Retry a failed backtest
async function retryBacktest(row) {
    const symbol = row.dataset.symbol;
    const timeframe = row.dataset.timeframe;
    const options = JSON.parse(row.dataset.options || '{}');
    
    if (!symbol || !timeframe) {
        console.error('Missing symbol or timeframe for retry');
        return;
    }
    
    const syncData = getSyncData();
    if (!syncData || !syncData.session) {
        alert(i18n.t('errors.noSession'));
        return;
    }
    
    // Update row to show retrying
    row.classList.remove('result-row-error');
    row.classList.add('result-row-running');
    row.innerHTML = `
        <td>${symbol}</td>
        <td>${timeframe}</td>
        <td><small>${formatOptions(options)}</small></td>
        <td colspan="6" class="pending-cell">
            <span class="running-indicator">${i18n.t('messages.retrying')}</span>
        </td>
    `;
    
    try {
        const response = await fetch('/api/retry-backtest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                symbol,
                timeframe,
                options,
                indicatorId: state.indicatorId,
                dateFrom: dateFromInput.value,
                dateTo: dateToInput.value,
                session: syncData.session,
                signature: syncData.signature,
                jobId: state.currentJobId
            })
        });
        
        const data = await response.json();
        
        if (data.success && data.result) {
            // Update state with new result
            const existingIndex = state.results.findIndex(r => 
                r.symbol === symbol && 
                r.timeframe === timeframe && 
                JSON.stringify(r.options) === JSON.stringify(options)
            );
            
            if (existingIndex >= 0) {
                state.results[existingIndex] = data.result;
            } else {
                state.results.push(data.result);
            }
            
            updateRowWithResult(data.result);
        } else {
            // Update with error
            const errorResult = data.result || {
                symbol,
                timeframe,
                options,
                error: data.error || 'Retry failed'
            };
            updateRowWithResult(errorResult);
        }
    } catch (err) {
        console.error('Retry error:', err);
        const errorResult = {
            symbol,
            timeframe,
            options,
            error: err.message || 'Network error during retry'
        };
        updateRowWithResult(errorResult);
    }
}

// Helper: Generate range values (Client-side)
function getRangeValues(min, max, step) {
    const values = [];

    // Validate inputs
    min = parseFloat(min);
    max = parseFloat(max);
    step = parseFloat(step);

    if (isNaN(min) || isNaN(max) || isNaN(step)) {
        throw new Error('Invalid number in range definition (min, max, or step)');
    }

    if (step <= 0) {
        console.warn(`Invalid step value: ${step}, using 1`);
        step = 1;
    }

    // Calculate expected array size
    const steps = Math.round((max - min) / step);
    const expectedSize = steps + 1;

    // Prevent creating arrays that are too large (max 1000 values per parameter)
    if (expectedSize > 1000) {
        throw new Error(`Range too large: ${expectedSize} values (max 1000). Adjust your min/max/step values.`);
    }

    for (let i = 0; i <= steps; i++) {
        let val = min + (step * i);
        // Fix floating point precision (e.g. 0.1 + 0.2 = 0.30000000000000004)
        val = parseFloat(val.toPrecision(10));
        values.push(val);
    }

    return values;
}

// Helper: Generate Cartesian product of options (Client-side)
function generateOptionCombinations(baseOptions, ranges) {
    const keys = Object.keys(baseOptions);
    const combinations = [{}];

    keys.forEach(key => {
        let values = [baseOptions[key]];

        // If this key has a range defined, use it
        if (ranges && ranges[key] && ranges[key].active) {
            if (typeof baseOptions[key] === 'boolean') {
                values = [true, false];
                console.log(`🔧 Range for ${key}: boolean (testing true/false)`);
            } else {
                const { min, max, step } = ranges[key];
                console.log(`🔧 Range for ${key}: min=${min}, max=${max}, step=${step}`);
                values = getRangeValues(min, max, step);
                console.log(`  → Generated ${values.length} values: [${values.join(', ')}]`);
            }
        }

        const newCombinations = [];
        combinations.forEach(combo => {
            values.forEach(val => {
                newCombinations.push({ ...combo, [key]: val });
            });
        });

        // Replace combinations with new expanded list
        combinations.length = 0;
        combinations.push(...newCombinations);
    });

    return combinations;
}

async function runBacktest() {
    if (!state.indicatorId) {
        alert(i18n.t('errors.noIndicator'));
        return;
    }
    if (state.symbols.length === 0) {
        alert(i18n.t('errors.noSymbol'));
        return;
    }

    const selectedTimeframes = Array.from(document.querySelectorAll('input[name="timeframe"]:checked')).map(cb => cb.value);
    if (selectedTimeframes.length === 0) {
        alert(i18n.t('errors.noTimeframe'));
        return;
    }

    updateStatus(i18n.t('messages.startingBacktest'), 'info');
    runBacktestBtn.disabled = true;
    runBacktestBtn.textContent = i18n.t('messages.runningBacktest');
    stopBacktestBtn.classList.remove('hidden');
    resultsTableBody.innerHTML = '';
    state.results = []; // Clear previous results
    step3.classList.remove('hidden'); // Show results section

    // Scroll to results section
    setTimeout(() => {
        step3.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    // Get credentials from localStorage
    let session = null;
    let signature = null;
    const syncData = getSyncData();
    if (syncData) {
        session = syncData.session;
        signature = syncData.signature;
    }

    // Generate option combinations locally
    let optionCombinations = [];
    try {
        optionCombinations = generateOptionCombinations(state.options, state.ranges);
        console.log(`Generated ${optionCombinations.length} option combinations`);
    } catch (e) {
        alert(i18n.t('errors.generateCombinations', { message: e.message }));
        resetButtons();
        return;
    }

    // Calculate total tests for confirmation
    const totalTests = state.symbols.length * selectedTimeframes.length * optionCombinations.length;

    // Warn if too many tests
    if (totalTests > 100) {
        if (!confirm(i18n.t('dialogs.confirmBacktest', { count: totalTests }))) {
            resetButtons();
            return;
        }
    }

    try {
        // Get account type from sync data
        const accountType = syncData ? (syncData.accountType || 'Free') : 'Free';
        // Get parallel value from input or use saved/default
        const maxParallelConnections = parallelInput ? parseInt(parallelInput.value, 10) : getMaxConnections(accountType);
        
        // Save the value for next time
        if (parallelInput && !isNaN(maxParallelConnections)) {
            saveParallelValue(maxParallelConnections);
        }
        
        console.log('📊 Starting backtest with accountType:', accountType, 'maxParallel:', maxParallelConnections);
        
        const response = await fetch('/api/backtest', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                indicatorId: state.indicatorId,
                symbols: state.symbols,
                timeframes: selectedTimeframes,
                // Send pre-generated combinations instead of raw options/ranges
                combinations: optionCombinations,
                // Still send ranges for UI/logging purposes if needed, but logic is done
                ranges: state.ranges,
                dateFrom: dateFromInput.value,
                dateTo: dateToInput.value,
                session: session, // Include session
                signature: signature, // Include signature
                accountType: accountType, // Include account type for parallel execution
                maxParallelConnections: maxParallelConnections // User-configured limit
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Failed to start backtest');
        }

        const job = await response.json();
        state.currentJobId = job.id;
        localStorage.setItem('currentJobId', job.id);
        connectWebSocket(job.id);

        updateStatus(`Backtest started (${totalTests} tests). Waiting for results...`, 'info');

        saveSettings(); // Save current settings after starting backtest

    } catch (error) {
        console.error('Backtest error:', error);
        updateStatus('❌ ' + i18n.t('errors.generic', { message: error.message }), 'error');
        resetButtons();
    }
}

function renderDiscoveredIndicators(indicators) {
    if (!discoveredContainer) return;

    discoveredContainer.innerHTML = '<br/>';

    const list = document.createElement('div');
    list.className = 'discovered-list';

    indicators.forEach(ind => {
        const item = document.createElement('div');
        item.className = 'discovered-item';
        item.onclick = () => loadIndicatorWithTVValues(ind);

        // Create indicator info section
        const infoDiv = document.createElement('div');
        infoDiv.className = 'indicator-info';
        infoDiv.innerHTML = `
            <div class="name">${ind.name}</div>
        `;

        item.appendChild(infoDiv);
        list.appendChild(item);
    });

    discoveredContainer.appendChild(list);
    discoveredContainer.classList.remove('hidden');
}

// Load indicator with TradingView values
function loadIndicatorWithTVValues(indicator) {
    console.log('Loading with TradingView values:', indicator);

    // RESET STATE when switching indicators
    state.indicatorId = indicator.id;
    state.options = {};
    state.ranges = {};
    state.inputMetadata = {};
    state.activeTab = 'Inputs';
    state.currentIndicator = {
        tabs: indicator.tabs || [],
        groups: indicator.groups || [],
        inputs: indicator.inputs || {}
    };

    window.currentIndicatorObj = indicator; // Store for "Load Saved Settings" button

    // Show History Button
    historyBtn.classList.remove('hidden');

    // Check if we should show "Load Saved Settings" button
    reloadPreviousSettingsBtn.classList.add('hidden');
    const savedSettings = getSettings();
    if (savedSettings && savedSettings.indicatorId === indicator.id) {
        reloadPreviousSettingsBtn.classList.remove('hidden');
    }

    // Note: No need to convert inputs format - they're already enriched objects from extension
    // Just store empty ranges for TradingView values (no optimization by default)
    window.savedOptionsAndRanges = {
        indicatorId: indicator.id,
        options: {},  // Will be populated by renderOptions from indicator.inputs
        ranges: {} // No ranges from TradingView
    };

    console.log('Loading indicator with', Object.keys(indicator.inputs || {}).length, 'inputs');

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
        updateStatus('💾 ' + i18n.t('messages.settingsLoaded', { indicator: indicator.name }), 'success');
        setTimeout(() => statusMessage.textContent = '', 3000);
    }

    // Fetch options - will use window.savedOptionsAndRanges
    fetchOptions();
}

// Load indicator with localStorage values
function loadIndicatorWithLocalValues(indicator) {
    console.log('Loading with localStorage values for:', indicator.id);

    state.indicatorId = indicator.id;
    window.currentIndicatorObj = indicator;

    // Show History Button
    historyBtn.classList.remove('hidden');
    // Ensure Load Saved Settings is visible since we just loaded from it
    reloadPreviousSettingsBtn.classList.remove('hidden');

    // Restore from localStorage
    const settings = getSettings();
    if (settings && settings.indicatorId === indicator.id) {
        window.savedOptionsAndRanges = {
            indicatorId: indicator.id,
            options: settings.options || {},
            ranges: settings.ranges || {}
        };
        console.log('Loaded localStorage values:', settings.options);

        // Also restore symbols, timeframes, and date range
        if (settings.symbols && Array.isArray(settings.symbols)) {
            state.symbols = settings.symbols;
            renderSymbols();
            console.log('Restored symbols:', settings.symbols);
        }

        // Restore timeframes
        if (settings.timeframes) {
            document.querySelectorAll('input[name="timeframe"]').forEach(cb => {
                cb.checked = settings.timeframes.includes(cb.value);
            });
            console.log('Restored timeframes:', settings.timeframes);
        }

        // Restore date range
        if (settings.dateFrom) {
            dateFromInput.value = settings.dateFrom;
            console.log('Restored dateFrom:', settings.dateFrom);
        }
        if (settings.dateTo) {
            dateToInput.value = settings.dateTo;
            console.log('Restored dateTo:', settings.dateTo);
        }
    } else {
        // Different indicator or no saved settings, clear saved values
        window.savedOptionsAndRanges = null;
    }

    // Show status message
    if (statusMessage) {
        updateStatus('💾 ' + i18n.t('messages.settingsLoaded', { indicator: indicator.name }), 'success');
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
    const settings = getSettings();

    // Default symbols if nothing saved
    const defaultSymbols = [
        'BINANCE:BTCUSDT.P', 'BINANCE:ETHUSDT.P', 'BINANCE:XRPUSDT.P',
        'BINANCE:BNBUSDT.P'
    ];

    if (!settings) {
        state.symbols = defaultSymbols;
        renderSymbols();
        return;
    }

    try {
        // Restore indicator ID
        if (settings.indicatorId) {
            state.indicatorId = settings.indicatorId;
            state.activeSource = 'saved';

            // Note: We no longer render saved indicator in step1 as UI has changed
            // renderSavedIndicator(settings);
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

// Export current settings to JSON file
function exportSettings() {
    try {
        const settings = {
            version: '1.0.0',
            exportDate: new Date().toISOString(),
            indicatorId: state.indicatorId,
            indicatorName: window.currentIndicatorObj?.name || 'Unknown',
            symbols: state.symbols,
            timeframes: Array.from(document.querySelectorAll('input[name="timeframe"]:checked')).map(cb => cb.value),
            options: state.options,
            ranges: state.ranges,
            dateFrom: dateFromInput.value,
            dateTo: dateToInput.value,
            inputMetadata: state.inputMetadata
            // NOTE: session is NOT exported for security reasons
        };

        if (!settings.indicatorId) {
            throw new Error('No indicator selected to export');
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `backtest-settings-${timestamp}.json`;
        const jsonString = JSON.stringify(settings, null, 2);

        // Create and trigger download
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        updateStatus('✅ ' + i18n.t('messages.settingsExported', { filename }), 'success');
        setTimeout(() => statusMessage.textContent = '', 3000);
    } catch (error) {
        console.error('Export settings error:', error);
        updateStatus('❌ ' + i18n.t('errors.exportFailed', { error: error.message }), 'error');
    }
}

// Import settings from JSON file
async function handleImportSettings(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        updateStatus('📤 ' + i18n.t('messages.importingResults'), 'info');

        const text = await file.text();
        const imported = JSON.parse(text);

        validateImportedSettings(imported);

        applyImportedSettings(imported);
        updateStatus('✅ ' + i18n.t('messages.settingsImported'), 'success');
        setTimeout(() => statusMessage.textContent = '', 3000);
        event.target.value = '';
    } catch (error) {
        console.error('Import settings error:', error);
        updateStatus('❌ ' + i18n.t('errors.importFailed', { error: error.message }), 'error');
        event.target.value = '';
    }
}

// Validate imported settings structure
function validateImportedSettings(settings) {
    if (!settings || typeof settings !== 'object') {
        throw new Error('Invalid settings file: not a valid JSON object');
    }
    if (!settings.indicatorId) {
        throw new Error('Invalid settings file: missing indicatorId');
    }
    if (!Array.isArray(settings.symbols)) {
        throw new Error('Invalid settings file: symbols must be an array');
    }
    if (!Array.isArray(settings.timeframes)) {
        throw new Error('Invalid settings file: timeframes must be an array');
    }
    if (typeof settings.options !== 'object') {
        throw new Error('Invalid settings file: options must be an object');
    }
    if (typeof settings.ranges !== 'object') {
        throw new Error('Invalid settings file: ranges must be an object');
    }
    return true;
}

// Apply imported settings to UI and state
function applyImportedSettings(imported) {
    state.indicatorId = imported.indicatorId;
    state.symbols = imported.symbols || [];
    renderSymbols();

    if (imported.timeframes) {
        document.querySelectorAll('input[name="timeframe"]').forEach(cb => {
            cb.checked = imported.timeframes.includes(cb.value);
        });
    }

    if (imported.dateFrom) dateFromInput.value = imported.dateFrom;
    if (imported.dateTo) dateToInput.value = imported.dateTo;

    state.options = imported.options || {};
    state.ranges = imported.ranges || {};
    state.inputMetadata = imported.inputMetadata || {};

    const syncData = getSyncData();
    if (syncData && syncData.indicators) {
        const indicator = syncData.indicators.find(ind => ind.id === imported.indicatorId);

        if (indicator) {
            window.currentIndicatorObj = indicator;
            window.savedOptionsAndRanges = {
                indicatorId: imported.indicatorId,
                options: imported.options,
                ranges: imported.ranges
            };
            renderOptions(indicator);
            step2.classList.remove('hidden');
        } else {
            updateStatus(`⚠️ Settings imported but indicator not found. Please sync from extension.`, 'warning');
        }
    }

    updateBacktestSummary();
    saveSettings();
}

function clearSettings() {
    if (!confirm(i18n.t('dialogs.confirmClear'))) {
        return;
    }

    localStorage.removeItem('backtestSettings');
    alert(i18n.t('messages.settingsCleared'));
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
    if (!state.indicatorId) {
        optionsContainer.innerHTML = `<p>${i18n.t('messages.pleaseSelectIndicator')}</p>`;
        return;
    }

    optionsContainer.innerHTML = `<p>${i18n.t('messages.loadingOptions')}</p>`;
    step2.classList.remove('hidden');
    step3.classList.add('hidden');

    try {
        // Get indicator from sync data (localStorage)
        const syncData = getSyncData();
        if (!syncData) {
            throw new Error('No sync data found. Please sync with extension.');
        }

        const indicator = syncData.indicators.find(ind => ind.id === state.indicatorId);

        if (!indicator) {
            throw new Error('Indicator not found in sync data.');
        }

        if (!indicator.inputs || Object.keys(indicator.inputs).length === 0) {
            throw new Error('Indicator has no inputs.');
        }

        // Store current indicator structure
        state.currentIndicator = {
            tabs: indicator.tabs || [{ name: 'Inputs', active: true }],
            groups: indicator.groups || [],
            inputs: indicator.inputs
        };

        console.log('✅ Loaded indicator from localStorage:', indicator.name);
        console.log('Tabs:', state.currentIndicator.tabs.length);
        console.log('Groups:', state.currentIndicator.groups.length);
        console.log('Inputs:', Object.keys(state.currentIndicator.inputs).length);

        renderOptions(indicator);
        updateBacktestSummary();

    } catch (e) {
        console.error('Error fetching options:', e);
        optionsContainer.innerHTML = `<p class="negative">${i18n.t('errors.loadingOptions', { message: e.message })}</p>`;
    }
}

function renderOptions(indicator) {
    optionsContainer.innerHTML = '';
    state.options = {};
    state.ranges = {};
    state.inputMetadata = {};

    const saved = window.savedOptionsAndRanges;
    const useSaved = saved && saved.indicatorId === state.indicatorId;

    // Create tabs navigation
    const tabsNav = document.createElement('div');
    tabsNav.className = 'indicator-tabs';
    indicator.tabs.forEach(tab => {
        const btn = document.createElement('button');
        btn.className = `tab-button ${tab.active ? 'active' : ''}`;
        btn.dataset.tab = tab.name;
        btn.textContent = tab.name;
        btn.onclick = () => switchTab(tab.name);
        tabsNav.appendChild(btn);
    });
    optionsContainer.appendChild(tabsNav);

    // Create tab content container
    const tabContent = document.createElement('div');
    tabContent.className = 'tab-content-container';

    indicator.tabs.forEach(tab => {
        const tabPane = document.createElement('div');
        tabPane.className = `tab-pane ${tab.active ? 'active' : ''}`;
        tabPane.dataset.tab = tab.name;

        const tabGroups = indicator.groups.filter(g => g.tab === tab.name);

        if (tabGroups.length === 0) {
            tabPane.innerHTML = `<p class="empty-tab">${i18n.t('messages.noSettingsInTab')}</p>`;
        } else {
            tabGroups.forEach(group => {
                const groupEl = renderGroup(group, indicator.inputs, useSaved, saved);
                if (groupEl) tabPane.appendChild(groupEl);
            });
        }

        tabContent.appendChild(tabPane);
    });

    optionsContainer.appendChild(tabContent);
    setTimeout(() => updateBacktestSummary(), 100);
}

function renderGroup(group, allInputs, useSaved, saved) {
    // Check if group has visible inputs
    const visibleInputs = group.inputs.filter(inputId => {
        const inputObj = allInputs[inputId];
        return inputObj && !inputObj.isHidden;
    });

    if (visibleInputs.length === 0) return null;

    const groupEl = document.createElement('div');
    groupEl.className = 'input-group collapsible';

    const header = document.createElement('div');
    header.className = 'group-header';
    header.innerHTML = `
        <span class="group-name">${group.name}</span>
        <span class="collapse-icon">▼</span>
    `;
    header.onclick = () => toggleGroup(group.id);
    groupEl.appendChild(header);

    const content = document.createElement('div');
    content.className = 'group-content';
    content.id = `group_${group.id}`;

    visibleInputs.forEach(inputId => {
        const inputObj = allInputs[inputId];
        const row = renderInputRow(inputId, inputObj, useSaved, saved);
        content.appendChild(row);
    });

    groupEl.appendChild(content);
    return groupEl;
}

function renderInputRow(key, inputObj, useSaved, saved) {
    let value = inputObj.value;  // Use TV value
    const label = inputObj.name || key;

    if (useSaved && saved.options && saved.options.hasOwnProperty(key)) {
        value = saved.options[key];
    }

    const isNumeric = inputObj.type === 'float' || inputObj.type === 'integer';
    state.options[key] = isNumeric ? parseFloat(value) : value;
    state.inputMetadata[key] = label;

    const row = document.createElement('div');
    row.className = 'option-row';

    const isNumber = inputObj.type === 'float' || inputObj.type === 'integer';
    const isBool = inputObj.type === 'bool';

    let inputHtml = '';
    if (isBool) {
        inputHtml = `
            <label class="toggle-switch">
                <input type="checkbox" ${value ? 'checked' : ''}
                       onchange="updateOption('${key}', this.checked, 'boolean')">
                <span class="slider"></span>
            </label>
        `;
    } else if (inputObj.options && Array.isArray(inputObj.options)) {
        inputHtml = `
            <select onchange="updateOption('${key}', this.value, 'text')">
                ${inputObj.options.map(opt =>
                    `<option value="${opt}" ${opt === value ? 'selected' : ''}>${opt}</option>`
                ).join('')}
            </select>
        `;
    } else {
        inputHtml = `
            <input type="${isNumber ? 'number' : 'text'}"
                   value="${value}"
                   ${inputObj.step ? `step="${inputObj.step}"` : ''}
                   ${inputObj.min !== undefined ? `min="${inputObj.min}"` : ''}
                   ${inputObj.max !== undefined ? `max="${inputObj.max}"` : ''}
                   onchange="updateOption('${key}', this.value, '${inputObj.type}')">
        `;
    }

    // Optimization controls
    let optimizeHtml = '';
    if (isNumber || isBool) {
        let isRangeActive = false;
        const fix = (n) => parseFloat(n.toPrecision(10));

        let rangeMin = isNumber ? value : null;
        let rangeMax = isNumber ? fix(value + (value === 0 ? 10 : value * 2)) : null;
        let rangeStep = isNumber ? (inputObj.step || fix(value === 0 ? 1 : value / 10)) : null;

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

        // Toujours initialiser state.ranges pour les paramètres numériques et booléens
        // Cela garantit que les ranges sont sauvegardées même si non optimisées
        if (!state.ranges[key]) {
            state.ranges[key] = {
                active: isRangeActive,  // false par défaut pour nouveaux indicateurs
                min: rangeMin,
                max: rangeMax,
                step: rangeStep
            };
        }

        const optimizeContent = isNumber ? `
            <div class="optimize-fields-container">
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
                    <input type="number" value="${rangeStep}" step="${inputObj.step || 'any'}" onchange="updateRange('${key}', 'step', this.value)">
                </div>
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

    const tooltipAttr = inputObj.tooltip ? `title="${inputObj.tooltip}"` : '';

    row.innerHTML = `
        <div class="option-label" ${tooltipAttr}>${label}</div>
        <div class="option-controls">
            <div class="control-primary">${inputHtml}</div>
            ${optimizeHtml}
        </div>
    `;

    return row;
}

// Tab and group control functions
window.switchTab = function(tabName) {
    state.activeTab = tabName;

    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.toggle('active', pane.dataset.tab === tabName);
    });
};

window.toggleGroup = function(groupId) {
    const content = document.getElementById(`group_${groupId}`);
    if (!content) return;

    const icon = content.parentElement.querySelector('.collapse-icon');

    if (content.classList.contains('collapsed')) {
        content.classList.remove('collapsed');
        icon.textContent = '▼';
    } else {
        content.classList.add('collapsed');
        icon.textContent = '▶';
    }
};

window.updateOption = (key, value, type) => {
    if (type === 'number' || type === 'float' || type === 'integer') {
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

// Timeframe period limits (in days) - recommended max period for each timeframe
const TIMEFRAME_PERIOD_LIMITS = {
    '1': 30,      // 1 minute: max 30 days
    '5': 180,     // 5 minutes: max 6 months
    '15': 365,    // 15 minutes: max 1 year
    '30': 730,    // 30 minutes: max 2 years
    '60': 730,    // 1 hour: max 2 years
    '240': 1825,  // 4 hours: max 5 years
    '1D': 3650,   // 1 day: max 10 years
    'D': 3650,    // 1 day (alternate): max 10 years
    '1W': 7300,   // 1 week: max 20 years
    'W': 7300,    // 1 week (alternate): max 20 years
    '1M': 14600   // 1 month: max 40 years
};

function updateBacktestSummary() {
    // Calculate total backtests
    const symbolCount = state.symbols.length;
    const selectedTimeframes = Array.from(document.querySelectorAll('input[name="timeframe"]:checked'));
    const timeframeCount = selectedTimeframes.length;

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

        // Check for timeframe/period warnings
        const periodWarnings = checkTimeframePeriodWarnings(selectedTimeframes);
        const warningElement = document.getElementById('periodWarning');
        const warningMessage = document.getElementById('periodWarningMessage');
        if (warningElement && warningMessage) {
            if (periodWarnings.length > 0) {
                warningMessage.innerHTML = periodWarnings.join('<br>');
                warningElement.classList.remove('hidden');
            } else {
                warningElement.classList.add('hidden');
            }
        }

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

function resetButtons() {
    runBacktestBtn.disabled = false;
    runBacktestBtn.textContent = i18n.t('buttons.runBacktest');
    stopBacktestBtn.classList.add('hidden');
    state.currentJobId = null;
    localStorage.removeItem('currentJobId'); // Clear active job
    // Hide progress bar
    hideProgressBar();
}

// Reset buttons but keep the currentJobId (for loaded jobs)
function resetButtonsKeepJob() {
    runBacktestBtn.disabled = false;
    runBacktestBtn.textContent = i18n.t('buttons.runBacktest');
    stopBacktestBtn.classList.add('hidden');
    // Don't clear currentJobId - we need it for export
    hideProgressBar();
}

// Progress bar functions
function updateProgressBar(percent, current, total) {
    const progressContainer = document.getElementById('progressBarContainer');
    const progressFill = document.getElementById('progressBarFill');
    const progressText = document.getElementById('progressBarText');
    const progressPercent = document.getElementById('progressBarPercent');
    
    if (progressContainer && progressFill && progressText) {
        progressContainer.classList.remove('hidden');
        progressFill.style.width = `${percent}%`;
        progressText.textContent = `${current} / ${total}`;
        if (progressPercent) {
            progressPercent.textContent = `${percent}%`;
        }
    }
}

function hideProgressBar() {
    const progressContainer = document.getElementById('progressBarContainer');
    if (progressContainer) {
        progressContainer.classList.add('hidden');
    }
    // Also hide saved progress
    const savedContainer = document.getElementById('savedProgressContainer');
    if (savedContainer) {
        savedContainer.style.display = 'none';
    }
}

// Update saved progress indicator
function updateSavedProgress(saved, total) {
    const savedContainer = document.getElementById('savedProgressContainer');
    const savedText = document.getElementById('savedProgressText');
    
    if (savedContainer && savedText) {
        savedContainer.style.display = 'flex';
        savedText.textContent = `💾 Sauvegardé: ${saved} / ${total}`;
    }
}

// Check timeframe/period warnings
function checkTimeframePeriodWarnings(selectedTimeframes) {
    const warnings = [];
    const dateFrom = dateFromInput.value;
    const dateTo = dateToInput.value;
    
    if (!dateFrom || !dateTo) return warnings;
    
    const fromDate = new Date(dateFrom);
    const toDate = new Date(dateTo);
    const periodDays = Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24));
    
    selectedTimeframes.forEach(checkbox => {
        const tf = checkbox.value;
        const limit = TIMEFRAME_PERIOD_LIMITS[tf];
        
        if (limit && periodDays > limit) {
            const tfLabel = checkbox.parentElement?.textContent?.trim() || tf;
            warnings.push(`${tfLabel}: Period of ${periodDays} days exceeds recommended ${limit} days. May cause timeouts.`);
        }
    });
    
    return warnings;
}

async function stopBacktest() {
    if (!state.currentJobId) return;

    try {
        const response = await fetch(`/api/backtest/${state.currentJobId}/cancel`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            statusMessage.textContent = i18n.t('messages.backtestStopped');
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

// Generate unique row ID for pending/running/result tracking (CSS-safe)
function getRowId(data) {
    // Create a simple hash from the options to avoid special characters
    const optionsStr = JSON.stringify(data.options || {});
    let hash = 0;
    for (let i = 0; i < optionsStr.length; i++) {
        const char = optionsStr.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return `${data.symbol.replace(/[^a-zA-Z0-9]/g, '_')}-${data.timeframe}-${Math.abs(hash)}`;
}

// Add a pending row (shows symbol, timeframe, options with loading indicator)
function addPendingRow(data) {
    const rowId = getRowId(data);
    
    // Check if row already exists
    const existingRow = document.querySelector(`tr[data-row-id="${rowId}"]`);
    if (existingRow) {
        return;
    }
    
    const row = document.createElement('tr');
    row.dataset.rowId = rowId;
    row.classList.add('result-row-pending');
    row.innerHTML = `
        <td>${data.symbol}</td>
        <td>${data.timeframe}</td>
        <td><small>${formatOptions(data.options)}</small></td>
        <td colspan="6" class="pending-cell">
            <span class="pending-indicator">⏳ Queued...</span>
        </td>
    `;
    resultsTableBody.appendChild(row);
}

// Update row status to running
function updateRowStatus(data, status) {
    const rowId = getRowId(data);
    const row = document.querySelector(`tr[data-row-id="${rowId}"]`);
    
    if (row) {
        row.classList.remove('result-row-pending');
        row.classList.add('result-row-running');
        const pendingCell = row.querySelector('.pending-cell');
        if (pendingCell) {
            pendingCell.innerHTML = `<span class="running-indicator">🔄 ${i18n.t('messages.runningInline')}</span>`;
        }
    }
}

// Update row to show retrying status (orange warning)
function updateRowWithRetrying(data) {
    const rowId = getRowId(data);
    let row = document.querySelector(`tr[data-row-id="${rowId}"]`);
    
    if (!row) {
        row = document.createElement('tr');
        row.dataset.rowId = rowId;
        resultsTableBody.appendChild(row);
    }
    
    // Add retrying class (orange)
    row.classList.remove('result-row-pending', 'result-row-running', 'result-row-error');
    row.classList.add('result-row-retrying');
    
    row.innerHTML = `
        <td>${data.symbol}</td>
        <td>${data.timeframe}</td>
        <td><small>${formatOptions(data.options)}</small></td>
        <td colspan="6" class="warning-cell">
            <span class="retry-indicator">⏳ ${data.message}</span>
        </td>
    `;
}

// Update row with actual result
function updateRowWithResult(r) {
    const rowId = getRowId(r);
    let row = document.querySelector(`tr[data-row-id="${rowId}"]`);
    
    // If no existing row, create a new one
    if (!row) {
        row = document.createElement('tr');
        row.dataset.rowId = rowId;
        resultsTableBody.appendChild(row);
    }
    
    // Remove pending/running/retrying classes
    row.classList.remove('result-row-pending', 'result-row-running', 'result-row-retrying');
    row.dataset.resultIndex = state.results.length - 1;
    row.style.cursor = 'pointer';

    if (r.error || !r.report) {
        row.classList.add('result-row-error');
        row.onclick = null; // No modal for errors
        
        // Store data for retry
        row.dataset.symbol = r.symbol;
        row.dataset.timeframe = r.timeframe;
        row.dataset.options = JSON.stringify(r.options);
        
        row.innerHTML = `
            <td>${r.symbol}</td>
            <td>${r.timeframe}</td>
            <td><small>${formatOptions(r.options)}</small></td>
            <td colspan="5" class="negative">${r.error || 'Unknown error (No report data)'}</td>
            <td>
                <button class="retry-btn" onclick="event.stopPropagation(); retryBacktest(this.closest('tr'))">
                    🔄 Retry
                </button>
            </td>
        `;
    } else {
        row.onclick = () => openAnalyticsModal(r);
        const netProfit = r.report.netProfit !== 'N/A' ? r.report.netProfit : null;
        const netProfitClass = netProfit !== null && netProfit >= 0 ? 'positive' : 'negative';

        if (netProfit !== null) {
            row.classList.add(netProfit >= 0 ? 'result-row-profit' : 'result-row-loss');
        }

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
}

function addResultRow(r) {
    const row = document.createElement('tr');
    row.dataset.resultIndex = state.results.length - 1; // Store index for modal
    row.addEventListener('click', () => openAnalyticsModal(r));

    if (r.error || !r.report) {
        row.classList.add('result-row-error');
        row.innerHTML = `
            <td>${r.symbol}</td>
            <td>${r.timeframe}</td>
            <td><small>${formatOptions(r.options)}</small></td>
            <td colspan="8" class="negative">${r.error || 'Unknown error (No report data)'}</td>
        `;
    } else {
        const netProfit = r.report.netProfit !== 'N/A' ? r.report.netProfit : null;
        const netProfitClass = netProfit !== null && netProfit >= 0 ? 'positive' : 'negative';

        // Add border class based on profit
        if (netProfit !== null) {
            row.classList.add(netProfit >= 0 ? 'result-row-profit' : 'result-row-loss');
        }

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

// Export results to JSON file (streaming from server for large datasets, fallback to client-side)
async function exportResultsJSON() {
    // Check if we have results to export
    if (!state.currentJobId && (!state.results || state.results.length === 0)) {
        alert(i18n.t('errors.noResults'));
        return;
    }

    try {
        updateStatus('📦 ' + i18n.t('messages.preparingExport', { default: 'Préparation de l\'export...' }), 'info');
        
        const syncData = getSyncData();
        const session = syncData?.session || '';
        
        // Always use server-side streaming export (same as history modal)
        if (state.currentJobId) {
            try {
                const sizeUrl = `/api/jobs/${state.currentJobId}/size?session=${encodeURIComponent(session)}`;
                const sizeResponse = await fetch(sizeUrl, {
                    headers: { 'X-Session-Id': session }
                });
                
                if (sizeResponse.ok) {
                    // Job exists on server in incremental format - use streaming export
                    const sizeInfo = await sizeResponse.json();
                    const sizeMB = (sizeInfo.compressedSize / (1024 * 1024)).toFixed(2);
                    updateStatus(`📦 Export: ~${sizeMB} MB (${sizeInfo.resultCount} results)`, 'info');
                    
                    // Download the compressed export directly
                    const exportUrl = `/api/jobs/${state.currentJobId}/export?session=${encodeURIComponent(session)}`;
                    
                    const a = document.createElement('a');
                    a.href = exportUrl;
                    a.download = ''; // Let server set filename
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);

                    updateStatus('✅ ' + i18n.t('messages.resultsExported', { filename: 'backtest-results.json.gz', count: sizeInfo.resultCount }), 'success');
                    setTimeout(() => statusMessage.textContent = '', 3000);
                    return;
                } else {
                    const errorText = await sizeResponse.text();
                    console.warn('Size endpoint failed:', sizeResponse.status, errorText);
                }
            } catch (sizeError) {
                console.warn('Size check failed:', sizeError);
            }
        }
        
        // No job on server - show error with instructions
        updateStatus('❌ ' + i18n.t('messages.exportNotAvailable'), 'error');
        alert(i18n.t('messages.exportNotAvailableAlert'));
        
    } catch (error) {
        console.error('Export results error:', error);
        updateStatus('❌ ' + i18n.t('errors.exportFailed', { error: error.message }), 'error');
    }
}

// Import results from JSON or JSON.GZ file
async function handleImportResults(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        updateStatus('📤 ' + i18n.t('messages.importingResults'), 'info');

        let text;
        
        // Check if file is gzip compressed
        if (file.name.endsWith('.gz')) {
            console.log('Importing gzip file:', file.name, 'size:', file.size);
            
            // Read file as ArrayBuffer first
            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            
            // Try DecompressionStream first (modern browsers)
            if (typeof DecompressionStream !== 'undefined') {
                try {
                    const ds = new DecompressionStream('gzip');
                    const writer = ds.writable.getWriter();
                    writer.write(uint8Array);
                    writer.close();
                    
                    const decompressedStream = ds.readable;
                    const reader = decompressedStream.getReader();
                    const chunks = [];
                    
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        chunks.push(value);
                    }
                    
                    // Combine chunks and decode
                    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
                    const combined = new Uint8Array(totalLength);
                    let offset = 0;
                    for (const chunk of chunks) {
                        combined.set(chunk, offset);
                        offset += chunk.length;
                    }
                    
                    text = new TextDecoder().decode(combined);
                    console.log('Decompressed with DecompressionStream, length:', text.length);
                } catch (streamError) {
                    console.warn('DecompressionStream failed, trying pako fallback:', streamError);
                    // Fallback to pako if available
                    if (typeof pako !== 'undefined') {
                        const decompressed = pako.inflate(uint8Array, { to: 'string' });
                        text = decompressed;
                        console.log('Decompressed with pako, length:', text.length);
                    } else {
                        throw new Error('Gzip decompression failed and pako library not available');
                    }
                }
            } else if (typeof pako !== 'undefined') {
                // Use pako for older browsers
                const decompressed = pako.inflate(uint8Array, { to: 'string' });
                text = decompressed;
                console.log('Decompressed with pako, length:', text.length);
            } else {
                throw new Error('No gzip decompression method available. Please use a modern browser or uncompressed JSON.');
            }
        } else {
            text = await file.text();
        }
        
        if (!text || text.length === 0) {
            throw new Error('Decompressed file is empty');
        }
        
        console.log('Parsing JSON, first 200 chars:', text.substring(0, 200));
        const imported = JSON.parse(text);

        validateImportedResults(imported);

        applyImportedResults(imported);
        updateStatus('✅ ' + i18n.t('messages.resultsImported', { count: imported.results.length }), 'success');
        setTimeout(() => statusMessage.textContent = '', 3000);
        event.target.value = '';
    } catch (error) {
        console.error('Import results error:', error);
        updateStatus('❌ ' + i18n.t('errors.importFailed', { error: error.message }), 'error');
        event.target.value = '';
    }
}

// Validate imported results structure
function validateImportedResults(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid results file: not a valid JSON object');
    }
    if (!Array.isArray(data.results)) {
        throw new Error('Invalid results file: results must be an array');
    }
    if (data.results.length === 0) {
        throw new Error('Invalid results file: no results found');
    }

    const sampleResult = data.results[0];
    if (!sampleResult.symbol || !sampleResult.timeframe) {
        throw new Error('Invalid results file: results missing required fields');
    }
    return true;
}

// Generate UUID v4 (compatible with older browsers)
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Apply imported results to UI
function applyImportedResults(imported) {
    state.results = [];
    resultsTableBody.innerHTML = '';

    // Generate new job ID, use current user's session
    state.currentJobId = generateUUID();
    // state.session stays as current user's session (not imported)

    if (imported.config) {
        const cfg = imported.config;

        if (cfg.indicatorId) {
            state.indicatorId = cfg.indicatorId;
            step2.classList.remove('hidden');
        }

        if (cfg.symbols && Array.isArray(cfg.symbols)) {
            state.symbols = cfg.symbols;
            renderSymbols();
        }

        if (cfg.timeframes) {
            document.querySelectorAll('input[name="timeframe"]').forEach(cb => {
                cb.checked = cfg.timeframes.includes(cb.value);
            });
        }

        if (cfg.dateFrom) dateFromInput.value = cfg.dateFrom;
        if (cfg.dateTo) dateToInput.value = cfg.dateTo;

        const syncData = getSyncData();
        if (syncData && syncData.indicators && cfg.indicatorId) {
            const indicator = syncData.indicators.find(ind => ind.id === cfg.indicatorId);
            if (indicator) {
                window.currentIndicatorObj = indicator;
                window.savedOptionsAndRanges = {
                    indicatorId: cfg.indicatorId,
                    options: cfg.options || {},
                    ranges: cfg.ranges || {}
                };
                renderOptions(indicator);
                state.options = cfg.options || {};
                state.ranges = cfg.ranges || {};
            }
        }
    }

    step3.classList.remove('hidden');

    imported.results.forEach(result => {
        state.results.push(result);
        addResultRow(result);
    });

    const dateStr = imported.exportDate ? new Date(imported.exportDate).toLocaleString() : 'unknown date';
    statusMessage.textContent = `Imported results from ${dateStr} (${imported.results.length} results)`;
    statusMessage.style.color = '#4CAF50';

    historyBtn.classList.remove('hidden');

    // Close history modal and scroll to results
    historyModal.classList.add('hidden');
    setTimeout(() => {
        step3.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}

// Export a specific job by ID (from history) - uses streaming server endpoint
async function exportHistoryJobJSON(jobId) {
    try {
        updateStatus('📥 Exporting job...', 'info');

        const syncData = getSyncData();
        const session = syncData?.session || '';

        // Check if job exists and get size estimate
        const sizeResponse = await fetch(`/api/jobs/${jobId}/size?session=${encodeURIComponent(session)}`, {
            headers: { 'X-Session-Id': session }
        });

        if (sizeResponse.ok) {
            // Job exists in incremental format - use streaming export
            const sizeInfo = await sizeResponse.json();
            const sizeMB = (sizeInfo.compressedSize / (1024 * 1024)).toFixed(2);
            updateStatus(`📦 Export en cours... (~${sizeMB} MB compressé, ${sizeInfo.resultCount} résultats)`, 'info');

            // Download the compressed export directly
            const exportUrl = `/api/jobs/${jobId}/export?session=${encodeURIComponent(session)}`;

            const a = document.createElement('a');
            a.href = exportUrl;
            a.download = ''; // Let server set filename
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            updateStatus(`✅ Job exported (${sizeInfo.resultCount} results)`, 'success');
            setTimeout(() => statusMessage.textContent = '', 3000);
        } else {
            throw new Error('Job not found or not in exportable format');
        }

    } catch (error) {
        console.error('Export history job error:', error);
        updateStatus('❌ ' + i18n.t('errors.exportFailed', { error: error.message }), 'error');
    }
}

// Share a job - creates a public download link
async function shareJob(jobId) {
    try {
        updateStatus('🔗 ' + i18n.t('messages.creatingShareLink'), 'info');

        const syncData = getSyncData();
        const session = syncData?.session || '';

        const response = await fetch(`/api/jobs/${jobId}/share`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-Session-Id': session 
            },
            body: JSON.stringify({ expiresInDays: 30 })
        });

        if (!response.ok) {
            throw new Error('Failed to create share link');
        }

        const shareData = await response.json();
        
        // Build full URL
        const baseUrl = window.location.origin;
        const shareUrl = `${baseUrl}${shareData.downloadUrl}`;
        
        // Copy to clipboard
        try {
            await navigator.clipboard.writeText(shareUrl);
            updateStatus('✅ ' + i18n.t('messages.shareLinkCopied', { date: new Date(shareData.expiresAt).toLocaleDateString() }), 'success');
        } catch (e) {
            // Fallback: show in prompt
            prompt(i18n.t('messages.shareLinkPrompt'), shareUrl);
            updateStatus('✅ ' + i18n.t('messages.shareLinkCreated', { date: new Date(shareData.expiresAt).toLocaleDateString() }), 'success');
        }
        
        setTimeout(() => statusMessage.textContent = '', 5000);

    } catch (error) {
        console.error('Share job error:', error);
        updateStatus('❌ ' + i18n.t('messages.shareError') + ': ' + error.message, 'error');
    }
}

// Helper: Load job results via streaming for export (avoids memory issues with large jobs)
async function loadJobResultsForExport(jobId, session) {
    return new Promise((resolve, reject) => {
        const results = [];
        const sessionParam = session ? `?session=${encodeURIComponent(session)}` : '';
        const eventSource = new EventSource(`/api/jobs/${jobId}/stream${sessionParam}`);

        eventSource.addEventListener('results', (event) => {
            try {
                const data = JSON.parse(event.data);
                data.batch.forEach(result => results.push(result));
            } catch (e) {
                console.error('Error parsing results:', e);
            }
        });

        eventSource.addEventListener('complete', () => {
            eventSource.close();
            resolve(results);
        });

        eventSource.addEventListener('error', (event) => {
            eventSource.close();
            reject(new Error('Failed to load job results'));
        });

        eventSource.onerror = () => {
            eventSource.close();
            reject(new Error('Connection error'));
        };
    });
}



// ======= TABLE SORTING =======
let sortState = { column: null, direction: 'asc' };

function initTableSorting() {
    const headers = document.querySelectorAll('#resultsTable th');
    const sortableColumns = [3, 4, 5, 6, 7, 8]; // Net Profit, Trades, % Win, PF, DD, Avg Trade

    headers.forEach((header, index) => {
        if (sortableColumns.includes(index)) {
            header.classList.add('sortable');
            header.style.cursor = 'pointer';
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
        alert(i18n.t('errors.noDetailedData'));
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

// Tab switching (only for modal tabs, not indicator tabs)
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('analyticsModal');
    if (modal) {
        modal.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tabName = btn.dataset.tab;

                // Update active button (only within modal)
                modal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Update active pane (only within modal)
                modal.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
                document.getElementById(`${tabName}-tab`).classList.add('active');
            });
        });
    }
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
                    label: i18n.t('chart.equity'),
                    data: equity,
                    borderColor: '#00bfa5',
                    backgroundColor: 'rgba(0, 191, 165, 0.1)',
                    fill: true,
                    tension: 0.1,
                    borderWidth: 2,
                    yAxisID: 'y'
                },
                {
                    label: i18n.t('chart.drawdown'),
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
                        text: i18n.t('chart.equity'),
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
                        text: i18n.t('chart.drawdown'),
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
        container.innerHTML = `<p>${i18n.t('messages.noPerformanceData')}</p>`;
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
        tbody.innerHTML = `<tr><td colspan="9">${i18n.t('messages.noTrades')}</td></tr>`;
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
        const borderClass = trade.profit?.v >= 0 ? 'result-row-profit' : 'result-row-loss';
        const type = trade.entry?.type || 'N/A';
        const typeClass = type.toLowerCase() === 'long' ? 'trade-type-long' : type.toLowerCase() === 'short' ? 'trade-type-short' : '';

        return `
            <tr class="${borderClass}">
                <td>${trades.length - index}</td>
                <td><span class="${typeClass}">${type.toUpperCase()}</span></td>
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
