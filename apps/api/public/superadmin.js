const API = '';
const ITEMS_PER_PAGE = 10;

// State management
let currentPage = 1;
let currentEditId = null;
let searchDebounceTimer = null;
let isLoggingIn = false;
let currentSearchQuery = '';
let currentStatusFilter = '';

// Global stats cache (fetched separately)
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

function showToast(message, type = 'success', duration = 3000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : '⚠';
    toast.innerHTML = `<span style="font-size: 18px;">${icon}</span><span>${escapeHtml(message)}</span>`;
    
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
        await fetchGlobalStats(); // Get accurate global stats
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
    // 1. Immediately hide the dashboard to stop the UI from making more data calls
    document.getElementById('dashboardScreen').classList.add('hidden');
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('adminKey').value = '';

    try {
        // 2. Use standard 'fetch' with X-Requested-With header to pass CSRF check
        await fetch(`${API}/auth/admin/logout`, { 
            method: 'POST', 
            credentials: 'include',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
    } catch (e) {
        console.log('Session already cleared');
    }
    
    // 3. Reset local variables
    currentPage = 1;
    currentSearchQuery = '';
    currentStatusFilter = '';
    showToast('Logged out successfully');
}

// Fetch global stats from a dedicated endpoint (we'll use the full list for now)
async function fetchGlobalStats() {
    try {
        // Fetch all hotels without pagination for accurate stats
        const response = await fetchAPI('/admin/hotels?limit=1000');
        const allHotels = response.hotels || [];
        
        globalStats = {
            total: response.total || allHotels.length,
            trial: allHotels.filter(h => h.status === 'TRIAL').length,
            active: allHotels.filter(h => h.status === 'ACTIVE').length,
            views: allHotels.reduce((sum, h) => sum + (h.views || 0), 0)
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

// Main fetch function - ALWAYS server-side pagination
async function fetchHotels() {
    showPageLoading(true);
    try {
        // Build URL with filters
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

function renderTable(hotels) {
    const tbody = document.getElementById('hotelsBody');
    
    if (hotels.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <div class="empty-state-icon">🔍</div>
                    <p>No hotels found</p>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = hotels.map(hotel => {
        const trialInfo = hotel.trialEnds ? formatDate(hotel.trialEnds) : null;
        const paidInfo = hotel.paidUntil ? formatDate(hotel.paidUntil) : null;
        
        let dateDisplay = '';
        if (hotel.status === 'TRIAL' && trialInfo) {
            dateDisplay = `<div class="date-info ${trialInfo.isOverdue ? 'overdue' : ''}">
                Trial ends: ${trialInfo.formatted}
            </div>`;
        } else if (['ACTIVE', 'GRACE'].includes(hotel.status) && paidInfo) {
            dateDisplay = `<div class="date-info ${paidInfo.isOverdue ? 'overdue' : ''}">
                Paid until: ${paidInfo.formatted}
            </div>`;
        }
        
        return `
            <tr>
                <td>
                    <div class="hotel-info">
                        <span class="hotel-name">${escapeHtml(hotel.name)}</span>
                        <span class="hotel-meta">${escapeHtml(hotel.city)} • ${escapeHtml(hotel.phone)}</span>
                        <code style="font-size: 11px; color: var(--text-secondary);">${escapeHtml(hotel.slug)}</code>
                        <div class="hotel-links">
                            <a href="/admin.html" target="_blank">Admin</a>
                            <a href="/menu.html?h=${escapeHtml(hotel.slug)}" target="_blank">Menu</a>
                        </div>
                    </div>
                </td>
                <td><span class="plan-badge">${hotel.plan}</span></td>
                <td><span class="badge status-${hotel.status}">${hotel.status}</span></td>
                <td>${dateDisplay || '-'}</td>
                <td>${(hotel.views || 0).toLocaleString('en-IN')}</td>
                <td>
                    <button class="btn btn-sm btn-secondary edit-hotel-btn" 
                            data-id="${hotel.id}" 
                            data-name="${escapeHtml(hotel.name)}" 
                            data-status="${hotel.status}">
                        Edit Status
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    // Attach event listeners to dynamically created edit buttons
    tbody.querySelectorAll('.edit-hotel-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const id = this.dataset.id;
            const name = this.dataset.name;
            const status = this.dataset.status;
            openEditModal(id, name, status);
        });
    });
}

function renderPagination(totalPages, totalItems) {
    const container = document.getElementById('pagination');
    
    if (totalPages <= 1) {
        container.innerHTML = totalItems > 0 ? `<p style="color: var(--text-secondary); text-align: center; margin-top: 10px;">Showing ${totalItems} hotel${totalItems !== 1 ? 's' : ''}</p>` : '';
        return;
    }
    
    let html = `<p style="color: var(--text-secondary); text-align: center; margin-bottom: 10px;">Page ${currentPage} of ${totalPages} (${totalItems} total)</p>`;
    
    html += `<button class="page-btn" data-page="${currentPage - 1}" 
             ${currentPage === 1 ? 'disabled' : ''}>← Prev</button>`;
    
    // Show page numbers with ellipsis
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
            html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" 
                     data-page="${i}">${i}</button>`;
        } else if (i === currentPage - 2 || i === currentPage + 2) {
            html += `<span style="color: var(--text-secondary); padding: 8px;">...</span>`;
        }
    }
    
    html += `<button class="page-btn" data-page="${currentPage + 1}" 
             ${currentPage === totalPages ? 'disabled' : ''}>Next →</button>`;
    
    container.innerHTML = html;

    // Attach event listeners to pagination buttons
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
    fetchHotels(); // Always fetch from server
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function debounceSearch(query) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        currentSearchQuery = query;
        currentPage = 1; // Reset to first page on new search
        fetchHotels();
    }, 300);
}

function applyFilters() {
    const statusFilter = document.getElementById('filterStatus').value;
    currentStatusFilter = statusFilter;
    currentPage = 1; // Reset to first page on filter change
    fetchHotels();
}

// Modal functions - now receive data as parameters instead of searching array
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

function closeModal() {
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
        closeModal();
        await fetchHotels(); // Refresh current page
        await fetchGlobalStats(); // Refresh stats
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        setLoading('saveStatusBtn', false, 'Save Changes');
    }
}

async function createHotel() {
    const payload = {
        name: document.getElementById('hName').value.trim(),
        city: document.getElementById('hCity').value.trim(),
        phone: document.getElementById('hPhone').value.trim(),
        slug: document.getElementById('hSlug').value.trim(),
        pin: document.getElementById('hPin').value.trim(),
        plan: document.getElementById('hPlan').value
    };

    if (!payload.name || !payload.city || !payload.phone || !payload.slug || !payload.pin) {
        showToast('Please fill all required fields', 'error');
        return;
    }
    
    if (payload.pin.length !== 4 || !/^\d{4}$/.test(payload.pin)) {
        showToast('PIN must be exactly 4 digits', 'error');
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
        
        showToast(`Hotel created! PIN: ${result.pin}`, 'success', 5000);
        
        ['hName', 'hCity', 'hPhone', 'hSlug', 'hPin'].forEach(id => {
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

// Input validation handlers
function handleSlugInput(e) {
    e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

function handlePinInput(e) {
    e.target.value = e.target.value.replace(/[^0-9]/g, '');
}

// Auto-login check using cookie
async function init() {
    console.log('Initializing...');
    
    // Setup all event listeners
    setupEventListeners();
    
    try {
        await fetchAPI('/auth/admin/me');
        
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('dashboardScreen').classList.remove('hidden');
        
        // Reset filters on init
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
    document.getElementById('hSlug').addEventListener('input', handleSlugInput);
    document.getElementById('hPin').addEventListener('input', handlePinInput);
    
    // Search and filter
    document.getElementById('searchInput').addEventListener('input', function() {
        debounceSearch(this.value);
    });
    document.getElementById('filterStatus').addEventListener('change', applyFilters);
    
    // Modal
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('cancelEditBtn').addEventListener('click', closeModal);
    document.getElementById('saveStatusBtn').addEventListener('click', saveStatus);
    document.getElementById('editStatus').addEventListener('change', onStatusChange);
    
    // Close modal on backdrop click
    document.getElementById('editModal').addEventListener('click', function(e) {
        if (e.target.id === 'editModal') closeModal();
    });
    
    // Escape key to close modal
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeModal();
    });
}

// Run init when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
