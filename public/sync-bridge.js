// Sync bridge script - receives data from content script and saves to localStorage
(function () {
    console.log('🌉 Sync bridge loaded');

    // Listen for messages from content script
    window.addEventListener('message', function (event) {
        // Only accept messages from same origin
        if (event.source !== window) return;

        if (event.data.type === 'TV_BACKTEST_SYNC_DATA') {
            console.log('🌉 Received TV_BACKTEST_SYNC_DATA:', event.data.data);
            try {
                const syncData = event.data.data;
                console.log('🌉 accountType in received data:', syncData.accountType);
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
    console.log('🌉 Existing localStorage data:', syncDataStr ? 'found' : 'not found');

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
            console.log('🌉 Loaded from localStorage, accountType:', data.accountType);
            window.dispatchEvent(new CustomEvent('tvBacktestSyncLoaded', {
                detail: data
            }));
        } catch (e) {
            console.error('❌ Failed to parse sync data:', e);
        }
    }
})();
