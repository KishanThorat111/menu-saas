/**
 * KODSPOT — Shared QR Card Generator v2.0
 * 600 DPI A6-optimized, dual-side support
 * Used by both admin.js and superadmin.js
 *
 * Usage:
 *   const blob = await KodSpotQR.generateFront({ name, city, slug, logoUrl, hotelId, qrSvg, plan });
 *   const blob = await KodSpotQR.generateBack({ name, city, slug, logoUrl, hotelId, qrSvg, plan, reviewUrl });
 *   const blob = await KodSpotQR.generatePrintReady({ ... });
 */
var KodSpotQR = (function () {
  'use strict';

  // ── Constants: 600 DPI A6 ──────────────────────────────────────────────
  var W = 2480;      // 105mm at 600 DPI
  var H = 3508;      // 148mm at 600 DPI
  var SCALE = W / 1200; // ~2.067 scale factor from old design

  // ── Colors ─────────────────────────────────────────────────────────────
  var C = {
    bg:         '#ffffff',
    card:       '#ffffff',
    cardBorder: '#e5e7eb',
    cardShadow: 'rgba(0, 0, 0, 0.06)',
    title:      '#111827',
    city:       '#6b7280',
    qrModule:   '#1a1a1a',
    ctaPrimary: '#1f2937',
    ctaSub:     '#9ca3af',
    urlBg:      '#f9fafb',
    urlBorder:  '#e5e7eb',
    urlText:    '#374151',
    brand:      '#b8860b',
    brandSub:   '#d1d5db',
    separator:  '#e5e7eb',
    reviewStar: '#d97706',
    reviewText: '#92400e',
    reviewSub:  '#b45309'
  };

  // ── Helpers ────────────────────────────────────────────────────────────
  function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function loadImageAsync(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function truncateName(ctx, name, maxWidth) {
    var display = name;
    while (ctx.measureText(display).width > maxWidth && display.length > 10) {
      display = display.slice(0, -1);
    }
    if (display !== name) display += '\u2026';
    return display;
  }

  function safeName(name) {
    return (name || 'menu').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').substring(0, 40);
  }

  // ── Load QR SVG as Image ──────────────────────────────────────────────
  function loadQrImage(qrSvg) {
    var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(qrSvg);
    return loadImageAsync(url);
  }

  // ── Render shared top section (name + city + logo) ─────────────────────
  // Returns the Y position after this section
  function renderHeader(ctx, cfg) {
    var cx = W / 2;
    var contentY = 180; // Top margin

    // === Restaurant name ===
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.title;
    ctx.font = '600 112px Inter, -apple-system, sans-serif';
    var displayName = truncateName(ctx, cfg.name || 'Restaurant', W - 240);
    ctx.fillText(displayName, cx, contentY);

    contentY += 80;

    // === City ===
    if (cfg.city) {
      ctx.fillStyle = C.city;
      ctx.font = '400 56px Inter, -apple-system, sans-serif';
      ctx.fillText('\ud83d\udccd ' + cfg.city, cx, contentY);
      contentY += 90;
    } else {
      contentY += 40;
    }

    return contentY;
  }

  // ── Render logo (async) ────────────────────────────────────────────────
  // Returns new Y position
  async function renderLogo(ctx, cfg, startY) {
    if (!cfg.logoUrl || !cfg.hotelId) return startY;

    var logoImg = await loadImageAsync('/api/logo/' + cfg.hotelId + '?v=' + Date.now());
    if (!logoImg) return startY;

    var maxLW = 496, maxLH = 290; // Scaled up for 600 DPI
    var scale = Math.min(maxLW / logoImg.naturalWidth, maxLH / logoImg.naturalHeight, 1);
    var lw = Math.round(logoImg.naturalWidth * scale);
    var lh = Math.round(logoImg.naturalHeight * scale);
    var lx = (W - lw) / 2;
    var ly = startY;
    var lr = Math.min(33, lw / 4, lh / 4);

    // White background with border
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    roundRect(ctx, lx - 12, ly - 12, lw + 24, lh + 24, lr + 4);
    ctx.fill();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    roundRect(ctx, lx - 12, ly - 12, lw + 24, lh + 24, lr + 4);
    ctx.stroke();

    // Draw logo with rounded clip
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, lx, ly, lw, lh, lr);
    ctx.clip();
    ctx.drawImage(logoImg, lx, ly, lw, lh);
    ctx.restore();

    return ly + lh + 60;
  }

  // ── Render QR code (clean, no brackets) ────────────────────────────────
  // Returns new Y position
  async function renderQR(ctx, qrSvg, startY) {
    var cx = W / 2;
    var qrSize = 1770; // 75mm at 600 DPI
    var qrPad = 60;
    var qrBgSize = qrSize + qrPad * 2;
    var qrX = (W - qrBgSize) / 2;
    var qrY = startY;

    // QR background box with subtle shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.04)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    roundRect(ctx, qrX, qrY, qrBgSize, qrBgSize, 24);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = C.cardBorder;
    ctx.lineWidth = 2;
    ctx.beginPath();
    roundRect(ctx, qrX, qrY, qrBgSize, qrBgSize, 24);
    ctx.stroke();

    // Draw QR code
    var qrImg = await loadQrImage(qrSvg);
    if (qrImg) {
      ctx.drawImage(qrImg, qrX + qrPad, qrY + qrPad, qrSize, qrSize);
    }

    return qrY + qrBgSize + 55;
  }

  // ── Render CTA section (menu side) ─────────────────────────────────────
  function renderMenuCTA(ctx, startY) {
    var cx = W / 2;
    var y = startY;

    ctx.fillStyle = C.ctaPrimary;
    ctx.font = '600 68px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('\ud83d\udcf1 Scan to view menu', cx, y);

    y += 68;
    ctx.fillStyle = C.ctaSub;
    ctx.font = '400 48px Inter, -apple-system, sans-serif';
    ctx.fillText('No app needed \u2022 Opens in your browser', cx, y);

    return y + 60;
  }

  // ── Render CTA section (review side) ───────────────────────────────────
  function renderReviewCTA(ctx, startY) {
    var cx = W / 2;
    var y = startY;

    ctx.fillStyle = C.reviewText;
    ctx.font = '600 68px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('\u2b50 Enjoyed your meal?', cx, y);

    y += 68;
    ctx.fillStyle = C.reviewSub;
    ctx.font = '400 48px Inter, -apple-system, sans-serif';
    ctx.fillText('Tap to leave us a review!', cx, y);

    return y + 60;
  }

  // ── Render CTA section (UPI pay side) ─────────────────────────────────
  function renderUpiCTA(ctx, startY) {
    var cx = W / 2;
    var y = startY;

    ctx.fillStyle = '#059669';
    ctx.font = '600 68px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('\ud83d\udcb0 Scan to pay', cx, y);

    y += 68;
    ctx.fillStyle = '#6b7280';
    ctx.font = '400 48px Inter, -apple-system, sans-serif';
    ctx.fillText('Pay via UPI \u2022 PhonePe, GPay, Paytm', cx, y);

    return y + 60;
  }

  // ── Render URL section ─────────────────────────────────────────────────
  function renderURL(ctx, slug, startY) {
    var cx = W / 2;
    var y = startY;

    // Separator
    ctx.strokeStyle = C.separator;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(240, y);
    ctx.lineTo(W - 240, y);
    ctx.stroke();

    y += 70;

    // URL in subtle box
    var urlText = 'kodspot.com/m/' + slug;
    ctx.font = '500 52px Inter, -apple-system, sans-serif';
    var tw = ctx.measureText(urlText).width;
    var boxW = tw + 80;
    var boxH = 80;
    var boxX = (W - boxW) / 2;
    var boxY = y - boxH / 2;

    ctx.fillStyle = C.urlBg;
    ctx.beginPath();
    roundRect(ctx, boxX, boxY, boxW, boxH, 16);
    ctx.fill();
    ctx.strokeStyle = C.urlBorder;
    ctx.lineWidth = 2;
    ctx.beginPath();
    roundRect(ctx, boxX, boxY, boxW, boxH, 16);
    ctx.stroke();

    ctx.fillStyle = C.urlText;
    ctx.textAlign = 'center';
    ctx.fillText(urlText, cx, y + 4);

    return y + boxH / 2 + 40;
  }

  // ── Render "For menu, flip card" (review back side only) ───────────────
  function renderFlipHint(ctx, slug, startY) {
    var cx = W / 2;
    var y = startY;

    // Separator
    ctx.strokeStyle = C.separator;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(240, y);
    ctx.lineTo(W - 240, y);
    ctx.stroke();

    y += 70;

    ctx.fillStyle = C.city;
    ctx.font = '400 44px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('\ud83d\udcf1 For menu, flip this card', cx, y);

    return y + 50;
  }

  // ── Render footer ──────────────────────────────────────────────────────
  function renderFooter(ctx, plan) {
    var cx = W / 2;
    // Footer sits at fixed position near bottom (above the hidden base zone)
    // A6 base hides bottom ~18mm = ~425px at 600 DPI
    // Place footer at ~3020px so it's just above the base
    var y = H - 480;

    ctx.fillStyle = C.brand;
    ctx.font = '600 52px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('kodspot.com', cx, y);

    if (plan !== 'PRO') {
      y += 56;
      ctx.fillStyle = C.brandSub;
      ctx.font = '400 36px Inter, -apple-system, sans-serif';
      ctx.fillText('Powered by KodSpot', cx, y);
    }
  }

  // ── GENERATE FRONT SIDE ────────────────────────────────────────────────
  async function generateFront(cfg) {
    // cfg: { name, city, slug, logoUrl, hotelId, qrSvg, plan }
    if (!cfg.qrSvg || !cfg.slug) return null;

    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');

    // White background
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    // Header
    var y = renderHeader(ctx, cfg);

    // Logo
    y = await renderLogo(ctx, cfg, y);

    // QR Code
    y = await renderQR(ctx, cfg.qrSvg, y);

    // Menu CTA
    y = renderMenuCTA(ctx, y);

    // URL section
    y = renderURL(ctx, cfg.slug, y);

    // Footer
    renderFooter(ctx, cfg.plan);

    return new Promise(function (resolve) {
      canvas.toBlob(resolve, 'image/png', 1.0);
    });
  }

  // ── GENERATE BACK SIDE ─────────────────────────────────────────────────
  // If reviewUrl is provided, generates review card.
  // Otherwise, generates identical menu card (same as front).
  async function generateBack(cfg) {
    // cfg: { name, city, slug, logoUrl, hotelId, qrSvg, plan, reviewUrl?, reviewQrSvg?, upiId?, upiQrSvg? }
    var hasReview = !!(cfg.reviewUrl && cfg.reviewQrSvg);
    var hasUpi = !!(cfg.upiId && cfg.upiQrSvg);

    if (!hasReview && !hasUpi) {
      // No review URL and no UPI → back is identical to front
      return generateFront(cfg);
    }

    // Decide what to show on back side:
    // Priority: Review > UPI (review is the established pattern)
    // If both exist, show review on back (UPI is accessible via menu anyway)
    var useReview = hasReview;
    var useUpi = !hasReview && hasUpi;

    // Review card
    if (!cfg.slug) return null;

    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');

    // White background
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    // Header (same restaurant name + city)
    var y = renderHeader(ctx, cfg);

    // Logo
    y = await renderLogo(ctx, cfg, y);

    // QR Code — review or UPI
    if (useReview && cfg.reviewQrSvg) {
      y = await renderQR(ctx, cfg.reviewQrSvg, y);
    } else if (useUpi && cfg.upiQrSvg) {
      y = await renderQR(ctx, cfg.upiQrSvg, y);
    } else {
      y = await renderQR(ctx, cfg.qrSvg, y);
    }

    // CTA — review or UPI
    if (useReview) {
      y = renderReviewCTA(ctx, y);
    } else if (useUpi) {
      y = renderUpiCTA(ctx, y);
    }

    // "For menu, flip card" hint
    y = renderFlipHint(ctx, cfg.slug, y);

    // Footer
    renderFooter(ctx, cfg.plan);

    return new Promise(function (resolve) {
      canvas.toBlob(resolve, 'image/png', 1.0);
    });
  }

  // ── GENERATE PRINT-READY (both sides stacked) ─────────────────────────
  async function generatePrintReady(cfg) {
    var frontBlob = await generateFront(cfg);
    var backBlob = await generateBack(cfg);
    if (!frontBlob || !backBlob) return null;

    // Load both as images
    var frontUrl = URL.createObjectURL(frontBlob);
    var backUrl = URL.createObjectURL(backBlob);
    var frontImg = await loadImageAsync(frontUrl);
    var backImg = await loadImageAsync(backUrl);
    URL.revokeObjectURL(frontUrl);
    URL.revokeObjectURL(backUrl);
    if (!frontImg || !backImg) return null;

    // Create tall canvas: front + gap + label + back
    var gap = 120;
    var labelH = 80;
    var totalH = H + gap + labelH + H + gap + labelH;
    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = totalH;
    var ctx = canvas.getContext('2d');

    // Light gray background
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(0, 0, W, totalH);

    // Front label
    ctx.fillStyle = '#374151';
    ctx.font = '600 48px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('\u2702 FRONT SIDE \u2014 Cut along dotted line', W / 2, 56);

    // Dashed line
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 3;
    ctx.setLineDash([20, 12]);
    ctx.beginPath();
    ctx.moveTo(40, labelH);
    ctx.lineTo(W - 40, labelH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Front image
    ctx.drawImage(frontImg, 0, labelH);

    // Middle separator
    var midY = labelH + H + gap / 2;
    ctx.fillStyle = '#374151';
    ctx.font = '600 48px Inter, -apple-system, sans-serif';
    ctx.fillText('\u2702 BACK SIDE \u2014 Cut along dotted line', W / 2, midY + 24);

    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 3;
    ctx.setLineDash([20, 12]);
    ctx.beginPath();
    ctx.moveTo(40, midY + gap / 2);
    ctx.lineTo(W - 40, midY + gap / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Back image
    ctx.drawImage(backImg, 0, labelH + H + gap + labelH);

    return new Promise(function (resolve) {
      canvas.toBlob(resolve, 'image/png', 1.0);
    });
  }

  // ── Download helpers ───────────────────────────────────────────────────
  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  // ── Public API ─────────────────────────────────────────────────────────
  return {
    generateFront: generateFront,
    generateBack: generateBack,
    generatePrintReady: generatePrintReady,
    downloadBlob: downloadBlob,
    safeName: safeName,
    W: W,
    H: H
  };
})();
