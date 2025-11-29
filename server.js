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

// Global error handlers to catch unhandled WebSocket 429 errors
// These prevent the server from crashing on TradingView rate limits
process.on('uncaughtException', (err) => {
    const errMsg = err.message || String(err);
    if (errMsg.includes('429')) {
        console.log(`⚠️ [Global] Caught 429 rate limit error: ${errMsg}`);
        // Don't exit - this is a rate limit, not a fatal error
    } else {
        console.error('❌ [Global] Uncaught exception:', err);
        // For non-429 errors, you might want to exit or handle differently
    }
});

process.on('unhandledRejection', (reason, promise) => {
    const errMsg = reason?.message || String(reason);
    if (errMsg.includes('429')) {
        console.log(`⚠️ [Global] Caught 429 rate limit rejection: ${errMsg}`);
    } else {
        console.error('❌ [Global] Unhandled rejection:', reason);
    }
});

// Dynamic import for p-limit (ESM module)
let pLimit;
(async () => {
    pLimit = (await import('p-limit')).default;
})();

const app = express();
const PORT = process.env.PORT || 3000;

// TradingView plan to parallel connections mapping
// Using conservative limits to avoid 429 rate limiting
// These are default values - client can override with custom settings
const PLAN_CONNECTIONS = {
    'Free': 1,
    'Essential': 2,
    'Plus': 4,
    'Premium': 8,
    'Ultimate': 15
};

// Get max parallel connections for a plan
function getMaxConnections(accountType) {
    return PLAN_CONNECTIONS[accountType] || PLAN_CONNECTIONS['Free'];
}

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
                ws.jobId = data.jobId;

                // Send current state if job exists
                const job = jobs.get(data.jobId);
                if (job) {
                    ws.send(JSON.stringify({ type: 'status', status: job.status }));
                    
                    // Send pending tasks if job has them
                    if (job.tasks && job.tasks.length > 0) {
                        job.tasks.forEach(task => {
                            ws.send(JSON.stringify({ 
                                type: 'pending', 
                                data: { 
                                    symbol: task.symbol, 
                                    timeframe: task.timeframe, 
                                    options: task.combo,
                                    status: 'pending'
                                } 
                            }));
                        });
                    }
                    
                    // Send already completed results
                    if (job.results && job.results.length > 0) {
                        job.results.forEach(result => {
                            ws.send(JSON.stringify({ type: 'result', data: result }));
                        });
                        // Send progress
                        ws.send(JSON.stringify({
                            type: 'progress',
                            current: job.results.length,
                            total: job.tasks ? job.tasks.length : job.results.length,
                            percent: job.tasks ? Math.round((job.results.length / job.tasks.length) * 100) : 100
                        }));
                    }
                }
            }
        } catch (e) {
            console.error('WebSocket parse error:', e);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Broadcast to subscribers of a specific job
function broadcast(jobId, message) {
    let sentCount = 0;
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.jobId === jobId) {
            client.send(JSON.stringify(message));
            sentCount++;
        }
    });
    if (message.type === 'rate_limit' || message.type === 'error') {
        console.log(`📡 Broadcast ${message.type} to ${sentCount} clients for job ${jobId}`);
    }
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
// Note: We now rely on client-side credentials passed with each request.
// process.env.SESSION/SIGNATURE are no longer used as primary source.

// API: Sync Credentials & Indicators (from Extension) - REMOVED
// Client now saves directly to chrome.storage.local

// API: Get Config - REMOVED
// Client now has hardcoded config and gets indicators from extension

// API: Get Indicator Options - REMOVED
// Client gets options from extension sync data

// Helper: Clean error messages from TradingView

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

