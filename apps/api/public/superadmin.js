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
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
    fetchTrialRequests();
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
    const stats = await fetchAPI('/admin/stats');

    // Update hotel metric cards
    globalStats = {
      total: stats.hotels.total,
      trial: stats.hotels.trial,
      active: stats.hotels.active,
      views: stats.views
    };
    updateStatsDisplay();

    // Update revenue dashboard
    updateRevenueDashboard(stats);
  } catch (e) {
    console.error('Failed to fetch global stats:', e);
  }
}

function formatINR(paise) {
  return '₹' + (paise / 100).toLocaleString('en-IN');
}

function updateRevenueDashboard(stats) {
  var p = stats.payments;

  // Net revenue
  document.getElementById('revNetRevenue').textContent = formatINR(stats.netRevenue);
  var grossNote = '';
  if (p.refunded.total > 0) {
    grossNote = 'Gross ' + formatINR(p.captured.total) + ' − ' + formatINR(p.refunded.total) + ' refunded';
  } else if (p.captured.total > 0) {
    grossNote = 'All-time revenue';
  }
  document.getElementById('revGrossNote').textContent = grossNote;

  // MRR badge
  document.getElementById('revMrr').textContent = formatINR(stats.mrr);

  // Payment counts
  document.getElementById('revCapturedCount').textContent = p.captured.count;
  document.getElementById('revRefundedCount').textContent = p.refunded.count;
  document.getElementById('revRefundedAmt').textContent = p.refunded.total > 0 ? formatINR(p.refunded.total) : 'None';
  document.getElementById('revFailedCount').textContent = p.failed.count;
  document.getElementById('revAbandonedCount').textContent = p.created.count;
  document.getElementById('revTodayScans').textContent = (stats.todayScans || 0).toLocaleString('en-IN');

  // Revenue breakdown by plan + payment methods
  var breakdown = document.getElementById('revenueBreakdown');
  var parts = [];
  var planColors = { STARTER: '#c68b52', STANDARD: '#2563eb', PRO: '#7c3aed' };
  var planNames = { STARTER: 'Starter', STANDARD: 'Standard', PRO: 'Pro' };

  // Plan breakdown
  if (stats.revenueByPlan && Object.keys(stats.revenueByPlan).length > 0) {
    Object.keys(stats.revenueByPlan).forEach(function(plan) {
      var r = stats.revenueByPlan[plan];
      parts.push(
        '<span class="rb-item">' +
        '<span class="rb-dot" style="background:' + (planColors[plan] || '#94a3b8') + ';"></span>' +
        '<span class="rb-label">' + (planNames[plan] || plan) + '</span> ' +
        formatINR(r.total) + ' (' + r.count + ')' +
        '</span>'
      );
    });
  }

  // Active plan distribution
  if (stats.planBreakdown && Object.keys(stats.planBreakdown).length > 0) {
    parts.push('<span class="rb-item" style="margin-left:0.5rem;color:var(--text-tertiary);">|</span>');
    Object.keys(stats.planBreakdown).forEach(function(plan) {
      parts.push(
        '<span class="rb-item">' +
        '<span class="rb-label" style="color:' + (planColors[plan] || '#94a3b8') + ';">' + stats.planBreakdown[plan] + '</span> active ' +
        (planNames[plan] || plan) +
        '</span>'
      );
    });
  }

  // Payment methods
  if (stats.paymentMethods && Object.keys(stats.paymentMethods).length > 0) {
    parts.push('<span class="rb-item" style="margin-left:0.5rem;color:var(--text-tertiary);">|</span>');
    var methodLabels = { upi: 'UPI', card: 'Card', netbanking: 'Net Banking', wallet: 'Wallet', cash: 'Cash', manual: 'Manual', unknown: 'Unknown' };
    Object.keys(stats.paymentMethods).forEach(function(m) {
      parts.push(
        '<span class="rb-item">' +
        (methodLabels[m] || m) + ': <strong>' + stats.paymentMethods[m] + '</strong>' +
        '</span>'
      );
    });
  }

  breakdown.innerHTML = parts.join('');
}

function updateStatsDisplay() {
  document.getElementById('statTotal').textContent = globalStats.total;
  document.getElementById('statTrial').textContent = globalStats.trial;
  document.getElementById('statActive').textContent = globalStats.active;
  document.getElementById('statViews').textContent = globalStats.views.toLocaleString('en-IN');
}

