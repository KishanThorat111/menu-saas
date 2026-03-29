const API = window.location.origin;
let hotel = null;
let currentTab = 'menu';

// ==================== WEAK PIN DETECTION (mirrors server-side) ====================
var WEAK_PIN_SET = new Set([
  '12345678','87654321','00000000','11111111','22222222','33333333','44444444',
  '55555555','66666666','77777777','88888888','99999999','12341234','11223344',
  '00000001','11112222','12121212','13131313','98765432','01234567','76543210',
  '01011990','01012000','01011980','11111112','10000000','20000000'
]);
function isWeakPinClient(pin) {
  if (WEAK_PIN_SET.has(pin)) return true;
  if (/^(.)\1{7}$/.test(pin)) return true;
  var d = pin.split('').map(Number), asc = true, desc = true;
  for (var i = 1; i < d.length; i++) {
    if (d[i] !== (d[i-1]+1)%10) asc = false;
    if (d[i] !== (d[i-1]-1+10)%10) desc = false;
  }
  if (asc || desc) return true;
  if (pin.length === 8 && pin.slice(0,4) === pin.slice(4)) return true;
  if (pin.length === 8 && pin.slice(0,2) === pin.slice(2,4) && pin.slice(0,2) === pin.slice(4,6) && pin.slice(0,2) === pin.slice(6)) return true;
  return false;
}

// ==================== FORGOT PIN STATE ====================
let forgotPinState = {
  code: '',
  resetToken: '',
  otpTimer: null,
  otpExpiresAt: null
};

function getToken() {
  return localStorage.getItem('menu_token');
}

if (getToken()) loadDashboard();

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
  document.getElementById('tab-billing').classList.toggle('hidden', tab !== 'billing');
  document.getElementById('tab-qr').classList.toggle('hidden', tab !== 'qr');
  if (tab === 'menu') renderMenu();
  if (tab === 'billing') loadBilling();
  if (tab === 'qr') { loadQrCode(); initReviewUrlUI(); }
}

async function apiFetch(endpoint, options = {}) {
  if (!options.headers) options.headers = {};
  if (options.body && !(options.body instanceof FormData) && !options.headers['Content-Type']) {
    options.headers['Content-Type'] = 'application/json';
  }
  const token = getToken();
  if (token) options.headers['Authorization'] = `Bearer ${token}`;
  
  const res = await fetch(`${API}${endpoint}`, options);
  if (res.status === 401) {
    showToast('Session expired. Please login again.', 'error');
    logout();
    throw new Error('401');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Request failed');
  }
  return res;
}

// LOGIN: 6-char base32 code + 8-digit PIN
async function login() {
  const code = document.getElementById('slug').value.trim().toUpperCase();
  const pin = document.getElementById('pin').value.trim();
  
  if (!code || !pin) {
    document.getElementById('error').textContent = 'Please enter both menu code and PIN';
    return;
  }
  
  if (!/^[A-Z2-7]{6}$/.test(code)) {
    document.getElementById('error').textContent = 'Menu code must be exactly 6 characters (A-Z, 2-7)';
    return;
  }
  
  if (pin.length !== 8 || !/^\d{8}$/.test(pin)) {
    document.getElementById('error').textContent = 'PIN must be exactly 8 digits';
    return;
  }
  
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, pin })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    
    localStorage.setItem('menu_token', data.token);
    showToast('Login successful!');
    loadDashboard();
  } catch (e) {
    document.getElementById('error').textContent = e.message;
  }
}

function logout() {
  localStorage.removeItem('menu_token');
  location.reload();
}

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
    const statusBadge = document.getElementById('hotelStatusBadge');
    if (statusBadge) statusBadge.setAttribute('data-status', hotel.status);
    document.getElementById('themeSelect').value = hotel.theme || 'classic';
    renderMenu();
    updateCategorySelect();
  } catch (e) {
    console.error(e);
    showToast('Failed to load dashboard', 'error');
    logout();
  }
}

async function changeTheme(newTheme) {
  try {
    await apiFetch('/settings/theme', {
      method: 'PATCH',
      body: JSON.stringify({ theme: newTheme })
    });
    showToast('Theme updated! Refresh your public menu to see changes.');
    hotel.theme = newTheme;
  } catch (e) {
    // Revert select to current theme on error (e.g. plan gating)
    document.getElementById('themeSelect').value = hotel.theme || 'classic';
    var wrapper = document.getElementById('themeSelect')?.closest('.custom-select-wrapper');
    if (wrapper) {
      var display = wrapper.querySelector('.custom-select-display span');
      var opts = document.getElementById('themeSelect').options;
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].value === hotel.theme) { if (display) display.textContent = opts[i].textContent; break; }
      }
    }
    showToast(e.message, 'error');
  }
}

