// Sync bridge script - loads data from chrome.storage.local to page localStorage
(function () {

    // Listen for messages from content script
    window.addEventListener('message', function (event) {
        // Only accept messages from same origin
        if (event.source !== window) return;

        if (event.data.type === 'TV_BACKTEST_SYNC_DATA') {
            try {
                const syncData = event.data.data;
                localStorage.setItem('tvBacktestSyncData', JSON.stringify(syncData));

                // Trigger custom event for app.js
                window.dispatchEvent(new CustomEvent('tvBacktestSyncLoaded', {
                    detail: syncData
                }));
            } catch (e) {
                console.error('❌ Failed to save sync data:', e);
            }
        }
    });

    // Check if chrome extension API is available (fallback, shouldn't happen with content script)
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['tvBacktestSync'], function (result) {
            if (result.tvBacktestSync) {
                try {
                    localStorage.setItem('tvBacktestSyncData', JSON.stringify(result.tvBacktestSync));
                    window.dispatchEvent(new CustomEvent('tvBacktestSyncLoaded', {
                        detail: result.tvBacktestSync
                    }));
                } catch (e) {
                    console.error('❌ Failed to transfer sync data:', e);
                }
            }
        });
    } else {
        // Check localStorage for existing data
        let syncDataStr = localStorage.getItem('tvBacktestSyncData');

        if (!syncDataStr) {
            // Try legacy key
            const legacyData = localStorage.getItem('tvBacktestSync');
            if (legacyData) {
                localStorage.setItem('tvBacktestSyncData', legacyData);
                syncDataStr = legacyData;
            }
        }

        if (syncDataStr) {
            try {
                const data = JSON.parse(syncDataStr);
                window.dispatchEvent(new CustomEvent('tvBacktestSyncLoaded', {
                    detail: data
                }));
            } catch (e) {
                console.error('❌ Failed to parse sync data:', e);
            }
        }
    }
})();
