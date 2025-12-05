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
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

// Generate a short hash from session ID for directory naming
function getSessionHash(session) {
    if (!session) return 'anonymous';
    // Use first 16 chars of SHA256 hash of session for short but unique identifier
    return crypto.createHash('sha256').update(session).digest('hex').substring(0, 16);
}

// Get or create user directory path
function getUserDir(session) {
    const sessionHash = getSessionHash(session);
    const userDir = path.join(RESULTS_DIR, sessionHash);
    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
        console.log(`📁 Created user directory: ${sessionHash}`);
    }
    return userDir;
}

// Get index file path for a user
function getIndexFilePath(session) {
    const userDir = getUserDir(session);
    return path.join(userDir, 'index.json');
}

// Get or create job directory path (new incremental storage format)
function getJobDir(session, jobId) {
    const userDir = getUserDir(session);
    const jobDir = path.join(userDir, jobId);
    if (!fs.existsSync(jobDir)) {
        fs.mkdirSync(jobDir, { recursive: true });
    }
    return jobDir;
}

// Check if a job uses the new incremental format (directory with meta.json.gz)
function isIncrementalJob(session, jobId) {
    const userDir = getUserDir(session);
    const jobDir = path.join(userDir, jobId);
    const metaPath = path.join(jobDir, 'meta.json.gz');
    return fs.existsSync(jobDir) && fs.statSync(jobDir).isDirectory() && fs.existsSync(metaPath);
}

// Append a single result to job directory with gzip compression
async function appendResult(session, jobId, resultIndex, result) {
    return new Promise((resolve, reject) => {
        const jobDir = getJobDir(session, jobId);
        const resultPath = path.join(jobDir, `${resultIndex}.json.gz`);
        const jsonData = JSON.stringify(result);
        
        zlib.gzip(jsonData, (err, compressed) => {
            if (err) {
                console.error(`Failed to compress result ${resultIndex} for job ${jobId}:`, err);
                return reject(err);
            }
            
            fs.writeFile(resultPath, compressed, (err) => {
                if (err) {
                    console.error(`Failed to save result ${resultIndex} for job ${jobId}:`, err);
                    return reject(err);
                }
                resolve(true);
            });
        });
    });
}

// Save job metadata only (not results) with gzip compression
function saveJobMeta(jobId) {
    const job = jobs.get(jobId);
    if (!job) return;

    const session = job.session || null;
    const jobDir = getJobDir(session, jobId);
    const metaPath = path.join(jobDir, 'meta.json.gz');
    
    // Create metadata object without results array
    const meta = {
        id: job.id || jobId,
        status: job.status,
        config: job.config,
        startTime: job.startTime,
        session: job.session,
        accountType: job.accountType,
        maxParallelConnections: job.maxParallelConnections,
        resultCount: job.resultCount || 0,
        error: job.error
    };
    
    const jsonData = JSON.stringify(meta, null, 2);
    
    zlib.gzip(jsonData, (err, compressed) => {
        if (err) {
            console.error(`Failed to compress meta for job ${jobId}:`, err);
            return;
        }
        
        fs.writeFile(metaPath, compressed, (err) => {
            if (err) {
                console.error(`Failed to save meta for job ${jobId}:`, err);
                return;
            }
            
            // Update the user's index with job metadata
            updateJobIndex(session, jobId, {
                id: job.id || jobId,
                status: job.status || 'unknown',
                startTime: job.startTime || null,
                symbolCount: job.resultCount || 0,
                indicatorId: job.config?.indicatorId || null,
                symbols: job.config?.symbols || [],
                isArchived: false,
                isIncremental: true
            });
        });
    });
}

// Load job metadata from incremental format
function loadJobMeta(session, jobId) {
    return new Promise((resolve, reject) => {
        const userDir = getUserDir(session);
        const jobDir = path.join(userDir, jobId);
        const metaPath = path.join(jobDir, 'meta.json.gz');
        
        if (!fs.existsSync(metaPath)) {
            return reject(new Error('Job metadata not found'));
        }
        
        fs.readFile(metaPath, (err, compressed) => {
            if (err) return reject(err);
            
            zlib.gunzip(compressed, (err, buffer) => {
                if (err) return reject(err);
                
                try {
                    const meta = JSON.parse(buffer.toString());
                    resolve(meta);
                } catch (e) {
                    reject(e);
                }
            });
        });
    });
}