function updateThemeGating() {
  var sel = document.getElementById('themeSelect');
  if (!sel || !billingData || !billingData.allowedThemes) return;
  var allowed = billingData.allowedThemes;
  for (var i = 0; i < sel.options.length; i++) {
    var opt = sel.options[i];
    if (allowed.indexOf(opt.value) === -1) {
      opt.disabled = true;
      opt.textContent = opt.textContent.replace(/ 🔒$/, '') + ' \ud83d\udd12';
    } else {
      opt.disabled = false;
      opt.textContent = opt.textContent.replace(/ 🔒$/, '');
    }
  }
  // Refresh custom dropdown if present
  var wrapper = sel.closest('.custom-select-wrapper');
  if (wrapper) {
    var items = wrapper.querySelectorAll('.custom-select-option');
    items.forEach(function(item) {
      var val = item.getAttribute('data-value');
      if (allowed.indexOf(val) === -1) {
        item.classList.add('disabled');
        item.style.opacity = '0.5';
        item.style.pointerEvents = 'none';
      } else {
        item.classList.remove('disabled');
        item.style.opacity = '';
        item.style.pointerEvents = '';
      }
    });
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
    menuDiv.innerHTML = '<div style="text-align:center;padding:3rem 1.5rem;color:#64748b;"><div style="font-size:3rem;margin-bottom:0.75rem;">📋</div><p style="font-size:1rem;font-weight:600;">No categories yet</p><p style="font-size:0.875rem;margin-top:0.25rem;">Switch to the Add Items tab to create your first category</p></div>';
    return;
  }
  
  hotel.categories.forEach(cat => {
    const catDiv = document.createElement('div');
    const titleDiv = document.createElement('div');
    titleDiv.className = 'category-title';
    
    const titleText = document.createElement('span');
    titleText.textContent = cat.name;
    titleDiv.appendChild(titleText);
    
    const renameBtn = document.createElement('button');
    renameBtn.className = 'btn-category-rename';
    renameBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>';
    renameBtn.title = 'Rename category';
    renameBtn.addEventListener('click', function(e) { e.stopPropagation(); renameCategory(cat.id, cat.name); });
    titleDiv.appendChild(renameBtn);
    catDiv.appendChild(titleDiv);
    
    const items = cat.items || [];
    const visibleItems = items.filter(i => i.isAvailable !== false);
    const hiddenItems = items.filter(i => i.isAvailable === false);
    
    if (items.length === 0) {
      const p = document.createElement('p');
      p.style.cssText = 'color:#94a3b8;padding:1.25rem 1.5rem;font-size:0.875rem;';
      p.textContent = 'No items in this category';
      catDiv.appendChild(p);
    } else {
      visibleItems.forEach(item => catDiv.appendChild(createItemElement(item, cat.id)));
      if (hiddenItems.length > 0) {
        const hDiv = document.createElement('div');
        const hLabel = document.createElement('p');
        hLabel.style.cssText = 'color:#94a3b8;font-size:0.8125rem;padding:0.75rem 1.25rem;font-weight:600;border-top:1px dashed #e8e5e0;margin:0;';
        hLabel.textContent = `🚫 Hidden Items (${hiddenItems.length})`;
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
  
  const hasImage = item.imageUrl;
  
  const headerDiv = document.createElement('div');
  headerDiv.className = 'item-header';
  
  const leftDiv = document.createElement('div');
  leftDiv.style.cssText = 'display:flex;gap:0.875rem;align-items:flex-start;flex:1;min-width:0;';
  
  if (hasImage) {
    const img = document.createElement('img');
    img.src = escapeHtml(item.imageUrl);
    img.className = 'image-preview';
    img.loading = 'lazy';
    leftDiv.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'image-placeholder';
    placeholder.textContent = '🍽️';
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
    popSpan.style.cssText = 'background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:9999px;font-size:0.5625rem;font-weight:800;border:1px solid #fcd34d;letter-spacing:0.04em;';
    popSpan.textContent = '⭐ POPULAR';
    nameDiv.appendChild(popSpan);
  }
  
  const metaDiv = document.createElement('div');
  metaDiv.className = 'item-meta';
  
  const priceSpan = document.createElement('span');
  priceSpan.className = 'price';
  priceSpan.textContent = `₹${item.price}`;
  metaDiv.appendChild(priceSpan);
  
  if (item.description) {
    const descSpan = document.createElement('span');
    descSpan.style.cssText = 'color:#64748b;font-size:0.8125rem;';
    descSpan.textContent = ` • ${item.description}`;
    metaDiv.appendChild(descSpan);
  }
  
  infoDiv.appendChild(nameDiv);
  infoDiv.appendChild(metaDiv);
  leftDiv.appendChild(infoDiv);
  headerDiv.appendChild(leftDiv);
  itemDiv.appendChild(headerDiv);
  
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'actions';
  
  if (!isHidden) {
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'btn btn-warning btn-sm';
  toggleBtn.innerHTML = `<span class="btn-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9"></polygon></svg></span><span class="btn-text">${item.isPopular ? 'Popular' : 'Mark'}</span>`;
  toggleBtn.title = item.isPopular ? 'Unmark Popular' : 'Mark Popular';
  toggleBtn.setAttribute('aria-pressed', item.isPopular ? 'true' : 'false');
  toggleBtn.addEventListener('click', () => togglePopular(item.id, !item.isPopular));
  actionsDiv.appendChild(toggleBtn);
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.innerHTML = `<span class="btn-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></span><span class="btn-text">Remove</span>`;
    deleteBtn.title = 'Remove item';
    deleteBtn.addEventListener('click', () => deleteItem(item.id));
    actionsDiv.appendChild(deleteBtn);

    // Toggle Veg Button
    const vegBtn = document.createElement('button');
    vegBtn.className = 'btn btn-secondary btn-sm';
    vegBtn.dataset.action = 'toggle-veg';
    vegBtn.innerHTML = `<span class="btn-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 11-9 11s-9-4-9-11c0-4 4-8 9-8 5 0 9 4 9 8z"></path><path d="M7 10c0 4 5 7 5 7"></path></svg></span><span class="btn-text">${item.isVeg ? 'Veg' : 'Non-Veg'}</span>`;
    vegBtn.title = item.isVeg ? 'Make Non-Veg' : 'Make Veg';
    vegBtn.setAttribute('aria-pressed', item.isVeg ? 'true' : 'false');
    vegBtn.addEventListener('click', () => toggleVeg(item.id, item.isVeg));
    actionsDiv.appendChild(vegBtn);

    // Edit Price Button (use Indian rupee symbol)
    const priceBtn = document.createElement('button');
    priceBtn.className = 'btn btn-primary btn-sm';
    priceBtn.innerHTML = `<span class="btn-icon" aria-hidden="true">₹</span><span class="btn-text">Price</span>`;
    priceBtn.title = 'Edit price (₹)';
    priceBtn.addEventListener('click', () => editPrice(item.id, item.price));
    actionsDiv.appendChild(priceBtn);

    // Edit Description Button
    const descBtn = document.createElement('button');
    descBtn.className = 'btn btn-secondary btn-sm';
    descBtn.innerHTML = `<span class="btn-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg></span><span class="btn-text">Edit</span>`;
    descBtn.title = 'Edit description & category';
    descBtn.addEventListener('click', () => editDishDetails(item.id, item.description, categoryId));
    actionsDiv.appendChild(descBtn);
  } else {
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'btn btn-success btn-sm';
    restoreBtn.innerHTML = `<span class="btn-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"></path><path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"></path></svg></span><span class="btn-text">Restore</span>`;
    restoreBtn.addEventListener('click', () => restoreItem(item.id));
    actionsDiv.appendChild(restoreBtn);
    
    const permDeleteBtn = document.createElement('button');
    permDeleteBtn.className = 'btn btn-danger btn-sm';
    permDeleteBtn.innerHTML = `<span class="btn-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></span><span class="btn-text">Delete</span>`;
    permDeleteBtn.title = 'Delete forever (irreversible)';
    permDeleteBtn.addEventListener('click', () => permanentDelete(item.id));
    actionsDiv.appendChild(permDeleteBtn);
  }
  
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
  fileLabel.innerHTML = `<span class="btn-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="14" rx="2" ry="2"></rect><circle cx="12" cy="13" r="3"></circle><path d="M8 7l2-3h4l2 3"></path></svg></span><span class="btn-text">Image</span>`;
  fileLabel.title = hasImage ? 'Change image' : 'Add image';
  
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
    await apiFetch('/categories', { 
      method: 'POST', 
      body: JSON.stringify({ name, sortOrder: 0 }) 
    });
    document.getElementById('catName').value = '';
    showToast('Category added!');
    loadDashboard();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function addItem() {
  const categoryId = document.getElementById('catSelect').value;
  const name = document.getElementById('itemName').value.trim();
  const price = parseInt(document.getElementById('itemPrice').value);
  const desc = document.getElementById('itemDesc').value.trim();
  // Veg option: read from radio (veg/non-veg). Default: non-veg when nothing selected.
  const vegRadio = document.querySelector('input[name="vegOption"]:checked');
  const isVeg = vegRadio ? (vegRadio.value === 'veg') : false;
  const isPopular = document.getElementById('isPopular').checked;
  const imageInput = document.getElementById('newItemImage');
  const btn = document.getElementById('addItemBtn');
  
  if (!categoryId || !name || isNaN(price)) {
    return showToast('Fill required fields', 'error');
  }
  
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Saving...';
  btn.disabled = true;
  
  try {
    let options = { method: 'POST' };
    if (imageInput.files.length > 0) {
      const file = imageInput.files[0];
      if (file.size > 5 * 1024 * 1024) {
        showToast('Image must be less than 5MB', 'error');
        btn.innerHTML = originalText;
        btn.disabled = false;
        return;
      }
      btn.innerHTML = 'Compressing...';
      const compressed = await compressImage(file, 800, 0.85);
      const fd = new FormData();
      fd.append('categoryId', categoryId);
      fd.append('name', name);
      fd.append('price', price);
      fd.append('description', desc);
      fd.append('isVeg', isVeg);
      fd.append('isPopular', isPopular);
      fd.append('image', compressed);
      options.body = fd;
    } else {
      options.body = JSON.stringify({ 
        categoryId, name, price, description: desc, isVeg, isPopular, sortOrder: 0 
      });
    }
    
    await apiFetch('/items', options);
    showToast('Item added!');
    imageInput.value = '';
    document.getElementById('itemName').value = '';
    document.getElementById('itemPrice').value = '';
    document.getElementById('itemDesc').value = '';
    // reset veg radios to default non-veg
    const nonVegRadio = document.getElementById('vegOptionNonVeg');
    const vegRadioReset = document.getElementById('vegOptionVeg');
    if (nonVegRadio) nonVegRadio.checked = true;
    if (vegRadioReset) vegRadioReset.checked = false;
    document.getElementById('isPopular').checked = false;
    loadDashboard();
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
    // reset file upload label/preview
    resetNewItemFileLabel();
  }
}

// reset Add Item file label and preview helper
function resetNewItemFileLabel() {
  try {
    const imageInput = document.getElementById('newItemImage');
    if (!imageInput) return;
    imageInput.value = '';
    const fileLabel = imageInput.parentNode && imageInput.parentNode.querySelector('.file-upload-text');
    if (fileLabel) fileLabel.textContent = 'Choose Dish Image';
    const fileLabelWrap = imageInput.parentNode && imageInput.parentNode.querySelector('.file-upload-label');
    if (fileLabelWrap) fileLabelWrap.classList.remove('file-selected');
    const prev = imageInput.parentNode && imageInput.parentNode.querySelector('.file-preview-thumb');
    if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
  } catch (_) {}
}

async function compressImage(file, maxWidth, quality) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;
        if (w > maxWidth) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((b) => resolve(
          new File([b], file.name.replace(/\.[^/.]+$/, '.jpg'), { type: 'image/jpeg' })
        ), 'image/jpeg', quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadImage(itemId, input) {
  if (!input.files[0]) return;
  const file = input.files[0];
  if (file.size > 5 * 1024 * 1024) {
    showToast('Image must be less than 5MB', 'error');
    input.value = '';
    return;
  }
  const label = document.getElementById(`label-${itemId}`);
  const originalText = label.textContent;
  label.textContent = 'Compressing...';
  
  try {
    const compressed = await compressImage(file, 800, 0.85);
    const fd = new FormData();
    fd.append('image', compressed);
    label.textContent = 'Uploading...';
    await apiFetch(`/items/${itemId}/image`, { method: 'POST', body: fd });
    showToast('Image updated!');
    loadDashboard();
  } catch (e) {
    showToast(e.message, 'error');
    label.textContent = originalText;
  } finally {
    input.value = '';
  }
}

// Show selected filename / preview for Add Item image input
function handleNewItemImageChange(e) {
  const input = e.target;
  const wrapper = input.parentNode;
  if (!wrapper) return;
  const label = wrapper.querySelector('.file-upload-label');
  const text = wrapper.querySelector('.file-upload-text');
  if (!label || !text) return;

  const file = input.files && input.files[0];
  if (!file) {
    text.textContent = 'Choose Dish Image';
    label.classList.remove('file-selected');
    const prev = wrapper.querySelector('.file-preview-thumb');
    if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
    return;
  }

  text.textContent = file.name.length > 28 ? file.name.slice(0, 24) + '...' : file.name;
  label.classList.add('file-selected');

  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = function(evt) {
      let prev = wrapper.querySelector('.file-preview-thumb');
      if (!prev) {
        prev = document.createElement('img');
        prev.className = 'file-preview-thumb';
        prev.style.width = '40px';
        prev.style.height = '40px';
        prev.style.objectFit = 'cover';
        prev.style.borderRadius = '6px';
        prev.style.marginRight = '0.5rem';
        const icon = label.querySelector('.file-upload-icon');
        if (icon) label.insertBefore(prev, icon);
        else label.insertBefore(prev, label.firstChild);
      }
      prev.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  }
}

document.addEventListener('DOMContentLoaded', function() {
  const newItemImageInput = document.getElementById('newItemImage');
  if (newItemImageInput) newItemImageInput.addEventListener('change', handleNewItemImageChange);
});

async function deleteItem(id) {
  const ok = await openConfirmModal({ title: 'Remove Item', message: 'Remove this item from menu?', confirmText: 'Remove' });
  if (!ok) {
    try { document.activeElement && document.activeElement.blur && document.activeElement.blur(); } catch(e){}
    return;
  }
  try {
    await apiFetch(`/items/${id}`, { method: 'DELETE' });
    showToast('Item removed');
    loadDashboard();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function restoreItem(id) {
  try {
    await apiFetch(`/items/${id}/restore`, { method: 'PATCH' });
    showToast('Item restored');
    loadDashboard();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function permanentDelete(id) {
  const ok = await openConfirmModal({ title: 'Delete Item', message: 'WARNING: This will permanently delete the item and its image!', confirmText: 'Delete' });
  if (!ok) return;
  try {
    await apiFetch(`/items/${id}/permanent`, { method: 'DELETE' });
    showToast('Item deleted forever');
    loadDashboard();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function togglePopular(id, makePopular) {
  try {
    await apiFetch(`/items/${id}`, { 
      method: 'PATCH', 
      body: JSON.stringify({ isPopular: makePopular }) 
    });
    showToast(makePopular ? 'Marked as popular!' : 'Removed from popular');
    loadDashboard();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// Toggle Veg Status
async function toggleVeg(id, currentIsVeg) {
  try {
    const newVeg = !currentIsVeg;
    await apiFetch(`/items/${id}`, { 
      method: 'PATCH', 
      body: JSON.stringify({ isVeg: newVeg }) 
    });

    showToast(newVeg ? 'Marked as Veg' : 'Marked as Non-Veg');

    // Update local state and DOM immediately
    if (hotel && hotel.categories) {
      for (const cat of hotel.categories) {
        const item = cat.items?.find(i => i.id === id);
        if (item) {
          item.isVeg = newVeg;
          
          const itemDiv = document.getElementById(`item-${id}`);
          if (itemDiv) {
            // Update VEG/NON-VEG badge - SAFER SELECTOR (first span in item-name)
            const badge = itemDiv.querySelector('.item-name span');
            if (badge) {
              badge.className = newVeg ? 'veg' : 'non-veg';
              badge.textContent = newVeg ? 'VEG' : 'NON-VEG';
            }

            // Update button markup (keep icon + text structure), title and pressed state
            const vegBtn = itemDiv.querySelector('button[data-action="toggle-veg"]');
            if (vegBtn) {
              vegBtn.innerHTML = `<span class="btn-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 11-9 11s-9-4-9-11c0-4 4-8 9-8 5 0 9 4 9 8z"></path><path d="M7 10c0 4 5 7 5 7"></path></svg></span><span class="btn-text">${newVeg ? 'Veg' : 'Non-Veg'}</span>`;
              vegBtn.title = newVeg ? 'Make Non-Veg' : 'Make Veg';
              vegBtn.setAttribute('aria-pressed', newVeg ? 'true' : 'false');
            }
          }
          break;
        }
      }
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// Edit Price
async function editPrice(id, currentPrice) {
  try {
    const result = await openEditModal({
      title: 'Edit Price',
      type: 'number',
      value: String(currentPrice),
      placeholder: 'Enter price (₹)'
    });
    if (result == null) return; // cancelled

    const parsed = parseInt(result, 10);
    if (isNaN(parsed) || parsed <= 0) {
      showToast('Invalid price', 'error');
      return;
    }

    await apiFetch(`/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ price: parsed })
    });
    showToast('Price updated!');

    // Update local state and DOM
    if (hotel && hotel.categories) {
      for (const cat of hotel.categories) {
        const item = cat.items?.find(i => i.id === id);
        if (item) {
          item.price = parsed;
          const itemDiv = document.getElementById(`item-${id}`);
          if (itemDiv) {
            const priceEl = itemDiv.querySelector('.price');
            if (priceEl) priceEl.textContent = `₹${parsed}`;
          }
          break;
        }
      }
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// Edit Description
async function editDescription(id, currentDesc) {
  try {
    const result = await openEditModal({
      title: 'Edit Description',
      type: 'textarea',
      value: currentDesc || '',
      placeholder: 'Enter description',
      maxLength: 500
    });
    if (result == null) return; // cancelled

    await apiFetch(`/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ description: result })
    });
    showToast('Description updated!');

    // Update local state and DOM
    if (hotel && hotel.categories) {
      for (const cat of hotel.categories) {
        const item = cat.items?.find(i => i.id === id);
        if (item) {
          item.description = result;
          const itemDiv = document.getElementById(`item-${id}`);
          if (itemDiv) {
            const metaDiv = itemDiv.querySelector('.item-meta');
            if (metaDiv) {
              const priceSpan = document.createElement('span');
              priceSpan.className = 'price';
              priceSpan.textContent = `₹${item.price}`;
              metaDiv.innerHTML = '';
              metaDiv.appendChild(priceSpan);
              if (result) {
                const descSpan = document.createElement('span');
                descSpan.style.cssText = 'color:#64748b;font-size:0.8125rem;';
                descSpan.textContent = ` • ${result}`;
                metaDiv.appendChild(descSpan);
              }
            }
          }
          break;
        }
      }
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function renameCategory(catId, currentName) {
  try {
    const result = await openEditModal({
      title: 'Rename Category',
      type: 'text',
      value: currentName,
      placeholder: 'Category name',
      maxLength: 100
    });
    if (result == null || result === currentName) return;

    await apiFetch(`/categories/${catId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: result })
    });
    showToast('Category renamed!');

    if (hotel && hotel.categories) {
      var cat = hotel.categories.find(c => c.id === catId);
      if (cat) cat.name = result;
    }
    renderMenu();
    updateCategorySelect();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function editDishDetails(itemId, currentDesc, currentCategoryId) {
  var overlay = document.getElementById('dishEditModalOverlay');
  var descField = document.getElementById('dishEditDesc');
  var catSelect = document.getElementById('dishEditCategory');
  var saveBtn = document.getElementById('dishEditSave');
  var cancelBtn = document.getElementById('dishEditCancel');
  var closeBtn = document.getElementById('dishEditClose');
  var errorEl = document.getElementById('dishEditError');

  descField.value = currentDesc || '';
  errorEl.style.display = 'none';

  // Populate category dropdown
  catSelect.innerHTML = '';
  if (hotel && hotel.categories) {
    hotel.categories.forEach(function(cat) {
      var opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.name;
      if (cat.id === currentCategoryId) opt.selected = true;
      catSelect.appendChild(opt);
    });
  }

  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
  descField.focus();

  // Clean listeners via cloneNode
  var newSave = saveBtn.cloneNode(true);
  var newCancel = cancelBtn.cloneNode(true);
  var newClose = closeBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSave, saveBtn);
  cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
  closeBtn.parentNode.replaceChild(newClose, closeBtn);

  function closeModal() {
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
  }

  newCancel.addEventListener('click', closeModal);
  newClose.addEventListener('click', closeModal);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });

  newSave.addEventListener('click', async function() {
    var newDesc = descField.value.trim();
    var newCatId = catSelect.value;

    if (newDesc.length > 500) {
      errorEl.textContent = 'Description must be 500 characters or less';
      errorEl.style.display = 'block';
      return;
    }

    var updates = {};
    var descChanged = newDesc !== (currentDesc || '');
    var catChanged = newCatId !== currentCategoryId;

    if (!descChanged && !catChanged) { closeModal(); return; }

    if (descChanged) updates.description = newDesc;
    if (catChanged) updates.categoryId = newCatId;

    newSave.disabled = true;
    newSave.textContent = 'Saving...';

    try {
      await apiFetch(`/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });

      closeModal();

      if (catChanged) {
        showToast('Dish moved & updated!');
        loadDashboard();
      } else {
        showToast('Description updated!');
        if (hotel && hotel.categories) {
          for (var cat of hotel.categories) {
            var item = cat.items?.find(function(i) { return i.id === itemId; });
            if (item) {
              item.description = newDesc;
              var itemDiv = document.getElementById('item-' + itemId);
              if (itemDiv) {
                var metaDiv = itemDiv.querySelector('.item-meta');
                if (metaDiv) {
                  var priceSpan = document.createElement('span');
                  priceSpan.className = 'price';
                  priceSpan.textContent = '₹' + item.price;
                  metaDiv.innerHTML = '';
                  metaDiv.appendChild(priceSpan);
                  if (newDesc) {
                    var descSpan = document.createElement('span');
                    descSpan.style.cssText = 'color:#64748b;font-size:0.8125rem;';
                    descSpan.textContent = ' • ' + newDesc;
                    metaDiv.appendChild(descSpan);
                  }
                }
              }
              break;
            }
          }
        }
      }
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      newSave.disabled = false;
      newSave.textContent = 'Save';
    }
  });
}

// Modal helpers
function openEditModal({ title = 'Edit', type = 'text', value = '', placeholder = '', maxLength = 0 } = {}) {
  return new Promise((resolve) => {
    // prevent re-entrancy if modal already open
    const overlayEl = document.getElementById('editModalOverlay');
    if (overlayEl && overlayEl.classList.contains('show')) {
      // already open - focus existing input and return a cancelled promise
      const existingInput = overlayEl.querySelector('input, textarea');
      if (existingInput) existingInput.focus();
      resolve(null);
      return;
    }
    const overlay = document.getElementById('editModalOverlay');
    const titleEl = document.getElementById('editModalTitle');
    const input = document.getElementById('editModalInput');
    const textarea = document.getElementById('editModalTextarea');
    const errorEl = document.getElementById('editModalError');
    const saveBtn = document.getElementById('editModalSave');
    const cancelBtn = document.getElementById('editModalCancel');
    const closeBtn = document.getElementById('editModalClose');

    titleEl.textContent = title;
    input.classList.add('hidden');
    textarea.classList.add('hidden');
    input.value = '';
    textarea.value = '';

    let activeElBefore = document.activeElement;
    let handled = false;

    function cleanup() {
      overlay.classList.remove('show');
      overlay.setAttribute('aria-hidden', 'true');
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keydown', trapHandler);
      saveBtn.removeEventListener('click', onSave);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      if (activeElBefore && activeElBefore.focus) activeElBefore.focus();
    }

    function finish(val) {
      if (handled) return;
      handled = true;
      cleanup();
      resolve(val);
    }

    function onSave(e) {
      e && e.preventDefault();
      // validation
      if (type === 'textarea' && maxLength > 0) {
        if (textarea.value.trim().length > maxLength) {
          errorEl.style.display = 'block';
          errorEl.textContent = `Description must be ${maxLength} characters or less`;
          textarea.focus();
          return;
        }
      }

      // disable save and show busy state
      if (handled) return;
      saveBtn.disabled = true;
      const origSaveText = saveBtn.textContent;
      saveBtn.textContent = 'Saving...';

      try {
        if (type === 'number') finish(input.value.trim());
        else if (type === 'textarea') finish(textarea.value.trim());
        else finish(input.value.trim());
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = origSaveText;
      }
    }

    function onCancel(e) {
      e && e.preventDefault();
      finish(null);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && type !== 'textarea') {
        e.preventDefault();
        onSave(e);
      }
    }

    // clear error
    if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }

    // Setup fields
    if (type === 'textarea') {
      textarea.classList.remove('hidden');
      textarea.placeholder = placeholder || '';
      textarea.value = value || '';
      setTimeout(() => textarea.focus(), 0);
    } else {
      input.type = type === 'number' ? 'number' : 'text';
      input.classList.remove('hidden');
      input.placeholder = placeholder || '';
      input.value = value || '';
      setTimeout(() => { input.focus(); input.select && input.select(); }, 0);
    }

    // show
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');

    // focus trap (simple)
    const trapHandler = function(e) {
      const focusable = overlay.querySelectorAll('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keydown', trapHandler);
    saveBtn.addEventListener('click', onSave);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
  });
}

// Confirmation modal helper (uses the same modal styles)
function openConfirmModal({ title = 'Confirm', message = '', confirmText = 'OK' } = {}) {
    return new Promise(async (resolve) => {
      const overlay = document.getElementById('confirmModalOverlay');
      if (overlay && overlay.classList.contains('show')) {
        // already open - focus cancel and return false
        const cancel = overlay.querySelector('#confirmModalCancel');
        if (cancel) cancel.focus();
        resolve(false);
        return;
      }
      let handled = false;

      // If an input is focused (mobile keyboard up), blur it so keyboard hides
      // then wait briefly before showing the confirm modal to avoid it being pushed off-screen.
      const prevActive = document.activeElement;
      const tag = prevActive && prevActive.tagName && prevActive.tagName.toLowerCase();
      if (prevActive && (tag === 'input' || tag === 'textarea' || prevActive.isContentEditable)) {
        try { prevActive.blur(); } catch (_) {}
        await new Promise(r => setTimeout(r, 180));
      }

      // Center the confirm modal explicitly so it isn't pinned to bottom under keyboards
      const prevAlign = overlay && overlay.style ? overlay.style.alignItems : null;
      if (overlay && overlay.style) overlay.style.alignItems = 'center';

      // ensure confirm only resolves once
      const titleEl = document.getElementById('confirmModalTitle');
      const messageEl = document.getElementById('confirmModalMessage');
      const confirmBtn = document.getElementById('confirmModalConfirm');
      const cancelBtn = document.getElementById('confirmModalCancel');
      const closeBtn = document.getElementById('confirmModalClose');

      if (titleEl) titleEl.textContent = title;
      if (messageEl) messageEl.textContent = message;
      if (confirmBtn) confirmBtn.textContent = confirmText;

      let activeElBefore = document.activeElement;

      function cleanup() {
        overlay.classList.remove('show');
        overlay.setAttribute('aria-hidden', 'true');
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keydown', trapHandler);
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
        closeBtn.removeEventListener('click', onCancel);
        if (overlay && overlay.style) overlay.style.alignItems = prevAlign || '';
        if (activeElBefore && activeElBefore.focus) activeElBefore.focus();
      }

      function onConfirm(e) {
        e && e.preventDefault();
        if (handled) return;
        handled = true;
        cleanup();
        resolve(true);
      }
      function onCancel(e) {
        e && e.preventDefault();
        if (handled) return;
        handled = true;
        cleanup();
        resolve(false);
      }

      function onKeyDown(e) {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter') {
          e.preventDefault();
          onConfirm();
        }
      }

      const trapHandler = function(e) {
        const focusable = overlay.querySelectorAll('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.key === 'Tab') {
          if (e.shiftKey) {
            if (document.activeElement === first) { e.preventDefault(); last.focus(); }
          } else {
            if (document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        }
      };

      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('keydown', trapHandler);
      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
      closeBtn.addEventListener('click', onCancel);

      overlay.classList.add('show');
      overlay.setAttribute('aria-hidden', 'false');

      setTimeout(() => { if (cancelBtn) cancelBtn.focus(); }, 0);
    });
  }

// SAFE Event listeners (null-checked)
const loginBtn = document.getElementById('loginBtn');
if (loginBtn) loginBtn.addEventListener('click', login);

const pinInput = document.getElementById('pin');
if (pinInput) {
  pinInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') login();
  });
}

const tabMenu = document.getElementById('tabMenu');
if (tabMenu) {
  tabMenu.addEventListener('click', function() {
    switchTab('menu', this);
  });
}

const tabAdd = document.getElementById('tabAdd');
if (tabAdd) {
  tabAdd.addEventListener('click', function() {
    switchTab('add', this);
  });
}

const tabBilling = document.getElementById('tabBilling');
if (tabBilling) {
  tabBilling.addEventListener('click', function() {
    switchTab('billing', this);
  });
}

const tabQR = document.getElementById('tabQR');
if (tabQR) {
  tabQR.addEventListener('click', function() {
    switchTab('qr', this);
  });
}

const addCatBtn = document.getElementById('addCatBtn');
if (addCatBtn) addCatBtn.addEventListener('click', addCategory);

const addItemBtn = document.getElementById('addItemBtn');
if (addItemBtn) addItemBtn.addEventListener('click', addItem);

const themeSelect = document.getElementById('themeSelect');
if (themeSelect) {
  themeSelect.addEventListener('change', function() {
    changeTheme(this.value);
  });
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) logoutBtn.addEventListener('click', logout);

// Custom Styled Dropdowns
(function() {
  var arrowSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

  function initCustomSelect(sel) {
    if (!sel) return;
    var wrap = document.createElement('div');
    wrap.className = 'custom-select-wrap';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);

    var trigger = document.createElement('div');
    trigger.className = 'custom-select-trigger';

    var text = document.createElement('span');
    text.className = 'custom-select-text';

    var arrow = document.createElement('span');
    arrow.className = 'custom-select-arrow';
    arrow.innerHTML = arrowSvg;

    trigger.appendChild(text);
    trigger.appendChild(arrow);
    wrap.appendChild(trigger);

    var dropdown = document.createElement('div');
    dropdown.className = 'custom-select-dropdown';
    wrap.appendChild(dropdown);

    dropdown.addEventListener('click', function(e) { e.stopPropagation(); });

    function refresh() {
      var opt = sel.options[sel.selectedIndex];
      if (opt && opt.value) {
        text.textContent = opt.text;
        text.classList.remove('placeholder');
      } else {
        text.textContent = opt ? opt.text : 'Select...';
        text.classList.add('placeholder');
      }
    }

    function buildOpts() {
      dropdown.innerHTML = '';
      Array.from(sel.options).forEach(function(opt, i) {
        var div = document.createElement('div');
        div.className = 'custom-select-option' + (i === sel.selectedIndex ? ' selected' : '');
        var label = document.createTextNode(opt.text);
        div.appendChild(label);
        var check = document.createElement('span');
        check.className = 'cs-check';
        check.textContent = '\u2713';
        div.appendChild(check);
        div.addEventListener('click', function(e) {
          e.stopPropagation();
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          refresh();
          closeDD();
        });
        dropdown.appendChild(div);
      });
    }

    function closeDD() {
      trigger.classList.remove('open');
      dropdown.classList.remove('open');
      // Restore overflow on modal ancestors
      var m = wrap.closest('.modal');
      if (m) m.style.overflow = '';
      var mb = wrap.closest('.modal-body');
      if (mb) mb.style.overflow = '';
    }

    trigger.addEventListener('click', function(e) {
      e.stopPropagation();
      document.querySelectorAll('.custom-select-trigger.open').forEach(function(t) {
        if (t !== trigger) {
          t.classList.remove('open');
          t.nextElementSibling.classList.remove('open');
        }
      });
      if (trigger.classList.contains('open')) { closeDD(); }
      else {
        buildOpts();
        trigger.classList.add('open');
        dropdown.classList.add('open');
        // Allow overflow on modal ancestors so dropdown isn't clipped
        var m = wrap.closest('.modal');
        if (m) m.style.overflow = 'visible';
        var mb = wrap.closest('.modal-body');
        if (mb) mb.style.overflow = 'visible';
        // Scroll dropdown into view if inside a modal
        setTimeout(function() {
          var ddRect = dropdown.getBoundingClientRect();
          if (ddRect.bottom > window.innerHeight) {
            dropdown.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }, 20);
      }
    });

    document.addEventListener('click', closeDD);

    new MutationObserver(refresh).observe(sel, { childList: true, subtree: true, attributes: true });

    var desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(sel, 'value', {
      get: function() { return desc.get.call(this); },
      set: function(v) { desc.set.call(this, v); refresh(); }
    });

    refresh();
  }

  initCustomSelect(document.getElementById('catSelect'));
  initCustomSelect(document.getElementById('themeSelect'));
  initCustomSelect(document.getElementById('dishEditCategory'));
})();

// ==================== BILLING / PAYMENT FUNCTIONS ====================

let billingData = null;
let analyticsData = null;

async function loadBilling() {
  const container = document.getElementById('billingContent');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:3rem 1.5rem;color:var(--slate-400);"><div style="font-size:1.5rem;margin-bottom:0.75rem;animation:pulse 1.5s ease-in-out infinite;">\ud83d\udcb3</div><div style="font-size:0.875rem;font-weight:500;">Loading billing...</div></div>';

  try {
    const [billingRes, analyticsRes] = await Promise.all([
      apiFetch('/me/billing'),
      apiFetch('/me/analytics').catch(function() { return null; })
    ]);
    billingData = await billingRes.json();
    if (analyticsRes) {
      try { analyticsData = await analyticsRes.json(); } catch(e) { analyticsData = null; }
    }
    renderBilling();
    updateThemeGating();
  } catch (e) {
    container.innerHTML = '<div style="text-align:center;padding:3rem 1.5rem;"><div style="font-size:1.5rem;margin-bottom:0.75rem;">\u274c</div><div style="color:var(--red-500);font-weight:600;font-size:0.875rem;">Failed to load billing info</div><div style="color:var(--slate-400);font-size:0.8125rem;margin-top:0.5rem;">Please try refreshing the page</div></div>';
  }
}

function renderBilling() {
  const container = document.getElementById('billingContent');
  if (!container || !billingData) return;

  const b = billingData;
  const isUnlimited = b.dailyUniqueLimit === -1;
  const uniquePercent = isUnlimited ? 0 : Math.min(100, Math.round(((b.todayUnique || 0) / b.dailyUniqueLimit) * 100));
  const barColor = uniquePercent >= 90 ? '#ef4444' : uniquePercent >= 70 ? '#f59e0b' : '#10b981';

  const paidUntilStr = b.paidUntil ? new Date(b.paidUntil).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';
  const trialEndsStr = b.trialEnds ? new Date(b.trialEnds).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';
  const isExpiring = b.paidUntil && (new Date(b.paidUntil) - new Date()) < 7 * 24 * 60 * 60 * 1000;
  const isTrial = b.status === 'TRIAL';
  const isExpired = b.status === 'EXPIRED' || b.status === 'GRACE';

  let statusCard = 'highlight';
  if (isExpired) statusCard = 'warn';
  else if (b.status === 'ACTIVE') statusCard = 'success';

  var statusIcon = '\u26a0\ufe0f';
  if (b.status === 'ACTIVE') statusIcon = '\u2705';
  else if (isTrial) statusIcon = '\ud83e\uddea';
  else if (isExpired) statusIcon = '\ud83d\udea8';

  let html = '<div class="billing-header"><h3>\ud83d\udcb3 Billing &amp; Plan</h3></div>';

  // Status cards
  html += '<div class="billing-cards">';

  // Plan card
  html += '<div class="billing-card highlight">';
  html += '<div class="billing-card-icon">\ud83d\udc8e</div>';
  html += '<div class="billing-card-label">Current Plan</div>';
  html += '<div class="billing-card-value">' + escapeHtml(b.plan) + '</div>';
  html += '<div class="billing-card-sub">' + escapeHtml(b.planLabel) + '</div>';
  html += '</div>';

  // Status card
  html += '<div class="billing-card ' + statusCard + '">';
  html += '<div class="billing-card-icon">' + statusIcon + '</div>';
  html += '<div class="billing-card-label">Status</div>';
  html += '<div class="billing-card-value">' + escapeHtml(b.status === 'GRACE' ? 'PAYMENT DUE' : b.status) + '</div>';
  if (isTrial) html += '<div class="billing-card-sub">Trial ends: ' + trialEndsStr + '</div>';
  else if (b.paidUntil) html += '<div class="billing-card-sub">Active until: ' + paidUntilStr + '</div>';
  html += '</div>';

  // Scans card (with inline analytics when available)
  html += '<div class="billing-card">';
  html += '<div class="billing-card-icon">\ud83d\udcca</div>';
  html += '<div class="billing-card-label">Today\u2019s Visitors</div>';
  html += '<div class="billing-card-value">' + (b.todayUnique || 0) + (isUnlimited ? '' : ' / ' + b.dailyUniqueLimit) + '</div>';
  html += '<div class="billing-card-sub">' + b.todayScans + ' total scan' + (b.todayScans !== 1 ? 's' : '') + '</div>';
  if (!isUnlimited) {
    html += '<div class="scan-bar"><div class="scan-bar-fill" style="width:' + uniquePercent + '%;background:' + barColor + ';"></div></div>';
  }
  // Inline sparkline (show available days based on plan)
  var sparkDays = (analyticsData && analyticsData.analyticsDays) || 1;
  if (analyticsData && analyticsData.daily && analyticsData.daily.length >= 2) {
    var spark = analyticsData.daily.slice(-Math.min(sparkDays, analyticsData.daily.length));
    var sparkMax = 1;
    for (var si = 0; si < spark.length; si++) {
      if (spark[si].scans > sparkMax) sparkMax = spark[si].scans;
    }
    html += '<div class="sparkline-row">';
    html += '<span class="sparkline-label">' + spark.length + '-day trend</span>';
    html += '<div class="sparkline-bars">';
    for (var si = 0; si < spark.length; si++) {
      var sh = spark[si].scans > 0 ? Math.max(4, Math.round((spark[si].scans / sparkMax) * 24)) : 0;
      html += '<div class="sparkline-bar" style="height:' + sh + 'px" title="' + spark[si].scans + ' scans"></div>';
    }
    html += '</div>';
    if (analyticsData.week) {
      html += '<span class="sparkline-stat">' + analyticsData.week.unique + ' unique this week</span>';
    }
    html += '</div>';
  }
  html += '</div>';

  html += '</div>'; // end billing-cards

  // Visitor limit nudge banners
  if (!isUnlimited && uniquePercent >= 80) {
    html += '<div class="scan-nudge">';
    html += '<div class="billing-alert-icon">\ud83d\udcc8</div>';
    html += '<div class="billing-alert-text"><p>You\u2019ve used ' + uniquePercent + '% of your daily unique visitors (' + (b.todayUnique || 0) + '/' + b.dailyUniqueLimit + ').</p>';
    html += '<p>Consider upgrading for more visitors.</p></div>';
    html += '</div>';
  }

  // Pending plan banner
  if (b.pendingPlan) {
    var pendingDate = b.pendingActivatesOn ? new Date(b.pendingActivatesOn).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'end of current period';
    html += '<div class="pending-plan-banner">';
    html += '<div class="pending-plan-info">';
    html += '<span>\ud83d\udd04 Switching to <strong>' + escapeHtml(b.pendingPlan) + '</strong> on ' + pendingDate + '</span>';
    html += b.pendingPlanPaid ? ' <span class="pending-paid-tag">Paid</span>' : ' <span class="pending-free-tag">Free switch</span>';
    html += '</div>';
    if (!b.pendingPlanPaid) {
      html += '<button class="btn btn-sm btn-secondary cancel-pending-btn">\u2716 Cancel</button>';
    }
    html += '</div>';
  }

  // Renewal / Upgrade alert
  if (isTrial || isExpired || isExpiring) {
    html += '<div class="billing-alert">';
    if (isTrial) {
      html += '<div class="billing-alert-icon">\u23f0</div>';
      html += '<div class="billing-alert-text"><p>Your trial ends on ' + trialEndsStr + '</p>';
      html += '<p>Choose a plan below to continue after your trial.</p></div>';
    } else if (isExpired) {
      html += '<div class="billing-alert-icon">\u26a0\ufe0f</div>';
      html += '<div class="billing-alert-text"><p>Your subscription has expired</p>';
      html += '<p>Renew now to keep your menu live.</p></div>';
    } else {
      html += '<div class="billing-alert-icon">\ud83d\udd14</div>';
      html += '<div class="billing-alert-text"><p>Your plan expires on ' + paidUntilStr + '</p>';
      html += '<p>Renew early to avoid interruption.</p></div>';
    }
    html += '</div>';
  }

  // Plan selection cards
  var PLAN_TIER = { STARTER: 1, STANDARD: 2, PRO: 3 };
  var isActive = b.status === 'ACTIVE' && b.paidUntil && new Date(b.paidUntil) > new Date();
  var hasPaidPending = b.pendingPlan && b.pendingPlanPaid;
  var daysLeft = b.paidUntil ? Math.ceil((new Date(b.paidUntil) - new Date()) / (24*60*60*1000)) : 0;

  html += '<div class="billing-section-title">' + (isTrial || isExpired ? 'Choose a Plan' : 'Renew or Change Plan') + '</div>';
  html += '<div class="plan-cards">';

  var plans = [
    { key: 'STARTER', name: 'Starter', price: '\u20b9499', desc: '150 unique visitors/day \u00b7 4 themes', badge: '' },
    { key: 'STANDARD', name: 'Standard', price: '\u20b9999', desc: '500 unique visitors/day \u00b7 8 themes', badge: 'value' },
    { key: 'PRO', name: 'Pro', price: '\u20b91,499', desc: 'Unlimited visitors \u00b7 All 15 themes \u00b7 No branding', badge: 'popular' }
  ];

  plans.forEach(function(p) {
    // During TRIAL/EXPIRED, no plan is "current" (they haven't paid for any)
    var isCurrent = (isTrial || isExpired) ? false : (p.key === b.plan);
    var proClass = p.key === 'PRO' ? ' plan-pro' : (p.key === 'STANDARD' ? ' plan-standard' : '');
    html += '<div class="plan-card' + (isCurrent ? ' current' : '') + proClass + '" data-plan="' + p.key + '">';
    if (isCurrent) {
      html += '<div class="plan-card-badge current-badge">Current Plan</div>';
    } else if (b.pendingPlan === p.key) {
      html += '<div class="plan-card-badge pending-badge">\ud83d\udd04 Scheduled</div>';
    } else if (p.badge === 'popular') {
      html += '<div class="plan-card-badge popular-badge">\u2b50 Most Popular</div>';
    } else if (p.badge === 'value') {
      html += '<div class="plan-card-badge value-badge">\ud83d\udcaa Best Value</div>';
    } else {
      html += '<div class="plan-card-badge spacer-badge">\u00a0</div>';
    }
    html += '<div class="plan-card-name">' + escapeHtml(p.name) + '</div>';
    html += '<div class="plan-card-price">' + p.price + '<span class="price-period">/mo</span></div>';
    html += '<div class="plan-card-desc">' + escapeHtml(p.desc) + '</div>';

    // Smart button labels
    if (isTrial || isExpired) {
      // Trial/Expired: all plans show "Buy Plan" (no renew, no downgrade concept)
      html += '<button class="btn btn-primary plan-pay-btn" data-plan="' + p.key + '">\ud83d\uded2 Buy Plan</button>';
    } else if (b.pendingPlan === p.key) {
      html += '<button class="btn btn-secondary plan-pay-btn" disabled>Scheduled</button>';
    } else if (hasPaidPending) {
      html += '<button class="btn btn-secondary plan-pay-btn" disabled>Change pending</button>';
    } else if (isCurrent) {
      if (isActive && daysLeft > 7) {
        html += '<button class="btn btn-secondary plan-pay-btn" disabled>Active \u2714 \u00b7 ' + daysLeft + 'd left</button>';
      } else {
        html += '<button class="btn btn-primary plan-pay-btn" data-plan="' + p.key + '">\ud83d\udd04 Renew</button>';
      }
    } else if (isActive && PLAN_TIER[p.key] < PLAN_TIER[b.plan]) {
      html += '<button class="btn btn-secondary plan-downgrade-btn" data-plan="' + p.key + '">\ud83d\udd04 Switch Plan</button>';
    } else {
      html += '<button class="btn btn-secondary plan-pay-btn" data-plan="' + p.key + '">\u2b06\ufe0f Upgrade</button>';
    }
    html += '</div>';
  });

  html += '</div>';

  // Payment history (only CAPTURED/REFUNDED returned by backend)
  if (b.payments && b.payments.length > 0) {
    html += '<div class="payment-history">';
    html += '<div class="billing-section-title">\ud83d\udcdc Payment History</div>';
    html += '<div class="payment-history-list">';
    // Column headers (visible on desktop)
    html += '<div class="payment-history-header">';
    html += '<span class="ph-amount">Amount</span>';
    html += '<span class="ph-plan">Plan</span>';
    html += '<span class="ph-status">Status</span>';
    html += '<span class="ph-method">Mode</span>';
    html += '<span class="ph-date">Period</span>';
    html += '</div>';
    b.payments.forEach(function(p) {
      var amount = '\u20b9' + (p.amount / 100);
      var date = p.paidAt ? new Date(p.paidAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : new Date(p.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      // Human-friendly status labels
      var statusLabels = { CAPTURED: 'Paid', REFUNDED: 'Refunded', FAILED: 'Failed', CREATED: 'Pending' };
      var statusText = statusLabels[p.status] || p.status;
      var statusClass = p.status.toLowerCase();
      // Period display
      var periodText = '';
      if (p.periodStart && p.periodEnd) {
        var ps = new Date(p.periodStart).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        var pe = new Date(p.periodEnd).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        periodText = ps + ' \u2013 ' + pe;
      } else {
        periodText = date;
      }
      // Method display
      var methodText = '\u2014';
      if (p.method) {
        var methodLabels = { cash: 'Cash', manual: 'Manual', upi: 'UPI', card: 'Card', netbanking: 'Net Banking', wallet: 'Wallet' };
        methodText = methodLabels[p.method.toLowerCase()] || p.method;
      }
      html += '<div class="payment-row">';
      html += '<span class="amount">' + amount + '</span>';
      html += '<span class="plan-tag">' + p.plan + '</span>';
      html += '<span class="status-tag ' + statusClass + '">' + escapeHtml(statusText) + '</span>';
      html += '<span class="method-text">' + escapeHtml(methodText) + '</span>';
      html += '<span class="date-text">' + periodText + '</span>';
      html += '</div>';
    });
    html += '</div>'; // end payment-history-list
    html += '</div>'; // end payment-history
  } else {
    html += '<div class="payment-history">';
    html += '<div class="billing-section-title">\ud83d\udcdc Payment History</div>';
    html += '<div style="text-align:center;padding:2rem 1rem;color:var(--slate-400);font-size:0.875rem;">No payments yet. Choose a plan above to get started.</div>';
    html += '</div>';
  }

  container.innerHTML = html;

  // Attach plan card click handlers (avoid inline onclick for CSP compliance)
  container.querySelectorAll('.plan-card[data-plan]').forEach(function(card) {
    card.addEventListener('click', function() {
      var plan = this.dataset.plan;
      if (this.querySelector('.plan-downgrade-btn')) {
        initiateDowngrade(plan);
      } else if (this.querySelector('.plan-pay-btn[data-plan]')) {
        initiatePayment(plan);
      }
    });
  });
  container.querySelectorAll('.plan-pay-btn[data-plan]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      initiatePayment(this.dataset.plan);
    });
  });
  container.querySelectorAll('.plan-downgrade-btn[data-plan]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      initiateDowngrade(this.dataset.plan);
    });
  });
  // Cancel pending plan
  var cancelBtn = container.querySelector('.cancel-pending-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async function() {
      if (!confirm('Cancel your pending downgrade?')) return;
      try {
        var res = await apiFetch('/me/pending-plan', { method: 'DELETE' });
        var data = await res.json();
        if (data.success) {
          showToast('Pending plan change cancelled.', 'success');
          loadDashboard();
          setTimeout(function() { switchTab('billing', document.getElementById('tabBilling')); }, 500);
        } else {
          showToast(data.error || 'Failed to cancel.', 'error');
        }
      } catch (e) {
        showToast('Error cancelling pending plan: ' + e.message, 'error');
      }
    });
  }
}

async function initiatePayment(plan) {
  try {
    showToast('Creating payment order...', 'info');
    const res = await apiFetch('/payments/create-order', {
      method: 'POST',
      body: JSON.stringify({ plan: plan })
    });
    const order = await res.json();

    if (!order.orderId || !order.keyId) {
      showToast(order.error || 'Payment system not available. Contact support.', 'error');
      return;
    }

    var options = {
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      name: 'KodSpot',
      description: order.planLabel,
      order_id: order.orderId,
      prefill: {
        name: order.hotelName || '',
        email: order.email || '',
        contact: order.phone || ''
      },
      theme: { color: '#c68b52' },
      handler: async function(response) {
        try {
          showToast('Verifying payment...', 'info');
          const verifyRes = await apiFetch('/payments/verify', {
            method: 'POST',
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature
            })
          });
          const result = await verifyRes.json();
          if (result.success) {
            showToast(result.scheduled ? 'Payment successful! Plan change scheduled for your next billing period.' : 'Payment successful! Your plan is now active.', 'success');
            loadDashboard();
            setTimeout(function() { switchTab('billing', document.getElementById('tabBilling')); }, 500);
          } else {
            showToast('Payment verification failed. Contact support.', 'error');
          }
        } catch (e) {
          showToast('Verification error. If charged, it will activate automatically.', 'error');
        }
      },
      modal: {
        ondismiss: function() {
          showToast('Payment cancelled', 'info');
        }
      }
    };

    var rzp = new Razorpay(options);
    rzp.on('payment.failed', function(resp) {
      showToast('Payment failed: ' + (resp.error?.description || 'Unknown error'), 'error');
    });
    rzp.open();
  } catch (e) {
    showToast('Failed to create order: ' + e.message, 'error');
  }
}

async function initiateDowngrade(plan) {
  var planNames = { STARTER: 'Starter (\u20b9299/mo)', STANDARD: 'Standard (\u20b9499/mo)', PRO: 'Pro (\u20b9999/mo)' };
  // Show styled modal instead of browser confirm()
  var overlay = document.getElementById('switchPlanModalOverlay');
  document.getElementById('switchPlanName').textContent = planNames[plan] || plan;
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');

  // Wire up modal buttons (clean up old listeners via cloneNode)
  var confirmBtn = document.getElementById('switchPlanModalConfirm');
  var cancelBtn = document.getElementById('switchPlanModalCancel');
  var closeBtn = document.getElementById('switchPlanModalClose');
  var newConfirm = confirmBtn.cloneNode(true);
  var newCancel = cancelBtn.cloneNode(true);
  var newClose = closeBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
  cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
  closeBtn.parentNode.replaceChild(newClose, closeBtn);

  function closeModal() {
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
  }
  newCancel.addEventListener('click', closeModal);
  newClose.addEventListener('click', closeModal);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });

  newConfirm.addEventListener('click', async function() {
    newConfirm.disabled = true;
    newConfirm.textContent = 'Switching...';
    try {
      var res = await apiFetch('/me/downgrade', {
        method: 'POST',
        body: JSON.stringify({ plan: plan })
      });
      var data = await res.json();
      closeModal();
      if (data.success) {
        showToast(data.message, 'success');
        loadDashboard();
        setTimeout(function() { switchTab('billing', document.getElementById('tabBilling')); }, 500);
      } else {
        showToast(data.error || 'Switch failed.', 'error');
      }
    } catch (e) {
      closeModal();
      showToast('Switch error: ' + e.message, 'error');
    }
  });
}

// ==================== FORGOT PIN FUNCTIONS ====================

function getFingerprint() {
  try {
    return JSON.stringify({
      screen: `${screen.width}x${screen.height}`,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      lang: navigator.language,
      platform: navigator.platform
    });
  } catch { return ''; }
}

function showForgotStep(step) {
  ['loginFields', 'forgotStep1', 'forgotStep2', 'forgotStep3', 'forgotSuccess'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  var target = document.getElementById(step);
  if (target) target.classList.remove('hidden');
}

function backToLogin() {
  if (forgotPinState.otpTimer) {
    clearInterval(forgotPinState.otpTimer);
    forgotPinState.otpTimer = null;
  }
  forgotPinState = { code: '', resetToken: '', otpTimer: null, otpExpiresAt: null };
  showForgotStep('loginFields');
  // Clear all forgot pin inputs and errors
  ['forgotCode', 'forgotEmail', 'forgotOtp', 'newPin', 'confirmPin'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['forgotStep1Error', 'forgotStep2Error', 'forgotStep3Error'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.textContent = '';
  });
  var countdown = document.getElementById('otpCountdown');
  if (countdown) { countdown.textContent = '10:00'; countdown.style.color = ''; }
}

function startOtpTimer() {
  forgotPinState.otpExpiresAt = Date.now() + 10 * 60 * 1000;
  var countdownEl = document.getElementById('otpCountdown');
  if (!countdownEl) return;

  if (forgotPinState.otpTimer) clearInterval(forgotPinState.otpTimer);
  countdownEl.style.color = '';

  forgotPinState.otpTimer = setInterval(function() {
    var remaining = Math.max(0, forgotPinState.otpExpiresAt - Date.now());
    var mins = Math.floor(remaining / 60000);
    var secs = Math.floor((remaining % 60000) / 1000);
    countdownEl.textContent = mins + ':' + String(secs).padStart(2, '0');

    if (remaining <= 0) {
      clearInterval(forgotPinState.otpTimer);
      forgotPinState.otpTimer = null;
      countdownEl.textContent = 'Expired';
      countdownEl.style.color = 'var(--red-500)';
    }
  }, 1000);
}

async function forgotPinRequest() {
  var code = document.getElementById('forgotCode').value.trim().toUpperCase();
  var email = document.getElementById('forgotEmail').value.trim();
  var errorEl = document.getElementById('forgotStep1Error');
  var btn = document.getElementById('forgotStep1Btn');

  errorEl.textContent = '';

  if (!code || !/^[A-Z2-7]{6}$/.test(code)) {
    errorEl.textContent = 'Enter a valid 6-character menu code (A-Z, 2-7)';
    return;
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorEl.textContent = 'Enter a valid email address';
    return;
  }

  var originalText = btn.innerHTML;
  btn.innerHTML = 'Sending...';
  btn.disabled = true;

  try {
    var res = await fetch(API + '/auth/forgot-pin/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, email: email, fingerprint: getFingerprint() })
    });

    var data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || 'Request failed. Please try again.';
      return;
    }

    forgotPinState.code = code;
    showForgotStep('forgotStep2');
    startOtpTimer();
    showToast('If your details match, a reset code has been sent to your email.');
  } catch (e) {
    errorEl.textContent = 'Network error. Please check your connection and try again.';
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

async function forgotPinVerify() {
  var otp = document.getElementById('forgotOtp').value.trim();
  var errorEl = document.getElementById('forgotStep2Error');
  var btn = document.getElementById('forgotStep2Btn');

  errorEl.textContent = '';

  if (!otp || !/^\d{6}$/.test(otp)) {
    errorEl.textContent = 'Enter the 6-digit code from your email';
    return;
  }

  var originalText = btn.innerHTML;
  btn.innerHTML = 'Verifying...';
  btn.disabled = true;

  try {
    var res = await fetch(API + '/auth/forgot-pin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: forgotPinState.code, otp: otp, fingerprint: getFingerprint() })
    });

    var data = await res.json();

    if (!res.ok) {
      var msg = data.error || 'Verification failed';
      if (data.remainingAttempts !== undefined && data.remainingAttempts >= 0) {
        msg += ' (' + data.remainingAttempts + ' attempt' + (data.remainingAttempts !== 1 ? 's' : '') + ' remaining)';
      }
      errorEl.textContent = msg;
      return;
    }

    forgotPinState.resetToken = data.resetToken;
    if (forgotPinState.otpTimer) {
      clearInterval(forgotPinState.otpTimer);
      forgotPinState.otpTimer = null;
    }
    showForgotStep('forgotStep3');
    showToast('Code verified! Set your new PIN.');
  } catch (e) {
    errorEl.textContent = 'Network error. Please check your connection and try again.';
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

async function forgotPinReset() {
  var newPin = document.getElementById('newPin').value.trim();
  var confirmPin = document.getElementById('confirmPin').value.trim();
  var errorEl = document.getElementById('forgotStep3Error');
  var btn = document.getElementById('forgotStep3Btn');

  errorEl.textContent = '';

  if (!newPin || !/^\d{8}$/.test(newPin)) {
    errorEl.textContent = 'PIN must be exactly 8 digits';
    return;
  }

  if (newPin !== confirmPin) {
    errorEl.textContent = 'PINs do not match';
    return;
  }

  // Reject weak PINs client-side (mirrors server-side isWeakPin)
  if (isWeakPinClient(newPin)) {
    errorEl.textContent = 'PIN is too simple. Choose a stronger PIN.';
    return;
  }

  var originalText = btn.innerHTML;
  btn.innerHTML = 'Resetting...';
  btn.disabled = true;

  try {
    var res = await fetch(API + '/auth/forgot-pin/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: forgotPinState.code,
        resetToken: forgotPinState.resetToken,
        newPin: newPin,
        fingerprint: getFingerprint()
      })
    });

    var data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || 'Reset failed. Please start over.';
      return;
    }

    forgotPinState = { code: '', resetToken: '', otpTimer: null, otpExpiresAt: null };
    showForgotStep('forgotSuccess');
    showToast('PIN reset successful!');
  } catch (e) {
    errorEl.textContent = 'Network error. Please check your connection and try again.';
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

// ==================== FORGOT PIN EVENT LISTENERS ====================
var forgotPinLink = document.getElementById('forgotPinLink');
if (forgotPinLink) forgotPinLink.addEventListener('click', function(e) { e.preventDefault(); showForgotStep('forgotStep1'); });

var backToLogin1 = document.getElementById('backToLogin1');
if (backToLogin1) backToLogin1.addEventListener('click', function(e) { e.preventDefault(); backToLogin(); });

var backToLogin2 = document.getElementById('backToLogin2');
if (backToLogin2) backToLogin2.addEventListener('click', function(e) { e.preventDefault(); backToLogin(); });

var backToLogin3 = document.getElementById('backToLogin3');
if (backToLogin3) backToLogin3.addEventListener('click', function(e) { e.preventDefault(); backToLogin(); });

var forgotStep1Btn = document.getElementById('forgotStep1Btn');
if (forgotStep1Btn) forgotStep1Btn.addEventListener('click', forgotPinRequest);

var forgotStep2Btn = document.getElementById('forgotStep2Btn');
if (forgotStep2Btn) forgotStep2Btn.addEventListener('click', forgotPinVerify);

var forgotStep3Btn = document.getElementById('forgotStep3Btn');
if (forgotStep3Btn) forgotStep3Btn.addEventListener('click', forgotPinReset);

var forgotSuccessBtn = document.getElementById('forgotSuccessBtn');
if (forgotSuccessBtn) forgotSuccessBtn.addEventListener('click', backToLogin);

// Enter key support for forgot pin inputs
var forgotEmailInput = document.getElementById('forgotEmail');
if (forgotEmailInput) forgotEmailInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') forgotPinRequest(); });

var forgotCodeInput = document.getElementById('forgotCode');
if (forgotCodeInput) forgotCodeInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') forgotPinRequest(); });

var forgotOtpInput = document.getElementById('forgotOtp');
if (forgotOtpInput) forgotOtpInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') forgotPinVerify(); });

var confirmPinInput = document.getElementById('confirmPin');
if (confirmPinInput) confirmPinInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') forgotPinReset(); });

var newPinInput = document.getElementById('newPin');
if (newPinInput) newPinInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') {
  var cp = document.getElementById('confirmPin');
  if (cp) cp.focus();
}});

