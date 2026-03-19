  // ── Focus Trap for Modal ─────────────────────────────────────────────
  function trapFocus(element) {
    var focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    var focusableElements = element.querySelectorAll(focusableSelectors);
    if (focusableElements.length === 0) return;
    var first = focusableElements[0];
    var last = focusableElements[focusableElements.length - 1];
    element.addEventListener('keydown', function(e) {
      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    });
  }

/* ==========================================================================
   KODSPOT — PUBLIC MENU ENGINE v3.0
   Grid layout · Search · Diet filter · Collapsible categories
   Performance-first · Concurrency-limited image loading preserved
   ========================================================================== */

(function () {
  'use strict';

  // ── Utilities ──────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function getSlug() {
    var pathMatch = window.location.pathname.match(/^\/m\/([A-Za-z2-7]{6})$/);
    if (pathMatch) return pathMatch[1].toUpperCase();
    var param = new URLSearchParams(window.location.search).get('h');
    return param ? param.toUpperCase().trim() : null;
  }

  function esc(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ── SVG Icons (inline, CSP-safe) ──────────────────────────────────────
  var ICONS = {
    search: '<svg class="search-icon" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    filter: '<svg viewBox="0 0 16 16" fill="none"><path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    chevronDown: '<svg class="filter-chevron" viewBox="0 0 12 12" fill="none"><path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    check: '<svg class="fo-check" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    catChevron: '<svg class="cat-chevron" viewBox="0 0 20 20" fill="none"><path d="M6 8l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    placeholder: '<svg viewBox="0 0 48 48" fill="none"><path d="M15 34l7-9 5 6 7-9 9 12H5l10-13z" fill="currentColor" opacity="0.3"/><circle cx="17" cy="18" r="4" fill="currentColor" opacity="0.3"/><rect x="4" y="8" width="40" height="32" rx="4" stroke="currentColor" stroke-width="2.5" opacity="0.25"/></svg>',
    star: '★'
  };

  // ── DOM Refs ───────────────────────────────────────────────────────────
  var skeleton = $('skeleton');
  var content  = $('content');
  var modal    = $('modal');
  var modalImg = $('modalImg');
  var modalX   = $('modalClose');
  var topBtn   = $('topBtn');

  // ── State ──────────────────────────────────────────────────────────────
  var menuData     = null;    // Full API response kept for re-filtering
  var validCats    = [];      // Categories with items
  var searchTerm   = '';
  var dietFilter   = 'all';   // 'all' | 'veg' | 'nonveg'
  var catPills     = {};
  var catSections  = {};
  var catObserver  = null;
  var isNavClick   = false;
  var topBtnVisible = false;
  var collapsedCats = {};     // { catId: true } — remembers collapse state

  // ── Image Modal ────────────────────────────────────────────────────────
  function openModal(src) {
    modalImg.src = src;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    trapFocus(modal);
    modalImg.focus();
  }

  function closeModal() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    modalImg.src = '';
    document.body.style.overflow = '';
  }

  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  modalX.addEventListener('click', closeModal);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  // ── Back-to-Top Button ─────────────────────────────────────────────────
  function initTopBtn() {
    var hero = document.querySelector('.hero');
    if (!hero) return;
    var observer = new IntersectionObserver(function (entries) {
      var shouldShow = !entries[0].isIntersecting;
      if (shouldShow !== topBtnVisible) {
        topBtnVisible = shouldShow;
        topBtn.classList.toggle('show', shouldShow);
      }
    }, { threshold: 0 });
    observer.observe(hero);
    topBtn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ── Category Observer (scroll tracking for pills) ──────────────────────
  function initCatObserver() {
    if (catObserver) catObserver.disconnect();
    catObserver = new IntersectionObserver(function (entries) {
      if (isNavClick) return;
      entries.forEach(function (entry) {
        if (entry.isIntersecting) setActivePill(entry.target.id);
      });
    }, { root: null, rootMargin: '-72px 0px -65% 0px', threshold: 0 });
    Object.values(catSections).forEach(function (el) { catObserver.observe(el); });
  }

  function setActivePill(sectionId) {
    Object.values(catPills).forEach(function (p) { p.classList.remove('active'); });
    var catId = sectionId.replace('cat-', '');
    if (catPills[catId]) catPills[catId].classList.add('active');
  }

  // ── Sticky nav shadow ─────────────────────────────────────────────────
  function initNavShadow() {
    var nav = $('catNav');
    var sentinel = $('navSentinel');
    if (!nav || !sentinel) return;
    var observer = new IntersectionObserver(function (entries) {
      nav.classList.toggle('scrolled', !entries[0].isIntersecting);
    }, { threshold: 0 });
    observer.observe(sentinel);
  }

  var THEME_COLORS = {
    classic: '#be7928',
    warm: '#ea580c',
    nature: '#059669',
    elegant: '#b8860b'
  };

  // ── Render Menu ────────────────────────────────────────────────────────
  function renderMenu(data) {
    menuData = data;
    var theme = data.theme || 'classic';
    document.body.className = 'theme-' + theme;

    var metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', THEME_COLORS[theme] || THEME_COLORS.classic);

    document.title = esc(data.name) + ' \u2014 Menu';

    // Build valid categories
    validCats = [];
    var totalItems = 0;
    if (data.categories) {
      data.categories.forEach(function (cat) {
        if (cat.items && cat.items.length > 0) {
          validCats.push(cat);
          totalItems += cat.items.length;
        }
      });
    }

    var html = '';

    // ── Hero Header ──
    html += '<div class="hero anim">';
    if (data.logoUrl) {
      html += '<img class="hero-logo" src="' + esc(data.logoUrl) + '" alt="' + esc(data.name) + ' logo">';
    }
    html += '<h1>' + esc(data.name) + '</h1>';
    html += '<div class="hero-meta">';
    html += '<span>' + esc(data.city) + '</span>';
    if (totalItems > 0) {
      html += '<span class="hero-dot" aria-hidden="true"></span>';
      html += '<span>' + totalItems + ' dish' + (totalItems !== 1 ? 'es' : '') + '</span>';
    }
    html += '</div>';
    html += '</div>';

    // ── Empty Menu State ──
    if (validCats.length === 0) {
      html += '<div class="state-card anim" style="animation-delay:0.1s">';
      html += '<span class="state-icon" aria-hidden="true">&#128203;</span>';
      html += '<h2>Menu is being prepared</h2>';
      html += '<p>This restaurant is setting up their menu. Check back soon!</p>';
      html += '</div>';
      inject(html);
      return;
    }

    // ── Search + Filter Toolbar ──
    html += buildToolbarHTML();

    // ── Nav sentinel (for shadow detection) ──
    html += '<div id="navSentinel" style="height:1px" aria-hidden="true"></div>';

    // ── Category Navigation ──
    html += '<nav class="cat-nav" id="catNav" aria-label="Menu categories">';
    html += '<div class="cat-nav-track" id="catNavTrack">';
    validCats.forEach(function (cat, i) {
      var cls = i === 0 ? ' active' : '';
      html += '<a class="cat-pill' + cls + '" href="#cat-' + cat.id + '" data-cat="' + cat.id + '">';
      html += esc(cat.name);
      html += ' <span class="cat-pill-count">' + cat.items.length + '</span>';
      html += '</a>';
    });
    html += '</div></nav>';

    // ── Category Sections ──
    var MAX_ANIM_CATS = 3;

    validCats.forEach(function (cat, ci) {
      var useAnim = ci < MAX_ANIM_CATS;
      var secClass = useAnim ? 'anim' : 'anim-scroll';
      var secDelay = useAnim ? ' style="animation-delay:' + (ci * 0.05).toFixed(2) + 's"' : '';

      html += '<section class="cat-section ' + secClass + '" id="cat-' + cat.id + '"' + secDelay + '>';

      // Category header (clickable to collapse)
      html += '<div class="cat-head" data-cat-id="' + cat.id + '" role="button" tabindex="0" aria-expanded="true">';
      html += '<div class="cat-bar" aria-hidden="true"></div>';
      html += '<h2 class="cat-title">' + esc(cat.name) + '</h2>';
      html += '<span class="cat-count" data-cat-count="' + cat.id + '">' + cat.items.length + ' item' + (cat.items.length !== 1 ? 's' : '') + '</span>';
      html += ICONS.catChevron;
      html += '</div>';

      // Collapsible items wrapper
      html += '<div class="cat-items-wrap" data-cat-wrap="' + cat.id + '">';

      // Items GRID
      html += '<div class="items-grid">';
      cat.items.forEach(function (item, ii) {
        html += buildItemCardHTML(item, ii, ci, useAnim);
      });
      html += '</div>'; // .items-grid

      html += '</div>'; // .cat-items-wrap
      html += '</section>';
    });

    // ── No-results placeholder (hidden initially) ──
    html += '<div class="no-results" id="noResults" style="display:none">';
    html += '<span class="no-results-icon" aria-hidden="true">&#128269;</span>';
    html += '<p>No dishes found</p>';
    html += '<button class="clear-link" id="clearFilters">Clear search &amp; filters</button>';
    html += '</div>';

    // ── Footer ──
    html += '<footer class="menu-footer anim" style="animation-delay:0.2s">';
    html += '<div class="menu-footer-brand">Powered by KodSpot</div>';
    html += '<a href="/privacy.html">Privacy</a> &middot; <a href="/terms.html">Terms</a>';
    html += '</footer>';

    inject(html);

    // CSP-safe: hero logo error handling (no inline onerror)
    var heroLogo = content.querySelector('.hero-logo');
    if (heroLogo) heroLogo.addEventListener('error', function () { this.style.display = 'none'; });

    // ── Wire up interactions ──
    wireImages();
    wireNav(validCats);
    wireScrollReveal();
    wireNavFade();
    initNavShadow();
    initTopBtn();
    wireSearch();
    wireFilter();
    wireCollapse();
    wireClearFilters();
    wireDescToggles();
  }

  // ── Description expand/collapse ─────────────────────────────────────────
  function wireDescToggles() {
    var descs = content.querySelectorAll('.item-desc');
    descs.forEach(function (desc) {
      if (desc.scrollHeight > desc.clientHeight + 1) {
        var toggle = desc.parentElement.querySelector('.desc-toggle');
        if (toggle) toggle.classList.add('visible');
      }
    });

    content.addEventListener('click', function (e) {
      var toggle = e.target.closest('.desc-toggle');
      if (!toggle) return;
      var body = toggle.closest('.item-body');
      if (!body) return;
      var desc = body.querySelector('.item-desc');
      if (!desc) return;
      var expanded = desc.classList.toggle('expanded');
      toggle.textContent = expanded ? 'less' : 'more';
      toggle.setAttribute('aria-label', expanded ? 'Show less' : 'Show full description');
    });

    content.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('desc-toggle')) {
        e.preventDefault();
        e.target.click();
      }
    });
  }

  // ── Build Toolbar HTML (search + filter) ───────────────────────────────
  function buildToolbarHTML() {
    var h = '<div class="toolbar">';

    // Search box
    h += '<div class="search-box">';
    h += ICONS.search;
    h += '<input type="search" id="searchInput" placeholder="Search dishes..." autocomplete="off" aria-label="Search dishes">';
    h += '<button class="search-clear" id="searchClear" aria-label="Clear search">&times;</button>';
    h += '</div>';

    // Filter button + dropdown
    h += '<div class="filter-wrap" id="filterWrap">';
    h += '<button class="filter-btn" id="filterBtn" aria-haspopup="true" aria-expanded="false">';
    h += ICONS.filter;
    h += '<span id="filterLabel">All</span>';
    h += ICONS.chevronDown;
    h += '</button>';
    h += '<div class="filter-dropdown" id="filterDropdown" role="menu">';

    // Options
    h += '<button class="filter-option selected" data-filter="all" role="menuitem">';
    h += '<span class="fo-icon">&#127869;</span> All';
    h += ICONS.check;
    h += '</button>';

    h += '<button class="filter-option" data-filter="veg" role="menuitem">';
    h += '<span class="fo-icon"><span class="b-veg" style="width:14px;height:14px"></span></span> Veg Only';
    h += ICONS.check;
    h += '</button>';

    h += '<button class="filter-option" data-filter="nonveg" role="menuitem">';
    h += '<span class="fo-icon"><span class="b-nv" style="width:14px;height:14px"></span></span> Non-Veg Only';
    h += ICONS.check;
    h += '</button>';

    h += '</div>'; // .filter-dropdown
    h += '</div>'; // .filter-wrap

    h += '</div>'; // .toolbar
    return h;
  }

  // ── Build single item card HTML ────────────────────────────────────────
  function buildItemCardHTML(item, ii, ci, useAnim) {
    var popClass = item.isPopular ? ' is-popular' : '';
    var itemClass, itemStyle;

    if (useAnim) {
      var delay = (ci * 0.04 + ii * 0.02).toFixed(3);
      itemClass = 'item-card anim' + popClass;
      itemStyle = ' style="animation-delay:' + delay + 's"';
    } else {
      itemClass = 'item-card anim-scroll' + popClass;
      itemStyle = '';
    }

    var h = '<article class="' + itemClass + '" data-item-id="' + item.id + '" data-veg="' + (item.isVeg ? '1' : '0') + '" data-name="' + esc(item.name).toLowerCase() + '"' + itemStyle + '>';

    // Image area
    h += '<div class="item-img-wrap">';
    if (item.imageUrl) {
      h += '<div class="item-placeholder-icon img-slot" data-src="' + esc(item.imageUrl) + '" aria-hidden="true">' + ICONS.placeholder + '</div>';
    } else {
      h += '<div class="item-placeholder-icon" aria-hidden="true">' + ICONS.placeholder + '</div>';
    }

    // Popular ribbon overlaid on image
    if (item.isPopular) {
      h += '<span class="pop-ribbon">' + ICONS.star + ' Popular</span>';
    }
    h += '</div>'; // .item-img-wrap

    // Body
    h += '<div class="item-body">';
    h += '<div class="item-name-row">';
    h += '<span class="' + (item.isVeg ? 'b-veg' : 'b-nv') + '" role="img" aria-label="' + (item.isVeg ? 'Vegetarian' : 'Non-vegetarian') + '"></span>';
    h += '<span class="item-name">' + esc(item.name) + '</span>';
    h += '</div>';

    if (item.description) {
      h += '<div class="item-desc">' + esc(item.description) + '</div>';
      h += '<span class="desc-toggle" role="button" tabindex="0" aria-label="Show full description">more</span>';
    }

    h += '<div class="item-price-row">';
    h += '<span class="item-price">\u20B9' + item.price + '</span>';
    h += '</div>';

    h += '</div>'; // .item-body
    h += '</article>';

    return h;
  }

  // ── Inject HTML into content, hide skeleton ────────────────────────────
  function inject(html) {
    content.innerHTML = html;
    content.style.display = '';
    skeleton.style.display = 'none';
  }

  // ── Search: debounced live filtering ───────────────────────────────────
  function wireSearch() {
    var input = $('searchInput');
    var clearBtn = $('searchClear');
    if (!input) return;

    var debounceTimer = null;

    input.addEventListener('input', function () {
      var val = this.value;
      clearBtn.classList.toggle('visible', val.length > 0);
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        searchTerm = val.trim().toLowerCase();
        applyFilters();
      }, 180);
    });

    clearBtn.addEventListener('click', function () {
      input.value = '';
      clearBtn.classList.remove('visible');
      searchTerm = '';
      applyFilters();
      input.focus();
    });
  }

  // ── Filter: dropdown toggle + selection ────────────────────────────────
  function wireFilter() {
    var btn = $('filterBtn');
    var dropdown = $('filterDropdown');
    var wrap = $('filterWrap');
    if (!btn || !dropdown) return;

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = dropdown.classList.contains('open');
      dropdown.classList.toggle('open', !isOpen);
      btn.classList.toggle('open', !isOpen);
      btn.setAttribute('aria-expanded', String(!isOpen));
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) {
        dropdown.classList.remove('open');
        btn.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });

    // Option clicks
    dropdown.addEventListener('click', function (e) {
      var option = e.target.closest('.filter-option');
      if (!option) return;
      var value = option.getAttribute('data-filter');
      dietFilter = value;

      // Update selected state
      dropdown.querySelectorAll('.filter-option').forEach(function (o) { o.classList.remove('selected'); });
      option.classList.add('selected');

      // Update button label
      var label = $('filterLabel');
      var labels = { all: 'All', veg: 'Veg', nonveg: 'Non-Veg' };
      label.textContent = labels[value] || 'All';

      // Active state on button
      btn.classList.toggle('active', value !== 'all');

      // Close dropdown
      dropdown.classList.remove('open');
      btn.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');

      applyFilters();
    });
  }

  // ── Apply search + diet filter together ────────────────────────────────
  function applyFilters() {
    var totalVisible = 0;

    validCats.forEach(function (cat) {
      var sectionEl = document.getElementById('cat-' + cat.id);
      var pillEl = catPills[cat.id];
      if (!sectionEl) return;

      var cards = sectionEl.querySelectorAll('.item-card');
      var catVisible = 0;

      cards.forEach(function (card) {
        var nameMatch = !searchTerm || card.getAttribute('data-name').indexOf(searchTerm) !== -1;
        var vegMatch = dietFilter === 'all' ||
          (dietFilter === 'veg' && card.getAttribute('data-veg') === '1') ||
          (dietFilter === 'nonveg' && card.getAttribute('data-veg') === '0');

        var show = nameMatch && vegMatch;
        card.classList.toggle('item-hidden', !show);
        if (show) catVisible++;
      });

      totalVisible += catVisible;

      // Hide entire category section + pill if no items match
      var hidden = catVisible === 0;
      sectionEl.classList.toggle('cat-hidden', hidden);
      if (pillEl) pillEl.classList.toggle('cat-hidden', hidden);

      // Update count badge
      var countEl = sectionEl.querySelector('[data-cat-count="' + cat.id + '"]');
      if (countEl) {
        countEl.textContent = catVisible + ' item' + (catVisible !== 1 ? 's' : '');
      }

      // Update pill count
      if (pillEl) {
        var pillCount = pillEl.querySelector('.cat-pill-count');
        if (pillCount) pillCount.textContent = catVisible;
      }
    });

    // Show/hide "no results" card
    var noResults = $('noResults');
    if (noResults) {
      noResults.style.display = totalVisible === 0 ? '' : 'none';
    }
  }

  // ── Clear all filters button ───────────────────────────────────────────
  function wireClearFilters() {
    var btn = $('clearFilters');
    if (!btn) return;
    btn.addEventListener('click', function () {
      // Reset search
      var input = $('searchInput');
      if (input) { input.value = ''; }
      var clearBtn = $('searchClear');
      if (clearBtn) clearBtn.classList.remove('visible');
      searchTerm = '';

      // Reset filter
      dietFilter = 'all';
      var label = $('filterLabel');
      if (label) label.textContent = 'All';
      var filterBtn = $('filterBtn');
      if (filterBtn) filterBtn.classList.remove('active');
      var filterDropdown = $('filterDropdown');
      if (filterDropdown) {
        filterDropdown.querySelectorAll('.filter-option').forEach(function (o) { o.classList.remove('selected'); });
        var allOption = filterDropdown.querySelector('[data-filter="all"]');
        if (allOption) allOption.classList.add('selected');
      }

      applyFilters();
    });
  }

  // ── Collapsible Categories ─────────────────────────────────────────────
  function wireCollapse() {
    var heads = content.querySelectorAll('.cat-head');
    heads.forEach(function (head) {
      head.addEventListener('click', function () { toggleCat(this); });
      head.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleCat(this);
        }
      });
    });
  }

  function toggleCat(headEl) {
    var catId = headEl.getAttribute('data-cat-id');
    var wrap = content.querySelector('[data-cat-wrap="' + catId + '"]');
    if (!wrap) return;

    var isCollapsed = headEl.classList.contains('collapsed');

    if (isCollapsed) {
      // Expand
      headEl.classList.remove('collapsed');
      headEl.setAttribute('aria-expanded', 'true');
      wrap.classList.remove('collapsed');
      wrap.style.maxHeight = wrap.scrollHeight + 'px';
      delete collapsedCats[catId];
      // Re-observe images that may now be visible
      wireImagesInContainer(wrap);
      // Clear maxHeight after transition so content can grow (e.g. images loading)
      setTimeout(function () { wrap.style.maxHeight = ''; }, 400);
    } else {
      // Collapse
      wrap.style.maxHeight = wrap.scrollHeight + 'px';
      // Force reflow then collapse
      wrap.offsetHeight; // eslint-disable-line no-unused-expressions
      wrap.classList.add('collapsed');
      headEl.classList.add('collapsed');
      headEl.setAttribute('aria-expanded', 'false');
      collapsedCats[catId] = true;
    }
  }

  // ── Scroll-reveal for off-screen items ─────────────────────────────────
  function wireScrollReveal() {
    var els = content.querySelectorAll('.anim-scroll');
    if (!els.length) return;
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px 60px 0px', threshold: 0.05 });
    els.forEach(function (el) { revealObserver.observe(el); });
  }

  // ── Nav fade hint: remove fade when scrolled to end ────────────────────
  function wireNavFade() {
    var track = $('catNavTrack');
    if (!track) return;
    function checkFade() {
      var atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
      track.classList.toggle('no-fade', atEnd);
    }
    track.addEventListener('scroll', checkFade, { passive: true });
    checkFade();
  }

  // ── Wire images: IntersectionObserver + concurrency-limited queue ─────
  // Max 4 concurrent downloads prevents overwhelming R2 CDN.
  // Retries free the queue slot immediately so they don't block other images.
  var imgQueue = [];
  var imgActive = 0;
  var IMG_MAX_CONCURRENT = 4;
  var imgObserver = null;

  function processImgQueue() {
    while (imgActive < IMG_MAX_CONCURRENT && imgQueue.length > 0) {
      imgActive++;
      loadImage(imgQueue.shift());
    }
  }

  function onImgDone() {
    imgActive--;
    processImgQueue();
  }

  function loadImage(slot) {
    var src = slot.getAttribute('data-src');
    if (!src) { onImgDone(); return; }

    var img = document.createElement('img');
    var settled = false;
    img.className = 'item-img';
    img.alt = 'Dish photo';
    img.decoding = 'async';
    img.style.opacity = '0';
    img.style.transition = 'opacity 0.25s';

    img.addEventListener('load', function () {
      this.style.opacity = '1';
      if (!settled) { settled = true; onImgDone(); }
    });

    img.addEventListener('error', function () {
      var self = this;
      if (!settled) { settled = true; onImgDone(); }

      var retries = parseInt(self.getAttribute('data-retries') || '0', 10);
      if (retries < 2) {
        self.setAttribute('data-retries', String(retries + 1));
        setTimeout(function () {
          self.src = src + (src.indexOf('?') === -1 ? '?' : '&') + '_r=' + (retries + 1);
        }, 1500);
        return;
      }
      // Final failure: show SVG placeholder instead
      self.style.display = 'none';
      var ph = document.createElement('div');
      ph.className = 'item-placeholder-icon';
      ph.setAttribute('aria-hidden', 'true');
      ph.innerHTML = ICONS.placeholder;
      if (self.parentNode) self.parentNode.insertBefore(ph, self);
    });

    img.addEventListener('click', function () {
      openModal(this.src);
    });

    img.src = src;
    slot.replaceWith(img);
  }

  function wireImages() {
    var slots = content.querySelectorAll('.img-slot');
    if (!slots.length) return;

    imgObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        imgObserver.unobserve(entry.target);
        imgQueue.push(entry.target);
      });
      processImgQueue();
    }, { rootMargin: '200px 0px', threshold: 0 });

    slots.forEach(function (slot) { imgObserver.observe(slot); });
  }

  // Re-observe images in a container (used after expanding collapsed section)
  function wireImagesInContainer(container) {
    if (!imgObserver) return;
    var slots = container.querySelectorAll('.img-slot');
    slots.forEach(function (slot) { imgObserver.observe(slot); });
  }

  // ── Wire category nav: click → smooth scroll + observer ────────────────
  function wireNav(cats) {
    if (!cats || cats.length === 0) return;

    catPills = {};
    catSections = {};

    function getNavHeight() {
      var nav = $('catNav');
      return nav ? nav.offsetHeight : 56;
    }

    function centerPill(pill) {
      var track = $('catNavTrack');
      if (!track) return;
      var trackRect = track.getBoundingClientRect();
      var pillRect = pill.getBoundingClientRect();
      var offset = pillRect.left - trackRect.left + track.scrollLeft
                   - (track.clientWidth - pill.offsetWidth) / 2;
      track.scrollTo({ left: Math.max(0, offset), behavior: 'smooth' });
    }

    cats.forEach(function (cat) {
      var pill = content.querySelector('.cat-pill[data-cat="' + cat.id + '"]');
      var sec = $('cat-' + cat.id);
      if (pill && sec) {
        catPills[cat.id] = pill;
        catSections[cat.id] = sec;

        pill.addEventListener('click', function (e) {
          e.preventDefault();
          isNavClick = true;
          setActivePill('cat-' + cat.id);
          centerPill(pill);

          // Expand if collapsed
          var head = sec.querySelector('.cat-head');
          if (head && head.classList.contains('collapsed')) {
            toggleCat(head);
          }

          var y = sec.getBoundingClientRect().top + window.pageYOffset - getNavHeight() - 8;
          window.scrollTo({ top: y, behavior: 'smooth' });

          setTimeout(function () { isNavClick = false; }, 800);
        });
      }
    });

    initCatObserver();
  }

  // ── Fetch & Boot ───────────────────────────────────────────────────────
  var slug = getSlug();

  if (!slug) {
    inject(
      '<div class="state-card">' +
      '<span class="state-icon" aria-hidden="true">&#128279;</span>' +
      '<h2>Invalid Menu Link</h2>' +
      '<p>This link doesn\u2019t contain a valid menu code. Please scan the QR code again.</p>' +
      '</div>'
    );
  } else {
    fetch('/api/menu/' + encodeURIComponent(slug))
      .then(function (res) {
        if (!res.ok) throw new Error(res.status);
        return res.json();
      })
      .then(renderMenu)
      .catch(function () {
        inject(
          '<div class="state-card">' +
          '<span class="state-icon" aria-hidden="true">&#128542;</span>' +
          '<h2>Menu Not Found</h2>' +
          '<p>We couldn\u2019t load this menu. The restaurant may be updating — try again shortly.</p>' +
          '<button class="retry-btn" id="retryBtn">&#x21bb; Retry</button>' +
          '</div>'
        );
        var retryBtn = $('retryBtn');
        if (retryBtn) retryBtn.addEventListener('click', function () { location.reload(); });
      });
  }
})();
