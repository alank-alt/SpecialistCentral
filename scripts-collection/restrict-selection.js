(function() {
    const style = document.createElement('style');
    style.id = 'altegio-custom-restrict-selection';
    style.textContent = `
        app-service-card.service-disabled {
            pointer-events: none !important;
        }
        app-service-card.service-disabled ui-kit-service-card,
        app-service-card.service-disabled .service-card,
        app-service-card.service-disabled .card-content-container {
            opacity: 0.45 !important;
            filter: grayscale(80%) !important;
            pointer-events: none !important;
            transition: opacity 0.3s ease, filter 0.3s ease !important;
        }
        app-service-card.service-disabled .checkbox__label {
            cursor: not-allowed !important;
        }
    `;
    document.head.appendChild(style);

    function update() {
        const checked = document.querySelector('app-service-card input.checkbox__input:checked, app-service-card .checkbox__label.checked');
        const active = checked ? checked.closest('app-service-card') : null;
        document.querySelectorAll('app-service-card').forEach(card => {
            card.classList.toggle('service-disabled', !!active && card !== active);
        });
    }

    setInterval(update, 200);
})();
