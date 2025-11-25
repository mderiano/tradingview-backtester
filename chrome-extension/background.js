// Background service worker for handling fetch requests
console.log('Background service worker loaded');

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'syncToServer') {
        console.log('📤 Background: Received sync request', request.payload);
        
        const serverUrl = request.serverUrl || 'http://freebox.deriano.fr:3000';
        const apiUrl = `${serverUrl}/api/sync`;
        
        console.log('📤 Background: Sending to', apiUrl);
        
        // Perform the fetch in the background worker (not subject to page CSP)
        fetch(apiUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(request.payload)
        })
        .then(response => {
            console.log('📥 Background: Got response', response.status);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('📥 Background: Response data', data);
            sendResponse({ success: true, data });
        })
        .catch(error => {
            console.error('❌ Background: Error', error);
            sendResponse({ success: false, error: error.message });
        });
        
        // Return true to indicate async response
        return true;
    }
});
