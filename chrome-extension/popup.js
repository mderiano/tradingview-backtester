document.getElementById('syncBtn').addEventListener('click', async () => {
    const statusDiv = document.getElementById('status');
    const btn = document.getElementById('syncBtn');

    // Reset status
    statusDiv.style.display = 'none';
    statusDiv.className = 'status';
    btn.disabled = true;
    btn.textContent = 'Syncing...';

    try {
        // 1. Get current tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab.url.includes('tradingview.com')) {
            throw new Error('Please open a TradingView chart first.');
        }

        // 2. Get Cookies
        const sessionCookie = await chrome.cookies.get({ url: 'https://www.tradingview.com', name: 'sessionid' });
        const signCookie = await chrome.cookies.get({ url: 'https://www.tradingview.com', name: 'sessionid_sign' });

        if (!sessionCookie) {
            throw new Error('Could not find sessionid cookie. Are you logged in?');
        }

        // 3. Get Active Indicators using chrome.scripting.executeScript (MAIN world)
        // This runs the function directly in the page's context, bypassing CSP issues with inline scripts
        let indicators = [];
        let symbol = '';
        let timeframe = '';

        // Store session/signature to pass into the function
        const sessionValue = sessionCookie.value;
        const signatureValue = signCookie ? signCookie.value : '';

        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                world: 'MAIN',
                args: [sessionValue, signatureValue], // Pass as arguments
                func: (session, signature) => {
                    try {
                        console.log("🔍 TV Backtest: Starting extraction (Main World)...");

                        // Helper to explore and find the chart widget
                        function getChartWidget() {
                            console.log("Debug: Exploring TradingView structure...");

                            // Log what's available
                            console.log("Debug: window.TV exists?", !!window.TV);
                            console.log("Debug: window.TradingView exists?", !!window.TradingView);
                            console.log("Debug: window.TradingViewApi exists?", !!window.TradingViewApi);

                            // Method 0: TradingViewApi (NEW - found in your test)
                            if (window.TradingViewApi && typeof window.TradingViewApi.activeChart === 'function') {
                                console.log("Debug: Using window.TradingViewApi.activeChart()");
                                return window.TradingViewApi.activeChart();
                            }

                            // Try to find tvWidget in global scope
                            if (window.tvWidget) {
                                console.log("Debug: Found window.tvWidget");
                                if (window.tvWidget.activeChart && typeof window.tvWidget.activeChart === 'function') {
                                    console.log("Debug: Using window.tvWidget.activeChart()");
                                    return window.tvWidget.activeChart();
                                }
                            }

                            // Method 1: Standard TV path
                            if (window.TV && window.TV.main && typeof window.TV.main.activeChart === 'function') {
                                console.log("Debug: Found via TV.main.activeChart()");
                                return window.TV.main.activeChart();
                            }

                            // Method 2: TradingView global
                            if (window.TradingView && window.TradingView.main && typeof window.TradingView.main.activeChart === 'function') {
                                console.log("Debug: Found via TradingView.main.activeChart()");
                                return window.TradingView.main.activeChart();
                            }

                            // Method 3: Search for iframe widgets
                            const iframes = document.querySelectorAll('iframe');
                            console.log("Debug: Found", iframes.length, "iframes");

                            // Method 4: Look for chart container and try to find widget from DOM
                            const chartContainer = document.querySelector('.chart-container, [class*="chart"], [data-role="chart"]');
                            if (chartContainer) {
                                console.log("Debug: Found chart container:", chartContainer.className);
                            }

                            // Method 5: Search all window properties for something that looks like a chart
                            console.log("Debug: Searching window properties...");
                            for (const key in window) {
                                try {
                                    const obj = window[key];
                                    if (obj && typeof obj === 'object' && obj !== window) {
                                        // Check if it has chart-like methods
                                        if (typeof obj.activeChart === 'function') {
                                            console.log(`Debug: Found activeChart() at window.${key}`);
                                            const chart = obj.activeChart();
                                            if (chart) return chart;
                                        }
                                        // Check if it IS a chart
                                        if (typeof obj.getAllStudies === 'function' ||
                                            typeof obj.getAllShapes === 'function' ||
                                            (typeof obj.model === 'function')) {
                                            console.log(`Debug: Found chart-like object at window.${key}`);
                                            return obj;
                                        }
                                    }
                                } catch (e) { /* ignore access errors */ }
                            }

                            return null;
                        }

                        const chartWidget = getChartWidget();
                        if (!chartWidget) {
                            console.error("❌ TV Backtest: No active chart widget found.");
                            console.log("Debug: Available window keys:", Object.keys(window).filter(k => k.toLowerCase().includes('tv') || k.toLowerCase().includes('chart')));
                            return { error: "No active chart found. Check console for available objects." };
                        }

                        console.log("✅ TV Backtest: Found chart widget:", chartWidget);
                        console.log("Debug: Widget methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(chartWidget)));

                        // Extract chart parameters
                        let symbol = '';
                        let timeframe = '';

                        try {
                            if (typeof chartWidget.symbol === 'function') {
                                symbol = chartWidget.symbol();
                                console.log("Debug: Extracted symbol:", symbol);
                            }
                        } catch (e) {
                            console.warn("Error getting symbol:", e);
                        }

                        try {
                            if (typeof chartWidget.resolution === 'function') {
                                timeframe = chartWidget.resolution();
                                console.log("Debug: Extracted timeframe:", timeframe);
                            } else if (typeof chartWidget.interval === 'function') {
                                timeframe = chartWidget.interval();
                                console.log("Debug: Extracted timeframe (via interval):", timeframe);
                            }
                        } catch (e) {
                            console.warn("Error getting timeframe:", e);
                        }

                        let allStudies = {};

                        // Method 1: .getAllStudies()
                        try {
                            if (typeof chartWidget.getAllStudies === 'function') {
                                const studies = chartWidget.getAllStudies();
                                console.log("Debug: getAllStudies() returned", studies ? studies.length : 0, "items");
                                if (studies && studies.length > 0) {
                                    studies.forEach(s => {
                                        allStudies[s.id || s.name || Math.random()] = s;
                                    });
                                }
                            }
                        } catch (e) { console.warn("getAllStudies failed:", e.message); }

                        // Method 2: .getAllShapes() (sometimes indicators are here)
                        try {
                            if (typeof chartWidget.getAllShapes === 'function') {
                                const shapes = chartWidget.getAllShapes();
                                console.log("Debug: getAllShapes() returned", shapes ? shapes.length : 0, "items");
                                if (shapes && shapes.length > 0) {
                                    shapes.forEach(s => {
                                        if (s.type === 'study' || s.isStudy) {
                                            allStudies[s.id || s.name || Math.random()] = s;
                                        }
                                    });
                                }
                            }
                        } catch (e) { console.warn("getAllShapes failed:", e.message); }

                        // Method 3: .dataSources()
                        try {
                            if (typeof chartWidget.dataSources === 'function') {
                                const sources = chartWidget.dataSources();
                                console.log("Debug: dataSources() returned", sources ? sources.length : 0, "items");
                                if (sources && sources.length > 0) {
                                    sources.forEach(s => {
                                        allStudies[s.id || s.name || Math.random()] = s;
                                    });
                                }
                            }
                        } catch (e) { console.warn("dataSources failed:", e.message); }

                        // Method 4: .model().dataSources()
                        try {
                            if (typeof chartWidget.model === 'function') {
                                let model = chartWidget.model();
                                console.log("Debug: Got model:", !!model);

                                if (model && typeof model.model === 'function') {
                                    model = model.model();
                                    console.log("Debug: Got nested model:", !!model);
                                }

                                if (model && typeof model.dataSources === 'function') {
                                    const sources = model.dataSources();
                                    console.log("Debug: model.dataSources() returned", sources ? sources.length : 0, "items");
                                    if (sources && sources.length > 0) {
                                        sources.forEach(s => {
                                            allStudies[s.id || s.name || Math.random()] = s;
                                        });
                                    }
                                }
                            }
                        } catch (e) { console.warn("model inspection failed:", e.message); }

                        console.log("Debug: Total studies found:", Object.keys(allStudies).length);

                        // Extract and format indicators
                        const found = [];
                        Object.keys(allStudies).forEach(id => {
                            const study = allStudies[id];
                            console.log("Debug: Processing study:", id, study);

                            // Try to get metaInfo in various ways
                            let meta = null;
                            let metaSource = null;
                            try {
                                // Try all possible ways to get metaInfo
                                if (typeof study.metaInfo === 'function') {
                                    meta = study.metaInfo();
                                    metaSource = "study.metaInfo()";
                                } else if (study.metaInfo && typeof study.metaInfo === 'object') {
                                    meta = study.metaInfo;
                                    metaSource = "study.metaInfo";
                                } else if (study._metaInfo) {
                                    meta = study._metaInfo;
                                    metaSource = "study._metaInfo";
                                } else if (typeof study.properties === 'function') {
                                    const props = study.properties();
                                    if (props && props.metaInfo) {
                                        meta = props.metaInfo;
                                        metaSource = "study.properties().metaInfo";
                                    }
                                }

                                // Try getStudyById if we have the chartWidget
                                if (!meta && study.id && chartWidget && typeof chartWidget.getStudyById === 'function') {
                                    const fullStudy = chartWidget.getStudyById(study.id);
                                    if (fullStudy) {
                                        // Try metaInfo on fullStudy directly
                                        if (typeof fullStudy.metaInfo === 'function') {
                                            meta = fullStudy.metaInfo();
                                            metaSource = "chartWidget.getStudyById().metaInfo()";
                                        }
                                        // Try _study.metaInfo (this is where it's likely to be)
                                        else if (fullStudy._study) {
                                            if (typeof fullStudy._study.metaInfo === 'function') {
                                                meta = fullStudy._study.metaInfo();
                                                metaSource = "getStudyById()._study.metaInfo()";
                                            } else if (fullStudy._study.metaInfo) {
                                                meta = fullStudy._study.metaInfo;
                                                metaSource = "getStudyById()._study.metaInfo";
                                            } else if (fullStudy._study._metaInfo) {
                                                meta = fullStudy._study._metaInfo;
                                                metaSource = "getStudyById()._study._metaInfo";
                                            }
                                        }
                                    }
                                }

                                // Try nested properties
                                if (!meta && study._study && typeof study._study.metaInfo === 'function') {
                                    meta = study._study.metaInfo();
                                    metaSource = "study._study.metaInfo()";
                                }
                            } catch (e) {
                                console.warn("Error getting metaInfo for", id, e.message);
                            }

                            // If we have meta, extract info
                            if (meta) {
                                console.log("Debug: Found metaInfo via", metaSource, ":", meta);
                                const isStrategy = meta.isStrategy || meta.is_strategy || meta.type === 'Strategy';
                                const scriptId = meta.scriptIdPart || meta.id || meta.scriptId;

                                // Extract raw input values for this indicator
                                let rawInputValues = {};
                                try {
                                    const fullStudy = chartWidget.getStudyById(study.id);
                                    if (fullStudy) {
                                        if (typeof fullStudy.getInputValues === 'function') {
                                            rawInputValues = fullStudy.getInputValues();
                                            console.log("Debug: Extracted raw input values via getInputValues():", rawInputValues);
                                        } else if (fullStudy._study && fullStudy._study._inputs) {
                                            rawInputValues = fullStudy._study._inputs;
                                            console.log("Debug: Extracted raw input values via _study._inputs:", rawInputValues);
                                        }
                                    }
                                } catch (e) {
                                    console.warn("Error getting inputs for", study.id, e);
                                }

                                // Merge raw values with metaInfo to create enriched inputs
                                const enrichedInputs = {};
                                if (meta && meta.inputs && Array.isArray(meta.inputs)) {
                                    meta.inputs.forEach(inputDef => {
                                        const inputId = inputDef.id;

                                        // Use CURRENT value from TV (what user set), fallback to defval
                                        const currentValue = rawInputValues.hasOwnProperty(inputId)
                                            ? rawInputValues[inputId]
                                            : inputDef.defval;

                                        enrichedInputs[inputId] = {
                                            id: inputId,
                                            value: currentValue,  // Current from TV, NOT defval
                                            name: inputDef.name || inputId,
                                            type: inputDef.type || 'text',
                                            defval: inputDef.defval,
                                            step: inputDef.step,
                                            min: inputDef.min,
                                            max: inputDef.max,
                                            tooltip: inputDef.tooltip || '',
                                            isHidden: inputDef.isHidden || false,
                                            group: inputDef.group || null,
                                            groupId: inputDef.groupId || null,
                                            internalID: inputDef.internalID || null,
                                            options: inputDef.options || null
                                        };
                                    });
                                    console.log(`✅ Created ${Object.keys(enrichedInputs).length} enriched inputs`);
                                } else {
                                    // Fallback: use raw values as-is if no metadata
                                    console.warn("⚠️ No metaInfo.inputs available, using raw values");
                                    Object.keys(rawInputValues).forEach(key => {
                                        enrichedInputs[key] = {
                                            id: key,
                                            value: rawInputValues[key],
                                            name: key,
                                            type: typeof rawInputValues[key],
                                            defval: rawInputValues[key],
                                            isHidden: false
                                        };
                                    });
                                }

                                // Build groups structure for THIS indicator
                                let groups = [];

                                if (meta && meta.inputs && Array.isArray(meta.inputs)) {
                                    const groupsMap = new Map();

                                    // Helper to map strategy properties to groups
                                    const strategyPropMap = {
                                        'initial_capital': 'Capital & Order Size',
                                        'currency': 'Capital & Order Size',
                                        'default_qty_value': 'Capital & Order Size',
                                        'default_qty_type': 'Capital & Order Size',
                                        'pyramiding': 'Capital & Order Size',
                                        'commission_value': 'Commission',
                                        'commission_type': 'Commission',
                                        'slippage': 'Slippage',
                                        'margin_long': 'Margin',
                                        'margin_short': 'Margin',
                                        'process_orders_on_close': 'Recalculate',
                                        'calc_on_every_tick': 'Recalculate',
                                        'calc_on_order_fills': 'Recalculate',
                                        'backtest_fill_limits_assumption': 'Backtesting',
                                        'fill_orders_on_standard_ohlc': 'Backtesting',
                                        'risk_free_rate': 'Risk'
                                    };

                                    meta.inputs.forEach(input => {
                                        if (input.isHidden) return;

                                        const inputId = input.id;

                                        // Standard Inputs tab (has 'group' property)
                                        if (input.group) {
                                            const groupKey = `inputs_${input.group}`;
                                            if (!groupsMap.has(groupKey)) {
                                                groupsMap.set(groupKey, {
                                                    id: groupKey,
                                                    name: input.group,
                                                    tab: 'Inputs',
                                                    inputs: []
                                                });
                                            }
                                            groupsMap.get(groupKey).inputs.push(inputId);
                                        }
                                        // Properties tab (strategy props)
                                        else if (input.groupId === 'strategy_props') {
                                            const propId = input.internalID || input.name;
                                            const groupName = strategyPropMap[propId] || 'Other Properties';
                                            const groupKey = `props_${groupName}`;

                                            if (!groupsMap.has(groupKey)) {
                                                groupsMap.set(groupKey, {
                                                    id: groupKey,
                                                    name: groupName,
                                                    tab: 'Properties',
                                                    inputs: []
                                                });
                                            }
                                            groupsMap.get(groupKey).inputs.push(inputId);
                                        }
                                    });

                                    groups = Array.from(groupsMap.values());
                                    console.log(`✅ Built ${groups.length} groups for ${meta.scriptName || 'indicator'}`);
                                }

                                // Build tabs - only include tabs that have groups
                                const tabsWithGroups = new Set(groups.map(g => g.tab));
                                const allPossibleTabs = [
                                    { name: "Inputs", active: true },
                                    { name: "Properties", active: false },
                                    { name: "Style", active: false },
                                    { name: "Visibility", active: false }
                                ];

                                let tabs = allPossibleTabs.filter(tab => tabsWithGroups.has(tab.name));

                                // If no tabs have content, default to Inputs tab
                                if (tabs.length === 0) {
                                    tabs = [{ name: "Inputs", active: true }];
                                } else {
                                    // Ensure first tab is active
                                    tabs.forEach((tab, index) => {
                                        tab.active = index === 0;
                                    });
                                }

                                console.log(`✅ Included ${tabs.length} non-empty tabs:`, tabs.map(t => t.name).join(', '));

                                found.push({
                                    id: scriptId || study.id || id,
                                    fullId: meta.id || scriptId,
                                    name: meta.scriptName || meta.description || meta.shortDescription || study.name || id,
                                    version: meta.version,
                                    type: isStrategy ? 'strategy' : 'study',
                                    instanceId: study.id || id,
                                    inputs: enrichedInputs,  // Enriched inputs object
                                    tabs: tabs,              // Per-indicator tabs
                                    groups: groups          // Per-indicator groups
                                });
                            } else {
                                // Fallback: use basic study info if no metaInfo
                                // This is still useful - we can at least send the name and ID
                                console.log("Debug: No metaInfo found, using basic info");
                                found.push({
                                    id: study.id || id,
                                    fullId: study.id || id,
                                    name: study.name || study.title || id,
                                    version: null,
                                    type: 'study',
                                    instanceId: study.id || id,
                                    inputs: {}
                                });
                            }
                        });

                        console.log("✅ TV Backtest: Extracted indicators:", found);

                        return {
                            session: session,
                            signature: signature,
                            indicators: found,
                            symbol: symbol,
                            timeframe: timeframe
                            // Note: grouping is now per-indicator (in indicators[].tabs and indicators[].groups)
                        };
                    } catch (e) {
                        console.error("❌ TV Backtest: Error", e);
                        return { error: e.message, stack: e.stack };
                    }
                }
            });

            if (results && results[0] && results[0].result) {
                const res = results[0].result;
                if (res.indicators) {
                    indicators = res.indicators;
                    symbol = res.symbol || '';
                    timeframe = res.timeframe || '';
                } else if (res.error) {
                    console.warn('Extraction error:', res.error);
                }
            }

            // 4. Save to chrome.storage.local directly (Client-side handling)
            const syncData = {
                session: sessionCookie.value,
                signature: signCookie ? signCookie.value : '',
                indicators: indicators,
                symbol: symbol,
                timeframe: timeframe,
                syncedAt: new Date().toISOString()
                // Note: grouping is now per-indicator (in indicators[].tabs and indicators[].groups)
            };

            console.log('💾 Saving sync data to local storage:', syncData);

            // Get server URL from config
            const serverUrl = window.BACKTEST_CONFIG?.SERVER_URL || 'http://srv1159534.hstgr.cloud:3000';

            // Save to chrome.storage.local
            chrome.storage.local.set({
                'tvBacktestSync': syncData
            }, () => {
                if (chrome.runtime.lastError) {
                    statusDiv.textContent = `❌ Error: ${chrome.runtime.lastError.message}`;
                    statusDiv.className = 'status error';
                    statusDiv.style.display = 'block';
                    btn.disabled = false;
                    btn.textContent = 'Sync with Backtester';
                    return;
                }

                console.log('✅ Data saved to chrome.storage.local');
                statusDiv.textContent = `✅ Synced! Found ${indicators.length} indicators. Opening server...`;
                statusDiv.className = 'status success';
                statusDiv.style.display = 'block';

                // Open server in new tab
                chrome.tabs.create({ url: serverUrl });

                btn.disabled = false;
                btn.textContent = 'Sync with Backtester';
            });

        } catch (error) {
            statusDiv.textContent = `❌ Error: ${error.message}`;
            statusDiv.className = 'status error';
            statusDiv.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Sync with Backtester';
        }
    } catch (error) {
        statusDiv.textContent = `❌ Error: ${error.message}`;
        statusDiv.className = 'status error';
        statusDiv.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Sync with Backtester';
    }
});
