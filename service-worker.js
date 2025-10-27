// --- SERVICE WORKER (service-worker.js) ---
// This file runs in the background to handle offline access and notifications.

const CACHE_NAME = 'smart-alarm-cache-v3'; // Incremented cache version
const URLS_TO_CACHE = [
    './',
    './index.html',
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.min.js'
    // We can't cache manifest.json or this file itself, but they're loaded by the browser.
];

let alarmCheckInterval = null;
let backgroundAlarmGroups = [];
let lastNotifiedAlarmId = null;
let lastNotificationTime = 0;

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// --- INSTALL & ACTIVATE ---

self.addEventListener('install', event => {
    // Perform install steps
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                // We use addAll for atomic cache operation
                return cache.addAll(URLS_TO_CACHE).catch(err => {
                    // This might fail if one of the external URLs is down
                    // For a robust offline app, we'd handle this better
                    console.error('Failed to cache all resources:', err);
                });
            })
            .then(() => self.skipWaiting()) // Activate new SW immediately
    );
});

self.addEventListener('activate', event => {
    // Clean up old caches
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.filter(cacheName => cacheName !== CACHE_NAME)
                          .map(cacheName => caches.delete(cacheName))
            );
        }).then(() => self.clients.claim()) // Take control of open pages
    );
});

// --- FETCH (Offline) ---

self.addEventListener('fetch', event => {
    // We only care about GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Network-first strategy for dynamic content, cache-first for static assets
    if (event.request.url.includes('cdn.tailwindcss.com') || event.request.url.includes('cdnjs.cloudflare.com')) {
        // Cache-first for static libs
        event.respondWith(
            caches.match(event.request).then(cachedResponse => {
                return cachedResponse || fetch(event.request);
            })
        );
    } else {
        // Network-first for app files (index.html, manifest.json, etc.)
        event.respondWith(
            fetch(event.request)
                .then(networkResponse => {
                    // Check if we received a valid response
                    if (networkResponse && networkResponse.ok) {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME)
                            .then(cache => {
                                // Only cache our app's core files
                                if (event.request.url.includes('index.html') || event.request.url.endsWith('/')) {
                                    cache.put(event.request, responseToCache);
                                }
                            });
                    }
                    return networkResponse;
                })
                .catch(() => {
                    // Network request failed, try to serve from cache (offline)
                    return caches.match(event.request).then(cachedResponse => {
                        return cachedResponse || caches.match('./index.html'); // Fallback to index
                    });
                })
        );
    }
});


// --- ALARM LOGIC (Background) ---

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'UPDATE_ALARMS') {
        console.log('SW received updated alarms:', event.data.alarms);
        backgroundAlarmGroups = event.data.alarms;
        
        // Start or restart the alarm check
        if (alarmCheckInterval) {
            clearInterval(alarmCheckInterval);
        }
        // Check every 30 seconds. More frequent checks waste battery.
        // This means alarms might be up to 30s late.
        alarmCheckInterval = setInterval(checkBackgroundAlarms, 30000); 
    }
});

function checkBackgroundAlarms() {
    if (!backgroundAlarmGroups || backgroundAlarmGroups.length === 0) {
        return;
    }

    const now = new Date();
    const currentDay = DAYS_OF_WEEK[now.getDay()];
    // Check for alarms in the current minute
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    console.log(`SW checking alarms at ${currentTime} on ${currentDay}`);

    for (const group of backgroundAlarmGroups) {
        if (!group.isEnabled) continue;
        for (const alarm of group.alarms) {
            if (!alarm.isEnabled || alarm.time !== currentTime) continue;
            
            const isToday = alarm.days.length === 0 || alarm.days.includes(currentDay);
            
            // Check if this alarm just fired
            const nowTime = now.getTime();
            if (isToday && (alarm.id !== lastNotifiedAlarmId || (nowTime - lastNotificationTime) > 60000)) {
                console.log('SW triggering notification for:', alarm.label);
                
                lastNotifiedAlarmId = alarm.id;
                lastNotificationTime = nowTime;
                
                showNotification(alarm, group);

                // We don't disable one-time alarms here,
                // the main app will do that when it loads.
                return; // Only show one notification
            }
        }
    }
}

function showNotification(alarm, group) {
    const title = alarm.label || 'Alarm!';
    const options = {
        body: `From group: ${group.name}. Time: ${alarm.time}`,
        icon: './icons/icon-192.png', // You MUST create this icon
        badge: './icons/icon-72.png', // You MUST create this icon
        vibrate: [200, 100, 200, 100, 200], // Vibrate pattern
        tag: alarm.id, // Prevents stacking notifications for the same alarm
        renotify: true, // Will re-vibrate/alert if tag matches
        requireInteraction: true, // Keeps notification open on desktop
    };

    // Use self.registration.showNotification to show notification from Service Worker
    self.registration.showNotification(title, options);
}

// Open the app when notification is clicked
self.addEventListener('notificationclick', event => {
    event.notification.close();
    
    // This looks for an already open tab and focuses it, otherwise opens a new one
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(clientList => {
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                // Check for the base URL, not just index.html
                if (client.url.endsWith('/') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('./');
            }
        })
    );
});

