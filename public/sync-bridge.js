// Sync bridge script - receives data from content script and saves to localStorage
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

    // Check localStorage for existing data on page load
    let syncDataStr = localStorage.getItem('tvBacktestSyncData');

    if (!syncDataStr) {
        // Try legacy key for backwards compatibility
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
})();
