const API = '';
let hotel = null;
let currentTab = 'menu';

function getToken() { return localStorage.getItem('menu_token'); }

if (getToken()) loadDashboard();

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function switchTab(tab, el) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    if (el) el.classList.add('active');
    document.getElementById('tab-menu').classList.toggle('hidden', tab !== 'menu');
    document.getElementById('tab-add').classList.toggle('hidden', tab !== 'add');
    if (tab === 'menu') renderMenu();
}

async function apiFetch(endpoint, options = {}) {
    if (!options.headers) options.headers = {};

    if (options.body && !(options.body instanceof FormData) && !options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
    }

    const token = getToken();
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API}${endpoint}`, options);
    if (res.status === 401) { showToast('Session expired. Please login again.', 'error'); logout(); throw new Error('401'); }
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || 'Request failed'); }
    return res;
}

async function login() {
    const slug = document.getElementById('slug').value.trim();
    const pin = document.getElementById('pin').value;
    if (!slug || !pin) return;
    try {
        const res = await fetch(`${API}/auth/login`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({slug, pin})
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        localStorage.setItem('menu_token', data.token);
        showToast('Login successful!');
        loadDashboard();
    } catch(e) { document.getElementById('error').textContent = e.message; }
}

function logout() { localStorage.removeItem('menu_token'); location.reload(); }

async function loadDashboard() {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    try {
        const res = await apiFetch('/me');
        hotel = await res.json();
        document.getElementById('hotelName').textContent = hotel.name;
        document.getElementById('hotelCity').textContent = hotel.city;
        document.getElementById('hotelPlan').textContent = hotel.plan;
        document.getElementById('hotelStatus').textContent = hotel.status;
        document.getElementById('themeSelect').value = hotel.theme || 'classic';
        renderMenu();
        updateCategorySelect();
    } catch(e) { console.error(e); }
}

async function changeTheme(newTheme) {
    try {
        await apiFetch('/settings/theme', {
            method: 'PATCH',
            body: JSON.stringify({ theme: newTheme })
        });
        showToast('Theme updated! Refresh your public menu to see changes.');
        hotel.theme = newTheme;
    } catch(e) {
        showToast(e.message, 'error');
    }
}

function updateCategorySelect() {
    const select = document.getElementById('catSelect');
    select.innerHTML = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Select Category';
    select.appendChild(defaultOpt);
    if (hotel && hotel.categories) {
        hotel.categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat.id;
            option.textContent = cat.name;
            select.appendChild(option);
        });
    }
}

function renderMenu() {
    const menuDiv = document.getElementById('menuList');
    menuDiv.innerHTML = '';
    if (!hotel || !hotel.categories || hotel.categories.length === 0) {
        menuDiv.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">No categories yet.</p>';
        return;
    }

    hotel.categories.forEach(cat => {
        const catDiv = document.createElement('div');
        const titleDiv = document.createElement('div');
        titleDiv.className = 'category-title';
        titleDiv.textContent = cat.name;
        catDiv.appendChild(titleDiv);

        const items = cat.items || [];
        const visibleItems = items.filter(i => i.isAvailable !== false);
        const hiddenItems = items.filter(i => i.isAvailable === false);

        if (items.length === 0) {
            const p = document.createElement('p');
            p.style.cssText = 'color:#666;padding-left:10px;';
            p.textContent = 'No items in this category';
            catDiv.appendChild(p);
        } else {
            visibleItems.forEach(item => catDiv.appendChild(createItemElement(item, cat.id)));
            if (hiddenItems.length > 0) {
                const hDiv = document.createElement('div');
                const hLabel = document.createElement('p');
                hLabel.style.cssText = 'color: #666; font-size: 14px; margin: 10px 0;';
                hLabel.textContent = `🗑️ Hidden Items (${hiddenItems.length}):`;
                hDiv.appendChild(hLabel);
                hiddenItems.forEach(item => hDiv.appendChild(createItemElement(item, cat.id, true)));
                catDiv.appendChild(hDiv);
            }
        }
        menuDiv.appendChild(catDiv);
    });
}

function createItemElement(item, categoryId, isHidden = false) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'item' + (isHidden ? ' deleted' : '');
    itemDiv.id = `item-${item.id}`;
    const hasImage = !!item.imageUrl;

    // Build header with image + info
    const headerDiv = document.createElement('div');
    headerDiv.className = 'item-header';

    const leftDiv = document.createElement('div');
    leftDiv.style.cssText = 'display: flex; align-items: center;';

    if (hasImage) {
        const img = document.createElement('img');
        img.src = escapeHtml(item.imageUrl);
        img.className = 'image-preview';
        img.loading = 'lazy';
        leftDiv.appendChild(img);
    } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'image-placeholder';
        placeholder.textContent = 'No Image';
        leftDiv.appendChild(placeholder);
    }

    const infoDiv = document.createElement('div');
    infoDiv.className = 'item-info';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'item-name';
    nameDiv.textContent = item.name + ' ';
    const vegSpan = document.createElement('span');
    vegSpan.className = item.isVeg ? 'veg' : 'non-veg';
    vegSpan.textContent = item.isVeg ? 'VEG' : 'NON-VEG';
    nameDiv.appendChild(vegSpan);
    if (item.isPopular) {
        const popSpan = document.createElement('span');
        popSpan.className = 'badge';
        popSpan.style.cssText = 'background:#ffc107;color:#000;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:5px;';
        popSpan.textContent = '⭐ POPULAR';
        nameDiv.appendChild(popSpan);
    }
    infoDiv.appendChild(nameDiv);

    const metaDiv = document.createElement('div');
    metaDiv.className = 'item-meta';
    const priceSpan = document.createElement('span');
    priceSpan.className = 'price';
    priceSpan.textContent = `₹${item.price}`;
    metaDiv.appendChild(priceSpan);
    if (item.description) {
        const descSpan = document.createElement('span');
        descSpan.style.cssText = 'color: #666; font-size: 14px;';
        descSpan.textContent = `• ${item.description}`;
        metaDiv.appendChild(descSpan);
    }
    infoDiv.appendChild(metaDiv);

    leftDiv.appendChild(infoDiv);
    headerDiv.appendChild(leftDiv);
    itemDiv.appendChild(headerDiv);

    // Build actions
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'actions';

    if (!isHidden) {
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'btn-warning btn-sm';
        toggleBtn.textContent = item.isPopular ? 'Unmark Popular' : 'Mark Popular';
        toggleBtn.addEventListener('click', () => togglePopular(item.id, !item.isPopular));
        actionsDiv.appendChild(toggleBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-danger btn-sm';
        deleteBtn.textContent = 'Remove';
        deleteBtn.addEventListener('click', () => deleteItem(item.id));
        actionsDiv.appendChild(deleteBtn);
    } else {
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'btn-success btn-sm';
        restoreBtn.textContent = 'Restore';
        restoreBtn.addEventListener('click', () => restoreItem(item.id));
        actionsDiv.appendChild(restoreBtn);

        const permDeleteBtn = document.createElement('button');
        permDeleteBtn.className = 'btn-danger btn-sm';
        permDeleteBtn.textContent = 'Delete Forever';
        permDeleteBtn.addEventListener('click', () => permanentDelete(item.id));
        actionsDiv.appendChild(permDeleteBtn);
    }

    // File upload wrapper
    const fileWrapper = document.createElement('div');
    fileWrapper.className = 'file-input-wrapper';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = `file-${item.id}`;
    fileInput.accept = 'image/*';
    if (isHidden) fileInput.disabled = true;
    fileInput.addEventListener('change', function() { uploadImage(item.id, this); });

    const fileLabel = document.createElement('label');
    fileLabel.htmlFor = `file-${item.id}`;
    fileLabel.className = 'file-input-label';
    fileLabel.id = `label-${item.id}`;
    fileLabel.textContent = `📷 ${hasImage ? 'Change' : 'Add'} Image`;

    fileWrapper.appendChild(fileInput);
    fileWrapper.appendChild(fileLabel);
    actionsDiv.appendChild(fileWrapper);

    itemDiv.appendChild(actionsDiv);
    return itemDiv;
}

async function addCategory() {
    const name = document.getElementById('catName').value.trim();
    if (!name) return showToast('Enter category name', 'error');
    try {
        await apiFetch('/categories', { method: 'POST', body: JSON.stringify({name, sortOrder: 0}) });
        document.getElementById('catName').value = '';
        showToast('Category added!');
        loadDashboard();
    } catch(e) { showToast(e.message, 'error'); }
}

async function addItem() {
    const categoryId = document.getElementById('catSelect').value;
    const name = document.getElementById('itemName').value.trim();
    const price = parseInt(document.getElementById('itemPrice').value);
    const desc = document.getElementById('itemDesc').value.trim();
    const isVeg = document.getElementById('isVeg').checked;
    const isPopular = document.getElementById('isPopular').checked;
    const imageInput = document.getElementById('newItemImage');
    const btn = document.getElementById('addItemBtn');

    if (!categoryId || !name || isNaN(price)) return showToast('Fill required fields', 'error');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Saving...'; btn.disabled = true;

    try {
        let options = { method: 'POST' };
        if (imageInput.files.length > 0) {
            btn.innerHTML = 'Compressing...';
            const compressed = await compressImage(imageInput.files[0], 800, 0.85);
            const fd = new FormData();
            fd.append('categoryId', categoryId); fd.append('name', name);
            fd.append('price', price); fd.append('description', desc);
            fd.append('isVeg', isVeg); fd.append('isPopular', isPopular);
            fd.append('image', compressed);
            options.body = fd;
        } else {
            options.body = JSON.stringify({ categoryId, name, price, description: desc, isVeg, isPopular, sortOrder: 0 });
        }
        await apiFetch('/items', options);
        showToast('Item added!');
        imageInput.value = ''; document.getElementById('itemName').value = ''; document.getElementById('itemPrice').value = '';
        document.getElementById('itemDesc').value = ''; document.getElementById('isVeg').checked = false;
        document.getElementById('isPopular').checked = false;
        loadDashboard();
    } catch(e) { showToast(e.message, 'error'); }
    finally { btn.innerHTML = originalText; btn.disabled = false; }
}

async function compressImage(file, maxWidth, quality) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width; let h = img.height;
                if (w > maxWidth) { h = Math.round((h * maxWidth) / w); w = maxWidth; }
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#FFF'; ctx.fillRect(0,0,w,h);
                ctx.drawImage(img, 0, 0, w, h);
                canvas.toBlob((b) => resolve(new File([b], file.name.replace(/\.[^/.]+$/, '.jpg'), {type:'image/jpeg'})), 'image/jpeg', quality);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function uploadImage(itemId, input) {
    if (!input.files[0]) return;
    const label = document.getElementById(`label-${itemId}`);
    const originalText = label.textContent;
    label.textContent = 'Compressing...';
    try {
        const compressed = await compressImage(input.files[0], 800, 0.85);
        const fd = new FormData(); fd.append('image', compressed);
        label.textContent = 'Uploading...';
        await apiFetch(`/items/${itemId}/image`, { method: 'POST', body: fd });
        showToast('Image updated!'); loadDashboard();
    } catch(e) { showToast(e.message, 'error'); label.textContent = originalText; }
    finally { input.value = ''; }
}

async function deleteItem(id) {
    if (!confirm('Remove this item from menu?')) return;
    try { await apiFetch(`/items/${id}`, { method: 'DELETE' }); showToast('Item removed'); loadDashboard(); } catch(e) {}
}

async function restoreItem(id) {
    try { await apiFetch(`/items/${id}/restore`, { method: 'PATCH' }); showToast('Item restored'); loadDashboard(); } catch(e) {}
}

async function permanentDelete(id) {
    if (!confirm('WARNING: This will permanently delete the item and its image!')) return;
    try { await apiFetch(`/items/${id}/permanent`, { method: 'DELETE' }); showToast('Item deleted forever'); loadDashboard(); } catch(e) {}
}

async function togglePopular(id, makePopular) {
    try {
        await apiFetch(`/items/${id}`, { method: 'PATCH', body: JSON.stringify({ isPopular: makePopular }) });
        showToast(makePopular ? 'Marked as popular!' : 'Removed from popular');
        loadDashboard();
    } catch(e) {}
}

// Event listeners (CSP-compliant — no inline handlers)
document.getElementById('loginBtn').addEventListener('click', login);
document.getElementById('pin').addEventListener('keypress', e => { if (e.key === 'Enter') login(); });
document.getElementById('tabMenu').addEventListener('click', function() { switchTab('menu', this); });
document.getElementById('tabAdd').addEventListener('click', function() { switchTab('add', this); });
document.getElementById('addCatBtn').addEventListener('click', addCategory);
document.getElementById('addItemBtn').addEventListener('click', addItem);
document.getElementById('themeSelect').addEventListener('change', function() { changeTheme(this.value); });
document.getElementById('logoutBtn').addEventListener('click', logout);
