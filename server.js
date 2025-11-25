const express = require('express');
const bodyParser = require('body-parser');
const TradingView = require('@mathieuc/tradingview');
const ExcelJS = require('exceljs');
const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Job Store: { jobId: { status, progress, results, error, cancelled } }
const jobs = new Map();

// Ensure results directory exists
const RESULTS_DIR = path.join(__dirname, 'results');
if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR);
}

// Helper: Save job to disk
function saveJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) return;

    const filePath = path.join(RESULTS_DIR, `${jobId}.json`);
    // Save a copy of the job object
    const jobData = JSON.stringify(job, null, 2);

    fs.writeFile(filePath, jobData, (err) => {
        if (err) console.error(`Failed to save job ${jobId}:`, err);
    });
}

// Helper: Compress old results
function compressOldResults() {
    const retentionDays = parseInt(process.env.RETENTION_DAYS || '15');
    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;

    fs.readdir(RESULTS_DIR, (err, files) => {
        if (err) return console.error('Error reading results dir for cleanup:', err);

        files.forEach(file => {
            if (!file.endsWith('.json')) return; // Only compress .json files

            const filePath = path.join(RESULTS_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return;

                const ageDays = (now - stats.mtimeMs) / msPerDay;
                if (ageDays > retentionDays) {
                    console.log(`Compressing old result: ${file} (${ageDays.toFixed(1)} days old)`);

                    const gzip = zlib.createGzip();
                    const source = fs.createReadStream(filePath);
                    const destination = fs.createWriteStream(`${filePath}.gz`);

                    source.pipe(gzip).pipe(destination).on('finish', () => {
                        // Delete original file after successful compression
                        fs.unlink(filePath, (err) => {
                            if (err) console.error(`Error deleting ${file} after compression:`, err);
                            else console.log(`Compressed and deleted ${file}`);
                        });
                    }).on('error', (err) => {
                        console.error(`Error compressing ${file}:`, err);
                    });
                }
            });
        });
    });
}

// Run compression check on startup
compressOldResults();
// Run compression check every 24 hours
setInterval(compressOldResults, 24 * 60 * 60 * 1000);

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'subscribe' && data.jobId) {
                console.log(`Client subscribed to job ${data.jobId}`);
                ws.jobId = data.jobId;

                // Send current state if job exists
                const job = jobs.get(data.jobId);
                if (job) {
                    ws.send(JSON.stringify({ type: 'status', status: job.status }));
                    // Replay results if needed, or just let client know it's running
                }
            }
        } catch (e) {
            console.error('WebSocket message error:', e);
        }
    });
});

// Broadcast to subscribers of a specific job
function broadcast(jobId, message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.jobId === jobId) {
            client.send(JSON.stringify(message));
        }
    });
}

const cors = require('cors');

