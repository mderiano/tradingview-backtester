// Content script that runs on the backtester page
// This bridges chrome.storage.local to localStorage

// Function to send sync data to page
function sendSyncDataToPage(syncData) {

    // Send data to page via postMessage (bypasses CSP)
    window.postMessage({
        type: 'TV_BACKTEST_SYNC_DATA',
        data: syncData
    }, '*');
}

// Read from chrome.storage.local (accessible in content scripts)
chrome.storage.local.get(['tvBacktestSync'], function (result) {

    if (result.tvBacktestSync) {

        // Wait for page to be ready before sending message
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                sendSyncDataToPage(result.tvBacktestSync);
            });
        } else {
            sendSyncDataToPage(result.tvBacktestSync);
        }
    }
});