// Delay helper to avoid rate limiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Create a TradingView client with proper error handling for WebSocket 429 errors
async function createTradingViewClient(session, signature) {
    return new Promise((resolve, reject) => {
        let resolved = false;
        let rejected = false;
        
        // Create the client
        const client = new TradingView.Client({
            token: session,
            signature: signature,
            server: 'history-data',
        });
        
        // Access internal WebSocket to add error handler
        // The client stores the WebSocket in a private field, but we can access it via prototype
        // Alternative: patch the library or use a global error handler
        
        // Listen for client-level errors
        client.onError((...args) => {
            if (!resolved && !rejected) {
                rejected = true;
                const errMsg = args.join(' ');
                console.log(`⚠️ TradingView client error: ${errMsg}`);
                reject(new Error(errMsg));
            }
        });
        
        // Listen for disconnection (which happens on 429)
        client.onDisconnected(() => {
            if (!resolved && !rejected) {
                rejected = true;
                console.log(`⚠️ TradingView client disconnected unexpectedly`);
                reject(new Error('Client disconnected - possible rate limit (429)'));
            }
        });
        
        // TradingView client emits 'logged' when ready
        client.onLogged(() => {
            if (!rejected) {
                resolved = true;
                resolve(client);
            }
        });
        
        // Timeout if connection takes too long (usually means 429 or network issue)
        setTimeout(() => {
            if (!resolved && !rejected) {
                rejected = true;
                console.log(`⚠️ TradingView client connection timeout`);
                try { client.end(); } catch(e) {}
                reject(new Error('Client connection timeout - possible rate limit (429)'));
            }
        }, 15000); // 15 second timeout
    });
}

// Execute a single backtest task (creates its own client)
async function runSingleBacktest({ symbol, timeframe, combo, dateFrom, dateTo, indicatorId, session, signature, onRetrying }, retryCount = 0) {
    // Create a dedicated client for this backtest
    let client;
    
    // Errors that should trigger a retry
    const isRetryableError = (errMsg) => {
        return errMsg.includes('429') || 
               errMsg.includes('rate limit') || 
               errMsg.includes('timeout') || 
               errMsg.includes('disconnected') ||
               errMsg.includes('ECONNRESET') ||
               errMsg.includes('ETIMEDOUT') ||
               errMsg.includes('socket hang up') ||
               errMsg.includes('network');
    };
    
    // Errors that are critical and should NOT retry (auth/session issues)
    const isCriticalError = (errMsg) => {
        return errMsg.includes('session') || 
               errMsg.includes('auth') || 
               errMsg.includes('unauthorized') ||
               errMsg.includes('forbidden') ||
               errMsg.includes('invalid');
    };
    
    try {
        client = await createTradingViewClient(session, signature);
    } catch (err) {
        const errMsg = (err.message || String(err)).toLowerCase();
        console.log(`⚠️ Client creation failed: ${err.message || err}`);
        
        // Critical errors - don't retry
        if (isCriticalError(errMsg)) {
            throw err;
        }
        
        // Retryable errors - retry up to 3 times
        if (retryCount < 3) {
            const waitTime = (retryCount + 1) * 5;
            console.log(`⚠️ Error occurred, waiting ${waitTime}s before retry (attempt ${retryCount + 1}/3)...`);
            
            // Notify frontend that we're retrying (show orange warning on the specific row)
            if (onRetrying) {
                onRetrying({
                    symbol,
                    timeframe,
                    options: combo,
                    attempt: retryCount + 1,
                    maxAttempts: 3,
                    waitTime,
                    message: `Erreur - Retry ${retryCount + 1}/3 dans ${waitTime}s...`
                });
            }
            
            await delay(waitTime * 1000);
            return runSingleBacktest({ symbol, timeframe, combo, dateFrom, dateTo, indicatorId, session, signature, onRetrying }, retryCount + 1);
        }
        
        throw err;
    }

    try {
        const strategy = await TradingView.getIndicator(
            indicatorId,
            'last',
            session,
            signature
        );

        // Set options
        Object.keys(combo).forEach(key => {
            strategy.setOption(key, combo[key]);
        });

        // Create history session for deep backtesting
        const history = new client.Session.History();

        // Calculate timestamps from date inputs or default to 1 year
        let from, to;

        if (dateFrom && dateTo) {
            from = Math.floor(new Date(dateFrom).getTime() / 1000);
            to = Math.floor(new Date(dateTo).getTime() / 1000);
        } else {
            from = Math.floor(Date.now() / 1000) - (1 * 365 * 24 * 60 * 60);
            to = Math.floor(Date.now() / 1000);
        }

        // Add 1-day buffer before start date
        from = from - (24 * 60 * 60);

        // Request deep backtest
        history.requestHistoryData(symbol, from, to, strategy, { timeframe });

        // Wait for history to load with timeout
        const report = await new Promise((resolve, reject) => {
            const timeoutMs = parseInt(process.env.BACKTEST_TIMEOUT_MS || '120000');
            
            let errorOccurred = false;
            
            // Set up error handling
            history.onError((...error) => {
                errorOccurred = true;
                history.delete();
                reject(new Error(error.join(' ')));
            });

            const timeout = setTimeout(() => {
                if (!errorOccurred) {
                    history.delete();
                    reject(new Error(`Timeout waiting for deep backtest report after ${timeoutMs}ms`));
                }
            }, timeoutMs);

            history.onHistoryLoaded(() => {
                clearTimeout(timeout);
                if (!errorOccurred) {
                    resolve(history.strategyReport);
                }
            });
        });

        // Cleanup history session
        history.delete();
        
        // Close the client
        client.end();

        return {
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
            fullReport: report
        };
    } catch (error) {
        // Make sure to close client on error
        client.end();
        throw error;
    }
}