// Middleware
// Configure CORS explicitly for Chrome extension
app.use(cors({
    origin: '*', // Allow all origins (including chrome-extension://)
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight requests
app.options('*', cors());

app.use(express.static('public'));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});
app.use(express.static('public'));

// Check credentials - WARN ONLY
if (!process.env.SESSION || !process.env.SIGNATURE) {
    console.warn('⚠️  Warning: TradingView credentials not found in .env file.');
    console.warn('    You must sync via the Chrome Extension to run backtests.');
}

// Store discovered indicators from extension
let discoveredIndicators = [];
let chartContext = { symbol: '', timeframe: '' }; // Store current chart context

// API: Sync Credentials & Indicators (from Extension)
app.post('/api/sync', (req, res) => {
    const { session, signature, indicators, symbol, timeframe } = req.body;

    if (!session) {
        return res.status(400).send('Missing session');
    }

    // Update credentials in memory
    process.env.SESSION = session;
    if (signature) process.env.SIGNATURE = signature;

    // Update indicators with TradingView data
    if (indicators && Array.isArray(indicators)) {
        discoveredIndicators = indicators;
        console.log(`🔄 Synced: Auth updated & ${indicators.length} indicators found.`);
        
        // Store TradingView chart parameters
        if (symbol) {
            chartContext.symbol = symbol;
            console.log(`📊 Chart symbol: ${symbol}`);
        }
        if (timeframe) {
            chartContext.timeframe = timeframe;
            console.log(`⏰ Chart timeframe: ${timeframe}`);
        }
        
        // Log indicator inputs for debugging
        indicators.forEach(ind => {
            if (ind.inputs && Object.keys(ind.inputs).length > 0) {
                console.log(`📝 ${ind.name} inputs:`, ind.inputs);
            }
        });
    } else {
        console.log('🔄 Synced: Auth updated.');
    }

    // Prepare data for localStorage (to be sent to client)
    const syncData = {
        session,
        signature,
        indicators: discoveredIndicators,
        symbol: chartContext.symbol,
        timeframe: chartContext.timeframe,
        syncedAt: new Date().toISOString()
    };

    res.json({ 
        success: true, 
        message: 'Synced successfully',
        receivedData: {
            indicatorCount: indicators?.length || 0,
            hasSymbol: !!symbol,
            hasTimeframe: !!timeframe
        },
        syncData // Return data to be stored in localStorage
    });
});

// Restore credentials from localStorage (on page reload)
app.post('/api/restore-credentials', (req, res) => {
    const { session, signature } = req.body;

    if (!session) {
        return res.status(400).json({ error: 'Missing session' });
    }

    // Update credentials in memory
    process.env.SESSION = session;
    if (signature) process.env.SIGNATURE = signature;

    console.log('🔄 Credentials restored from localStorage');

    res.json({ success: true });
});

// API: Get Config
app.get('/api/config', (req, res) => {
    res.json({
        appTitle: process.env.APP_TITLE || 'TradingView Backtester',
        appSubtitle: process.env.APP_SUBTITLE || 'Automated strategy testing with range analysis',
        indicatorId: process.env.INDICATOR_ID || '',
        discoveredIndicators: discoveredIndicators, // Return discovered indicators
        chartContext: chartContext // Return symbol and timeframe
    });
});

// API: Get Indicator Options
app.get('/api/indicator', async (req, res) => {
    try {
        const indicatorId = req.query.id;
        if (!indicatorId) {
            return res.status(400).json({ error: 'Missing id query parameter' });
        }
        console.log(`Fetching options for indicator: ${indicatorId}`);

        const indicator = await TradingView.getIndicator(
            indicatorId,
            'last',
            process.env.SESSION,
            process.env.SIGNATURE
        );

        if (!indicator || !indicator.inputs) {
            return res.status(404).json({ error: 'Indicator not found or no inputs available' });
        }

        res.json({ inputs: indicator.inputs });
    } catch (error) {
        console.error('Error fetching indicator:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper: Generate range values
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

// Helper: Generate Cartesian product of options
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

// Helper: Clean error messages from TradingView
function cleanErrorMessage(err) {
    let errorMessage = 'Unknown error';

    if (err instanceof Error) {
        errorMessage = err.message;
    } else if (typeof err === 'string') {
        errorMessage = err;
    } else {
        errorMessage = JSON.stringify(err);
    }

    // Extract the meaningful part before "Command info:" if present
    if (errorMessage.includes('Command info:')) {
        errorMessage = errorMessage.split('Command info:')[0].trim();
    }

    // Add helpful hints for common errors
    if (errorMessage.includes('Bar Magnifier feature is only available to Premium users')) {
        errorMessage += ' (Hint: Disable "use_bar_magnifier" option in your strategy settings)';
    }

    return errorMessage;
}

// Async Backtest Runner
async function runBacktestJob(jobId, { indicatorId, options, ranges, symbols, timeframes, dateFrom, dateTo }) {
    const job = jobs.get(jobId);
    job.status = 'running';
    saveJob(jobId); // Save initial state
    broadcast(jobId, { type: 'status', status: 'running' });

    try {
        const optionCombinations = generateOptionCombinations(options, ranges);
        const totalTests = symbols.length * timeframes.length * optionCombinations.length;

        console.log(`Job ${jobId}: Starting ${totalTests} tests`);
        broadcast(jobId, { type: 'info', message: `Starting ${totalTests} tests...` });

        // Runtime Credential Check
        if (!process.env.SESSION || !process.env.SIGNATURE) {
            throw new Error('Missing TradingView credentials. Please sync via the Chrome Extension.');
        }

        let completedTests = 0;

        // Create a shared client for this batch using Deep Backtesting (Premium only)
        // This uses TradingView's history-data server for deep historical data
        const client = new TradingView.Client({
            token: process.env.SESSION,
            signature: process.env.SIGNATURE,
            server: 'history-data', // Premium feature - deep backtesting
        });

        // Process sequentially
        for (const symbol of symbols) {
            for (const timeframe of timeframes) {
                for (const combo of optionCombinations) {
                    // Check if job was cancelled
                    if (job.cancelled) {
                        console.log(`Job ${jobId} was cancelled`);
                        client.end();
                        return;
                    }

                    try {
                        console.log(`Testing: ${symbol} ${timeframe} options=${JSON.stringify(combo)}`);

                        const strategy = await TradingView.getIndicator(
                            indicatorId,
                            'last',
                            process.env.SESSION,
                            process.env.SIGNATURE
                        );

                        // Set options
                        Object.keys(combo).forEach(key => {
                            strategy.setOption(key, combo[key]);
                        });

                        // Create history session for deep backtesting
                        const history = new client.Session.History();

                        // Set up error handling
                        history.onError((...error) => {
                            console.error('History error:', error);
                            history.delete();
                            throw new Error(error.join(' '));
                        });

                        // Calculate timestamps from date inputs or default to 1 year
                        let from, to;

                        if (dateFrom && dateTo) {
                            // Convert date strings (YYYY-MM-DD) to Unix timestamps
                            from = Math.floor(new Date(dateFrom).getTime() / 1000);
                            to = Math.floor(new Date(dateTo).getTime() / 1000);
                        } else {
                            // Default: from 1 year ago to now
                            from = Math.floor(Date.now() / 1000) - (1 * 365 * 24 * 60 * 60);
                            to = Math.floor(Date.now() / 1000);
                        }

                        // Add 1-day buffer before start date to avoid missing trades at boundary
                        // TradingView API has a boundary condition where trades very close to
                        // the exact start timestamp may be excluded. Subtracting 1 day ensures
                        // we capture all trades in the requested range.
                        from = from - (24 * 60 * 60); // Subtract 1 day in seconds

                        // Request deep backtest
                        history.requestHistoryData(symbol, from, to, strategy, { timeframe });

                        // Wait for history to load
                        const report = await new Promise((resolve, reject) => {
                            // Use configurable timeout (default 120s for production environments)
                            // Production servers may have slower network connections to TradingView
                            const timeoutMs = parseInt(process.env.BACKTEST_TIMEOUT_MS || '120000');

                            let timeout = setTimeout(() => {
                                history.delete();
                                reject(new Error(`Timeout waiting for deep backtest report after ${timeoutMs}ms`));
                            }, timeoutMs);

                            history.onHistoryLoaded(() => {
                                clearTimeout(timeout);
                                resolve(history.strategyReport);
                            });
                        });

                        console.log(`✓ Deep backtest report received for ${symbol} ${timeframe}`);

                        // DEBUG: Log data availability and strategy settings
                        if (report && report.settings && report.settings.dateRange) {
                            const fromDate = new Date(report.settings.dateRange.backtest.from).toISOString().split('T')[0];
                            const toDate = new Date(report.settings.dateRange.backtest.to).toISOString().split('T')[0];
                            console.log(`  Backtest date range: ${fromDate} to ${toDate}`);
                        }
                        console.log(`  Total trades: ${report?.performance?.all?.totalTrades || 0}`);

                        const result = {
                            symbol,
                            timeframe,
                            options: combo,
                            report: report && report.performance ? {
                                netProfit: report.performance.all?.netProfit ?? 'N/A',
                                totalClosedTrades: report.performance.all?.totalTrades ?? 'N/A',
                                percentProfitable: report.performance.all?.percentProfitable ?
                                    (report.performance.all.percentProfitable * 100) : 'N/A',
                                profitFactor: report.performance.all?.profitFactor ?? 'N/A',
                                maxDrawdown: report.performance.maxStrategyDrawDownPercent ?
                                    (report.performance.maxStrategyDrawDownPercent * 100) : 'N/A',
                                avgTrade: report.performance.all?.avgTrade ?? 'N/A'
                            } : null,
                            // Include full report for detailed analytics modal
                            fullReport: report
                        };

                        job.results.push(result);
                        saveJob(jobId); // Save progress (optional, maybe too frequent? Let's save on batch or completion to avoid IO spam)
                        // Actually, for long running jobs, saving periodically is good. Let's save every 10 results or so?
                        // For now, let's just save on completion to avoid performance hit, or maybe every 5 minutes.
                        // Let's stick to saving on completion/error for now, and maybe update status.

                        broadcast(jobId, { type: 'result', data: result });

                        // Cleanup history session
                        history.delete();

                    } catch (err) {
                        console.error(`Failed test for ${symbol} ${timeframe}:`, err);

                        const errorMessage = cleanErrorMessage(err);

                        // Stop the job on error as requested
                        console.log(`Job ${jobId} stopping due to error: ${errorMessage}`);
                        job.status = 'failed';
                        job.error = errorMessage;
                        saveJob(jobId); // Save error state

                        // Send the error result so it shows in the table
                        const errorResult = {
                            symbol,
                            timeframe,
                            options: combo,
                            error: errorMessage
                        };
                        job.results.push(errorResult);
                        broadcast(jobId, { type: 'result', data: errorResult });

                        // Broadcast fatal error to stop frontend
                        broadcast(jobId, { type: 'error', message: errorMessage });

                        // Cleanup client
                        client.end();
                        return; // Stop the job
                    }

                    completedTests++;
                    broadcast(jobId, {
                        type: 'progress',
                        current: completedTests,
                        total: totalTests,
                        percent: Math.round((completedTests / totalTests) * 100)
                    });
                }
            }
        }

        client.end();
        job.status = 'completed';
        saveJob(jobId); // Save final state
        broadcast(jobId, { type: 'complete', results: job.results });
        console.log(`Job ${jobId}: Completed`);

    } catch (error) {
        console.error(`Job ${jobId} failed:`, error);
        job.status = 'failed';
        job.error = error.message;
        saveJob(jobId); // Save failure state
        broadcast(jobId, { type: 'error', message: error.message });
    }
}

// API: Start Backtest (Async)
app.post('/api/backtest', (req, res) => {
    try {
        const { indicatorId, options, ranges, symbols, timeframes, dateFrom, dateTo } = req.body;

        const jobId = crypto.randomUUID();
        jobs.set(jobId, {
            id: jobId,
            status: 'pending',
            config: { indicatorId, options, ranges, symbols, timeframes, dateFrom, dateTo },
            results: [],
            startTime: Date.now()
        });

        // Start job in background
        saveJob(jobId); // Save pending state
        runBacktestJob(jobId, { indicatorId, options, ranges, symbols, timeframes, dateFrom, dateTo });

        res.json({ jobId, message: 'Backtest started' });

    } catch (error) {
        console.error('Error starting backtest:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Cancel Backtest Job
app.post('/api/backtest/:jobId/cancel', (req, res) => {
    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    // Set cancelled flag
    job.cancelled = true;
    job.status = 'cancelled';
    saveJob(jobId); // Save cancelled state

    // Broadcast cancellation
    broadcast(jobId, {
        type: 'error',
        message: 'Backtest cancelled by user'
    });

    res.json({ success: true, message: 'Job cancelled' });
});

// API: List Jobs
app.get('/api/jobs', (req, res) => {
    try {
        const files = fs.readdirSync(RESULTS_DIR);
        const jobSummaries = files
            .filter(f => f.endsWith('.json') || f.endsWith('.json.gz'))
            .map(f => {
                try {
                    const filePath = path.join(RESULTS_DIR, f);
                    const stats = fs.statSync(filePath);

                    // If it's a gz file, we can't easily read the content without unzipping, 
                    // so we might just return basic info or try to read a bit.
                    // For now, let's assume we only list .json files for detailed info, 
                    // or we just list them as "Archived".

                    if (f.endsWith('.json.gz')) {
                        return {
                            id: f.replace('.json.gz', ''),
                            date: stats.mtime,
                            status: 'archived',
                            symbolCount: '?',
                            isArchived: true
                        };
                    }

                    const content = fs.readFileSync(filePath, 'utf8');
                    const job = JSON.parse(content);
                    return {
                        id: job.id,
                        date: new Date(job.startTime),
                        status: job.status,
                        symbolCount: job.results ? job.results.length : 0,
                        isArchived: false
                    };
                } catch (e) {
                    console.error(`Error reading job file ${f}:`, e);
                    return null;
                }
            })
            .filter(j => j !== null)
            .sort((a, b) => b.date - a.date); // Newest first

        res.json(jobSummaries);
    } catch (error) {
        console.error('Error listing jobs:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Get Job Details
app.get('/api/jobs/:id', (req, res) => {
    const { id } = req.params;

    // Check memory first
    if (jobs.has(id)) {
        return res.json(jobs.get(id));
    }

    // Check disk
    const jsonPath = path.join(RESULTS_DIR, `${id}.json`);
    const gzPath = path.join(RESULTS_DIR, `${id}.json.gz`);

    if (fs.existsSync(jsonPath)) {
        try {
            const content = fs.readFileSync(jsonPath, 'utf8');
            const job = JSON.parse(content);
            // Cache in memory? Maybe not, to avoid memory leaks.
            res.json(job);
        } catch (e) {
            res.status(500).json({ error: 'Failed to read job file' });
        }
    } else if (fs.existsSync(gzPath)) {
        try {
            const gzContent = fs.readFileSync(gzPath);
            zlib.gunzip(gzContent, (err, buffer) => {
                if (err) return res.status(500).json({ error: 'Failed to decompress job file' });
                try {
                    const job = JSON.parse(buffer.toString());
                    res.json(job);
                } catch (e) {
                    res.status(500).json({ error: 'Failed to parse decompressed job file' });
                }
            });
        } catch (e) {
            res.status(500).json({ error: 'Failed to read compressed job file' });
        }
    } else {
        res.status(404).json({ error: 'Job not found' });
    }
});

// API: Export to Excel
app.post('/api/export', async (req, res) => {
    try {
        const { results } = req.body;
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Backtest Results');

        // Define columns
        sheet.columns = [
            { header: 'Symbol', key: 'symbol', width: 15 },
            { header: 'Timeframe', key: 'timeframe', width: 10 },
            { header: 'Options', key: 'options', width: 40 },
            { header: 'Net Profit', key: 'netProfit', width: 15 },
            { header: 'Total Trades', key: 'totalClosedTrades', width: 15 },
            { header: '% Profitable', key: 'percentProfitable', width: 15 },
            { header: 'Profit Factor', key: 'profitFactor', width: 15 },
            { header: 'Max Drawdown', key: 'maxDrawdown', width: 15 },
            { header: 'Avg Trade', key: 'avgTrade', width: 15 },
            { header: 'Error', key: 'error', width: 20 }
        ];

        // Add rows
        results.forEach(r => {
            if (r.error) {
                sheet.addRow({
                    symbol: r.symbol,
                    timeframe: r.timeframe,
                    options: JSON.stringify(r.options),
                    error: r.error
                });
            } else {
                sheet.addRow({
                    symbol: r.symbol,
                    timeframe: r.timeframe,
                    options: JSON.stringify(r.options),
                    netProfit: r.report.netProfit,
                    totalClosedTrades: r.report.totalClosedTrades,
                    percentProfitable: r.report.percentProfitable,
                    profitFactor: r.report.profitFactor,
                    maxDrawdown: r.report.maxDrawdown,
                    avgTrade: r.report.avgTrade
                });
            }
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=backtest_results.xlsx');

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('Error exporting Excel:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Also accessible at http://127.0.0.1:${PORT}`);
});
