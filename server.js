const express = require('express');
const bodyParser = require('body-parser');
const TradingView = require('@mathieuc/tradingview');
const ExcelJS = require('exceljs');
const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Job Store: { jobId: { status, progress, results, error, cancelled } }
const jobs = new Map();

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

// Middleware
app.use(express.static('public'));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});
app.use(express.static('public'));

// Check credentials
if (!process.env.SESSION || !process.env.SIGNATURE) {
    console.error('❌ Error: TradingView credentials not found in .env file!');
    process.exit(1);
}

// API: Get Config
app.get('/api/config', (req, res) => {
    res.json({
        appTitle: process.env.APP_TITLE || 'TradingView Backtester',
        appSubtitle: process.env.APP_SUBTITLE || 'Automated strategy testing with range analysis',
        indicatorId: process.env.INDICATOR_ID || ''
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
            } else {
                const { min, max, step } = ranges[key];
                values = getRangeValues(min, max, step);
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
async function runBacktestJob(jobId, { indicatorId, options, ranges, symbols, timeframes }) {
    const job = jobs.get(jobId);
    job.status = 'running';
    broadcast(jobId, { type: 'status', status: 'running' });

    try {
        const optionCombinations = generateOptionCombinations(options, ranges);
        const totalTests = symbols.length * timeframes.length * optionCombinations.length;

        console.log(`Job ${jobId}: Starting ${totalTests} tests`);
        broadcast(jobId, { type: 'info', message: `Starting ${totalTests} tests...` });

        let completedTests = 0;

        // Create a shared client for this batch
        const client = new TradingView.Client({
            token: process.env.SESSION,
            signature: process.env.SIGNATURE,
        });

        // Process sequentially
        for (const symbol of symbols) {
            for (const timeframe of timeframes) {

                // Create chart for this symbol/timeframe
                const chart = new client.Session.Chart();
                chart.setMarket(symbol, { timeframe });

                // Wait a bit for chart to init
                await new Promise(r => setTimeout(r, 500));

                for (const combo of optionCombinations) {
                    // Check if job was cancelled
                    if (job.cancelled) {
                        console.log(`Job ${jobId} was cancelled`);
                        client.end();
                        return;
                    }

                    try {
                        // console.log(`Testing: ${symbol} ${timeframe} options=${JSON.stringify(combo)}`);

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

                        const indicator = new chart.Study(strategy);

                        const report = await new Promise((resolve, reject) => {
                            let timeout = setTimeout(() => {
                                reject(new Error('Timeout waiting for report'));
                            }, 20000); // 20s timeout

                            indicator.onUpdate(() => {
                                if (indicator.strategyReport) {
                                    clearTimeout(timeout);
                                    resolve(indicator.strategyReport);
                                }
                            });

                            indicator.onError((err) => {
                                clearTimeout(timeout);
                                reject(err);
                            });
                        });

                        console.log(`✓ Report received for ${symbol} ${timeframe}`);

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
                        broadcast(jobId, { type: 'result', data: result });

                        // Cleanup indicator
                        indicator.remove();

                    } catch (err) {
                        console.error(`Failed test for ${symbol} ${timeframe}:`, err);

                        const errorMessage = cleanErrorMessage(err);

                        // Stop the job on error as requested
                        console.log(`Job ${jobId} stopping due to error: ${errorMessage}`);
                        job.status = 'failed';
                        job.error = errorMessage;

                        // Send the error result so it shows in the table (optional, but good for context)
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

                        // Cleanup chart and client
                        chart.delete();
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

                // Cleanup chart
                chart.delete();
            }
        }

        client.end();
        job.status = 'completed';
        broadcast(jobId, { type: 'complete', results: job.results });
        console.log(`Job ${jobId}: Completed`);

    } catch (error) {
        console.error(`Job ${jobId} failed:`, error);
        job.status = 'failed';
        job.error = error.message;
        broadcast(jobId, { type: 'error', message: error.message });
    }
}

// API: Start Backtest (Async)
app.post('/api/backtest', (req, res) => {
    try {
        const { indicatorId, options, ranges, symbols, timeframes } = req.body;

        const jobId = crypto.randomUUID();
        jobs.set(jobId, {
            id: jobId,
            status: 'pending',
            results: [],
            startTime: Date.now()
        });

        // Start job in background
        runBacktestJob(jobId, { indicatorId, options, ranges, symbols, timeframes });

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

    // Broadcast cancellation
    broadcast(jobId, {
        type: 'error',
        message: 'Backtest cancelled by user'
    });

    res.json({ success: true, message: 'Job cancelled' });
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
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
