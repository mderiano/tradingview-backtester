// Sync bridge script - loads data from chrome.storage.local to page localStorage
(function() {
    console.log('🔄 Sync bridge: Checking for stored TradingView data...');
    
    // Check if chrome extension API is available
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['tvBacktestSync'], function(result) {
            if (result.tvBacktestSync) {
                console.log('📥 Found sync data in chrome.storage:', result.tvBacktestSync);
                
                // Store in localStorage for the web page to access
                try {
                    localStorage.setItem('tvBacktestSync', JSON.stringify(result.tvBacktestSync));
                    console.log('✅ Sync data transferred to localStorage');
                    
                    // Trigger a custom event to notify the app
                    window.dispatchEvent(new CustomEvent('tvBacktestSyncLoaded', {
                        detail: result.tvBacktestSync
                    }));
                } catch (e) {
                    console.error('❌ Failed to transfer sync data:', e);
                }
            } else {
                console.log('ℹ️ No sync data found in chrome.storage');
            }
        });
    } else {
        // Not running in extension context, check localStorage directly
        const syncData = localStorage.getItem('tvBacktestSync');
        if (syncData) {
            console.log('📥 Found sync data in localStorage');
            try {
                const data = JSON.parse(syncData);
                window.dispatchEvent(new CustomEvent('tvBacktestSyncLoaded', {
                    detail: data
                }));
            } catch (e) {
                console.error('❌ Failed to parse sync data:', e);
            }
        } else {
            console.log('ℹ️ No sync data found in localStorage');
        }
    }
})();