// ==================== LOGO UPLOAD ====================

function renderLogoPreview() {
  const placeholder = document.getElementById('logoPlaceholder');
  const img = document.getElementById('logoPreviewImg');
  const removeBtn = document.getElementById('btnRemoveLogo');
  if (!placeholder || !img || !removeBtn) return;

  if (hotel && hotel.logoUrl) {
    placeholder.style.display = 'none';
    img.style.display = 'block';
    img.src = hotel.logoUrl;
    removeBtn.style.display = 'inline-flex';
  } else {
    placeholder.style.display = 'flex';
    img.style.display = 'none';
    img.src = '';
    removeBtn.style.display = 'none';
  }
}

document.getElementById('logoFileInput').addEventListener('change', async function() {
  const file = this.files && this.files[0];
  if (!file) return;
  this.value = '';

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    showToast('Only JPEG, PNG, or WebP images allowed', 'error');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    showToast('Logo must be under 2 MB', 'error');
    return;
  }

  try {
    const fd = new FormData();
    fd.append('image', file);
    showToast('Uploading logo...');
    await apiFetch('/me/logo', { method: 'POST', body: fd });
    // Refresh hotel data
    const res = await apiFetch('/me');
    hotel = await res.json();
    renderLogoPreview();
    showToast('Logo uploaded!');
  } catch (e) {
    showToast(e.message || 'Logo upload failed', 'error');
  }
});