// Load a single result from incremental format
function loadResult(session, jobId, resultIndex) {
    return new Promise((resolve, reject) => {
        const userDir = getUserDir(session);
        const jobDir = path.join(userDir, jobId);
        const resultPath = path.join(jobDir, `${resultIndex}.json.gz`);
        
        if (!fs.existsSync(resultPath)) {
            return reject(new Error(`Result ${resultIndex} not found`));
        }
        
        fs.readFile(resultPath, (err, compressed) => {
            if (err) return reject(err);
            
            zlib.gunzip(compressed, (err, buffer) => {
                if (err) return reject(err);
                
                try {
                    const result = JSON.parse(buffer.toString());
                    resolve(result);
                } catch (e) {
                    reject(e);
                }
            });
        });
    });
}

// Count results in a job directory
function countJobResults(session, jobId) {
    const userDir = getUserDir(session);
    const jobDir = path.join(userDir, jobId);
    
    if (!fs.existsSync(jobDir)) return 0;
    
    try {
        const files = fs.readdirSync(jobDir);
        return files.filter(f => f.match(/^\d+\.json\.gz$/)).length;
    } catch (e) {
        return 0;
    }
}

// List all result files in a job directory (returns sorted array of indices)
function listJobResultFiles(session, jobId) {
    const userDir = getUserDir(session);
    const jobDir = path.join(userDir, jobId);
    
    if (!fs.existsSync(jobDir)) return [];
    
    try {
        const files = fs.readdirSync(jobDir);
        // Extract numeric indices from filenames like "0.json.gz", "1.json.gz", etc.
        const indices = files
            .filter(f => f.match(/^\d+\.json\.gz$/))
            .map(f => parseInt(f.replace('.json.gz', ''), 10))
            .sort((a, b) => a - b);
        return indices;
    } catch (e) {
        console.error(`Error listing job result files for ${jobId}:`, e);
        return [];
    }
}

// Load job index for a specific user
function loadJobIndex(session) {
    try {
        const indexFile = getIndexFilePath(session);
        if (fs.existsSync(indexFile)) {
            const content = fs.readFileSync(indexFile, 'utf8');
            return JSON.parse(content);
        }
    } catch (e) {
        console.error('Error loading job index:', e);
    }
    return {};
}

// Save job index for a specific user
function saveJobIndex(session, index) {
    try {
        const indexFile = getIndexFilePath(session);
        fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
    } catch (e) {
        console.error('Error saving job index:', e);
    }
}

// Update a single job's metadata in the index (requires session)
function updateJobIndex(session, jobId, metadata) {
    const index = loadJobIndex(session);
    index[jobId] = {
        ...index[jobId],
        ...metadata,
        updatedAt: Date.now()
    };
    saveJobIndex(session, index);
}

// Remove a job from the index (requires session)
function removeFromJobIndex(session, jobId) {
    const index = loadJobIndex(session);
    delete index[jobId];
    saveJobIndex(session, index);
}

// Rebuild index on startup
rebuildAllIndexes();

// Rebuild index for a specific user directory (supports new incremental format)
function rebuildUserIndex(userDir, sessionHash) {
    const index = {};
    
    try {
        const entries = fs.readdirSync(userDir);
        
        for (const entry of entries) {
            if (entry === 'index.json') continue;
            
            const entryPath = path.join(userDir, entry);
            const stat = fs.statSync(entryPath);
            
            // New incremental format: directory with meta.json.gz
            if (stat.isDirectory()) {
                const metaPath = path.join(entryPath, 'meta.json.gz');
                if (fs.existsSync(metaPath)) {
                    try {
                        const compressed = fs.readFileSync(metaPath);
                        const buffer = zlib.gunzipSync(compressed);
                        const meta = JSON.parse(buffer.toString());
                        
                        // Count actual result files
                        const files = fs.readdirSync(entryPath);
                        const resultCount = files.filter(f => f.match(/^\d+\.json\.gz$/)).length;
                        
                        index[entry] = {
                            id: meta.id || entry,
                            status: meta.status || 'unknown',
                            startTime: meta.startTime || null,
                            symbolCount: resultCount,
                            indicatorId: meta.config?.indicatorId || null,
                            symbols: meta.config?.symbols || [],
                            isArchived: false,
                            isIncremental: true,
                            updatedAt: Date.now()
                        };
                    } catch (e) {
                        console.error(`Error reading job ${entry} metadata:`, e.message);
                    }
                }
            }
        }
        
        // Save index to user directory
        const indexPath = path.join(userDir, 'index.json');
        fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
        
        return Object.keys(index).length;
    } catch (e) {
        console.error(`Error rebuilding index for ${sessionHash}:`, e);
        return 0;
    }
}

