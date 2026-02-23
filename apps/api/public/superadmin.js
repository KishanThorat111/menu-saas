const API = '';
// Load DOMPurify
// For production, use import or CDN
let DOMPurify;
if (window.DOMPurify) {
  DOMPurify = window.DOMPurify;
}
const ITEMS_PER_PAGE = 10;

// State management
let currentPage = 1;
let currentEditId = null;
let currentResetPinId = null; // NEW: Track which hotel is being reset
let currentDeleteId = null; // Track which hotel is being deleted
let searchDebounceTimer = null;
let isLoggingIn = false;
let currentSearchQuery = '';
let currentStatusFilter = '';

// Global stats cache
let globalStats = {
  total: 0,
  trial: 0,
  active: 0,
  views: 0
};

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  const now = new Date();
  const isOverdue = date < now;
  const formatted = date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  return { formatted, isOverdue, date };
}

// NEW: Format relative time (e.g., "2 days ago")
function formatRelativeTime(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  
  if (diffDays > 30) return `${Math.floor(diffDays / 30)} months ago`;
  if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffMinutes > 0) return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
  return 'Just now';
}

function showToast(message, type = 'success', duration = 3000) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  toast.innerHTML = `<span style="font-size:18px;">${icon}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function setLoading(elementId, isLoading, originalText = null) {
  const el = document.getElementById(elementId);
  if (isLoading) {
    el.dataset.originalText = el.innerHTML;
    el.innerHTML = '<span class="spinner"></span> Processing...';
    el.disabled = true;
  } else {
    el.innerHTML = originalText || el.dataset.originalText;
    el.disabled = false;
  }
}

function showPageLoading(show) {
  document.getElementById('loadingOverlay').classList.toggle('active', show);
}

// Cookie-based API fetch
async function fetchAPI(endpoint, options = {}) {
  if (!options.credentials) options.credentials = 'include';
  if (!options.headers) options.headers = {};
  options.headers['X-Requested-With'] = 'XMLHttpRequest';
  
  if (options.body && !(options.body instanceof FormData) && typeof options.body === 'string') {
    options.headers['Content-Type'] = 'application/json';
  }
  
  try {
    const res = await fetch(`${API}${endpoint}`, options);
    
    if (res.status === 401) {
      showToast('Session expired. Please login again.', 'error');
      logout();
      throw new Error('401');
    }
    if (res.status === 403) {
      showToast('Access denied. Admin key may have rotated.', 'error');
      logout();
      throw new Error('403');
    }
    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      showToast(data.message || 'Too many requests. Please slow down.', 'error', 5000);
      throw new Error('429');
    }
    
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.message || `HTTP ${res.status}: Request failed`);
    }
    return data;
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network error. Check your connection.');
    }
    throw error;
  }
}

async function login() {
  if (isLoggingIn) return;
  isLoggingIn = true;
  
  const key = document.getElementById('adminKey').value.trim();
  const errorEl = document.getElementById('authError');
  
  if (!key) {
    errorEl.textContent = 'Please enter admin key';
    isLoggingIn = false;
    return;
  }
  
  setLoading('loginBtn', true);
  errorEl.textContent = '';
  
  try {
    await fetchAPI('/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ adminKey: key })
    });
    
    document.getElementById('adminKey').value = '';
    showToast('Welcome back, Super Admin!');
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('dashboardScreen').classList.remove('hidden');
    
    // Reset state on login
    currentPage = 1;
    currentSearchQuery = '';
    currentStatusFilter = '';
    document.getElementById('searchInput').value = '';
    document.getElementById('filterStatus').value = '';
    
    await fetchHotels();
    await fetchGlobalStats();
    await updateSessionInfo();
  } catch (e) {
    errorEl.textContent = e.message;
  } finally {
    setLoading('loginBtn', false, 'Access Dashboard');
    isLoggingIn = false;
  }
}

async function checkSession() {
  try {
    const data = await fetchAPI('/auth/admin/me');
    showToast(`Session valid until ${new Date(data.session.expiresAt).toLocaleString()}`);
  } catch (e) {
    // Error handled by fetchAPI
  }
}

async function updateSessionInfo() {
  try {
    const data = await fetchAPI('/auth/admin/me');
    const expires = new Date(data.session.expiresAt);
    const hoursLeft = Math.floor((expires - new Date()) / (1000 * 60 * 60));
    document.getElementById('sessionDetails').innerHTML = 
      `Session expires in <strong>${hoursLeft} hours</strong> (${expires.toLocaleString()})`;
  } catch (e) {
    document.getElementById('sessionDetails').textContent = 'Session details unavailable';
  }
}

async function logout() {
  document.getElementById('dashboardScreen').classList.add('hidden');
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('adminKey').value = '';
  
  try {
    await fetch(`${API}/auth/admin/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
  } catch (e) {
    console.log('Session already cleared');
  }
  
  currentPage = 1;
  currentSearchQuery = '';
  currentStatusFilter = '';
  showToast('Logged out successfully');
}

