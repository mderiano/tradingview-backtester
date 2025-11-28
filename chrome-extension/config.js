// Configuration for the Chrome Extension
const CONFIG = {
    // Server URL - can be overridden by setting SERVER_URL in .env or modifying this file
    SERVER_URL: 'http://srv1159534.hstgr.cloud:3000'
};

// Make config available globally
if (typeof window !== 'undefined') {
    window.BACKTEST_CONFIG = CONFIG;
}