// ==================== TRIAL REQUESTS ====================
async function fetchTrialRequests() {
  try {
    const data = await fetchAPI('/admin/trial-requests?status=pending');
    const requests = data.requests || [];
    const badge = document.getElementById('trialRequestsBadge');
    const list = document.getElementById('trialRequestsList');

    if (badge) {
      badge.textContent = requests.length;
      badge.style.display = requests.length > 0 ? 'inline' : 'none';
    }

    if (requests.length === 0) {
      list.innerHTML = '<p style="color:#94a3b8;padding:12px 0;">No pending trial requests.</p>';
      return;
    }

    list.innerHTML = requests.map(function(r) {
      var time = new Date(r.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #f1f5f9;flex-wrap:wrap;gap:8px;">'
        + '<div>'
        + '<strong style="color:#0f172a;">' + escapeHtml(r.name) + '</strong>'
        + ' <span style="color:#94a3b8;">&mdash; ' + escapeHtml(r.city) + '</span><br>'
        + '<span style="font-size:13px;">📞 ' + escapeHtml(r.phone) + (r.email ? ' &bull; ✉️ ' + escapeHtml(r.email) : '') + '</span><br>'
        + '<span style="font-size:12px;color:#94a3b8;">' + time + '</span>'
        + '</div>'
        + '<div style="display:flex;gap:6px;">'
        + '<button class="btn btn-primary btn-sm" data-action="prefill" data-id="' + escapeHtml(r.id) + '" data-name="' + escapeHtml(r.name) + '" data-city="' + escapeHtml(r.city) + '" data-phone="' + escapeHtml(r.phone) + '" data-email="' + escapeHtml(r.email || '') + '">Create Hotel</button>'
        + '<button class="btn btn-secondary btn-sm" data-action="dismiss" data-id="' + escapeHtml(r.id) + '">Dismiss</button>'
        + '</div>'
        + '</div>';
    }).join('');
  } catch (e) {
    var list = document.getElementById('trialRequestsList');
    if (list) list.innerHTML = '<p style="color:#ef4444;">Failed to load trial requests.</p>';
  }
}

function prefillFromRequest(requestId, name, city, phone, email) {
  // Expand create hotel section if collapsed
  var content = document.getElementById('createFormContent');
  var toggle = document.getElementById('createSectionToggle');
  if (content && content.classList.contains('hidden')) {
    content.classList.remove('hidden');
    if (toggle) toggle.classList.add('active');
  }

  // Pre-fill form fields
  document.getElementById('hName').value = name;
  document.getElementById('hCity').value = city;
  document.getElementById('hPhone').value = phone;
  document.getElementById('hEmail').value = email;

  // Store request ID for linking after creation
  window._pendingTrialRequestId = requestId;

  // Scroll to create section
  document.getElementById('hName').scrollIntoView({ behavior: 'smooth', block: 'center' });
  showToast('Form pre-filled from trial request. Generate PIN and create the hotel.', 'info', 4000);
}

async function markRequestHandled(requestId, status) {
  try {
    await fetchAPI('/admin/trial-requests/' + requestId, {
      method: 'PATCH',
      body: JSON.stringify({ status: status })
    });
    showToast('Request ' + status, 'success');
    await fetchTrialRequests();
  } catch (e) {
    showToast('Failed to update request', 'error');
  }
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
        <div class="action-row">
          <button class="btn btn-sm btn-qr qr-hotel-btn"
            data-id="${hotel.id}"
            data-name="${escapeHtml(hotel.name)}"
            data-slug="${escapeHtml(hotel.slug)}"
            data-city="${escapeHtml(hotel.city || '')}"
            data-logourl="${escapeHtml(hotel.logoUrl || '')}"
            data-plan="${escapeHtml(hotel.plan || 'STARTER')}"
            data-reviewurl="${escapeHtml(hotel.reviewUrl || '')}"
            data-upiid="${escapeHtml(hotel.upiId || '')}"
            data-upienabled="${hotel.upiPayEnabled ? 'true' : 'false'}"
            data-qrtheme="${escapeHtml(hotel.qrTheme || 'walnut')}"
            title="View & download QR code">
            📱 QR Code
          </button>
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
        </div>
        <div class="action-row">
          <button class="btn btn-sm btn-warning reset-pin-btn"
            data-id="${hotel.id}"
            data-name="${escapeHtml(hotel.name)}"
            title="Reset PIN - Current PIN will be invalidated">
            🔑 Reset PIN
          </button>
          <button class="btn btn-sm btn-success record-payment-btn"
            data-id="${hotel.id}"
            data-name="${escapeHtml(hotel.name)}"
            data-plan="${hotel.plan}"
            data-status="${hotel.status}"
            data-paid-until="${hotel.paidUntil || ''}"
            title="Record an offline/manual payment">
            💰 Record Payment
          </button>
        </div>
        <div class="action-row">
          <button class="btn btn-sm btn-outline view-payments-btn"
            data-id="${hotel.id}"
            data-name="${escapeHtml(hotel.name)}"
            title="View all payment transactions">
            📊 Payments
          </button>
          <button class="btn btn-sm btn-danger delete-hotel-btn"
            data-id="${hotel.id}"
            data-name="${escapeHtml(hotel.name)}"
            title="Soft delete - Anonymize PII, disable access">
            ⛔ Delete
          </button>
        </div>`;
    }
    
    return `
      <tr${isDeleted ? ' style="opacity:0.6;"' : ''}>
        <td data-label="Hotel">
          <div class="hotel-info">
            <span class="hotel-name">${escapeHtml(hotel.name)}</span>
            <span class="hotel-meta">${escapeHtml(hotel.city)} • ${escapeHtml(hotel.phone || 'No phone')}</span>
            <code class="hotel-slug">${escapeHtml(hotel.slug)}</code>
            ${hotel.upiId && hotel.upiPayEnabled ? '<span style="display:inline-block;font-size:0.65rem;background:#ecfdf5;color:#059669;border:1px solid #a7f3d0;padding:1px 6px;border-radius:4px;margin-top:2px;">💰 UPI Pay</span>' : ''}
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
    // Plan is readonly — changes only via Record Payment
    var planLabels = { STARTER: 'Starter (\u20b9499)', STANDARD: 'Standard (\u20b9999)', PRO: 'Pro (\u20b91,499)' };
    document.getElementById('editDetailsPlanDisplay').value = planLabels[latestHotel.plan] || latestHotel.plan;
    document.getElementById('editDetailsPlan').value = latestHotel.plan;
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

  // Attach record payment button listeners
  tbody.querySelectorAll('.record-payment-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      openRecordPaymentModal(this.dataset.id, this.dataset.name, this.dataset.plan, this.dataset.status, this.dataset.paidUntil);
    });
  });

  // Attach view payments button listeners
  tbody.querySelectorAll('.view-payments-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      openPaymentHistoryModal(this.dataset.id, this.dataset.name);
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

  // Attach QR code button listeners
  tbody.querySelectorAll('.qr-hotel-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      openQrModal(this.dataset.id, this.dataset.name, this.dataset.slug, this.dataset.city, this.dataset.logourl, this.dataset.plan, this.dataset.reviewurl, this.dataset.upiid, this.dataset.upienabled === 'true', this.dataset.qrtheme);
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

// ==================== RECORD PAYMENT MODAL ====================
let currentRecordPaymentId = null;

function openRecordPaymentModal(hotelId, hotelName, currentPlan, status, paidUntil) {
  currentRecordPaymentId = hotelId;
  document.getElementById('recordPaymentHotelName').textContent = hotelName;
  document.getElementById('recordPaymentPlan').value = currentPlan || 'STARTER';
  document.getElementById('recordPaymentMode').value = 'CASH';
  document.getElementById('recordPaymentNote').value = '';
  // Show info banner if hotel has active subscription
  var infoEl = document.getElementById('recordPaymentInfo');
  if (infoEl) {
    if (status === 'ACTIVE' && paidUntil && new Date(paidUntil) > new Date()) {
      var paidDate = new Date(paidUntil).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      var daysLeft = Math.ceil((new Date(paidUntil) - new Date()) / (24*60*60*1000));
      infoEl.innerHTML = '<strong>\u26a0\ufe0f Active subscription</strong> \u2014 ' + escapeHtml(currentPlan || '') + ' plan active until ' + paidDate + ' (' + daysLeft + ' days left). Same-plan renewal blocked if >7 days remain.';
      infoEl.style.display = 'block';
    } else {
      infoEl.style.display = 'none';
    }
  }
  document.getElementById('recordPaymentModal').classList.add('active');
}

function closeRecordPaymentModal() {
  document.getElementById('recordPaymentModal').classList.remove('active');
  currentRecordPaymentId = null;
}

async function confirmRecordPayment() {
  if (!currentRecordPaymentId) return;

  // Read values directly from native select using selectedIndex (bypasses custom select override)
  const planSel = document.getElementById('recordPaymentPlan');
  const modeSel = document.getElementById('recordPaymentMode');
  const plan = planSel.options[planSel.selectedIndex]?.value || planSel.value;
  const mode = modeSel.options[modeSel.selectedIndex]?.value || modeSel.value;
  const note = document.getElementById('recordPaymentNote').value.trim();

  if (!plan || !mode) {
    showToast('Plan and mode are required', 'error');
    return;
  }

  setLoading('confirmRecordPaymentBtn', true);
  try {
    await fetchAPI(`/admin/hotels/${currentRecordPaymentId}/record-payment`, {
      method: 'POST',
      body: JSON.stringify({ plan, mode, note: note || undefined })
    });
    showToast('Payment recorded successfully!', 'success');
    closeRecordPaymentModal();
    await fetchHotels();
    await fetchGlobalStats();
  } catch (e) {
    showToast(e.message || 'Failed to record payment', 'error');
  } finally {
    setLoading('confirmRecordPaymentBtn', false, '💰 Record Payment');
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
    
    // If created from a trial request, mark it as approved
    if (window._pendingTrialRequestId) {
      try {
        await fetchAPI('/admin/trial-requests/' + window._pendingTrialRequestId, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'approved', hotelId: result.id })
        });
      } catch (e) { /* non-critical */ }
      window._pendingTrialRequestId = null;
      fetchTrialRequests();
    }
    
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
  
  // Record Payment Modal
  document.getElementById('closeRecordPaymentModalBtn').addEventListener('click', closeRecordPaymentModal);
  document.getElementById('cancelRecordPaymentBtn').addEventListener('click', closeRecordPaymentModal);
  document.getElementById('confirmRecordPaymentBtn').addEventListener('click', confirmRecordPayment);
  
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
  document.getElementById('recordPaymentModal').addEventListener('click', function(e) {
    if (e.target.id === 'recordPaymentModal') closeRecordPaymentModal();
  });
  
  // Delete Modal
  document.getElementById('closeDeleteModalBtn').addEventListener('click', closeDeleteModal);
  document.getElementById('cancelDeleteBtn').addEventListener('click', closeDeleteModal);
  document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDeleteHotel);

  // Purge Modal
  document.getElementById('closePurgeModalBtn').addEventListener('click', closePurgeModal);
  document.getElementById('cancelPurgeBtn').addEventListener('click', closePurgeModal);
  document.getElementById('confirmPurgeBtn').addEventListener('click', confirmPurgeHotel);

  // Payment History Modal
  document.getElementById('closePaymentHistoryModalBtn').addEventListener('click', closePaymentHistoryModal);
  document.getElementById('closePaymentHistoryBtn').addEventListener('click', closePaymentHistoryModal);

  // QR Code Modal
  document.getElementById('closeQrModalBtn').addEventListener('click', closeQrModal);
  document.getElementById('qrDownloadPngBtn').addEventListener('click', downloadSaQrPng);
  document.getElementById('qrDownloadBackPngBtn').addEventListener('click', downloadSaQrBackPng);
  document.getElementById('qrDownloadPrintReadyBtn').addEventListener('click', downloadSaQrPrintReady);
  document.getElementById('qrDownloadSvgBtn').addEventListener('click', downloadSaQrSvg);
  document.getElementById('qrShareBtn').addEventListener('click', shareSaQr);
  document.getElementById('saReviewUrlSaveBtn').addEventListener('click', saveSaReviewUrl);
  document.getElementById('saReviewUrlClearBtn').addEventListener('click', clearSaReviewUrl);

  // Escape key to close modals
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeEditModal();
      closeResetPinModal();
      closeDeleteModal();
      closePurgeModal();
      closeRecordPaymentModal();
      closePaymentHistoryModal();
      closeQrModal();
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

  // Trial requests section toggle (CSP-safe, replaces inline onclick)
  var trialToggle = document.getElementById('trialRequestsToggle');
  if (trialToggle) {
    trialToggle.addEventListener('click', function() {
      document.getElementById('trialRequestsContent').classList.toggle('hidden');
      trialToggle.classList.toggle('active');
      document.getElementById('trialRequestsToggleIcon').textContent = trialToggle.classList.contains('active') ? '▾' : '▸';
    });
  }

  // Trial request buttons – event delegation (CSP-safe, prevents XSS)
  var trialList = document.getElementById('trialRequestsList');
  if (trialList) {
    trialList.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-action="prefill"]');
      if (btn) {
        prefillFromRequest(btn.dataset.id, btn.dataset.name, btn.dataset.city, btn.dataset.phone, btn.dataset.email);
        return;
      }
      btn = e.target.closest('[data-action="dismiss"]');
      if (btn) {
        markRequestHandled(btn.dataset.id, 'rejected');
      }
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
  initCustomSelect(document.getElementById('recordPaymentPlan'));
  initCustomSelect(document.getElementById('recordPaymentMode'));
}

