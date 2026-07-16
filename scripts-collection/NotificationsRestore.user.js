// ==UserScript==
// @name         Notifications Snapshot & Restore
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Save and restore notifications toggle state
// @author       You
// @match        https://app.alteg.io/notifications/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function getLocationId() {
        const match = window.location.href.match(/notifications\/(\d+)/);
        return match ? match[1] : 'unknown';
    }

    function saveState() {
        const items = document.querySelectorAll('.notifications-overview-types-expand-section__item');
        const state = Array.from(items).map(item => {
            const textEl = item.querySelector('.notifications-overview-types-expand-section-item__text');
            const toggleEl = item.querySelector('.q-toggle');
            return {
                text: textEl ? textEl.textContent.trim() : '',
                checked: toggleEl ? toggleEl.getAttribute('aria-checked') === 'true' : false
            };
        });

        const locationId = getLocationId();
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');

        a.href = url;
        a.download = `notifications_${locationId}.json`;
        a.click();

        URL.revokeObjectURL(url);
    }

    function restoreState() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';

        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async ev => {
                try {
                    const savedState = JSON.parse(ev.target.result);
                    const currentItems = document.querySelectorAll('.notifications-overview-types-expand-section__item');

                    for (let index = 0; index < savedState.length; index++) {
                        const savedItem = savedState[index];
                        if (index < currentItems.length) {
                            const item = currentItems[index];
                            const textEl = item.querySelector('.notifications-overview-types-expand-section-item__text');
                            const currentText = textEl ? textEl.textContent.trim() : '';

                            // To be absolutely certain we are clicking the correct element, we verify its title
                            if (currentText === savedItem.text) {
                                const toggleEl = item.querySelector('.q-toggle');
                                if (toggleEl) {
                                    const isChecked = toggleEl.getAttribute('aria-checked') === 'true';

                                    // If current state does not match saved state, click the toggle
                                    if (isChecked !== savedItem.checked) {
                                        toggleEl.click();
                                        // Wait slightly to let the Vue app and backend API register the change safely
                                        await new Promise(r => setTimeout(r, 250));
                                    }
                                }
                            } else {
                                console.warn(`Mismatch at index ${index}: expected "${savedItem.text}", found "${currentText}"`);
                            }
                        }
                    }
                    alert('Restore completed successfully!');
                } catch (err) {
                    alert('Error reading or processing the JSON file');
                    console.error(err);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    function createUI() {
        // Prevent duplicate creation if the script runs twice
        if (document.getElementById('tm-snapshot-ui-container')) return;

        const container = document.createElement('div');
        container.id = 'tm-snapshot-ui-container';
        container.style.position = 'fixed';
        container.style.bottom = '20px';
        container.style.right = '20px';
        container.style.zIndex = '999999';
        container.style.display = 'flex';
        container.style.gap = '10px';

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save Snapshot';
        saveBtn.style.padding = '10px 15px';
        saveBtn.style.background = '#0288D1';
        saveBtn.style.color = '#fff';
        saveBtn.style.border = 'none';
        saveBtn.style.borderRadius = '5px';
        saveBtn.style.cursor = 'pointer';
        saveBtn.style.fontWeight = 'bold';
        saveBtn.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
        saveBtn.onclick = saveState;

        const restoreBtn = document.createElement('button');
        restoreBtn.textContent = 'Restore Snapshot';
        restoreBtn.style.padding = '10px 15px';
        restoreBtn.style.background = '#4CAF50';
        restoreBtn.style.color = '#fff';
        restoreBtn.style.border = 'none';
        restoreBtn.style.borderRadius = '5px';
        restoreBtn.style.cursor = 'pointer';
        restoreBtn.style.fontWeight = 'bold';
        restoreBtn.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
        restoreBtn.onclick = restoreState;

        container.appendChild(saveBtn);
        container.appendChild(restoreBtn);
        document.body.appendChild(container);
    }

    // Attach to the page when fully loaded
    window.addEventListener('load', createUI);
    // Fallback for SPA routing if document is already complete
    if (document.readyState === 'complete') {
        createUI();
    }
})();