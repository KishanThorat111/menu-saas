  // ── Focus Trap for Modal ─────────────────────────────────────────────
  function trapFocus(element) {
    const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusableElements = element.querySelectorAll(focusableSelectors);
    if (focusableElements.length === 0) return;
    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    element.addEventListener('keydown', function(e) {
      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    });
  }

/* ==========================================================================
   KODSPOT — PUBLIC MENU ENGINE v2.0
   Performance-first · CSP-compliant · Progressive enhancement
   Revenue-optimized visual hierarchy · 4 emotional theme territories
   ========================================================================== */

(function () {
  'use strict';

  // ── Utilities ──────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function getSlug() {
    // Support both /m/:code short URLs and legacy ?h= query param
    var pathMatch = window.location.pathname.match(/^\/m\/([A-Za-z2-7]{6})$/);
    if (pathMatch) return pathMatch[1].toUpperCase();
    var param = new URLSearchParams(window.location.search).get('h');
    return param ? param.toUpperCase().trim() : null;
  }

  function esc(text) {
    if (!text) return '';
    var d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  // ── DOM Refs ───────────────────────────────────────────────────────────
  var skeleton = $('skeleton');
  var content  = $('content');
  var modal    = $('modal');
  var modalImg = $('modalImg');
  var modalX   = $('modalClose');
  var topBtn   = $('topBtn');

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

  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
  });
  modalX.addEventListener('click', closeModal);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });

  // ── Back-to-Top Button ─────────────────────────────────────────────────
  var topBtnVisible = false;

  function initTopBtn() {
    var hero = document.querySelector('.hero');
    if (!hero) return;

    // Show/hide based on hero visibility
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

  // ── Category Navigation — Scroll tracking via IntersectionObserver ────
  var catObserver = null;
  var catPills = {};
  var catSections = {};
  var isNavClick = false;

  function initCatObserver() {
    if (catObserver) catObserver.disconnect();

    catObserver = new IntersectionObserver(function (entries) {
      if (isNavClick) return;
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          setActivePill(entry.target.id);
        }
      });
    }, {
      root: null,
      rootMargin: '-72px 0px -65% 0px',
      threshold: 0
    });

    Object.values(catSections).forEach(function (el) {
      catObserver.observe(el);
    });
  }

  function setActivePill(sectionId) {
    Object.values(catPills).forEach(function (p) { p.classList.remove('active'); });
    var catId = sectionId.replace('cat-', '');
    if (catPills[catId]) catPills[catId].classList.add('active');
  }

  // ── Sticky nav shadow on scroll ───────────────────────────────────────
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
    var theme = data.theme || 'classic';
    document.body.className = 'theme-' + theme;

    // Update meta theme-color
    var metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', THEME_COLORS[theme] || THEME_COLORS.classic);

    document.title = esc(data.name) + ' — Menu';

    // Count total dishes across all valid categories
    var validCats = [];
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
      html += '<span class="state-icon" aria-hidden="true">📋</span>';
      html += '<h2>Menu is being prepared</h2>';
      html += '<p>This restaurant is setting up their menu. Check back soon!</p>';
      html += '</div>';

      inject(html);
      return;
    }

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
    // Only animate the first 3 categories with CSS keyframe.
    // Beyond that, use scroll-reveal (class transition) for 60fps perf.
    var MAX_ANIM_CATS = 3;

    validCats.forEach(function (cat, ci) {
      var useAnim = ci < MAX_ANIM_CATS;
      var secClass = useAnim ? 'anim' : 'anim-scroll';
      var secDelay = useAnim ? ' style="animation-delay:' + (ci * 0.05).toFixed(2) + 's"' : '';

      html += '<section class="cat-section ' + secClass + '" id="cat-' + cat.id + '"' + secDelay + '>';

      // Category header
      html += '<div class="cat-head">';
      html += '<div class="cat-bar" aria-hidden="true"></div>';
      html += '<h2 class="cat-title">' + esc(cat.name) + '</h2>';
      html += '<span class="cat-count">' + cat.items.length + ' item' + (cat.items.length !== 1 ? 's' : '') + '</span>';
      html += '</div>';

      // Items list
      html += '<div class="items-list">';
      cat.items.forEach(function (item, ii) {
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

        html += '<article class="' + itemClass + '"' + itemStyle + '>';

        // Image or placeholder
        if (item.imageUrl) {
          html += '<div class="item-placeholder img-slot" data-src="' + esc(item.imageUrl) + '" aria-hidden="true">🍽️</div>';
        } else {
          html += '<div class="item-placeholder" aria-hidden="true">🍽️</div>';
        }

        // Body
        html += '<div class="item-body">';
        html += '<div class="item-row">';
        html += '<div class="item-info">';
        html += '<div class="item-name">';

        // Veg / Non-veg badge
        html += '<span class="' + (item.isVeg ? 'b-veg' : 'b-nv') + '" role="img" aria-label="' + (item.isVeg ? 'Vegetarian' : 'Non-vegetarian') + '"></span>';
        html += '<span>' + esc(item.name) + '</span>';

        // Popular badge
        if (item.isPopular) {
          html += ' <span class="b-pop">★ Popular</span>';
        }

        html += '</div>'; // .item-name

        if (item.description) {
          html += '<div class="item-desc">' + esc(item.description) + '</div>';
        }

        html += '</div>'; // .item-info
        html += '<div class="item-price">₹' + item.price + '</div>';
        html += '</div>'; // .item-row
        html += '</div>'; // .item-body

        html += '</article>';
      });
      html += '</div>'; // .items-list
      html += '</section>';
    });

    // ── Footer ──
    html += '<footer class="menu-footer anim" style="animation-delay:0.2s">';
    html += '<div class="menu-footer-brand">Powered by KodSpot</div>';
    html += '<a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a>';
    html += '</footer>';

    inject(html);

    // ── Wire up after DOM injection ──
    wireImages();
    wireNav(validCats);
    wireScrollReveal();
    wireNavFade();
    initNavShadow();
    initTopBtn();
  }

  // ── Inject HTML into content, hide skeleton ────────────────────────────
  function inject(html) {
    content.innerHTML = html;
    content.style.display = '';
    skeleton.style.display = 'none';
  }

  // ── Scroll-reveal for off-screen items (perf: no CSS keyframes) ────────
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
    }, {
      rootMargin: '0px 0px 60px 0px',
      threshold: 0.05
    });

    els.forEach(function (el) { revealObserver.observe(el); });
  }

  // ── Nav fade hint: remove fade when scrolled to end ────────────────────
  function wireNavFade() {
    var track = document.getElementById('catNavTrack');
    if (!track) return;

    function checkFade() {
      var atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
      track.classList.toggle('no-fade', atEnd);
    }

    track.addEventListener('scroll', checkFade, { passive: true });
    checkFade();
  }

  // ── Wire images: lazy load with fade-in transition ─────────────────────
  function wireImages() {
    content.querySelectorAll('.img-slot').forEach(function (slot) {
      var src = slot.getAttribute('data-src');
      if (!src) return;

      var img = document.createElement('img');
      img.className = 'item-img';
      img.alt = 'Dish photo';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.style.opacity = '0';
      img.style.transition = 'opacity 0.25s';
      img.src = src;

      img.addEventListener('load', function () {
        this.style.opacity = '1';
      });

      img.addEventListener('error', function () {
        // Revert to placeholder on error — don't show broken image
        this.style.display = 'none';
        var ph = document.createElement('div');
        ph.className = 'item-placeholder';
        ph.setAttribute('aria-hidden', 'true');
        ph.textContent = '🍽️';
        if (this.parentNode) this.parentNode.insertBefore(ph, this);
      });

      img.addEventListener('click', function () {
        openModal(this.src);
      });

      slot.replaceWith(img);
    });
  }

  // ── Wire category nav: click → smooth scroll + observer ────────────────
  function wireNav(validCats) {
    if (!validCats || validCats.length === 0) return;

    catPills = {};
    catSections = {};

    content.querySelectorAll('.cat-pill').forEach(function (pill) {
      var catId = pill.getAttribute('data-cat');
      catPills[catId] = pill;

      pill.addEventListener('click', function (e) {
        e.preventDefault();
        var target = document.getElementById('cat-' + catId);
        if (!target) return;

        isNavClick = true;
        setActivePill('cat-' + catId);
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Keep pill visible in nav track
        pill.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

        // Release observer lock after scroll animation settles
        setTimeout(function () { isNavClick = false; }, 850);
      });
    });

    content.querySelectorAll('.cat-section').forEach(function (sec) {
      var catId = sec.id.replace('cat-', '');
      catSections[catId] = sec;
    });

    initCatObserver();
  }

  // ── Error State ────────────────────────────────────────────────────────
  function showError(message, showRetry) {
    skeleton.style.display = 'none';
    content.style.display = '';
    content.innerHTML = '';

    var card = document.createElement('div');
    card.className = 'state-card anim';

    var icon = document.createElement('span');
    icon.className = 'state-icon';
    icon.textContent = '😔';
    card.appendChild(icon);

    var h = document.createElement('h2');
    h.textContent = message || 'Menu not found';
    card.appendChild(h);

    var p = document.createElement('p');
    p.textContent = 'This menu may not exist or is temporarily unavailable.';
    card.appendChild(p);

    if (showRetry) {
      var btn = document.createElement('button');
      btn.className = 'retry-btn';
      btn.textContent = 'Try Again';
      btn.addEventListener('click', function () { location.reload(); });
      card.appendChild(btn);
    }

    content.appendChild(card);
  }

  // ── Load Menu ──────────────────────────────────────────────────────────
  async function loadMenu() {
    var slug = getSlug();

    if (!slug) {
      showError('No menu specified', false);
      return;
    }

    try {
      var res = await fetch('/api/menu/' + encodeURIComponent(slug));
      if (!res.ok) throw new Error('not_found');

      var data = await res.json();
      renderMenu(data);
    } catch (e) {
      showError('Menu not found', true);
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────
  loadMenu();
})();