async function fetchGlobalStats() {
  try {
    const response = await fetchAPI('/admin/hotels?limit=1000');
    const allHotels = response.hotels || [];
    const nonDeleted = allHotels.filter(h => h.status !== 'DELETED');
    
    globalStats = {
      total: nonDeleted.length,
      trial: nonDeleted.filter(h => h.status === 'TRIAL').length,
      active: nonDeleted.filter(h => h.status === 'ACTIVE').length,
      views: nonDeleted.reduce((sum, h) => sum + (h.views || 0), 0)
    };
    
    updateStatsDisplay();
  } catch (e) {
    console.error('Failed to fetch global stats:', e);
  }
}

function updateStatsDisplay() {
  document.getElementById('statTotal').textContent = globalStats.total;
  document.getElementById('statTrial').textContent = globalStats.trial;
  document.getElementById('statActive').textContent = globalStats.active;
  document.getElementById('statViews').textContent = globalStats.views.toLocaleString('en-IN');
}

async function fetchHotels() {
  showPageLoading(true);
  try {
    let url = `/admin/hotels?page=${currentPage}&limit=${ITEMS_PER_PAGE}`;
    if (currentSearchQuery) {
      url += `&search=${encodeURIComponent(currentSearchQuery)}`;
    }
    if (currentStatusFilter) {
      url += `&status=${encodeURIComponent(currentStatusFilter)}`;
    }
    
    const response = await fetchAPI(url);
    const hotels = response.hotels || [];
    const total = response.total || 0;
    const totalPages = response.totalPages || Math.ceil(total / ITEMS_PER_PAGE);
    
    renderTable(hotels);
    renderPagination(totalPages, total);
  } catch (e) {
    console.error('fetchHotels error:', e);
    showToast('Failed to load hotels', 'error');
    renderTable([]);
    renderPagination(0, 0);
  } finally {
    showPageLoading(false);
  }
}