async function removeLogo() {
  if (!hotel || !hotel.logoUrl) return;
  const ok = await openConfirmModal({ title: 'Remove Logo', message: 'Remove restaurant logo? This cannot be undone.', confirmText: 'Remove' });
  if (!ok) return;

  try {
    await apiFetch('/me/logo', { method: 'DELETE' });
    hotel.logoUrl = null;
    renderLogoPreview();
    showToast('Logo removed');
  } catch (e) {
    showToast(e.message || 'Failed to remove logo', 'error');
  }
}

// ==================== QR CODE GENERATION & DOWNLOAD ====================
let qrSvgCache = null; // Cache SVG to avoid re-fetching

async function loadQrCode() {
  if (!hotel || !hotel.slug) return;

  // Render logo preview in QR tab
  renderLogoPreview();

  const preview = document.getElementById('qrPreview');
  const codeText = document.getElementById('qrCodeText');
  const menuLink = document.getElementById('qrMenuLink');
  const menuUrl = `${window.location.origin}/m/${hotel.slug}`;

  // Update menu code and URL
  codeText.textContent = hotel.slug;
  menuLink.href = menuUrl;
  menuLink.textContent = menuUrl;

  // Show loading state
  preview.innerHTML = '<div class="qr-loading"><div class="qr-loading-spinner"></div><span>Generating QR code...</span></div>';

  // Hide share button if Web Share API not supported
  const shareBtn = document.getElementById('btnShare');
  if (shareBtn && !(navigator.share && navigator.canShare)) {
    shareBtn.style.display = 'none';
  }

  try {
    const res = await apiFetch(`/api/qr/${hotel.slug}`);
    const svgText = await res.text();
    qrSvgCache = svgText;

    // Render SVG preview
    preview.innerHTML = svgText;

    // Scale SVG to fit the preview container
    const svgEl = preview.querySelector('svg');
    if (svgEl) {
      svgEl.removeAttribute('width');
      svgEl.removeAttribute('height');
      svgEl.style.width = '100%';
      svgEl.style.maxWidth = '220px';
      svgEl.style.height = 'auto';
    }
  } catch (e) {
    preview.innerHTML = '<div class="qr-loading"><span style="color:var(--red-500);">Failed to load QR code. Please try again.</span></div>';
    console.error('QR load error:', e);
  }
}