// ==================== QR CODE MODAL FUNCTIONS ====================
let qrModalState = {
  id: '',
  slug: '',
  name: '',
  city: '',
  logoUrl: '',
  plan: 'STARTER',
  qrTheme: 'walnut',
  reviewUrl: '',
  reviewQrSvg: null,
  svgCache: null,
  upiId: '',
  upiPayEnabled: false,
  upiQrSvg: null
};

function renderSaLogoPreview() {
  const placeholder = document.getElementById('saLogoPlaceholder');
  const img = document.getElementById('saLogoImg');
  const removeBtn = document.getElementById('saRemoveLogoBtn');
  if (!placeholder || !img || !removeBtn) return;

  if (qrModalState.logoUrl) {
    placeholder.style.display = 'none';
    img.style.display = 'block';
    img.src = qrModalState.logoUrl;
    removeBtn.style.display = 'inline-flex';
  } else {
    placeholder.style.display = 'flex';
    img.style.display = 'none';
    img.src = '';
    removeBtn.style.display = 'none';
  }
}

document.getElementById('saUploadLogoBtn').addEventListener('click', function() {
  document.getElementById('saLogoFileInput').click();
});
document.getElementById('saRemoveLogoBtn').addEventListener('click', function() {
  saRemoveLogo();
});