// Async Backtest Runner with Parallel Execution
async function runBacktestJob(jobId, { indicatorId, combinations, symbols, timeframes, dateFrom, dateTo, session, signature, accountType, maxParallelConnections }) {
    const job = jobs.get(jobId);
    
    // Wait a bit for WebSocket client to connect before starting
    // This ensures the frontend receives all pending/running status updates
    await delay(500);
    
    job.status = 'running';
    saveJob(jobId);
    broadcast(jobId, { type: 'status', status: 'running' });
    
    console.log(`Job ${jobId}: Account type: ${accountType}, Max parallel connections: ${maxParallelConnections}`);

    try {
        const optionCombinations = combinations;
        const totalTests = symbols.length * timeframes.length * optionCombinations.length;

        console.log(`Job ${jobId}: Starting ${totalTests} tests with ${maxParallelConnections} parallel connections`);
        broadcast(jobId, { type: 'info', message: `Starting ${totalTests} tests (${maxParallelConnections} parallel)...` });

        if (!session || !signature) {
            throw new Error('Missing TradingView credentials. Please sync via the Chrome Extension.');
        }

        // Create limit function for parallel execution
        const limit = pLimit(maxParallelConnections);
        let completedTests = 0;
        let criticalError = false; // Only for session/auth errors

        // Build all test tasks
        const tasks = [];
        for (const symbol of symbols) {
            for (const timeframe of timeframes) {
                for (const combo of optionCombinations) {
                    tasks.push({ symbol, timeframe, combo });
                }
            }
        }

        // Store tasks in job object so they can be sent to late-connecting clients
        job.tasks = tasks;

        // Send pending status for all tasks to frontend (so they can show loading state)
        tasks.forEach(task => {
            broadcast(jobId, { 
                type: 'pending', 
                data: { 
                    symbol: task.symbol, 
                    timeframe: task.timeframe, 
                    options: task.combo,
                    status: 'pending'
                } 
            });
        });

        // Track task index for staggered starts
        let taskIndex = 0;

        // Execute tasks in parallel with concurrency limit
        const promises = tasks.map(task => 
            limit(async () => {
                // Check if job was cancelled or has critical error
                if (job.cancelled || criticalError) {
                    return null;
                }

                // Add small delay between task starts to avoid rate limiting
                const myIndex = taskIndex++;
                if (myIndex > 0) {
                    await delay(500); // 500ms delay between each new connection
                }

                const { symbol, timeframe, combo } = task;

                // Notify frontend that this test is now running
                broadcast(jobId, { 
                    type: 'running', 
                    data: { symbol, timeframe, options: combo, status: 'running' } 
                });

                try {
                    console.log(`Testing: ${symbol} ${timeframe} options=${JSON.stringify(combo)}`);

                    // Each backtest creates its own client
                    const result = await runSingleBacktest({
                        symbol,
                        timeframe,
                        combo,
                        dateFrom,
                        dateTo,
                        indicatorId,
                        session,
                        signature,
                        onRetrying: (retryInfo) => {
                            console.log(`📡 Broadcasting retry status for ${symbol} ${timeframe}: attempt ${retryInfo.attempt}/${retryInfo.maxAttempts}`);
                            broadcast(jobId, { type: 'retrying', data: retryInfo });
                        }
                    });

                    console.log(`✓ Completed: ${symbol} ${timeframe} - ${result.report?.totalClosedTrades || 0} trades`);

                    job.results.push(result);
                    broadcast(jobId, { type: 'result', data: result });

                    completedTests++;
                    broadcast(jobId, {
                        type: 'progress',
                        current: completedTests,
                        total: totalTests,
                        percent: Math.round((completedTests / totalTests) * 100)
                    });

                    return result;

                } catch (err) {
                    console.error(`Failed test for ${symbol} ${timeframe}:`, err);
                    
                    const errorMessage = cleanErrorMessage(err);
                    
                    // Check if this is a 429 rate limit error or timeout (which usually means rate limit)
                    const isRateLimitError = errorMessage.includes('429') || 
                                            errorMessage.includes('timeout') ||
                                            errorMessage.includes('rate limit') ||
                                            errorMessage.includes('Limite TradingView');
                    
                    // Check if this is a critical error (session/auth) that should stop everything
                    const isCriticalError = errorMessage.includes('session') || 
                                           errorMessage.includes('auth') || 
                                           errorMessage.includes('unauthorized') ||
                                           errorMessage.includes('forbidden');
                    
                    if (isCriticalError) {
                        criticalError = true;
                        console.log(`Job ${jobId} stopping due to critical error: ${errorMessage}`);
                        job.status = 'failed';
                        job.error = errorMessage;
                        saveJob(jobId);
                        broadcast(jobId, { type: 'error', message: errorMessage });
                    }
                    
                    // Send rate limit error notification separately so frontend can show warning
                    if (isRateLimitError) {
                        console.log(`Job ${jobId}: Rate limit/timeout error detected, broadcasting to frontend: ${errorMessage}`);
                        broadcast(jobId, { type: 'rate_limit', message: errorMessage });
                    }

                    const errorResult = {
                        symbol,
                        timeframe,
                        options: combo,
                        error: errorMessage
                    };
                    job.results.push(errorResult);
                    broadcast(jobId, { type: 'result', data: errorResult });

                    completedTests++;
                    broadcast(jobId, {
                        type: 'progress',
                        current: completedTests,
                        total: totalTests,
                        percent: Math.round((completedTests / totalTests) * 100)
                    });

                    return errorResult;
                }
            })
        );

        // Wait for all tasks to complete (or fail)
        await Promise.all(promises);

        // Check final status
        if (job.cancelled) {
            console.log(`Job ${jobId} was cancelled`);
            return;
        }

        // Count errors
        const errorCount = job.results.filter(r => r.error).length;
        const successCount = job.results.filter(r => !r.error).length;

        if (!criticalError) {
            job.status = errorCount > 0 ? 'completed_with_errors' : 'completed';
            saveJob(jobId);
            broadcast(jobId, { type: 'complete', results: job.results });
            console.log(`Job ${jobId}: Completed (${successCount} success, ${errorCount} errors)`);
        }

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
        const { indicatorId, combinations, ranges, symbols, timeframes, dateFrom, dateTo, session, signature, accountType, maxParallelConnections: clientMaxConnections } = req.body;

        if (!session || !signature) {
            return res.status(401).json({ error: 'Missing TradingView credentials' });
        }

        // Use client-provided limit or fall back to server defaults
        const validAccountType = PLAN_CONNECTIONS[accountType] ? accountType : 'Free';
        const maxParallelConnections = clientMaxConnections || getMaxConnections(validAccountType);
        
        console.log(`📊 New backtest: Account type: ${validAccountType}, Max parallel: ${maxParallelConnections} (client requested: ${clientMaxConnections || 'default'})`);

        const jobId = crypto.randomUUID();
        jobs.set(jobId, {
            id: jobId,
            status: 'pending',
            config: { indicatorId, combinations, ranges, symbols, timeframes, dateFrom, dateTo },
            results: [],
            startTime: Date.now(),
            session: session, // Save session to filter history later
            accountType: validAccountType,
            maxParallelConnections: maxParallelConnections
        });

        // Start job in background
        saveJob(jobId); // Save pending state
        runBacktestJob(jobId, { indicatorId, combinations, symbols, timeframes, dateFrom, dateTo, session, signature, accountType: validAccountType, maxParallelConnections });

        res.json({ id: jobId, message: 'Backtest started' });

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
        const currentSession = req.headers['x-session-id'];
        console.log(`🔍 /api/jobs: Requesting history. Session: ${currentSession ? currentSession.substring(0, 10) + '...' : 'NONE'}`);

        const jobSummaries = files
            .filter(f => f.endsWith('.json') || f.endsWith('.json.gz'))
            .map(f => {
                try {
                    const filePath = path.join(RESULTS_DIR, f);
                    const stats = fs.statSync(filePath);

                    if (f.endsWith('.json.gz')) {
                        // For archived files, we can't easily check session without unzipping.
                        // For now, we'll exclude them if a session is provided to be safe,
                        // or include them if we assume they are old and public?
                        // The requirement says "n'affiche que les results de la personne concerné".
                        // Safest is to exclude if we can't verify.
                        // Or maybe we should just return them and let client decide?
                        // But client logic is "if session matches".
                        // Let's skip archived for now if we are filtering.
                        if (currentSession) return null;

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

                    // Filter by session
                    // Enforce strict filtering: only show jobs that match the current session.
                    // If user has a session, they see only their jobs.
                    // If user has NO session (guest), they see only guest jobs (no session).
                    // This hides legacy/guest jobs from authenticated users, and vice versa.
                    if (job.session !== currentSession) return null;

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

// API: Retry a single failed backtest
app.post('/api/retry-backtest', async (req, res) => {
    try {
        const { symbol, timeframe, options, indicatorId, dateFrom, dateTo, session, signature, jobId } = req.body;
        
        if (!symbol || !timeframe || !indicatorId || !session) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }
        
        console.log(`🔄 Retrying backtest for ${symbol} ${timeframe}`);
        
        // Notify frontend that retry is starting
        broadcast(jobId, { 
            type: 'running', 
            data: { symbol, timeframe, options, status: 'running' } 
        });
        
        try {
            const result = await runSingleBacktest({
                symbol,
                timeframe,
                combo: options,
                dateFrom,
                dateTo,
                indicatorId,
                session,
                signature,
                onRetrying: (retryInfo) => {
                    broadcast(jobId, { type: 'retrying', data: retryInfo });
                }
            });
            
            console.log(`✓ Retry completed: ${symbol} ${timeframe}`);
            
            // Broadcast result
            broadcast(jobId, { type: 'result', data: result });
            broadcast(jobId, { type: 'retry_complete', data: result });
            
            res.json({ success: true, result });
        } catch (err) {
            const errorMessage = cleanErrorMessage(err);
            console.error(`❌ Retry failed for ${symbol} ${timeframe}:`, errorMessage);
            
            const errorResult = {
                symbol,
                timeframe,
                options,
                error: errorMessage
            };
            
            broadcast(jobId, { type: 'result', data: errorResult });
            
            res.json({ success: false, error: errorMessage, result: errorResult });
        }
    } catch (error) {
        console.error('Error in retry-backtest:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Also accessible at http://127.0.0.1:${PORT}`);
});
