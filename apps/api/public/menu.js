function getSlug() {
    const params = new URLSearchParams(window.location.search);
    return params.get('h');
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function handleImageLoad(img) {
    img.style.opacity = '1';
}

function handleImageError(img) {
    img.style.display = 'none';
    const placeholder = document.createElement('div');
    placeholder.className = 'item-img-placeholder';
    placeholder.textContent = '🍽️';
    img.parentNode.insertBefore(placeholder, img);
}

function openImageModal(src) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImage');
    modalImg.src = src;
    modal.classList.add('active');
}

function closeImageModal() {
    const modal = document.getElementById('imageModal');
    modal.classList.remove('active');
    document.getElementById('modalImage').src = '';
}

async function loadMenu() {
    const slug = getSlug();
    const container = document.getElementById('menuContainer');

    if (!slug) {
        container.innerHTML = '<div class="error"><h2>No menu specified</h2><p>Please use a valid menu link.</p></div>';
        return;
    }

    try {
        const res = await fetch(`/api/menu/${encodeURIComponent(slug)}`);
        if (!res.ok) throw new Error('Menu not found');

        const data = await res.json();
        document.title = `${escapeHtml(data.name)} - Menu`;

        const theme = data.theme || 'classic';
        document.body.className = `theme-${theme}`;

        let html = '';

        // Header
        html += `<div class="header fade-in">`;
        html += `<h1>${escapeHtml(data.name)}</h1>`;
        html += `<p>📍 ${escapeHtml(data.city)}</p>`;
        html += `</div>`;

        // Categories
        if (!data.categories || data.categories.length === 0) {
            html += `<div class="error"><h2>Menu is being prepared</h2><p>Check back soon!</p></div>`;
        } else {
            data.categories.forEach((cat, catIdx) => {
                if (!cat.items || cat.items.length === 0) return;

                html += `<div class="category-title fade-in">${escapeHtml(cat.name)}</div>`;

                cat.items.forEach((item, itemIdx) => {
                    const delay = (catIdx * 0.05 + itemIdx * 0.03).toFixed(2);
                    html += `<div class="item fade-in" style="animation-delay: ${delay}s">`;

                    if (item.imageUrl) {
                        html += `<div class="item-img-wrapper" data-img-src="${escapeHtml(item.imageUrl)}"></div>`;
                    } else {
                        html += `<div class="item-img-placeholder">🍽️</div>`;
                    }

                    html += `<div class="item-details">`;
                    html += `<div class="item-name">`;
                    html += `<span class="${item.isVeg ? 'badge-veg' : 'badge-nonveg'}"></span> `;
                    html += escapeHtml(item.name);
                    if (item.isPopular) html += ` <span class="badge-popular">⭐ Popular</span>`;
                    html += `</div>`;
                    if (item.description) html += `<div class="item-desc">${escapeHtml(item.description)}</div>`;
                    html += `</div>`;

                    html += `<div class="price">₹${item.price}</div>`;
                    html += `</div>`;
                });
            });
        }

        html += `<div class="powered-by">Powered by MenuSaaS</div>`;
        container.innerHTML = html;

        // Create actual <img> elements with addEventListener (CSP-compliant)
        document.querySelectorAll('.item-img-wrapper').forEach(wrapper => {
            const src = wrapper.getAttribute('data-img-src');
            const img = document.createElement('img');
            img.className = 'item-img';
            img.alt = 'Item image';
            img.loading = 'lazy';
            img.style.opacity = '0';
            img.style.transition = 'opacity 0.3s';
            img.src = src;
            img.addEventListener('load', function() { handleImageLoad(this); });
            img.addEventListener('error', function() { handleImageError(this); });
            img.addEventListener('click', function() { openImageModal(this.src); });
            wrapper.replaceWith(img);
        });

    } catch (e) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error';

        const heading = document.createElement('h2');
        heading.textContent = 'Menu not found';
        errorDiv.appendChild(heading);

        const para = document.createElement('p');
        para.textContent = 'This menu may not exist or is temporarily unavailable.';
        errorDiv.appendChild(para);

        const retryBtn = document.createElement('button');
        retryBtn.textContent = '🔄 Try Again';
        retryBtn.addEventListener('click', function() { location.reload(); });
        errorDiv.appendChild(retryBtn);

        container.innerHTML = '';
        container.appendChild(errorDiv);
    }
}

// Event listeners (CSP-compliant — no inline handlers)
document.getElementById('imageModal').addEventListener('click', function(e) {
    if (e.target === this) closeImageModal();
});
document.getElementById('closeModalBtn').addEventListener('click', closeImageModal);
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeImageModal();
});

// Load on page load and auto-refresh every 5 minutes
loadMenu();
setInterval(loadMenu, 5 * 60 * 1000);