document.getElementById('saLogoFileInput').addEventListener('change', async function() {
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
  if (!qrModalState.id) return;

  try {
    const fd = new FormData();
    fd.append('image', file);
    showToast('Uploading logo...', 'info');
    const data = await fetchAPI(`/admin/hotels/${qrModalState.id}/logo`, { method: 'POST', body: fd });
    qrModalState.logoUrl = data.logoUrl || '';
    // Update source button data attribute to prevent staleness on re-open
    const srcBtn = document.querySelector(`.qr-hotel-btn[data-id="${qrModalState.id}"]`);
    if (srcBtn) srcBtn.dataset.logourl = qrModalState.logoUrl;
    renderSaLogoPreview();
    showToast('Logo uploaded!', 'success');
  } catch (e) {
    showToast(e.message || 'Logo upload failed', 'error');
  }
});

// Reusable styled confirm modal (replaces native confirm())
function openSaConfirmModal({ title = 'Confirm', message = '', confirmText = 'Confirm' } = {}) {
  return new Promise(resolve => {
    const modal = document.getElementById('saConfirmModal');
    const titleEl = document.getElementById('saConfirmTitle');
    const messageEl = document.getElementById('saConfirmMessage');
    const confirmBtn = document.getElementById('confirmSaConfirmBtn');
    const cancelBtn = document.getElementById('cancelSaConfirmBtn');
    const closeBtn = document.getElementById('closeSaConfirmModalBtn');

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    if (confirmBtn) confirmBtn.textContent = confirmText;

    let handled = false;
    function cleanup() {
      modal.classList.remove('active');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
    }
    function onConfirm() { if (handled) return; handled = true; cleanup(); resolve(true); }
    function onCancel() { if (handled) return; handled = true; cleanup(); resolve(false); }
    function onKey(e) {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
    }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
    modal.classList.add('active');
    setTimeout(() => { if (cancelBtn) cancelBtn.focus(); }, 0);
  });
}