function copyMenuCode() {
  if (!hotel || !hotel.slug) return;
  const menuUrl = `${window.location.origin}/m/${hotel.slug}`;
  navigator.clipboard.writeText(menuUrl).then(() => {
    showToast('Menu link copied to clipboard!');
  }).catch(() => {
    // Fallback: copy just the code
    navigator.clipboard.writeText(hotel.slug).then(() => {
      showToast('Menu code copied!');
    }).catch(() => {
      showToast('Could not copy to clipboard', 'error');
    });
  });
}

// ── QR Card generation — delegates to shared qr-card.js module ──────────
function getQrCardConfig() {
  if (!hotel || !qrSvgCache) return null;
  var cfg = {
    name: hotel.name,
    city: hotel.city,
    slug: hotel.slug,
    logoUrl: hotel.logoUrl,
    hotelId: hotel.id,
    qrSvg: qrSvgCache,
    plan: (billingData && billingData.plan) || hotel.plan || 'STARTER'
  };
  if (hotel.reviewUrl && reviewQrSvgCache) {
    cfg.reviewUrl = hotel.reviewUrl;
    cfg.reviewQrSvg = reviewQrSvgCache;
  }
  return cfg;
}

async function downloadQrPng() {
  if (!hotel) return;
  var cfg = getQrCardConfig();
  if (!cfg) { showToast('QR code not loaded yet. Please wait.', 'error'); return; }
  showToast('Generating high-res QR card (600 DPI)...');
  try {
    var blob = await KodSpotQR.generateFront(cfg);
    if (!blob) return;
    KodSpotQR.downloadBlob(blob, KodSpotQR.safeName(hotel.name) + '_QR_Front.png');
    showToast('Front side downloaded! 600 DPI — ready for print shop.');
  } catch (e) {
    console.error('PNG download error:', e);
    showToast('Failed to generate PNG. Please try again.', 'error');
  }
}