// Rebuild all user indexes (run on startup)
function rebuildAllIndexes() {
    console.log('🔄 Rebuilding user indexes...');
    let totalEntries = 0;
    
    try {
        const entries = fs.readdirSync(RESULTS_DIR);
        
        for (const entry of entries) {
            const entryPath = path.join(RESULTS_DIR, entry);
            const stat = fs.statSync(entryPath);
            
            if (stat.isDirectory()) {
                const count = rebuildUserIndex(entryPath, entry);
                if (count > 0) {
                    console.log(`   📁 ${entry}: ${count} job(s)`);
                    totalEntries += count;
                }
            }
        }
        
        console.log(`✅ Rebuilt indexes for ${totalEntries} total jobs`);
    } catch (e) {
        console.error('Error rebuilding indexes:', e);
    }
}
rebuildAllIndexes();

// Helper: Compress old job directories (incremental format)
function compressOldResults() {
    const retentionDays = parseInt(process.env.RETENTION_DAYS || '15');
    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;

    // Process each user directory
    fs.readdir(RESULTS_DIR, (err, entries) => {
        if (err) return console.error('Error reading results dir for cleanup:', err);

        entries.forEach(entry => {
            const entryPath = path.join(RESULTS_DIR, entry);
            
            fs.stat(entryPath, (err, stats) => {
                if (err || !stats.isDirectory()) return;
                
                // Process job directories in user directory
                fs.readdir(entryPath, (err, jobDirs) => {
                    if (err) return;
                    
                    jobDirs.forEach(jobDir => {
                        if (jobDir === 'index.json') return;
                        
                        const jobPath = path.join(entryPath, jobDir);
                        fs.stat(jobPath, (err, jobStats) => {
                            if (err || !jobStats.isDirectory()) return;
                            
                            // Check meta.json.gz for age
                            const metaPath = path.join(jobPath, 'meta.json.gz');
                            if (!fs.existsSync(metaPath)) return;
                            
                            fs.stat(metaPath, (err, metaStats) => {
                                if (err) return;
                                
                                const ageDays = (now - metaStats.mtimeMs) / msPerDay;
                                if (ageDays > retentionDays) {
                                    console.log(`🗑️ Cleaning up old job: ${entry}/${jobDir} (${ageDays.toFixed(1)} days old)`);
                                    // For now, just log - could implement archiving to single .tar.gz
                                }
                            });
                        });
                    });
                });
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

                // Send current state if job exists in memory (running job)
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
                    
                    // Send current progress (results are saved to disk, not kept in memory)
                    if (job.resultCount > 0) {
                        ws.send(JSON.stringify({
                            type: 'progress',
                            current: job.resultCount,
                            total: job.tasks ? job.tasks.length : job.resultCount,
                            percent: job.tasks ? Math.round((job.resultCount / job.tasks.length) * 100) : 100
                        }));
                        // Tell client to load results from streaming endpoint
                        ws.send(JSON.stringify({ 
                            type: 'load_from_disk', 
                            resultCount: job.resultCount 
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

// Async Backtest Runner with Parallel Execution (Incremental Save)
async function runBacktestJob(jobId, { indicatorId, combinations, symbols, timeframes, dateFrom, dateTo, session, signature, accountType, maxParallelConnections }) {
    const job = jobs.get(jobId);
    
    // Wait a bit for WebSocket client to connect before starting
    // This ensures the frontend receives all pending/running status updates
    await delay(500);
    
    job.status = 'running';
    job.resultCount = 0; // Track saved results count instead of array
    saveJobMeta(jobId);
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
        let savedResults = 0; // Counter for saved results
        let criticalError = false; // Only for session/auth errors
        let errorCount = 0;
        let successCount = 0;

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

                    // Save result incrementally to disk
                    const resultIndex = savedResults++;
                    job.resultCount = savedResults;
                    
                    // Append result to disk asynchronously
                    appendResult(session, jobId, resultIndex, result)
                        .then(() => {
                            broadcast(jobId, { type: 'saved', index: resultIndex + 1, total: totalTests });
                        })
                        .catch(err => {
                            console.error(`Failed to save result ${resultIndex}:`, err);
                        });
                    
                    broadcast(jobId, { type: 'result', data: result });
                    successCount++;

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
                        saveJobMeta(jobId);
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
                    
                    // Save error result incrementally to disk
                    const resultIndex = savedResults++;
                    job.resultCount = savedResults;
                    
                    appendResult(session, jobId, resultIndex, errorResult)
                        .then(() => {
                            broadcast(jobId, { type: 'saved', index: resultIndex + 1, total: totalTests });
                        })
                        .catch(err => {
                            console.error(`Failed to save error result ${resultIndex}:`, err);
                        });
                    
                    broadcast(jobId, { type: 'result', data: errorResult });
                    errorCount++;

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
            saveJobMeta(jobId);
            return;
        }

        if (!criticalError) {
            job.status = errorCount > 0 ? 'completed_with_errors' : 'completed';
            saveJobMeta(jobId);
            // Don't send full results array anymore, just completion status
            broadcast(jobId, { type: 'complete', resultCount: job.resultCount });
            console.log(`Job ${jobId}: Completed (${successCount} success, ${errorCount} errors, ${job.resultCount} saved)`);
        }

    } catch (error) {
        console.error(`Job ${jobId} failed:`, error);
        job.status = 'failed';
        job.error = error.message;
        saveJobMeta(jobId); // Save failure state
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
            resultCount: 0, // Track count instead of array
            startTime: Date.now(),
            session: session, // Save session to filter history later
            accountType: validAccountType,
            maxParallelConnections: maxParallelConnections
        });

        // Start job in background
        saveJobMeta(jobId); // Save pending state
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
    saveJobMeta(jobId); // Save cancelled state

    // Broadcast cancellation
    broadcast(jobId, {
        type: 'error',
        message: 'Backtest cancelled by user'
    });

    res.json({ success: true, message: 'Job cancelled' });
});

// API: List Jobs (optimized - uses user-specific index)
app.get('/api/jobs', (req, res) => {
    try {
        const currentSession = req.headers['x-session-id'];
        console.log(`🔍 /api/jobs: Requesting history. Session: ${currentSession ? currentSession.substring(0, 10) + '...' : 'NONE'}`);

        // Load from user-specific index (instant, no file reading)
        const index = loadJobIndex(currentSession);
        
        const jobSummaries = Object.values(index)
            .map(job => ({
                id: job.id,
                date: job.startTime ? new Date(job.startTime) : new Date(job.updatedAt),
                status: job.status,
                symbolCount: job.symbolCount || 0,
                indicatorId: job.indicatorId,
                symbols: job.symbols,
                isArchived: job.isArchived || false
            }))
            .sort((a, b) => b.date - a.date); // Newest first

        res.json(jobSummaries);
    } catch (error) {
        console.error('Error listing jobs:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Get Job Details (supports new incremental format)
app.get('/api/jobs/:id', async (req, res) => {
    const { id } = req.params;
    // Support both header and query param
    const currentSession = req.headers['x-session-id'] || req.query.session;

    // Check memory first (running jobs)
    if (jobs.has(id)) {
        const job = jobs.get(id);
        // For running jobs, return metadata only (results are streamed)
        return res.json({
            id: job.id,
            status: job.status,
            config: job.config,
            startTime: job.startTime,
            session: job.session,
            resultCount: job.resultCount || 0
        });
    }

    // Check for new incremental format first
    if (isIncrementalJob(currentSession, id)) {
        try {
            const meta = await loadJobMeta(currentSession, id);
            // Return metadata with resultCount
            return res.json(meta);
        } catch (e) {
            return res.status(500).json({ error: 'Failed to read job metadata' });
        }
    }

    // Job not found in new format
    res.status(404).json({ error: 'Job not found' });
});

// API: Stream Job Details (Server-Sent Events for progressive loading)
app.get('/api/jobs/:id/stream', async (req, res) => {
    const { id } = req.params;
    // Support both header and query param (EventSource doesn't support custom headers)
    const currentSession = req.headers['x-session-id'] || req.query.session;
    
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Stream results from incremental format (new)
    const streamIncrementalJob = async (meta) => {
        // Get actual result file indices from disk
        const resultIndices = listJobResultFiles(currentSession, id);
        const totalResults = resultIndices.length;
        
        // Send job metadata first
        sendEvent('metadata', {
            id: meta.id,
            status: meta.status,
            config: meta.config,
            startTime: meta.startTime,
            session: meta.session,
            totalResults: totalResults
        });

        if (totalResults > 0) {
            const BATCH_SIZE = 50;
            for (let i = 0; i < totalResults; i += BATCH_SIZE) {
                const batch = [];
                const end = Math.min(i + BATCH_SIZE, totalResults);
                
                for (let j = i; j < end; j++) {
                    const resultIndex = resultIndices[j];
                    try {
                        const result = await loadResult(currentSession, id, resultIndex);
                        batch.push(result);
                    } catch (e) {
                        console.error(`Failed to load result ${resultIndex} for job ${id}:`, e);
                    }
                }
                
                if (batch.length > 0) {
                    sendEvent('results', { 
                        batch, 
                        progress: end,
                        total: totalResults 
                    });
                }
                
                // Small delay to allow UI to update
                await new Promise(resolve => setImmediate(resolve));
            }
        }

        // Send completion event
        sendEvent('complete', { success: true });
        res.end();
    };

    // Check memory first (running jobs)
    if (jobs.has(id)) {
        const job = jobs.get(id);
        
        // Get actual result file indices from disk
        const resultIndices = listJobResultFiles(currentSession, id);
        const totalResults = resultIndices.length;
        
        // For running jobs, send current state
        sendEvent('metadata', {
            id: job.id,
            status: job.status,
            config: job.config,
            startTime: job.startTime,
            session: job.session,
            totalResults: totalResults
        });
        
        // Stream saved results from disk
        if (totalResults > 0) {
            const BATCH_SIZE = 50;
            for (let i = 0; i < totalResults; i += BATCH_SIZE) {
                const batch = [];
                const end = Math.min(i + BATCH_SIZE, totalResults);
                
                for (let j = i; j < end; j++) {
                    const resultIndex = resultIndices[j];
                    try {
                        const result = await loadResult(currentSession, id, resultIndex);
                        batch.push(result);
                    } catch (e) {
                        console.error(`Failed to load result ${resultIndex}:`, e);
                    }
                }
                
                if (batch.length > 0) {
                    sendEvent('results', { batch, progress: end, total: totalResults });
                }
                
                await new Promise(resolve => setImmediate(resolve));
            }
        }
        
        sendEvent('complete', { success: true });
        res.end();
        return;
    }

    // Check for new incremental format
    if (isIncrementalJob(currentSession, id)) {
        try {
            const meta = await loadJobMeta(currentSession, id);
            await streamIncrementalJob(meta);
        } catch (e) {
            sendEvent('error', { message: 'Failed to read job: ' + e.message });
            res.end();
        }
        return;
    }

    // Job not found
    sendEvent('error', { message: 'Job not found' });
    res.end();
});

// API: Export Job to compressed JSON (streaming, no memory issues)
app.get('/api/jobs/:id/export', async (req, res) => {
    const { id } = req.params;
    const currentSession = req.headers['x-session-id'] || req.query.session;
    
    // Check for incremental format
    if (!isIncrementalJob(currentSession, id)) {
        return res.status(404).json({ error: 'Job not found or not in exportable format' });
    }
    
    try {
        const meta = await loadJobMeta(currentSession, id);
        
        // Get actual result file indices from disk (not from meta.resultCount which may be stale)
        const resultIndices = listJobResultFiles(currentSession, id);
        const totalResults = resultIndices.length;
        
        console.log(`📦 Starting export for job ${id}: ${totalResults} results found on disk (meta says ${meta.resultCount || 0})`);
        
        // Set up response headers for gzip download
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        res.setHeader('Content-Type', 'application/gzip');
        res.setHeader('Content-Disposition', `attachment; filename="backtest-results-${timestamp}.json.gz"`);
        
        // Create gzip stream
        const gzip = zlib.createGzip();
        gzip.pipe(res);
        
        // Write opening of JSON structure
        gzip.write('{\n');
        gzip.write(`  "exportVersion": "2.0",\n`);
        gzip.write(`  "exportDate": "${new Date().toISOString()}",\n`);
        gzip.write(`  "jobId": "${meta.id}",\n`);
        gzip.write(`  "config": ${JSON.stringify(meta.config)},\n`);
        gzip.write(`  "summary": {\n`);
        gzip.write(`    "totalResults": ${totalResults},\n`);
        gzip.write(`    "status": "${meta.status}"\n`);
        gzip.write(`  },\n`);
        gzip.write(`  "results": [\n`);
        
        // Stream results one by one using actual file indices
        let exportedCount = 0;
        for (let i = 0; i < totalResults; i++) {
            const resultIndex = resultIndices[i];
            try {
                const result = await loadResult(currentSession, id, resultIndex);
                const prefix = exportedCount === 0 ? '    ' : ',\n    ';
                gzip.write(prefix + JSON.stringify(result));
                exportedCount++;
            } catch (e) {
                console.error(`Failed to export result ${resultIndex}:`, e);
            }
            
            // Yield to event loop periodically
            if (i % 100 === 0) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }
        
        // Close JSON structure
        gzip.write('\n  ]\n');
        gzip.write('}\n');
        gzip.end();
        
        console.log(`📦 Exported job ${id} with ${exportedCount} results`);
        
    } catch (error) {
        console.error('Export error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// API: Get job file size estimate for export
app.get('/api/jobs/:id/size', async (req, res) => {
    const { id } = req.params;
    const currentSession = req.headers['x-session-id'] || req.query.session;
    
    if (!isIncrementalJob(currentSession, id)) {
        return res.status(404).json({ error: 'Job not found' });
    }
    
    try {
        const userDir = getUserDir(currentSession);
        const jobDir = path.join(userDir, id);
        const files = fs.readdirSync(jobDir);
        
        let totalSize = 0;
        for (const file of files) {
            const filePath = path.join(jobDir, file);
            const stat = fs.statSync(filePath);
            totalSize += stat.size;
        }
        
        // Estimate uncompressed size (gzip typically compresses to ~30% of original)
        const estimatedUncompressed = Math.round(totalSize * 3.3);
        
        res.json({
            compressedSize: totalSize,
            estimatedUncompressedSize: estimatedUncompressed,
            resultCount: files.filter(f => f.match(/^\d+\.json\.gz$/)).length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Stream export job to Excel (for large datasets)
app.get('/api/jobs/:id/export-excel', async (req, res) => {
    const { id } = req.params;
    const currentSession = req.headers['x-session-id'] || req.query.session;
    
    if (!isIncrementalJob(currentSession, id)) {
        return res.status(404).json({ error: 'Job not found or not in exportable format' });
    }
    
    try {
        const meta = await loadJobMeta(currentSession, id);
        
        // Get actual result file indices from disk
        const resultIndices = listJobResultFiles(currentSession, id);
        const totalResults = resultIndices.length;
        
        console.log(`📊 Starting Excel export for job ${id} with ${totalResults} results (meta says ${meta.resultCount || 0})`);
        
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
            { header: 'Sharpe Ratio', key: 'sharpeRatio', width: 15 },
            { header: 'Sortino Ratio', key: 'sortinoRatio', width: 15 },
            { header: 'Avg Bars in Trade', key: 'avgBarsInTrade', width: 15 }
        ];
        
        // Style header
        sheet.getRow(1).font = { bold: true };
        
        // Load and add results using actual file indices
        for (let i = 0; i < totalResults; i++) {
            const resultIndex = resultIndices[i];
            try {
                const result = await loadResult(currentSession, id, resultIndex);
                const row = {
                    symbol: result.symbol,
                    timeframe: result.timeframe,
                    options: result.optionsStr || JSON.stringify(result.options || {}),
                    netProfit: result.results?.netProfit,
                    totalClosedTrades: result.results?.totalClosedTrades,
                    percentProfitable: result.results?.percentProfitable,
                    profitFactor: result.results?.profitFactor,
                    maxDrawdown: result.results?.maxDrawdown,
                    avgTrade: result.results?.avgTrade,
                    sharpeRatio: result.results?.sharpeRatio,
                    sortinoRatio: result.results?.sortinoRatio,
                    avgBarsInTrade: result.results?.avgBarsInTrade
                };
                sheet.addRow(row);
            } catch (e) {
                console.error(`Failed to add result ${resultIndex} to Excel:`, e);
            }
            
            // Log progress every 500 results
            if (i > 0 && i % 500 === 0) {
                console.log(`📊 Excel export progress: ${i}/${totalResults}`);
                // Yield to event loop
                await new Promise(resolve => setImmediate(resolve));
            }
        }
        
        const timestamp = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="backtest-results-${timestamp}.xlsx"`);
        
        await workbook.xlsx.write(res);
        console.log(`📊 Excel export completed for job ${id}`);
        
    } catch (error) {
        console.error('Excel export error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
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