async function saRemoveLogo() {
  if (!qrModalState.id || !qrModalState.logoUrl) return;
  const ok = await openSaConfirmModal({ title: 'Remove Logo', message: 'Remove restaurant logo? This cannot be undone.', confirmText: 'Remove' });
  if (!ok) return;

  try {
    await fetchAPI(`/admin/hotels/${qrModalState.id}/logo`, { method: 'DELETE' });
    qrModalState.logoUrl = '';
    // Update source button data attribute to prevent staleness on re-open
    const srcBtn = document.querySelector(`.qr-hotel-btn[data-id="${qrModalState.id}"]`);
    if (srcBtn) srcBtn.dataset.logourl = '';
    renderSaLogoPreview();
    showToast('Logo removed', 'success');
  } catch (e) {
    showToast(e.message || 'Failed to remove logo', 'error');
  }
}

function openQrModal(hotelId, hotelName, slug, city, logoUrl, plan, reviewUrl, upiId, upiPayEnabled, qrTheme) {
  qrModalState = { id: hotelId, slug, name: hotelName, city: city || '', logoUrl: logoUrl || '', plan: plan || 'STARTER', qrTheme: qrTheme || 'walnut', reviewUrl: reviewUrl || '', reviewQrSvg: null, svgCache: null, upiId: upiId || '', upiPayEnabled: !!upiPayEnabled, upiQrSvg: null };

  document.getElementById('qrHotelName').textContent = hotelName;
  document.getElementById('qrModalCode').textContent = slug;

  const menuUrl = `${window.location.origin}/m/${slug}`;
  const link = document.getElementById('qrModalLink');
  link.href = menuUrl;
  link.textContent = menuUrl;

  // Loading state
  document.getElementById('qrModalPreview').innerHTML = '<div class="qr-modal-loading"><div class="qr-spin"></div><span>Loading QR code...</span></div>';

  // Hide share button if not supported
  const shareBtn = document.getElementById('qrShareBtn');
  if (shareBtn && !(navigator.share && navigator.canShare)) {
    shareBtn.style.display = 'none';
  }

  document.getElementById('qrModal').classList.add('active');

  // Render logo preview
  renderSaLogoPreview();

  // Fetch QR SVG directly (not through fetchAPI since it returns SVG, not JSON)
  fetch(`/api/qr/${slug}`, { credentials: 'include' })
    .then(r => {
      if (!r.ok) throw new Error('Failed to load QR code');
      return r.text();
    })
    .then(svgText => {
      qrModalState.svgCache = svgText;
      const preview = document.getElementById('qrModalPreview');
      preview.innerHTML = svgText;
      const svgEl = preview.querySelector('svg');
      if (svgEl) {
        svgEl.removeAttribute('width');
        svgEl.removeAttribute('height');
        svgEl.style.width = '100%';
        svgEl.style.maxWidth = '200px';
        svgEl.style.height = 'auto';
      }
    })
    .catch(() => {
      document.getElementById('qrModalPreview').innerHTML = '<div class="qr-modal-loading"><span style="color:var(--red-500);">Failed to load QR code</span></div>';
    });

  // Init review URL UI
  initSaReviewUrlUI();

  // Fetch review QR SVG if reviewUrl exists
  if (reviewUrl) {
    fetch('/api/qr/review/' + hotelId, { credentials: 'include' })
      .then(r => r.ok ? r.text() : null)
      .then(svg => { qrModalState.reviewQrSvg = svg; })
      .catch(() => {});
  }

  // Fetch UPI QR SVG if UPI is enabled
  if (upiId && upiPayEnabled) {
    fetch('/api/qr/upi/' + hotelId, { credentials: 'include' })
      .then(r => r.ok ? r.text() : null)
      .then(svg => { qrModalState.upiQrSvg = svg; })
      .catch(() => {});
  }
}

