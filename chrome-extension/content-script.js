// Content script that runs on the backtester page
// This bridges chrome.storage.local to localStorage

// Function to send sync data to page
function sendSyncDataToPage(syncData) {
    console.log('📤 Sending sync data to page:', syncData);
    
    // Send data to page via postMessage (bypasses CSP)
    window.postMessage({
        type: 'TV_BACKTEST_SYNC_DATA',
        data: syncData
    }, '*');
}

// Read from chrome.storage.local (accessible in content scripts)
chrome.storage.local.get(['tvBacktestSync'], function (result) {
    console.log('📦 Initial chrome.storage.local read:', result);

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

// Listen for changes to chrome.storage.local (for re-sync while page is open)
chrome.storage.onChanged.addListener(function(changes, namespace) {
    if (namespace === 'local' && changes.tvBacktestSync) {
        console.log('🔄 chrome.storage.local changed, sending new data:', changes.tvBacktestSync.newValue);
        sendSyncDataToPage(changes.tvBacktestSync.newValue);
    }
});