async function downloadQrBackPng() {
  if (!hotel) return;
  var cfg = getQrCardConfig();
  if (!cfg) { showToast('QR code not loaded yet. Please wait.', 'error'); return; }
  showToast('Generating back side...');
  try {
    var blob = await KodSpotQR.generateBack(cfg);
    if (!blob) return;
    KodSpotQR.downloadBlob(blob, KodSpotQR.safeName(hotel.name) + '_QR_Back.png');
    showToast('Back side downloaded!');
  } catch (e) {
    console.error('PNG download error:', e);
    showToast('Failed to generate PNG. Please try again.', 'error');
  }
}

async function downloadQrPrintReady() {
  if (!hotel) return;
  var cfg = getQrCardConfig();
  if (!cfg) { showToast('QR code not loaded yet. Please wait.', 'error'); return; }
  showToast('Generating print-ready file (both sides)...');
  try {
    var blob = await KodSpotQR.generatePrintReady(cfg);
    if (!blob) return;
    KodSpotQR.downloadBlob(blob, KodSpotQR.safeName(hotel.name) + '_QR_PrintReady.png');
    showToast('Print-ready file downloaded! Take this to your print shop.');
  } catch (e) {
    console.error('Print-ready download error:', e);
    showToast('Failed to generate. Please try again.', 'error');
  }
}