function closeQrModal() {
  document.getElementById('qrModal').classList.remove('active');
  qrModalState = { id: '', slug: '', name: '', city: '', logoUrl: '', plan: 'STARTER', qrTheme: 'walnut', reviewUrl: '', reviewQrSvg: null, svgCache: null, upiId: '', upiPayEnabled: false, upiQrSvg: null };
}

// ── QR Card Generation (delegates to shared qr-card.js module) ──────────

function getSaQrCardConfig() {
  if (!qrModalState.svgCache || !qrModalState.slug) return null;
  var cfg = {
    name: qrModalState.name,
    city: qrModalState.city,
    slug: qrModalState.slug,
    logoUrl: qrModalState.logoUrl,
    hotelId: qrModalState.id,
    qrSvg: qrModalState.svgCache,
    qrTheme: qrModalState.qrTheme || 'walnut',
    plan: qrModalState.plan || 'STARTER'
  };
  if (qrModalState.reviewUrl && qrModalState.reviewQrSvg) {
    cfg.reviewUrl = qrModalState.reviewUrl;
    cfg.reviewQrSvg = qrModalState.reviewQrSvg;
  }
  if (qrModalState.upiId && qrModalState.upiPayEnabled && qrModalState.upiQrSvg) {
    cfg.upiId = qrModalState.upiId;
    cfg.upiQrSvg = qrModalState.upiQrSvg;
  }
  return cfg;
}

async function downloadSaQrPng() {
  var cfg = getSaQrCardConfig();
  if (!cfg) { showToast('QR code not loaded yet', 'error'); return; }
  showToast('Generating high-res QR card (600 DPI)...');
  try {
    var blob = await KodSpotQR.generateFront(cfg);
    if (!blob) return;
    KodSpotQR.downloadBlob(blob, KodSpotQR.safeName(qrModalState.name) + '_QR_Front.png');
    showToast('Front side downloaded! 600 DPI — ready for print shop.', 'success');
  } catch (e) {
    console.error('PNG download error:', e);
    showToast('Failed to generate PNG', 'error');
  }
}

async function downloadSaQrBackPng() {
  var cfg = getSaQrCardConfig();
  if (!cfg) { showToast('QR code not loaded yet', 'error'); return; }
  showToast('Generating back side...');
  try {
    var blob = await KodSpotQR.generateBack(cfg);
    if (!blob) return;
    KodSpotQR.downloadBlob(blob, KodSpotQR.safeName(qrModalState.name) + '_QR_Back.png');
    showToast('Back side downloaded!', 'success');
  } catch (e) {
    console.error('PNG download error:', e);
    showToast('Failed to generate PNG', 'error');
  }
}

async function downloadSaQrPrintReady() {
  var cfg = getSaQrCardConfig();
  if (!cfg) { showToast('QR code not loaded yet', 'error'); return; }
  showToast('Generating print-ready file (both sides)...');
  try {
    var blob = await KodSpotQR.generatePrintReady(cfg);
    if (!blob) return;
    KodSpotQR.downloadBlob(blob, KodSpotQR.safeName(qrModalState.name) + '_QR_PrintReady.png');
    showToast('Print-ready file downloaded!', 'success');
  } catch (e) {
    console.error('Print-ready download error:', e);
    showToast('Failed to generate. Please try again.', 'error');
  }
}

function downloadSaQrSvg() {
  if (!qrModalState.svgCache) { showToast('QR code not loaded yet', 'error'); return; }
  var sn = KodSpotQR.safeName(qrModalState.name);
  var blob = new Blob([qrModalState.svgCache], { type: 'image/svg+xml' });
  KodSpotQR.downloadBlob(blob, sn + '_QR_Menu.svg');
  showToast('SVG downloaded!', 'success');
}

async function shareSaQr() {
  try {
    var cfg = getSaQrCardConfig();
    if (!cfg) { showToast('QR code not ready', 'error'); return; }
    var blob = await KodSpotQR.generateFront(cfg);
    if (!blob) return;
    var sn = KodSpotQR.safeName(qrModalState.name);
    var file = new File([blob], sn + '_QR_Menu.png', { type: 'image/png' });
    var menuUrl = window.location.origin + '/m/' + qrModalState.slug;

    if (navigator.share && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: qrModalState.name + ' - Digital Menu',
        text: 'Scan QR code or visit: ' + menuUrl,
        files: [file]
      });
      showToast('Shared successfully!', 'success');
    } else if (navigator.share) {
      await navigator.share({
        title: qrModalState.name + ' - Digital Menu',
        text: 'View menu: ' + menuUrl,
        url: menuUrl
      });
      showToast('Link shared!', 'success');
    } else {
      downloadSaQrPng();
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error('Share error:', e);
      showToast('Sharing failed. Try downloading instead.', 'error');
    }
  }
}

