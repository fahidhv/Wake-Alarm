// This file controls the app's offline functionality and background notifications.
const CACHE_NAME = 'smart-alarm-v4'; // Incremented version to force update
const FILES_TO_CACHE = [
    './', // Caches the index.html
    './index.html',
    './manifest.json',
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.min.js'
];

let alarmState = [];

// --- INSTALL: Save files to cache ---
self.addEventListener('install', event => {
    console.log('Service Worker installing.');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Caching app shell');
                return cache.addAll(FILES_TO_CACHE);
            })
            .then(() => {
                // Force the new service worker to become active immediately
                return self.skipWaiting();
            })
    );
});

// --- ACTIVATE: Clean up old caches ---
self.addEventListener('activate', event => {
    console.log('Service Worker activating.');
    event.waitUntil(
        caches.keys().then(keyList => {
            return Promise.all(keyList.map(key => {
                if (key !== CACHE_NAME) {
                    console.log('Removing old cache:', key);
                    return caches.delete(key);
                }
            }));
        })
        .then(() => {
            // Take control of all open clients (tabs) immediately
            return clients.claim();
        })
    );
});

// --- FETCH: Network-first strategy ---
// This strategy ensures users get updates *immediately* if they are online.
// It falls back to the cache if they are offline.
self.addEventListener('fetch', event => {
    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                // If fetch is successful, cache it and return it
                return caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                });
            })
            .catch(() => {
                // If network fails (offline), get from cache
                return caches.match(event.request);
            })
    );
});

// --- MESSAGE: Receive alarm data from the app ---
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'UPDATE_ALARMS') {
        console.log('SW received alarm data:', event.data.alarms);
        alarmState = event.data.alarms;
        // Start checking alarms
        startAlarmCheck();
    }
});

let alarmInterval = null;
const DAYS_OF_WEEK_SW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startAlarmCheck() {
    if (alarmInterval) clearInterval(alarmInterval);
    // Check every 10 seconds. This is not guaranteed,
    // browsers will throttle this heavily.
    alarmInterval = setInterval(checkForAlarms, 10000);
}

function checkForAlarms() {
    if (!alarmState || alarmState.length === 0) return;

    const now = new Date();
    const currentDay = DAYS_OF_WEEK_SW[now.getDay()];
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    for (const group of alarmState) {
        if (!group.isEnabled || !group.alarms) continue;
        for (const alarm of group.alarms) {
            if (!alarm.isEnabled || alarm.time !== currentTime) continue;
            
            const isToday = (alarm.days && alarm.days.length === 0) || (alarm.days && alarm.days.includes(currentDay));
            if (isToday) {
                // Check if this alarm was already shown in the last 50 seconds
                // This is a non-persistent in-memory check
                if (!self.lastShownTimes) self.lastShownTimes = {};
                const lastShownKey = `lastShown_${alarm.id}`;
                const lastShownTime = self.lastShownTimes[lastShownKey] || 0;

                if (now.getTime() - lastShownTime > 50000) {
                    console.log('SW: Ringing alarm!', alarm);
                    showNotification(alarm, group);
                    
                    self.lastShownTimes[lastShownKey] = now.getTime();

                    // If it's a one-time alarm, we can't disable it here,
                    // the main app will do that when it loads.
                    return; // Only show one notification
                }
            }
        }
    }
}

function showNotification(alarm, group) {
    const title = alarm.label || 'Alarm!';
    const options = {
        body: `${alarm.time} - From group: ${group.name}`,
        // Use the placeholder icons from your manifest
        icon: 'https://placehold.co/192x192/2563eb/FFFFFF?text=A&font=inter',
        badge: 'https://placehold.co/72x72/2563eb/FFFFFF?text=A&font=inter',
        vibrate: [200, 100, 200, 100, 200], // Vibrate pattern
        tag: alarm.id, // Use alarm ID as tag to prevent multiple notifications
        renotify: true, // Allow re-notifying if tag is the same
    };

    self.registration.showNotification(title, options);
}