async function downloadQrSvg() {
  if (!hotel || !qrSvgCache) {
    showToast('QR code not loaded yet. Please switch to QR tab first.', 'error');
    return;
  }
  var sn = KodSpotQR.safeName(hotel.name);
  var blob = new Blob([qrSvgCache], { type: 'image/svg+xml' });
  KodSpotQR.downloadBlob(blob, sn + '_QR_Menu.svg');
  showToast('SVG downloaded! Best for printing stickers & standees.');
}

async function shareQr() {
  if (!hotel) return;
  try {
    var cfg = getQrCardConfig();
    if (!cfg) { showToast('QR code not loaded yet.', 'error'); return; }
    var blob = await KodSpotQR.generateFront(cfg);
    if (!blob) return;
    var sn = KodSpotQR.safeName(hotel.name);
    var file = new File([blob], sn + '_QR_Menu.png', { type: 'image/png' });
    var menuUrl = window.location.origin + '/m/' + hotel.slug;

    if (navigator.share && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: hotel.name + ' - Digital Menu',
        text: 'Scan QR code or visit: ' + menuUrl,
        files: [file]
      });
      showToast('Shared successfully!');
    } else if (navigator.share) {
      await navigator.share({
        title: hotel.name + ' - Digital Menu',
        text: 'View our menu: ' + menuUrl,
        url: menuUrl
      });
      showToast('Link shared!');
    } else {
      downloadQrPng();
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error('Share error:', e);
      showToast('Sharing failed. Try downloading instead.', 'error');
    }
  }
}