// ==================== REVIEW URL (SUPERADMIN) ====================
function initSaReviewUrlUI() {
  var input = document.getElementById('saReviewUrlInput');
  var clearBtn = document.getElementById('saReviewUrlClearBtn');
  var status = document.getElementById('saReviewUrlStatus');
  if (!input) return;

  if (qrModalState.reviewUrl) {
    input.value = qrModalState.reviewUrl;
    clearBtn.style.display = '';
    status.style.color = '#059669';
    status.textContent = '✓ Review link active — back side shows review QR';
  } else {
    input.value = '';
    clearBtn.style.display = 'none';
    status.style.color = '';
    status.textContent = '';
  }
}

async function saveSaReviewUrl() {
  var input = document.getElementById('saReviewUrlInput');
  var status = document.getElementById('saReviewUrlStatus');
  var url = (input.value || '').trim();

  if (!url) { status.style.color = '#dc2626'; status.textContent = 'Enter a review link'; return; }
  try { new URL(url); } catch (e) { status.style.color = '#dc2626'; status.textContent = 'Invalid URL'; return; }
  if (!qrModalState.id) return;

  try {
    status.style.color = ''; status.textContent = 'Saving...';
    await fetchAPI('/admin/hotels/' + qrModalState.id + '/review-url', {
      method: 'PATCH',
      body: JSON.stringify({ reviewUrl: url })
    });
    qrModalState.reviewUrl = url;
    // Update source button data attribute
    var srcBtn = document.querySelector('.qr-hotel-btn[data-id="' + qrModalState.id + '"]');
    if (srcBtn) srcBtn.dataset.reviewurl = url;
    document.getElementById('saReviewUrlClearBtn').style.display = '';
    status.style.color = '#059669';
    status.textContent = '✓ Saved — back side will show review QR';
    showToast('Review link saved!', 'success');
    // Fetch review QR SVG
    fetch('/api/qr/review/' + qrModalState.id, { credentials: 'include' })
      .then(function(r) { return r.ok ? r.text() : null; })
      .then(function(svg) { qrModalState.reviewQrSvg = svg; })
      .catch(function() {});
  } catch (e) {
    status.style.color = '#dc2626';
    status.textContent = e.message || 'Failed to save';
  }
}

async function clearSaReviewUrl() {
  var status = document.getElementById('saReviewUrlStatus');
  if (!qrModalState.id) return;

  try {
    status.style.color = ''; status.textContent = 'Removing...';
    await fetchAPI('/admin/hotels/' + qrModalState.id + '/review-url', {
      method: 'PATCH',
      body: JSON.stringify({ reviewUrl: '' })
    });
    qrModalState.reviewUrl = '';
    qrModalState.reviewQrSvg = null;
    var srcBtn = document.querySelector('.qr-hotel-btn[data-id="' + qrModalState.id + '"]');
    if (srcBtn) srcBtn.dataset.reviewurl = '';
    document.getElementById('saReviewUrlInput').value = '';
    document.getElementById('saReviewUrlClearBtn').style.display = 'none';
    status.style.color = ''; status.textContent = '';
    showToast('Review link removed', 'success');
  } catch (e) {
    status.style.color = '#dc2626';
    status.textContent = e.message || 'Failed to remove';
  }
}

// ==================== PAYMENT HISTORY MODAL ====================
let currentPaymentHistoryId = null;

async function openPaymentHistoryModal(hotelId, hotelName) {
  currentPaymentHistoryId = hotelId;
  document.getElementById('paymentHistoryHotelName').textContent = hotelName;
  document.getElementById('paymentHistoryContent').innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">Loading...</div>';
  document.getElementById('paymentHistoryModal').classList.add('active');

  try {
    const data = await fetchAPI(`/admin/hotels/${hotelId}/payments`);
    renderPaymentHistory(data.payments || []);
  } catch (e) {
    document.getElementById('paymentHistoryContent').innerHTML =
      '<div style="text-align:center;padding:2rem;color:#ef4444;">Failed to load payments: ' + escapeHtml(e.message) + '</div>';
  }
}

function closePaymentHistoryModal() {
  document.getElementById('paymentHistoryModal').classList.remove('active');
  currentPaymentHistoryId = null;
}