// UPDATED: Render table with Reset PIN button and pinResetCount badge
function renderTable(hotels) {
  const tbody = document.getElementById('hotelsBody');
  
  if (hotels.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state">
          <div class="empty-state-icon">🏨</div>
          <p>No hotels found</p>
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = hotels.map(hotel => {
    const trialInfo = hotel.trialEnds ? formatDate(hotel.trialEnds) : null;
    const paidInfo = hotel.paidUntil ? formatDate(hotel.paidUntil) : null;
    const lastResetText = formatRelativeTime(hotel.lastPinResetAt);
    const isDeleted = hotel.status === 'DELETED';
    
    let dateDisplay = '';
    if (isDeleted && hotel.deletedAt) {
      const deletedDate = formatDate(hotel.deletedAt);
      const purgeDate = hotel.purgeAfter ? formatDate(hotel.purgeAfter) : null;
      dateDisplay = `<div class="date-info">
        Deleted: ${deletedDate.formatted}
      </div>`;
      if (purgeDate) {
        dateDisplay += `<div class="date-info ${purgeDate.isOverdue ? 'overdue' : ''}">
          Purge after: ${purgeDate.formatted}
        </div>`;
      }
    } else if (hotel.status === 'TRIAL' && trialInfo) {
      dateDisplay = `<div class="date-info ${trialInfo.isOverdue ? 'overdue' : ''}">
        Trial ends: ${trialInfo.formatted}
      </div>`;
    } else if (['ACTIVE', 'GRACE'].includes(hotel.status) && paidInfo) {
      dateDisplay = `<div class="date-info ${paidInfo.isOverdue ? 'overdue' : ''}">
        Paid until: ${paidInfo.formatted}
      </div>`;
    }
    
    // NEW: PIN reset count badge
    const resetBadge = hotel.pinResetCount > 0 
      ? `<span class="reset-count-badge" title="Last reset: ${lastResetText || 'Unknown'}">
          🔑 ${hotel.pinResetCount} reset${hotel.pinResetCount > 1 ? 's' : ''}
         </span>`
      : '<span class="reset-count-badge zero">🔑 0 resets</span>';

    // Action buttons: different for DELETED hotels
    let actionButtons = '';
    if (isDeleted) {
      actionButtons = `
        <button class="btn btn-sm btn-danger purge-hotel-btn"
          data-id="${hotel.id}"
          data-name="${escapeHtml(hotel.name)}"
          title="Permanently remove all data and images">
          🗑️ Purge Now
        </button>`;
    } else {
      actionButtons = `
        <button class="btn btn-sm btn-info edit-hotel-details-btn"
          data-id="${hotel.id}"
          data-name="${escapeHtml(hotel.name)}"
          data-city="${escapeHtml(hotel.city)}"
          data-phone="${escapeHtml(hotel.phone)}"
          data-email="${escapeHtml(hotel.email)}"
          data-plan="${escapeHtml(hotel.plan)}"
          data-slug="${escapeHtml(hotel.slug)}"
          title="Edit hotel details">
          📝 Edit Details
        </button>
        <button class="btn btn-sm btn-secondary edit-hotel-btn"
          data-id="${hotel.id}" 
          data-name="${escapeHtml(hotel.name)}" 
          data-status="${hotel.status}">
          ✏️ Edit Status
        </button>
        <button class="btn btn-sm btn-warning reset-pin-btn"
          data-id="${hotel.id}"
          data-name="${escapeHtml(hotel.name)}"
          title="Reset PIN - Current PIN will be invalidated">
          🔑 Reset PIN
        </button>
        <button class="btn btn-sm btn-danger delete-hotel-btn"
          data-id="${hotel.id}"
          data-name="${escapeHtml(hotel.name)}"
          title="Soft delete - Anonymize PII, disable access">
          ⛔ Delete
        </button>`;
    }
    
    return `
      <tr${isDeleted ? ' style="opacity:0.6;"' : ''}>
        <td data-label="Hotel">
          <div class="hotel-info">
            <span class="hotel-name">${escapeHtml(hotel.name)}</span>
            <span class="hotel-meta">${escapeHtml(hotel.city)} • ${escapeHtml(hotel.phone || 'No phone')}</span>
            <code class="hotel-slug">${escapeHtml(hotel.slug)}</code>
            ${!isDeleted ? `<div class="hotel-links">
              <a href="/admin" target="_blank">Admin</a>
              <a href="/m/${escapeHtml(hotel.slug)}" target="_blank">Menu</a>
            </div>` : ''}
          </div>
        </td>
        <td data-label="Plan"><span class="plan-badge">${hotel.plan}</span></td>
        <td data-label="Status"><span class="badge status-${hotel.status}">${hotel.status}</span></td>
        <td data-label="Timeline">${dateDisplay || '-'}</td>
        <td data-label="Views">${(hotel.views || 0).toLocaleString('en-IN')}</td>
        <td data-label="PIN Resets">${resetBadge}</td>
        <td data-label="Actions">
          <div class="action-buttons">
            ${actionButtons}
          </div>
        </td>
      </tr>
    `;
  }).join('');
  
  // Attach event listeners to dynamically created buttons
  tbody.querySelectorAll('.edit-hotel-details-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      openEditDetailsModal({
        id: this.dataset.id,
        name: this.dataset.name,
        city: this.dataset.city,
        phone: this.dataset.phone,
        email: this.dataset.email,
        plan: this.dataset.plan,
        slug: this.dataset.slug
      });
    });
  });
  tbody.querySelectorAll('.edit-hotel-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const id = this.dataset.id;
      const name = this.dataset.name;
      const status = this.dataset.status;
      openEditModal(id, name, status);
    });
  });
  // ============ EDIT DETAILS MODAL LOGIC ============
  let currentEditDetailsId = null;
  async function openEditDetailsModal(hotel) {
    currentEditDetailsId = hotel.id;
    // Fetch latest hotel details from backend
    let latestHotel = hotel;
    try {
      latestHotel = await fetchAPI(`/admin/hotels/${hotel.id}`);
    } catch (e) {
      showToast('Failed to fetch latest hotel details', 'error');
    }
    document.getElementById('editDetailsName').value = latestHotel.name || '';
    document.getElementById('editDetailsCity').value = latestHotel.city || '';
    document.getElementById('editDetailsPhone').value = latestHotel.phone || '';
    // Fix: treat null/undefined/empty email as blank
    document.getElementById('editDetailsEmail').value = latestHotel.email ? latestHotel.email : '';
    // Only allow STARTER, STANDARD, PRO
    const allowedPlans = ['STARTER', 'STANDARD', 'PRO'];
    const planSelect = document.getElementById('editDetailsPlan');
    Array.from(planSelect.options).forEach(opt => {
      if (!allowedPlans.includes(opt.value)) opt.remove();
    });
    planSelect.value = allowedPlans.includes(latestHotel.plan) ? latestHotel.plan : 'STARTER';
    if (typeof initCustomSelect === 'function') initCustomSelect(planSelect);
    document.getElementById('editDetailsCode').value = latestHotel.slug || '';
    document.getElementById('editDetailsModal').classList.add('active');
  }
  function closeEditDetailsModal() {
    document.getElementById('editDetailsModal').classList.remove('active');
    currentEditDetailsId = null;
  }
  document.getElementById('closeEditDetailsModalBtn').addEventListener('click', closeEditDetailsModal);
  document.getElementById('cancelEditDetailsBtn').addEventListener('click', closeEditDetailsModal);
  document.getElementById('saveEditDetailsBtn').addEventListener('click', saveEditDetails);

  async function saveEditDetails() {
    if (!currentEditDetailsId) return;
    const emailVal = document.getElementById('editDetailsEmail').value.trim();
    const payload = {
      name: document.getElementById('editDetailsName').value.trim(),
      city: document.getElementById('editDetailsCity').value.trim(),
      phone: document.getElementById('editDetailsPhone').value.trim(),
      email: emailVal === '' ? '' : emailVal,
      plan: document.getElementById('editDetailsPlan').value
    };
    if (!payload.name || !payload.city || !payload.phone) {
      showToast('Name, city, and phone are required', 'error');
      return;
    }
    setLoading('saveEditDetailsBtn', true);
    try {
      await fetchAPI(`/admin/hotels/${currentEditDetailsId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      showToast('Hotel details updated!', 'success');
      closeEditDetailsModal();
      await fetchHotels();
      await fetchGlobalStats();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading('saveEditDetailsBtn', false, 'Save Changes');
    }
  }
  
  // NEW: Attach reset PIN button listeners
  tbody.querySelectorAll('.reset-pin-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const id = this.dataset.id;
      const name = this.dataset.name;
      openResetPinModal(id, name);
    });
  });

  // Attach delete button listeners
  tbody.querySelectorAll('.delete-hotel-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      openDeleteModal(this.dataset.id, this.dataset.name);
    });
  });

  // Attach purge button listeners
  tbody.querySelectorAll('.purge-hotel-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      openPurgeModal(this.dataset.id, this.dataset.name);
    });
  });
}

function renderPagination(totalPages, totalItems) {
  const container = document.getElementById('pagination');
  
  if (totalPages <= 1) {
    container.innerHTML = totalItems > 0 
      ? `<p style="color:var(--text-secondary);text-align:center;margin-top:10px;">Showing ${totalItems} hotel${totalItems !== 1 ? 's' : ''}</p>` 
      : '';
    return;
  }
  
  let html = `<p style="color:var(--text-secondary);text-align:center;margin-bottom:10px;">Page ${currentPage} of ${totalPages} (${totalItems} total)</p>`;
  html += `<button class="page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>← Prev</button>`;
  
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
      html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    } else if (i === currentPage - 2 || i === currentPage + 2) {
      html += `<span style="color:var(--text-secondary);padding:8px;">...</span>`;
    }
  }
  
  html += `<button class="page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>Next →</button>`;
  container.innerHTML = html;
  
  container.querySelectorAll('.page-btn[data-page]').forEach(btn => {
    btn.addEventListener('click', function() {
      const page = parseInt(this.dataset.page);
      changePage(page);
    });
  });
}