// ==================== REVIEW URL MANAGEMENT ====================
var reviewQrSvgCache = null;

function initReviewUrlUI() {
  if (!hotel) return;
  var input = document.getElementById('reviewUrlInput');
  var clearBtn = document.getElementById('clearReviewUrlBtn');
  var status = document.getElementById('reviewUrlStatus');
  if (!input) return;

  if (hotel.reviewUrl) {
    input.value = hotel.reviewUrl;
    clearBtn.style.display = '';
    status.className = 'review-url-status success';
    status.textContent = '✓ Review link active — back side will show review QR';
    // Pre-fetch review QR SVG
    fetchReviewQrSvg();
  } else {
    input.value = '';
    clearBtn.style.display = 'none';
    status.className = 'review-url-status';
    status.textContent = '';
    reviewQrSvgCache = null;
  }
}

async function fetchReviewQrSvg() {
  if (!hotel || !hotel.reviewUrl) { reviewQrSvgCache = null; return; }
  try {
    var resp = await fetch('/api/qr/review/' + hotel.id, { credentials: 'include' });
    if (resp.ok) {
      reviewQrSvgCache = await resp.text();
    } else {
      reviewQrSvgCache = null;
    }
  } catch (e) {
    reviewQrSvgCache = null;
  }
}

async function saveReviewUrl() {
  var input = document.getElementById('reviewUrlInput');
  var status = document.getElementById('reviewUrlStatus');
  var url = (input.value || '').trim();

  if (!url) {
    status.className = 'review-url-status error';
    status.textContent = 'Please enter a review link';
    return;
  }

  // Basic URL validation
  try { new URL(url); } catch (e) {
    status.className = 'review-url-status error';
    status.textContent = 'Invalid URL. Must start with https://';
    return;
  }

  try {
    status.className = 'review-url-status';
    status.textContent = 'Saving...';
    var data = await fetchAPI('/settings/review-url', {
      method: 'PATCH',
      body: JSON.stringify({ reviewUrl: url })
    });
    hotel.reviewUrl = data.reviewUrl || url;
    document.getElementById('clearReviewUrlBtn').style.display = '';
    status.className = 'review-url-status success';
    status.textContent = '✓ Review link saved — back side will now show review QR';
    showToast('Review link saved!');
    // Fetch the review QR SVG for card generation
    await fetchReviewQrSvg();
  } catch (e) {
    status.className = 'review-url-status error';
    status.textContent = e.message || 'Failed to save';
  }
}

async function clearReviewUrl() {
  var status = document.getElementById('reviewUrlStatus');
  try {
    status.className = 'review-url-status';
    status.textContent = 'Removing...';
    await fetchAPI('/settings/review-url', {
      method: 'PATCH',
      body: JSON.stringify({ reviewUrl: '' })
    });
    hotel.reviewUrl = null;
    document.getElementById('reviewUrlInput').value = '';
    document.getElementById('clearReviewUrlBtn').style.display = 'none';
    reviewQrSvgCache = null;
    status.className = 'review-url-status';
    status.textContent = '';
    showToast('Review link removed. Back side will now show menu QR.');
  } catch (e) {
    status.className = 'review-url-status error';
    status.textContent = e.message || 'Failed to remove';
  }
}