function renderPaymentHistory(payments) {
  const container = document.getElementById('paymentHistoryContent');
  if (!payments.length) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">No payment records found.</div>';
    return;
  }

  // CREATED older than 30 min = abandoned checkout, not truly pending
  const STALE_MS = 30 * 60 * 1000;
  const now = Date.now();
  const statusLabels = { CAPTURED: 'Paid', REFUNDED: 'Refunded', FAILED: 'Failed', CREATED: 'Pending' };
  const statusColors = { CAPTURED: '#047857', REFUNDED: '#64748b', FAILED: '#dc2626', CREATED: '#2563eb' };
  const statusBg = { CAPTURED: '#ecfdf5', REFUNDED: '#f8fafc', FAILED: '#fef2f2', CREATED: '#eff6ff' };
  const statusBorder = { CAPTURED: '#a7f3d0', REFUNDED: '#e2e8f0', FAILED: '#fecaca', CREATED: '#bfdbfe' };
  const methodLabels = { cash: 'Cash', manual: 'Manual', upi: 'UPI', card: 'Card', netbanking: 'Net Banking', wallet: 'Wallet' };

  let html = '<table class="ph-table"><thead><tr>';
  html += '<th>Amount</th><th>Plan</th><th>Status</th><th>Method</th><th>Period</th><th>Created</th>';
  html += '</tr></thead><tbody>';

  payments.forEach(function(p) {
    const amount = '₹' + (p.amount / 100);
    // Mark stale CREATED as Abandoned
    const isAbandoned = p.status === 'CREATED' && (now - new Date(p.createdAt).getTime()) > STALE_MS;
    const displayStatus = isAbandoned ? 'ABANDONED' : p.status;
    const label = isAbandoned ? 'Abandoned' : (statusLabels[p.status] || p.status);
    const abandonedColor = '#92400e';
    const abandonedBg = '#fffbeb';
    const abandonedBorder = '#fde68a';
    const color = isAbandoned ? abandonedColor : (statusColors[p.status] || '#64748b');
    const bg = isAbandoned ? abandonedBg : (statusBg[p.status] || '#f8fafc');
    const border = isAbandoned ? abandonedBorder : (statusBorder[p.status] || '#e2e8f0');
    const method = p.method ? (methodLabels[p.method.toLowerCase()] || p.method) : '—';

    let period = '—';
    if (p.periodStart && p.periodEnd) {
      const ps = new Date(p.periodStart).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      const pe = new Date(p.periodEnd).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      period = ps + ' – ' + pe;
    }

    const createdDate = new Date(p.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const createdTime = new Date(p.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    const noteText = p.metadata && p.metadata.note ? ' title="' + escapeHtml(p.metadata.note) + '"' : '';

    html += '<tr' + noteText + '>';
    html += '<td class="ph-amount-cell">' + escapeHtml(amount) + '</td>';
    html += '<td><span class="ph-plan-tag">' + escapeHtml(p.plan) + '</span></td>';
    html += '<td><span class="ph-status-tag" style="background:' + bg + ';color:' + color + ';border:1px solid ' + border + ';">' + escapeHtml(label) + '</span></td>';
    html += '<td class="ph-method-cell">' + escapeHtml(method) + '</td>';
    html += '<td class="ph-period-cell">' + period + '</td>';
    html += '<td class="ph-date-cell">' + createdDate + '<br><span style="color:var(--text-tertiary);">' + createdTime + '</span></td>';
    html += '</tr>';
  });

  html += '</tbody></table>';

  // Summary counts — net revenue = captured minus refunded
  const captured = payments.filter(function(p) { return p.status === 'CAPTURED'; });
  const refunded = payments.filter(function(p) { return p.status === 'REFUNDED'; });
  const totalCaptured = captured.reduce(function(sum, p) { return sum + p.amount; }, 0);
  const totalRefunded = refunded.reduce(function(sum, p) { return sum + p.amount; }, 0);
  const netRevenue = totalCaptured - totalRefunded;
  const abandoned = payments.filter(function(p) { return p.status === 'CREATED' && (now - new Date(p.createdAt).getTime()) > STALE_MS; }).length;
  const pending = payments.filter(function(p) { return p.status === 'CREATED' && (now - new Date(p.createdAt).getTime()) <= STALE_MS; }).length;
  const counts = { CAPTURED: captured.length, FAILED: 0, REFUNDED: refunded.length };
  payments.forEach(function(p) { if (p.status === 'FAILED') counts.FAILED++; });

  let summary = '<div class="ph-summary">';
  summary += '<span class="ph-summary-item"><strong>Net Revenue:</strong> ₹' + (netRevenue / 100) + '</span>';
  if (totalRefunded > 0) summary += '<span class="ph-summary-item" style="color:#64748b;"><strong>Gross:</strong> ₹' + (totalCaptured / 100) + ' (₹' + (totalRefunded / 100) + ' refunded)</span>';
  summary += '<span class="ph-summary-item" style="color:#047857;">' + counts.CAPTURED + ' Paid</span>';
  if (pending > 0) summary += '<span class="ph-summary-item" style="color:#2563eb;">' + pending + ' Pending</span>';
  if (abandoned > 0) summary += '<span class="ph-summary-item" style="color:#92400e;">' + abandoned + ' Abandoned</span>';
  if (counts.FAILED > 0) summary += '<span class="ph-summary-item" style="color:#dc2626;">' + counts.FAILED + ' Failed</span>';
  if (counts.REFUNDED > 0) summary += '<span class="ph-summary-item" style="color:#64748b;">' + counts.REFUNDED + ' Refunded</span>';
  summary += '</div>';

  container.innerHTML = summary + html;
}

// Run init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}