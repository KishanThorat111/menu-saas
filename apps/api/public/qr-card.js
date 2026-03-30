/**
 * KODSPOT — Premium QR Card Generator v3.0
 * 600 DPI A6 · Dark walnut + gold luxury design
 * Used by both admin.js and superadmin.js
 *
 * Usage:
 *   const blob = await KodSpotQR.generateFront({ name, city, slug, logoUrl, hotelId, qrSvg, plan });
 *   const blob = await KodSpotQR.generateBack({ name, city, slug, logoUrl, hotelId, qrSvg, plan, reviewUrl?, reviewQrSvg?, upiId?, upiQrSvg? });
 *   const blob = await KodSpotQR.generatePrintReady({ ... });
 */
var KodSpotQR = (function () {
  'use strict';

  // ── Constants: 600 DPI A6 ──────────────────────────────────────────────
  var W = 2480;      // 105mm at 600 DPI
  var H = 3508;      // 148mm at 600 DPI

  // ── Premium Color Palette ──────────────────────────────────────────────
  var C = {
    bgDark:       '#2C1810',   // Deep walnut
    bgMid:        '#3B2314',   // Medium walnut
    bgLight:      '#4A2E1C',   // Lighter center (radial)
    gold:         '#C5A55A',   // Primary gold
    goldLight:    '#D4B96E',   // Highlight gold
    goldDark:     '#A08840',   // Shadow gold
    goldPill:     '#B8960F',   // URL pill fill
    goldPillText: '#3B2314',   // URL pill text
    cream:        '#F5E6C8',   // Cream text
    creamSoft:    '#E8D5B0',   // Softer cream
    white:        '#FFFFFF',
    qrBg:         '#FFFFFF',
    qrFrame:      '#C5A55A',
    kBadgeBg:     '#D4900A',   // Orange KodSpot badge
    kBadgeText:   '#FFFFFF',
    reviewStar:   '#D4900A',
    reviewText:   '#F5E6C8',
    upiGreen:     '#4ADE80',
    upiText:      '#F5E6C8',
    footerText:   '#8B7355'
  };

  // ── Helpers ────────────────────────────────────────────────────────────
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
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

  function loadQrImage(qrSvg) {
    var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(qrSvg);
    return loadImageAsync(url);
  }

  // ── Create gold gradient ──────────────────────────────────────────────
  function goldGrad(ctx, x1, y1, x2, y2) {
    var g = ctx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, C.goldDark);
    g.addColorStop(0.3, C.goldLight);
    g.addColorStop(0.5, C.gold);
    g.addColorStop(0.7, C.goldLight);
    g.addColorStop(1, C.goldDark);
    return g;
  }

  // ── Render premium background ─────────────────────────────────────────
  function renderBackground(ctx) {
    // Base dark fill
    ctx.fillStyle = C.bgDark;
    ctx.fillRect(0, 0, W, H);

    // Radial gradient — lighter center for depth
    var grad = ctx.createRadialGradient(W / 2, H * 0.4, 100, W / 2, H * 0.4, W * 0.9);
    grad.addColorStop(0, C.bgLight);
    grad.addColorStop(0.5, C.bgMid);
    grad.addColorStop(1, C.bgDark);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Subtle texture — fine noise using semi-transparent dots
    ctx.globalAlpha = 0.03;
    for (var i = 0; i < 15000; i++) {
      var nx = Math.random() * W;
      var ny = Math.random() * H;
      var nr = Math.random() * 3 + 1;
      ctx.fillStyle = Math.random() > 0.5 ? '#000000' : '#FFFFFF';
      ctx.beginPath();
      ctx.arc(nx, ny, nr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
  }

  // ── Render gold borders ───────────────────────────────────────────────
  function renderBorders(ctx) {
    var m = 60;  // outer margin

    // Outer gold border (thick)
    ctx.strokeStyle = goldGrad(ctx, m, m, W - m, H - m);
    ctx.lineWidth = 8;
    roundRect(ctx, m, m, W - m * 2, H - m * 2, 20);
    ctx.stroke();

    // Inner decorative border (thin, with gap)
    var m2 = 100;
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 3;
    roundRect(ctx, m2, m2, W - m2 * 2, H - m2 * 2, 16);
    ctx.stroke();

    // Inner dotted accent border
    var m3 = 116;
    ctx.strokeStyle = C.goldDark;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 12]);
    roundRect(ctx, m3, m3, W - m3 * 2, H - m3 * 2, 14);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Render corner ornaments ───────────────────────────────────────────
  // Elegant geometric L-corners with decorative dots and small flourishes
  function renderCorners(ctx) {
    var positions = [
      { x: 68, y: 68, sx: 1, sy: 1 },        // Top-left
      { x: W - 68, y: 68, sx: -1, sy: 1 },    // Top-right
      { x: 68, y: H - 68, sx: 1, sy: -1 },    // Bottom-left
      { x: W - 68, y: H - 68, sx: -1, sy: -1 } // Bottom-right
    ];

    positions.forEach(function (p) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(p.sx, p.sy);

      var g = goldGrad(ctx, 0, 0, 180, 180);
      ctx.strokeStyle = g;
      ctx.fillStyle = g;

      // L-shape arms
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(0, 120);
      ctx.lineTo(0, 20);
      ctx.quadraticCurveTo(0, 0, 20, 0);
      ctx.lineTo(120, 0);
      ctx.stroke();

      // Small scroll on vertical arm
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(8, 100);
      ctx.quadraticCurveTo(20, 95, 22, 80);
      ctx.stroke();

      // Small scroll on horizontal arm
      ctx.beginPath();
      ctx.moveTo(100, 8);
      ctx.quadraticCurveTo(95, 20, 80, 22);
      ctx.stroke();

      // Corner diamond
      ctx.beginPath();
      ctx.moveTo(24, 12);
      ctx.lineTo(32, 4);
      ctx.lineTo(40, 12);
      ctx.lineTo(32, 20);
      ctx.closePath();
      ctx.fill();

      // Decorative dots
      [{ cx: 55, cy: 6 }, { cx: 75, cy: 6 }, { cx: 95, cy: 6 },
       { cx: 6, cy: 55 }, { cx: 6, cy: 75 }, { cx: 6, cy: 95 }].forEach(function (d) {
        ctx.beginPath();
        ctx.arc(d.cx, d.cy, 3.5, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();
    });
  }

  // ── Render KodSpot branding + hotel name ──────────────────────────────
  function renderBranding(ctx, cfg) {
    var y = 200;
    var leftX = 180;

    // Orange "K" badge
    var badgeSize = 80;
    var badgeR = 16;
    ctx.fillStyle = C.kBadgeBg;
    roundRect(ctx, leftX, y - badgeSize + 12, badgeSize, badgeSize, badgeR);
    ctx.fill();

    ctx.fillStyle = C.kBadgeText;
    ctx.font = 'bold 56px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('K', leftX + badgeSize / 2, y - badgeSize / 2 + 14);

    // "KodSpot" text
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.goldLight;
    ctx.font = 'bold 60px Georgia, "Times New Roman", serif';
    ctx.fillText('KodSpot', leftX + badgeSize + 20, y);

    // Hotel name — cream, same line continuation
    var ksWidth = ctx.measureText('KodSpot').width;
    ctx.fillStyle = C.cream;
    ctx.font = '400 52px Georgia, "Times New Roman", serif';
    var nameX = leftX + badgeSize + 20 + ksWidth + 20;
    var maxNameW = W - nameX - 200;
    var displayName = truncateName(ctx, cfg.name || 'Restaurant', maxNameW);
    ctx.fillText(displayName, nameX, y);

    // City below
    y += 60;
    if (cfg.city) {
      ctx.fillStyle = C.creamSoft;
      ctx.font = '400 44px Georgia, "Times New Roman", serif';
      ctx.fillText('\uD83D\uDCCD ' + cfg.city, leftX + badgeSize + 20, y);
      y += 80;
    } else {
      y += 40;
    }

    return y;
  }

  // ── Render "MENU" title (or custom title) ─────────────────────────────
  function renderTitle(ctx, text, startY) {
    var cx = W / 2;
    var y = startY + 20;

    // Gold gradient text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 140px Georgia, "Times New Roman", serif';

    // Measure for underline
    var tw = ctx.measureText(text).width;

    // Text with gold gradient
    ctx.fillStyle = goldGrad(ctx, cx - tw / 2, y, cx + tw / 2, y);
    ctx.fillText(text, cx, y);

    // Small decorative line under title
    y += 80;
    var lineW = Math.min(tw + 40, 600);
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - lineW / 2, y);
    ctx.lineTo(cx + lineW / 2, y);
    ctx.stroke();

    // Small diamond at center of line
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.moveTo(cx, y - 8);
    ctx.lineTo(cx + 8, y);
    ctx.lineTo(cx, y + 8);
    ctx.lineTo(cx - 8, y);
    ctx.closePath();
    ctx.fill();

    return y + 50;
  }

  // ── Render QR code in gold-framed white box ───────────────────────────
  async function renderQR(ctx, qrSvg, startY) {
    var cx = W / 2;
    var qrSize = 1550;
    var pad = 70;       // Padding inside white box
    var framePad = 20;  // Gap between white box and gold frame
    var boxSize = qrSize + pad * 2;
    var frameSize = boxSize + framePad * 2;
    var frameX = (W - frameSize) / 2;
    var frameY = startY;
    var boxX = frameX + framePad;
    var boxY = frameY + framePad;

    // Gold outer frame with subtle glow
    ctx.save();
    ctx.shadowColor = 'rgba(197, 165, 90, 0.3)';
    ctx.shadowBlur = 30;
    ctx.strokeStyle = goldGrad(ctx, frameX, frameY, frameX + frameSize, frameY + frameSize);
    ctx.lineWidth = 8;
    roundRect(ctx, frameX, frameY, frameSize, frameSize, 28);
    ctx.stroke();
    ctx.restore();

    // White QR background
    ctx.fillStyle = C.qrBg;
    roundRect(ctx, boxX, boxY, boxSize, boxSize, 20);
    ctx.fill();

    // Inner gold accent line
    var innerM = 12;
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 3;
    roundRect(ctx, boxX + innerM, boxY + innerM, boxSize - innerM * 2, boxSize - innerM * 2, 14);
    ctx.stroke();

    // Draw QR code
    var qrImg = await loadQrImage(qrSvg);
    if (qrImg) {
      ctx.drawImage(qrImg, boxX + pad, boxY + pad, qrSize, qrSize);
    }

    return frameY + frameSize + 50;
  }

  // ── Render CTA — Menu side ────────────────────────────────────────────
  function renderMenuCTA(ctx, startY) {
    var cx = W / 2;
    var y = startY + 10;

    ctx.textAlign = 'center';
    ctx.fillStyle = C.cream;
    ctx.font = '600 64px Georgia, "Times New Roman", serif';
    ctx.fillText('Scan  \u2192  Tap  \u2192  View Menu', cx, y);

    y += 72;
    ctx.fillStyle = C.creamSoft;
    ctx.font = 'italic 44px Georgia, "Times New Roman", serif';
    ctx.fillText('Open Menu:', cx, y);

    return y + 50;
  }

  // ── Render CTA — Review side ──────────────────────────────────────────
  function renderReviewCTA(ctx, startY) {
    var cx = W / 2;
    var y = startY + 10;

    ctx.textAlign = 'center';
    ctx.fillStyle = C.reviewText;
    ctx.font = '600 64px Georgia, "Times New Roman", serif';
    ctx.fillText('\u2B50 Enjoyed your meal?', cx, y);

    y += 72;
    ctx.fillStyle = C.creamSoft;
    ctx.font = 'italic 44px Georgia, "Times New Roman", serif';
    ctx.fillText('Tap to leave us a review!', cx, y);

    return y + 50;
  }

  // ── Render CTA — UPI Pay side ─────────────────────────────────────────
  function renderUpiCTA(ctx, startY) {
    var cx = W / 2;
    var y = startY + 10;

    ctx.textAlign = 'center';
    ctx.fillStyle = C.upiText;
    ctx.font = '600 64px Georgia, "Times New Roman", serif';
    ctx.fillText('\uD83D\uDCB0 Scan to Pay', cx, y);

    y += 72;
    ctx.fillStyle = C.creamSoft;
    ctx.font = 'italic 44px Georgia, "Times New Roman", serif';
    ctx.fillText('Pay via UPI \u2022 PhonePe, GPay, Paytm', cx, y);

    return y + 50;
  }

  // ── Render URL pill (gold metallic) ───────────────────────────────────
  function renderURL(ctx, slug, startY) {
    var cx = W / 2;
    var y = startY;

    var urlText = 'kodspot.com/m/' + slug;
    ctx.font = '600 48px Georgia, "Times New Roman", serif';
    var tw = ctx.measureText(urlText).width;
    var pillW = tw + 100;
    var pillH = 76;
    var pillX = (W - pillW) / 2;
    var pillY = y - pillH / 2;

    // Gold pill background with gradient
    ctx.fillStyle = goldGrad(ctx, pillX, pillY, pillX + pillW, pillY + pillH);
    roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();

    // Subtle inner highlight
    ctx.strokeStyle = C.goldLight;
    ctx.lineWidth = 2;
    roundRect(ctx, pillX + 3, pillY + 3, pillW - 6, pillH - 6, (pillH - 6) / 2);
    ctx.stroke();

    // URL text (dark on gold)
    ctx.fillStyle = C.goldPillText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(urlText, cx, y + 2);
    ctx.textBaseline = 'alphabetic';

    return y + pillH / 2 + 40;
  }

  // ── Render "Flip for menu" hint (back side) ───────────────────────────
  function renderFlipHint(ctx, slug, startY) {
    var cx = W / 2;
    var y = startY;

    ctx.fillStyle = C.creamSoft;
    ctx.font = '400 40px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.7;
    ctx.fillText('\uD83D\uDCF1 For menu, flip this card', cx, y);
    ctx.globalAlpha = 1.0;

    return y + 50;
  }

  // ── Render footer ─────────────────────────────────────────────────────
  function renderFooter(ctx, plan) {
    var cx = W / 2;
    var y = H - 440;

    // Thin gold separator
    var sepW = 300;
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(cx - sepW / 2, y);
    ctx.lineTo(cx + sepW / 2, y);
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    y += 50;
    ctx.textAlign = 'center';
    ctx.fillStyle = C.gold;
    ctx.font = '600 44px Georgia, "Times New Roman", serif';
    ctx.fillText('kodspot.com', cx, y);

    if (plan !== 'PRO') {
      y += 48;
      ctx.fillStyle = C.footerText;
      ctx.font = '400 32px Georgia, "Times New Roman", serif';
      ctx.fillText('Powered by KodSpot', cx, y);
    }
  }

  // ── GENERATE FRONT SIDE ────────────────────────────────────────────────
  async function generateFront(cfg) {
    if (!cfg.qrSvg || !cfg.slug) return null;

    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');

    // Premium background
    renderBackground(ctx);
    renderBorders(ctx);
    renderCorners(ctx);

    // Branding + hotel name
    var y = renderBranding(ctx, cfg);

    // "MENU" title
    y = renderTitle(ctx, 'MENU', y);

    // QR Code in gold frame
    y = await renderQR(ctx, cfg.qrSvg, y);

    // CTA
    y = renderMenuCTA(ctx, y);

    // URL pill
    y = renderURL(ctx, cfg.slug, y);

    // Footer
    renderFooter(ctx, cfg.plan);

    return new Promise(function (resolve) {
      canvas.toBlob(resolve, 'image/png', 1.0);
    });
  }

  // ── GENERATE BACK SIDE ─────────────────────────────────────────────────
  async function generateBack(cfg) {
    var hasReview = !!(cfg.reviewUrl && cfg.reviewQrSvg);
    var hasUpi = !!(cfg.upiId && cfg.upiQrSvg);

    if (!hasReview && !hasUpi) {
      return generateFront(cfg);
    }

    var useReview = hasReview;
    var useUpi = !hasReview && hasUpi;

    if (!cfg.slug) return null;

    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');

    // Premium background
    renderBackground(ctx);
    renderBorders(ctx);
    renderCorners(ctx);

    // Branding + hotel name
    var y = renderBranding(ctx, cfg);

    // Title — contextual
    if (useReview) {
      y = renderTitle(ctx, 'REVIEW', y);
    } else {
      y = renderTitle(ctx, 'PAY', y);
    }

    // QR Code
    if (useReview && cfg.reviewQrSvg) {
      y = await renderQR(ctx, cfg.reviewQrSvg, y);
    } else if (useUpi && cfg.upiQrSvg) {
      y = await renderQR(ctx, cfg.upiQrSvg, y);
    } else {
      y = await renderQR(ctx, cfg.qrSvg, y);
    }

    // CTA
    if (useReview) {
      y = renderReviewCTA(ctx, y);
    } else if (useUpi) {
      y = renderUpiCTA(ctx, y);
    }

    // Flip hint
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

    var frontUrl = URL.createObjectURL(frontBlob);
    var backUrl = URL.createObjectURL(backBlob);
    var frontImg = await loadImageAsync(frontUrl);
    var backImg = await loadImageAsync(backUrl);
    URL.revokeObjectURL(frontUrl);
    URL.revokeObjectURL(backUrl);
    if (!frontImg || !backImg) return null;

    var gap = 120;
    var labelH = 80;
    var totalH = H + gap + labelH + H + gap + labelH;
    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = totalH;
    var ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, W, totalH);

    // Front label
    ctx.fillStyle = C.gold;
    ctx.font = '600 48px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.fillText('\u2702 FRONT SIDE \u2014 Cut along dotted line', W / 2, 56);

    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.4;
    ctx.setLineDash([20, 12]);
    ctx.beginPath();
    ctx.moveTo(40, labelH);
    ctx.lineTo(W - 40, labelH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1.0;

    // Front image
    ctx.drawImage(frontImg, 0, labelH);

    // Middle separator
    var midY = labelH + H + gap / 2;
    ctx.fillStyle = C.gold;
    ctx.font = '600 48px Georgia, "Times New Roman", serif';
    ctx.fillText('\u2702 BACK SIDE \u2014 Cut along dotted line', W / 2, midY + 24);

    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.4;
    ctx.setLineDash([20, 12]);
    ctx.beginPath();
    ctx.moveTo(40, midY + gap / 2);
    ctx.lineTo(W - 40, midY + gap / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1.0;

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
