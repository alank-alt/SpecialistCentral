// ==UserScript==
// @name         Altegio Employee Scanner (Art Deco) - V3
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Continuously scrapes employee names, IDs, and positions to beat virtual scrolling
// @author       Johnny
// @match        https://app.alteg.io/*
// @grant        GM_setClipboard
// ==/UserScript==

(function() {
    'use strict';

    // 1. Build the Art Deco UI Container
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '20px';
    container.style.right = '20px';
    container.style.zIndex = '2147483647';
    container.style.backgroundColor = '#0a0a0a';
    container.style.border = '2px solid #D4AF37';
    container.style.padding = '12px 18px';
    container.style.fontFamily = '"Trebuchet MS", "Lucida Sans Unicode", sans-serif';
    container.style.color = '#D4AF37';
    container.style.boxShadow = '0px 5px 15px rgba(0, 0, 0, 0.5)';
    container.style.outline = '1px solid #D4AF37';
    container.style.outlineOffset = '-6px';
    container.style.textAlign = 'center';
    container.style.minWidth = '160px';

    const title = document.createElement('div');
    title.innerText = 'EMPLOYEE SCANNER';
    title.style.fontWeight = 'bold';
    title.style.letterSpacing = '2px';
    title.style.marginBottom = '8px';
    title.style.fontSize = '12px';
    title.style.textTransform = 'uppercase';

    // Live counter display
    const counterDisplay = document.createElement('div');
    counterDisplay.innerHTML = 'SCANNED: <span id="scan-count" style="color: white; font-size: 16px;">0</span>';
    counterDisplay.style.marginBottom = '12px';
    counterDisplay.style.fontSize = '11px';
    counterDisplay.style.letterSpacing = '1px';

    const btn = document.createElement('button');
    btn.innerText = 'EXTRACT TO EXCEL';
    btn.style.backgroundColor = '#D4AF37';
    btn.style.color = '#0a0a0a';
    btn.style.border = '1px solid #D4AF37';
    btn.style.padding = '8px 12px';
    btn.style.cursor = 'pointer';
    btn.style.fontWeight = 'bold';
    btn.style.fontFamily = 'inherit';
    btn.style.letterSpacing = '1px';
    btn.style.textTransform = 'uppercase';
    btn.style.transition = 'all 0.2s ease';
    btn.style.width = '100%';

    // Button hover effects
    btn.addEventListener('mouseenter', () => {
        btn.style.backgroundColor = '#0a0a0a';
        btn.style.color = '#D4AF37';
    });
    btn.addEventListener('mouseleave', () => {
        btn.style.backgroundColor = '#D4AF37';
        btn.style.color = '#0a0a0a';
    });

    container.appendChild(title);
    container.appendChild(counterDisplay);
    container.appendChild(btn);
    document.body.appendChild(container);

    // 2. Continuous Background Scanner
    const scannedData = new Map(); // Stores unique employees by ID

    setInterval(() => {
        const employeeLinks = document.querySelectorAll('a[href*="/employee/"]');

        employeeLinks.forEach(link => {
            const url = link.getAttribute('href');
            const match = url.match(/\/employee\/(\d+)/);

            if (match) {
                const id = match[1];

                // If we haven't logged this ID yet, grab the details
                if (!scannedData.has(id)) {
                    const name = link.innerText.trim();
                    let position = "N/A";

                    // Smart hunt for the position
                    const row = link.closest('tr');
                    if (row) {
                        const cells = Array.from(row.querySelectorAll('td'));
                        const linkCell = link.closest('td');
                        const linkIndex = cells.indexOf(linkCell);
                        if (linkIndex !== -1 && linkIndex + 1 < cells.length) {
                            position = cells[linkIndex + 1].innerText.trim();
                        }
                    } else {
                        const parent = link.parentElement;
                        if (parent && parent.nextElementSibling) {
                            position = parent.nextElementSibling.innerText.trim();
                        }
                    }

                    // Save to our master map if a name exists
                    if (name) {
                        scannedData.set(id, { name: name, position: position });
                        document.getElementById('scan-count').innerText = scannedData.size;
                    }
                }
            }
        });
    }, 500); // Scans the DOM twice a second

    // 3. Format and Copy
    btn.addEventListener('click', () => {
        if (scannedData.size > 0) {
            let results = [];
            // Convert Map to array of TSV strings
            scannedData.forEach((data, id) => {
                results.push(`${data.name}\t${id}\t${data.position}`);
            });

            const tsvData = "Employee Name\tEmployee ID\tPosition\n" + results.join('\n');

            navigator.clipboard.writeText(tsvData).then(() => {
                const originalText = btn.innerText;
                btn.innerText = 'COPIED!';
                setTimeout(() => { btn.innerText = originalText; }, 2000);
            }).catch(err => {
                alert('Clipboard write failed. Check your console.');
                console.error(err);
            });
        } else {
            alert('No employees found yet! Try scrolling down the list first.');
        }
    });
})();