function changePage(page) {
  if (page < 1) return;
  currentPage = page;
  fetchHotels();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function debounceSearch(query) {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    currentSearchQuery = query;
    currentPage = 1;
    fetchHotels();
  }, 300);
}

function applyFilters() {
  const statusFilter = document.getElementById('filterStatus').value;
  currentStatusFilter = statusFilter;
  currentPage = 1;
  fetchHotels();
}

// Edit Status Modal (existing)
function openEditModal(hotelId, hotelName, hotelStatus) {
  currentEditId = hotelId;
  document.getElementById('editHotelName').value = hotelName;
  document.getElementById('editStatus').value = hotelStatus;
  document.getElementById('editNote').value = '';
  
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
  document.getElementById('editPaidUntil').value = thirtyDaysFromNow.toISOString().split('T')[0];
  
  onStatusChange();
  document.getElementById('editModal').classList.add('active');
}

function closeEditModal() {
  document.getElementById('editModal').classList.remove('active');
  currentEditId = null;
}

function onStatusChange() {
  const status = document.getElementById('editStatus').value;
  const paidGroup = document.getElementById('paidUntilGroup');
  paidGroup.style.display = ['ACTIVE', 'GRACE'].includes(status) ? 'block' : 'none';
}

async function saveStatus() {
  if (!currentEditId) return;
  
  const status = document.getElementById('editStatus').value;
  const paidUntil = document.getElementById('editPaidUntil').value;
  const note = document.getElementById('editNote').value.trim();
  
  const payload = { status };
  if (paidUntil && ['ACTIVE', 'GRACE'].includes(status)) {
    payload.paidUntil = new Date(paidUntil).toISOString();
  }
  if (note) payload.note = note;
  
  setLoading('saveStatusBtn', true);
  try {
    await fetchAPI(`/admin/hotels/${currentEditId}/status`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    showToast('Status updated successfully!');
    closeEditModal();
    await fetchHotels();
    await fetchGlobalStats();
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    setLoading('saveStatusBtn', false, 'Save Changes');
  }
}

// NEW: Reset PIN Modal Functions
function openResetPinModal(hotelId, hotelName) {
  currentResetPinId = hotelId;
  document.getElementById('resetPinHotelName').textContent = hotelName;
  document.getElementById('newPinDisplay').classList.add('hidden');
  document.getElementById('newPinValue').textContent = '';
  document.getElementById('resetPinModal').classList.add('active');
}

function closeResetPinModal() {
  document.getElementById('resetPinModal').classList.remove('active');
  currentResetPinId = null;
}

// NEW: Confirm PIN Reset
async function confirmResetPin() {
  if (!currentResetPinId) return;
  
  setLoading('confirmResetPinBtn', true);
  try {
    const result = await fetchAPI(`/admin/hotels/${currentResetPinId}/reset-pin`, {
      method: 'POST'
    });
    
    // Display the new PIN prominently
    document.getElementById('newPinValue').textContent = result.pin;
    document.getElementById('newPinDisplay').classList.remove('hidden');
    
    // Show success toast with longer duration (5 seconds)
    showToast(`PIN reset successful! New PIN: ${result.pin}`, 'success', 5000);
    
    // Refresh hotel list to show updated reset count
    await fetchHotels();
    
  } catch (e) {
    showToast(e.message || 'Failed to reset PIN', 'error');
    closeResetPinModal();
  } finally {
    setLoading('confirmResetPinBtn', false, 'Confirm Reset');
  }
}

// ==================== DELETE HOTEL MODAL ====================
function openDeleteModal(hotelId, hotelName) {
  currentDeleteId = hotelId;
  document.getElementById('deleteHotelName').textContent = hotelName;
  document.getElementById('deleteModal').classList.add('active');
}

function closeDeleteModal() {
  document.getElementById('deleteModal').classList.remove('active');
  currentDeleteId = null;
}

async function confirmDeleteHotel() {
  if (!currentDeleteId) return;
  
  setLoading('confirmDeleteBtn', true);
  try {
    const result = await fetchAPI(`/admin/hotels/${currentDeleteId}`, {
      method: 'DELETE'
    });
    
    showToast(result.message || 'Hotel deleted and PII anonymized.', 'success', 5000);
    closeDeleteModal();
    await fetchHotels();
    await fetchGlobalStats();
  } catch (e) {
    showToast(e.message || 'Failed to delete hotel', 'error');
  } finally {
    setLoading('confirmDeleteBtn', false, '⛔ Confirm Delete');
  }
}

// ==================== PURGE HOTEL MODAL ====================
function openPurgeModal(hotelId, hotelName) {
  currentDeleteId = hotelId; // reuse state
  document.getElementById('purgeHotelName').textContent = hotelName || 'Deleted Hotel';
  document.getElementById('purgeModal').classList.add('active');
}

function closePurgeModal() {
  document.getElementById('purgeModal').classList.remove('active');
  currentDeleteId = null;
}

async function confirmPurgeHotel() {
  if (!currentDeleteId) return;
  
  setLoading('confirmPurgeBtn', true);
  try {
    const result = await fetchAPI(`/admin/hotels/${currentDeleteId}/purge`, {
      method: 'DELETE'
    });
    
    const msg = `Hotel purged. ${result.purged?.imagesDeleted || 0} images deleted from storage.`;
    showToast(msg, 'success', 5000);
    closePurgeModal();
    await fetchHotels();
    await fetchGlobalStats();
  } catch (e) {
    showToast(e.message || 'Failed to purge hotel', 'error');
  } finally {
    setLoading('confirmPurgeBtn', false, '🗑️ Confirm Purge');
  }
}

// UPDATED: 8-digit PIN generation and validation
async function createHotel() {
  const payload = {
    name: document.getElementById('hName').value.trim(),
    city: document.getElementById('hCity').value.trim(),
    phone: document.getElementById('hPhone').value.trim(),
    email: document.getElementById('hEmail').value.trim() || undefined,
    pin: document.getElementById('hPin').value.trim(),
    plan: document.getElementById('hPlan').value
  };
  
  if (!payload.name || !payload.city || !payload.phone || !payload.pin) {
    showToast('Please fill all required fields', 'error');
    return;
  }
  
  // UPDATED: 8-digit validation
  if (payload.pin.length !== 8 || !/^\d{8}$/.test(payload.pin)) {
    showToast('PIN must be exactly 8 digits', 'error');
    return;
  }
  
  if (payload.phone.length < 10) {
    showToast('Phone must be at least 10 digits', 'error');
    return;
  }
  
  setLoading('createBtn', true);
  try {
    const result = await fetchAPI('/admin/hotels', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    // Show menu code + PIN + short URL
    showToast(`Hotel created! Code: ${result.slug} | PIN: ${result.pin} | URL: ${result.menuUrl}`, 'success', 8000);
    
    // Clear form
    ['hName', 'hCity', 'hPhone', 'hEmail', 'hPin'].forEach(id => {
      document.getElementById(id).value = '';
    });
    
    // Refresh to show new hotel
    currentPage = 1;
    await fetchHotels();
    await fetchGlobalStats();
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    setLoading('createBtn', false, 'Create Hotel & Start Trial');
  }
}

// UPDATED: Generate 8-digit PIN
function generateRandomPin() {
  // Use crypto.getRandomValues only for secure PIN generation
  const array = new Uint32Array(1);
  window.crypto.getRandomValues(array);
  return (10000000 + (array[0] % 90000000)).toString();
}

// UPDATED: Auto-generate 8-digit PIN in form
function autoGeneratePin() {
  const pinInput = document.getElementById('hPin');
  if (pinInput && !pinInput.value) {
    pinInput.value = generateRandomPin();
  }
}

function handlePinInput(e) {
  e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 8);
}

async function init() {
  console.log('Initializing...');
  setupEventListeners();
  
  try {
    await fetchAPI('/auth/admin/me');
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('dashboardScreen').classList.remove('hidden');
    
    currentPage = 1;
    currentSearchQuery = '';
    currentStatusFilter = '';
    await fetchHotels();
    await fetchGlobalStats();
    await updateSessionInfo();
    showToast('Welcome back!');
  } catch (e) {
    console.log('No valid session found');
    document.getElementById('authScreen').classList.remove('hidden');
  }
}

function setupEventListeners() {
  // Auth screen
  document.getElementById('loginBtn').addEventListener('click', login);
  document.getElementById('adminKey').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') login();
  });
  
  // Dashboard header
  document.getElementById('checkSessionBtn').addEventListener('click', checkSession);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  
  // Create hotel form
  document.getElementById('createBtn').addEventListener('click', createHotel);
  document.getElementById('hPin').addEventListener('input', handlePinInput);
  
  // NEW: Auto-generate PIN button if exists
  const autoGenBtn = document.getElementById('autoGenPinBtn');
  if (autoGenBtn) {
    autoGenBtn.addEventListener('click', autoGeneratePin);
  }
  
  // Search and filter
  document.getElementById('searchInput').addEventListener('input', function() {
    debounceSearch(this.value);
  });
  document.getElementById('filterStatus').addEventListener('change', applyFilters);
  
  // Edit Status Modal
  document.getElementById('closeModalBtn').addEventListener('click', closeEditModal);
  document.getElementById('cancelEditBtn').addEventListener('click', closeEditModal);
  document.getElementById('saveStatusBtn').addEventListener('click', saveStatus);
  document.getElementById('editStatus').addEventListener('change', onStatusChange);
  
  // NEW: Reset PIN Modal
  document.getElementById('closeResetPinModalBtn').addEventListener('click', closeResetPinModal);
  document.getElementById('cancelResetPinBtn').addEventListener('click', closeResetPinModal);
  document.getElementById('confirmResetPinBtn').addEventListener('click', confirmResetPin);
  
  // Close modals on backdrop click
  document.getElementById('editModal').addEventListener('click', function(e) {
    if (e.target.id === 'editModal') closeEditModal();
  });
  document.getElementById('resetPinModal').addEventListener('click', function(e) {
    if (e.target.id === 'resetPinModal') closeResetPinModal();
  });
  document.getElementById('deleteModal').addEventListener('click', function(e) {
    if (e.target.id === 'deleteModal') closeDeleteModal();
  });
  document.getElementById('purgeModal').addEventListener('click', function(e) {
    if (e.target.id === 'purgeModal') closePurgeModal();
  });
  
  // Delete Modal
  document.getElementById('closeDeleteModalBtn').addEventListener('click', closeDeleteModal);
  document.getElementById('cancelDeleteBtn').addEventListener('click', closeDeleteModal);
  document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDeleteHotel);

  // Purge Modal
  document.getElementById('closePurgeModalBtn').addEventListener('click', closePurgeModal);
  document.getElementById('cancelPurgeBtn').addEventListener('click', closePurgeModal);
  document.getElementById('confirmPurgeBtn').addEventListener('click', confirmPurgeHotel);

  // Escape key to close modals
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeEditModal();
      closeResetPinModal();
      closeDeleteModal();
      closePurgeModal();
    }
  });

  // Create section toggle
  var createToggleHeader = document.getElementById('createSectionToggle');
  if (createToggleHeader) {
    createToggleHeader.addEventListener('click', function() {
      var content = document.getElementById('createFormContent');
      var toggle = document.getElementById('createToggle');
      content.classList.toggle('collapsed');
      toggle.classList.toggle('rotated');
      createToggleHeader.classList.toggle('active');
    });
  }

  // Custom styled dropdowns
  initAllCustomSelects();
}

// ── Custom Styled Dropdown ─────────────────────────────────────────────
var csArrowSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

function initCustomSelect(sel) {
  if (!sel || sel._csInit) return;
  sel._csInit = true;

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
  arrow.innerHTML = csArrowSvg;

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
    else { buildOpts(); trigger.classList.add('open'); dropdown.classList.add('open'); }
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

function initAllCustomSelects() {
  initCustomSelect(document.getElementById('hPlan'));
  initCustomSelect(document.getElementById('filterStatus'));
  initCustomSelect(document.getElementById('editStatus'));
}

// Run init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}