/**
 * KODSPOT — Premium QR Card Generator v4.0
 * 600 DPI A6 · Dark walnut + gold Victorian luxury
 * Used by both admin.js and superadmin.js
 */
var KodSpotQR = (function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════════
   *  CONSTANTS
   * ══════════════════════════════════════════════════════════════════════ */
  var W = 2480;
  var H = 3508;

  var C = {
    bgDark:    '#2A1508',
    bgMid:     '#3B2314',
    bgLight:   '#4D301A',
    gold:      '#C5A55A',
    goldHi:    '#E0CC88',
    goldLo:    '#96782E',
    cream:     '#F5E6C8',
    creamSoft: '#D9C6A0',
    white:     '#FFFFFF',
    kBadge:    '#D4900A',
    footerTxt: '#8B7355'
  };

  /* ══════════════════════════════════════════════════════════════════════
   *  UTILITIES
   * ══════════════════════════════════════════════════════════════════════ */
  function rr(ctx, x, y, w, h, r) {
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

  function loadImg(src) {
    return new Promise(function (ok) {
      var i = new Image();
      i.onload = function () { ok(i); };
      i.onerror = function () { ok(null); };
      i.src = src;
    });
  }

  function loadQrImage(svg) {
    return loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  }

  function truncName(ctx, name, maxW) {
    var d = name;
    while (ctx.measureText(d).width > maxW && d.length > 10) d = d.slice(0, -1);
    if (d !== name) d += '\u2026';
    return d;
  }

  function safeName(n) {
    return (n || 'menu').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').substring(0, 40);
  }

  function gGrad(ctx, x1, y1, x2, y2) {
    var g = ctx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, C.goldLo);
    g.addColorStop(0.25, C.goldHi);
    g.addColorStop(0.5, C.gold);
    g.addColorStop(0.75, C.goldHi);
    g.addColorStop(1, C.goldLo);
    return g;
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  BACKGROUND — dark walnut with subtle leather texture
   * ══════════════════════════════════════════════════════════════════════ */
  function drawBg(ctx) {
    ctx.fillStyle = C.bgDark;
    ctx.fillRect(0, 0, W, H);

    var g = ctx.createRadialGradient(W / 2, H * 0.38, 80, W / 2, H * 0.38, W);
    g.addColorStop(0, C.bgLight);
    g.addColorStop(0.45, C.bgMid);
    g.addColorStop(1, C.bgDark);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Leather grain noise
    ctx.globalAlpha = 0.035;
    for (var i = 0; i < 20000; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#FFF';
      ctx.fillRect(
        Math.random() * W | 0,
        Math.random() * H | 0,
        Math.random() * 4 + 1,
        Math.random() * 4 + 1
      );
    }
    ctx.globalAlpha = 1;
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  DOUBLE GOLD BORDER
   * ══════════════════════════════════════════════════════════════════════ */
  function drawBorders(ctx) {
    // Outer thick gold border
    var m1 = 48;
    ctx.strokeStyle = gGrad(ctx, m1, m1, W - m1, H - m1);
    ctx.lineWidth = 12;
    rr(ctx, m1, m1, W - m1 * 2, H - m1 * 2, 18);
    ctx.stroke();

    // Inner thin gold border
    var m2 = 80;
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 5;
    rr(ctx, m2, m2, W - m2 * 2, H - m2 * 2, 14);
    ctx.stroke();
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  ORNATE VICTORIAN CORNER PIECES — large, elaborate filigree
   *  Each corner spans ~320px × 320px with scrollwork, curves & details
   * ══════════════════════════════════════════════════════════════════════ */
  function drawCornerPiece(ctx) {
    // This draws ONE corner at origin (top-left orientation).
    // Caller mirrors via scale for the other three corners.
    var gold = gGrad(ctx, 0, 0, 320, 320);
    ctx.strokeStyle = gold;
    ctx.fillStyle = gold;

    // ── Main L-arms (thick) ──
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(0, 280);
    ctx.lineTo(0, 28);
    ctx.quadraticCurveTo(0, 0, 28, 0);
    ctx.lineTo(280, 0);
    ctx.stroke();

    // ── Inner L-arms (thin, offset) ──
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(18, 260);
    ctx.lineTo(18, 36);
    ctx.quadraticCurveTo(18, 18, 36, 18);
    ctx.lineTo(260, 18);
    ctx.stroke();

    // ── Large scroll on vertical arm ──
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(0, 240);
    ctx.bezierCurveTo(30, 235, 50, 210, 50, 180);
    ctx.bezierCurveTo(50, 155, 35, 140, 14, 140);
    ctx.stroke();

    // Inner spiral of vertical scroll
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(14, 140);
    ctx.bezierCurveTo(28, 140, 38, 155, 38, 170);
    ctx.bezierCurveTo(38, 185, 28, 192, 20, 188);
    ctx.stroke();

    // ── Large scroll on horizontal arm ──
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(240, 0);
    ctx.bezierCurveTo(235, 30, 210, 50, 180, 50);
    ctx.bezierCurveTo(155, 50, 140, 35, 140, 14);
    ctx.stroke();

    // Inner spiral of horizontal scroll
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(140, 14);
    ctx.bezierCurveTo(140, 28, 155, 38, 170, 38);
    ctx.bezierCurveTo(185, 38, 192, 28, 188, 20);
    ctx.stroke();

    // ── Corner fan / shell motif ──
    ctx.lineWidth = 5;
    // Fan curve 1
    ctx.beginPath();
    ctx.moveTo(40, 10);
    ctx.bezierCurveTo(60, 30, 70, 60, 60, 90);
    ctx.stroke();
    // Fan curve 2
    ctx.beginPath();
    ctx.moveTo(10, 40);
    ctx.bezierCurveTo(30, 60, 60, 70, 90, 60);
    ctx.stroke();
    // Fan curve 3 (inner)
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(34, 22);
    ctx.bezierCurveTo(50, 40, 56, 56, 48, 72);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(22, 34);
    ctx.bezierCurveTo(40, 50, 56, 56, 72, 48);
    ctx.stroke();

    // ── Corner diamond accent ──
    ctx.beginPath();
    ctx.moveTo(48, 6);
    ctx.lineTo(58, -4);
    ctx.lineTo(68, 6);
    ctx.lineTo(58, 16);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(6, 48);
    ctx.lineTo(-4, 58);
    ctx.lineTo(6, 68);
    ctx.lineTo(16, 58);
    ctx.closePath();
    ctx.fill();

    // ── Teardrop / leaf accents along arms ──
    // Vertical arm leaves
    [180, 210, 240].forEach(function (yy) {
      ctx.beginPath();
      ctx.ellipse(8, yy, 4, 9, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    // Horizontal arm leaves
    [180, 210, 240].forEach(function (xx) {
      ctx.beginPath();
      ctx.ellipse(xx, 8, 9, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    // ── Decorative dots near tips ──
    [265, 275, 285].forEach(function (xx) {
      ctx.beginPath();
      ctx.arc(xx, 5, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    [265, 275, 285].forEach(function (yy) {
      ctx.beginPath();
      ctx.arc(5, yy, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    // ── Small fleur-de-lis center accent ──
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(80, 80);
    ctx.bezierCurveTo(100, 60, 110, 40, 95, 25);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(80, 80);
    ctx.bezierCurveTo(60, 100, 40, 110, 25, 95);
    ctx.stroke();
    // Center dot
    ctx.beginPath();
    ctx.arc(80, 80, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCorners(ctx) {
    var m = 56;
    var positions = [
      { x: m,     y: m,     sx: 1,  sy: 1 },
      { x: W - m, y: m,     sx: -1, sy: 1 },
      { x: m,     y: H - m, sx: 1,  sy: -1 },
      { x: W - m, y: H - m, sx: -1, sy: -1 }
    ];
    positions.forEach(function (p) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(p.sx, p.sy);
      drawCornerPiece(ctx);
      ctx.restore();
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  BRANDING ROW — K badge + "KodSpot" + Hotel Name + City
   * ══════════════════════════════════════════════════════════════════════ */
  function drawBranding(ctx, cfg) {
    var lx = 160;
    var y = 210;

    // --- Orange K badge (larger) ---
    var bs = 110;
    var br = 20;
    ctx.fillStyle = C.kBadge;
    rr(ctx, lx, y - bs + 15, bs, bs, br);
    ctx.fill();
    ctx.fillStyle = C.white;
    ctx.font = 'bold 76px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('K', lx + bs / 2, y - bs / 2 + 17);

    // --- "KodSpot" in gold ---
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.goldHi;
    ctx.font = 'bold 74px Georgia, "Times New Roman", serif';
    var ksX = lx + bs + 24;
    ctx.fillText('KodSpot', ksX, y);

    // --- Hotel name in cream ---
    var ksW = ctx.measureText('KodSpot').width;
    ctx.fillStyle = C.cream;
    ctx.font = '400 64px Georgia, "Times New Roman", serif';
    var nameX = ksX + ksW + 24;
    var maxNW = W - nameX - 180;
    ctx.fillText(truncName(ctx, cfg.name || 'Restaurant', maxNW), nameX, y);

    // --- City ---
    y += 70;
    if (cfg.city) {
      ctx.fillStyle = C.creamSoft;
      ctx.font = '400 52px Georgia, "Times New Roman", serif';
      ctx.fillText('\uD83D\uDCCD ' + cfg.city, ksX, y);
      y += 80;
    } else {
      y += 30;
    }
    return y;
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  TITLE — large gold serif "MENU" / "REVIEW" / "PAY"
   * ══════════════════════════════════════════════════════════════════════ */
  function drawTitle(ctx, text, startY) {
    var cx = W / 2;
    var y = startY + 30;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 180px Georgia, "Times New Roman", serif';
    var tw = ctx.measureText(text).width;

    // Gold gradient fill
    ctx.fillStyle = gGrad(ctx, cx - tw / 2, y - 80, cx + tw / 2, y + 80);
    ctx.fillText(text, cx, y);

    // Underline with diamond
    y += 104;
    var lw = Math.min(tw + 60, 700);
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx - lw / 2, y);
    ctx.lineTo(cx + lw / 2, y);
    ctx.stroke();

    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.moveTo(cx, y - 10);
    ctx.lineTo(cx + 10, y);
    ctx.lineTo(cx, y + 10);
    ctx.lineTo(cx - 10, y);
    ctx.closePath();
    ctx.fill();

    return y + 40;
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  QR CODE — in white box with ornate gold frame
   * ══════════════════════════════════════════════════════════════════════ */
  async function drawQR(ctx, qrSvg, startY) {
    var cx = W / 2;
    var qrSize = 1500;
    var pad = 80;
    var boxSz = qrSize + pad * 2;
    var framePad = 28;
    var frameSz = boxSz + framePad * 2;
    var fx = (W - frameSz) / 2;
    var fy = startY;
    var bx = fx + framePad;
    var by = fy + framePad;

    // --- Outer gold frame (thick, with glow) ---
    ctx.save();
    ctx.shadowColor = 'rgba(197,165,90,0.35)';
    ctx.shadowBlur = 40;
    ctx.strokeStyle = gGrad(ctx, fx, fy, fx + frameSz, fy + frameSz);
    ctx.lineWidth = 14;
    rr(ctx, fx, fy, frameSz, frameSz, 24);
    ctx.stroke();
    ctx.restore();

    // --- Inner decorative gold line ---
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 4;
    rr(ctx, fx + 20, fy + 20, frameSz - 40, frameSz - 40, 18);
    ctx.stroke();

    // --- Small corner accents on the QR frame ---
    var cornerLen = 60;
    var cm = 10; // offset from outer frame edge
    var corners = [
      [fx + cm, fy + cm],
      [fx + frameSz - cm, fy + cm],
      [fx + cm, fy + frameSz - cm],
      [fx + frameSz - cm, fy + frameSz - cm]
    ];
    ctx.strokeStyle = C.goldHi;
    ctx.lineWidth = 5;
    corners.forEach(function (c, i) {
      var sx = (i % 2 === 0) ? 1 : -1;
      var sy = (i < 2) ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(c[0], c[1] + sy * cornerLen);
      ctx.lineTo(c[0], c[1]);
      ctx.lineTo(c[0] + sx * cornerLen, c[1]);
      ctx.stroke();
      // Tiny diamond
      ctx.fillStyle = C.goldHi;
      ctx.beginPath();
      ctx.moveTo(c[0], c[1] + sy * 8);
      ctx.lineTo(c[0] + sx * 8, c[1]);
      ctx.lineTo(c[0], c[1] - sy * 8);
      ctx.lineTo(c[0] - sx * 8, c[1]);
      ctx.closePath();
      ctx.fill();
    });

    // --- White background ---
    ctx.fillStyle = C.white;
    rr(ctx, bx, by, boxSz, boxSz, 16);
    ctx.fill();

    // --- QR image ---
    var qrImg = await loadQrImage(qrSvg);
    if (qrImg) {
      ctx.drawImage(qrImg, bx + pad, by + pad, qrSize, qrSize);
    }

    return fy + frameSz + 40;
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  CTA SECTIONS
   * ══════════════════════════════════════════════════════════════════════ */
  function drawMenuCTA(ctx, y) {
    var cx = W / 2;
    ctx.textAlign = 'center';
    ctx.fillStyle = C.cream;
    ctx.font = '600 76px Georgia, "Times New Roman", serif';
    ctx.fillText('Scan  \u2192  Tap  \u2192  View Menu', cx, y);
    y += 78;
    ctx.fillStyle = C.creamSoft;
    ctx.font = 'italic 50px Georgia, "Times New Roman", serif';
    ctx.fillText('Open Menu:', cx, y);
    return y + 44;
  }

  function drawReviewCTA(ctx, y) {
    var cx = W / 2;
    ctx.textAlign = 'center';
    ctx.fillStyle = C.cream;
    ctx.font = '600 76px Georgia, "Times New Roman", serif';
    ctx.fillText('\u2B50 Enjoyed your meal?', cx, y);
    y += 78;
    ctx.fillStyle = C.creamSoft;
    ctx.font = 'italic 50px Georgia, "Times New Roman", serif';
    ctx.fillText('Tap to leave us a review!', cx, y);
    return y + 44;
  }

  function drawUpiCTA(ctx, y) {
    var cx = W / 2;
    ctx.textAlign = 'center';
    ctx.fillStyle = C.cream;
    ctx.font = '600 76px Georgia, "Times New Roman", serif';
    ctx.fillText('\uD83D\uDCB0 Scan to Pay', cx, y);
    y += 78;
    ctx.fillStyle = C.creamSoft;
    ctx.font = 'italic 50px Georgia, "Times New Roman", serif';
    ctx.fillText('Pay via UPI \u2022 PhonePe, GPay, Paytm', cx, y);
    return y + 44;
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  URL PILL — gold metallic
   * ══════════════════════════════════════════════════════════════════════ */
  function drawURL(ctx, slug, y) {
    var cx = W / 2;
    var txt = 'kodspot.com/m/' + slug;
    ctx.font = '600 52px Georgia, "Times New Roman", serif';
    var tw = ctx.measureText(txt).width;
    var pw = tw + 110;
    var ph = 84;
    var px = (W - pw) / 2;
    var py = y - ph / 2;

    ctx.fillStyle = gGrad(ctx, px, py, px + pw, py + ph);
    rr(ctx, px, py, pw, ph, ph / 2);
    ctx.fill();

    // Highlight border
    ctx.strokeStyle = C.goldHi;
    ctx.lineWidth = 2;
    rr(ctx, px + 3, py + 3, pw - 6, ph - 6, (ph - 6) / 2);
    ctx.stroke();

    ctx.fillStyle = C.bgDark;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, cx, y + 2);
    ctx.textBaseline = 'alphabetic';

    return y + ph / 2 + 30;
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  FLIP HINT (back side)
   * ══════════════════════════════════════════════════════════════════════ */
  function drawFlipHint(ctx, y) {
    var cx = W / 2;
    ctx.fillStyle = C.creamSoft;
    ctx.font = '400 44px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.65;
    ctx.fillText('\uD83D\uDCF1 For menu, flip this card', cx, y);
    ctx.globalAlpha = 1;
    return y + 50;
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  FOOTER — "kodspot.com" + optional powered-by
   * ══════════════════════════════════════════════════════════════════════ */
  function drawFooter(ctx, plan) {
    var cx = W / 2;
    var y = H - 200;

    // Gold separator
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(cx - 160, y - 50);
    ctx.lineTo(cx + 160, y - 50);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.fillStyle = C.gold;
    ctx.font = '600 50px Georgia, "Times New Roman", serif';
    ctx.fillText('kodspot.com', cx, y);

    if (plan !== 'PRO') {
      ctx.fillStyle = C.footerTxt;
      ctx.font = '400 34px Georgia, "Times New Roman", serif';
      ctx.fillText('Powered by KodSpot', cx, y + 50);
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  SHARED CARD SCAFFOLD — all the premium framing
   * ══════════════════════════════════════════════════════════════════════ */
  function drawFrame(ctx) {
    drawBg(ctx);
    drawBorders(ctx);
    drawCorners(ctx);
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  GENERATE FRONT SIDE
   * ══════════════════════════════════════════════════════════════════════ */
  async function generateFront(cfg) {
    if (!cfg.qrSvg || !cfg.slug) return null;

    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');

    drawFrame(ctx);
    var y = drawBranding(ctx, cfg);
    y = drawTitle(ctx, 'MENU', y);
    y = await drawQR(ctx, cfg.qrSvg, y);
    y = drawMenuCTA(ctx, y);
    y = drawURL(ctx, cfg.slug, y);
    drawFooter(ctx, cfg.plan);

    return new Promise(function (ok) { canvas.toBlob(ok, 'image/png', 1.0); });
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  GENERATE BACK SIDE
   * ══════════════════════════════════════════════════════════════════════ */
  async function generateBack(cfg) {
    var hasReview = !!(cfg.reviewUrl && cfg.reviewQrSvg);
    var hasUpi = !!(cfg.upiId && cfg.upiQrSvg);
    if (!hasReview && !hasUpi) return generateFront(cfg);

    var useReview = hasReview;
    var useUpi = !hasReview && hasUpi;
    if (!cfg.slug) return null;

    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');

    drawFrame(ctx);
    var y = drawBranding(ctx, cfg);

    if (useReview) {
      y = drawTitle(ctx, 'REVIEW', y);
    } else {
      y = drawTitle(ctx, 'PAY', y);
    }

    if (useReview) {
      y = await drawQR(ctx, cfg.reviewQrSvg, y);
      y = drawReviewCTA(ctx, y);
    } else if (useUpi) {
      y = await drawQR(ctx, cfg.upiQrSvg, y);
      y = drawUpiCTA(ctx, y);
    } else {
      y = await drawQR(ctx, cfg.qrSvg, y);
    }

    y = drawFlipHint(ctx, y);
    drawFooter(ctx, cfg.plan);

    return new Promise(function (ok) { canvas.toBlob(ok, 'image/png', 1.0); });
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  GENERATE PRINT-READY (both sides stacked)
   * ══════════════════════════════════════════════════════════════════════ */
  async function generatePrintReady(cfg) {
    var fb = await generateFront(cfg);
    var bb = await generateBack(cfg);
    if (!fb || !bb) return null;

    var fu = URL.createObjectURL(fb);
    var bu = URL.createObjectURL(bb);
    var fi = await loadImg(fu);
    var bi = await loadImg(bu);
    URL.revokeObjectURL(fu);
    URL.revokeObjectURL(bu);
    if (!fi || !bi) return null;

    var gap = 120;
    var lh = 80;
    var totalH = H + gap + lh + H + gap + lh;
    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = totalH;
    var ctx = canvas.getContext('2d');

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
    ctx.beginPath(); ctx.moveTo(40, lh); ctx.lineTo(W - 40, lh); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.drawImage(fi, 0, lh);

    // Back label
    var midY = lh + H + gap / 2;
    ctx.fillStyle = C.gold;
    ctx.font = '600 48px Georgia, "Times New Roman", serif';
    ctx.fillText('\u2702 BACK SIDE \u2014 Cut along dotted line', W / 2, midY + 24);
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.4;
    ctx.setLineDash([20, 12]);
    ctx.beginPath(); ctx.moveTo(40, midY + gap / 2); ctx.lineTo(W - 40, midY + gap / 2); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.drawImage(bi, 0, lh + H + gap + lh);

    return new Promise(function (ok) { canvas.toBlob(ok, 'image/png', 1.0); });
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  DOWNLOAD HELPER
   * ══════════════════════════════════════════════════════════════════════ */
  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  PUBLIC API
   * ══════════════════════════════════════════════════════════════════════ */
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
